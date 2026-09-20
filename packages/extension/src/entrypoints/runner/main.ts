import {
	DEFAULT_TYPESAFE_JEV_MODEL,
	DirectHttpJevTransport,
	JevDecisionProvider,
	JevDecisionRouter,
	JevTaskRouter,
	RetryingJevTransport,
	SeedThresholdPolicy,
} from '@page-agent/decision-jev'
import type { PublicSessionStartPayload } from '@page-agent/protocol'
import type { DecisionRouter, SemanticTextProvider, TaskRouter } from '@page-agent/runtime'

import type { RunnerRequestPayload } from '@/agent/RunnerPort.background'
import { ChromeRuntimeRpc } from '@/runtime/ChromeRuntimeRpc'
import { ExtensionBrowserRuntime } from '@/runtime/ExtensionBrowserRuntime'
import { OpenAiCompatibleSemanticTextProvider } from '@/runtime/OpenAiCompatibleSemanticTextProvider'
import { createRunnerHost } from '@/runtime/RunnerHost'

const handles = new Map<string, import('@page-agent/runtime').SessionHandle>()
let backgroundPort: chrome.runtime.Port | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
const pendingEvents: unknown[] = []

function connectBackground(): void {
	if (backgroundPort) return
	const port = chrome.runtime.connect({ name: 'page-agent-runner-v2' })
	backgroundPort = port
	port.onMessage.addListener((message: unknown) => {
		if (!isRunnerRequest(message)) return
		void handle(message.payload)
			.then((value) => {
				postResponse(port, {
					type: 'PAGE_AGENT_V2_RUNNER_RESPONSE',
					requestId: message.requestId,
					ok: true,
					value,
				})
			})
			.catch((error: unknown) => {
				postResponse(port, {
					type: 'PAGE_AGENT_V2_RUNNER_RESPONSE',
					requestId: message.requestId,
					ok: false,
					error: {
						code: 'RUNNER_ERROR',
						message: error instanceof Error ? error.message : String(error),
					},
				})
			})
	})
	port.onDisconnect.addListener(() => {
		if (backgroundPort !== port) return
		backgroundPort = undefined
		if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined
			connectBackground()
		}, 100)
	})
	flushPendingEvents()
}

function postResponse(port: chrome.runtime.Port, message: unknown): void {
	// A response belongs to the background request that arrived on this exact
	// connection. If it disconnected, that request has already been rejected.
	if (backgroundPort !== port) return
	try {
		port.postMessage(message)
	} catch {
		// The disconnect listener reconnects the control channel.
	}
}

function postEvent(message: unknown): void {
	const port = backgroundPort
	if (!port) {
		pendingEvents.push(message)
		return
	}
	try {
		port.postMessage(message)
	} catch {
		pendingEvents.push(message)
	}
}

function flushPendingEvents(): void {
	const port = backgroundPort
	if (!port) return
	while (pendingEvents.length > 0) {
		const event = pendingEvents[0]
		try {
			port.postMessage(event)
			pendingEvents.shift()
		} catch {
			return
		}
	}
}

async function handle(payload: RunnerRequestPayload): Promise<unknown> {
	switch (payload.type) {
		case 'session.start': {
			const handle = await host.manager.create({
				request: payload.input.task,
				owner: { kind: 'external_client', ownerId: payload.input.origin },
				capabilities: payload.input.capabilities as import('@page-agent/runtime').Capability[],
				goals: [],
				initialTabId: payload.input.initialTabId,
			})
			handles.set(handle.id, handle)
			void forwardEvents(handle.id)
			void handle.result.finally(() => handles.delete(handle.id))
			return { sessionId: handle.id }
		}
		case 'session.cancel':
			await host.manager.command({
				type: 'cancel',
				sessionId: payload.input.sessionId,
				reason: 'public-api',
			})
			return undefined
		case 'session.reply':
			await host.manager.command({
				type: 'session.reply',
				sessionId: payload.input.sessionId,
				text: payload.input.text,
			})
			return undefined
		case 'session.result': {
			const handle = handles.get(payload.input.sessionId)
			const result = handle ? await handle.result : await host.manager.get(payload.input.sessionId)
			return result
				? { status: result.status, summary: result.finalResponse, data: result.data }
				: undefined
		}
	}
}

async function forwardEvents(sessionId: string): Promise<void> {
	for await (const event of host.manager.subscribe(sessionId)) {
		postEvent({ type: 'PAGE_AGENT_V2_RUNNER_EVENT', sessionId, event })
		if (event.type === 'session.terminal') break
	}
}

class LazyProviders {
	private current = this.load()

	constructor() {
		chrome.storage.onChanged.addListener((changes, areaName) => {
			if (areaName === 'local' && (changes.jevConfig || changes.llmConfig))
				this.current = this.load()
		})
	}

	get(): Promise<{
		decisions: DecisionRouter
		taskRouter: TaskRouter
		semanticText: SemanticTextProvider
	}> {
		return this.current
	}

	private async load(): Promise<{
		decisions: DecisionRouter
		taskRouter: TaskRouter
		semanticText: SemanticTextProvider
	}> {
		const stored = await chrome.storage.local.get(['jevConfig', 'llmConfig'])
		const semanticText: SemanticTextProvider = isLlmConfig(stored.llmConfig)
			? new OpenAiCompatibleSemanticTextProvider(stored.llmConfig)
			: unavailableSemanticText('Semantic model provider is not configured')
		if (!isJevConfig(stored.jevConfig)) {
			const blocked = blockedDecisionRouter('Jev provider is not configured')
			return {
				decisions: blocked,
				taskRouter: {
					route: async () => {
						throw new Error('Jev provider is not configured')
					},
				},
				semanticText,
			}
		}
		const provider = new JevDecisionProvider({
			model: normalizeJevModel(stored.jevConfig),
			transport: new RetryingJevTransport(
				new DirectHttpJevTransport({
					endpoint: stored.jevConfig.endpoint,
					apiKey: stored.jevConfig.apiKey,
				})
			),
			thresholds: new SeedThresholdPolicy(),
			telemetry: 'redacted',
		})
		return {
			decisions: new JevDecisionRouter(provider, semanticText),
			taskRouter: new JevTaskRouter(provider),
			semanticText,
		}
	}
}

class LazyDecisionRouter implements DecisionRouter {
	constructor(private readonly providers: LazyProviders) {}
	async decide(...args: Parameters<DecisionRouter['decide']>) {
		return (await this.providers.get()).decisions.decide(...args)
	}
}

class LazyTaskRouter implements TaskRouter {
	constructor(private readonly providers: LazyProviders) {}
	async route(...args: Parameters<TaskRouter['route']>) {
		return (await this.providers.get()).taskRouter.route(...args)
	}
	async shouldClarify(...args: Parameters<NonNullable<TaskRouter['shouldClarify']>>) {
		const router = (await this.providers.get()).taskRouter
		return router.shouldClarify ? router.shouldClarify(...args) : true
	}
}

class LazySemanticTextProvider implements SemanticTextProvider {
	constructor(private readonly providers: LazyProviders) {}
	async plan(...args: Parameters<NonNullable<SemanticTextProvider['plan']>>) {
		const provider = (await this.providers.get()).semanticText
		if (!provider.plan) throw new Error('Semantic model does not support typed task planning')
		return provider.plan(...args)
	}
	async extract(...args: Parameters<NonNullable<SemanticTextProvider['extract']>>) {
		const provider = (await this.providers.get()).semanticText
		if (!provider.extract)
			throw new Error('Semantic model does not support typed evidence extraction')
		return provider.extract(...args)
	}
	async generate(...args: Parameters<SemanticTextProvider['generate']>) {
		return (await this.providers.get()).semanticText.generate(...args)
	}
}

function blockedDecisionRouter(reason: string): DecisionRouter {
	return {
		decide: async () => ({ kind: 'blocked', reason }),
	}
}

function unavailableSemanticText(reason: string): SemanticTextProvider {
	return {
		generate: async () => {
			throw new Error(reason)
		},
	}
}

interface StoredLlmConfig {
	baseURL: string
	model: string
	apiKey?: string
}

function isLlmConfig(value: unknown): value is StoredLlmConfig {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (typeof candidate.baseURL !== 'string' || typeof candidate.model !== 'string') return false
	try {
		const url = new URL(candidate.baseURL)
		return (
			['http:', 'https:'].includes(url.protocol) &&
			candidate.model.trim().length > 0 &&
			(candidate.apiKey === undefined || typeof candidate.apiKey === 'string')
		)
	} catch {
		return false
	}
}

interface StoredJevConfig {
	endpoint: string
	model: string
	apiKey?: string
}

function isJevConfig(value: unknown): value is StoredJevConfig {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (typeof candidate.endpoint !== 'string' || typeof candidate.model !== 'string') return false
	try {
		const endpoint = new URL(candidate.endpoint)
		if (!['http:', 'https:'].includes(endpoint.protocol)) return false
	} catch {
		return false
	}
	return (
		candidate.model.trim().length > 0 &&
		(candidate.apiKey === undefined || typeof candidate.apiKey === 'string')
	)
}

function normalizeJevModel(config: StoredJevConfig): string {
	if (config.model.trim() === 'jev' || config.model.trim() === 'jev-1.13')
		return DEFAULT_TYPESAFE_JEV_MODEL
	return config.model.trim() || DEFAULT_TYPESAFE_JEV_MODEL
}

const providers = new LazyProviders()
const host = createRunnerHost({
	browser: new ExtensionBrowserRuntime(new ChromeRuntimeRpc()),
	decisions: new LazyDecisionRouter(providers),
	taskRouter: new LazyTaskRouter(providers),
	semanticText: new LazySemanticTextProvider(providers),
})

function isRunnerRequest(value: unknown): value is {
	type: 'PAGE_AGENT_V2_RUNNER_REQUEST'
	requestId: string
	payload: RunnerRequestPayload
} {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_RUNNER_REQUEST' &&
		typeof candidate.requestId === 'string' &&
		typeof candidate.payload === 'object' &&
		candidate.payload !== null
	)
}

connectBackground()

export type { PublicSessionStartPayload }
