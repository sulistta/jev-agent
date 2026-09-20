import type {
	Capability,
	JsonValue,
	PublicApiRequest,
	PublicApiResponse,
	PublicSessionEvent,
	PublicSessionStartPayload,
} from '@page-agent/protocol'

import { isTrustedExtensionPageSender } from '@/security/ExtensionSender'
import {
	ChromeStorageGrantStore,
	ChromeStorageNonceStore,
	OriginGrantManager,
	type PublicSessionGrant,
} from '@/security/OriginGrants'

import {
	ensureRunnerTab,
	registerRunnerPort,
	runnerGateway,
	subscribeRunnerEvents,
} from './RunnerPort.background'

export interface PublicSessionGateway {
	start(
		input: PublicSessionStartPayload & {
			origin: string
			sessionToken: string
			initialTabId?: string
		}
	): Promise<{ sessionId: string }>
	cancel(input: { origin: string; sessionId: string; sessionToken: string }): Promise<void>
	reply(input: {
		origin: string
		sessionId: string
		sessionToken: string
		text: string
	}): Promise<void>
	result(input: {
		origin: string
		sessionId: string
		sessionToken: string
	}): Promise<{ status: string; summary?: string; data?: JsonValue }>
}

const systemClock = { now: () => new Date().toISOString() }
const randomIds = {
	next(kind: 'grant' | 'session-token'): string {
		return `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
	},
}
let gateway: PublicSessionGateway | undefined = runnerGateway()
const publicSessionTabs = new Map<string, number>()
const bufferedPublicEvents = new Map<string, PublicSessionEvent[]>()
const grants = new OriginGrantManager(
	new ChromeStorageGrantStore(),
	systemClock,
	randomIds,
	new ChromeStorageNonceStore()
)

subscribeRunnerEvents(({ sessionId, event }) => {
	const tabId = publicSessionTabs.get(sessionId)
	if (tabId === undefined) {
		const buffered = bufferedPublicEvents.get(sessionId) ?? []
		buffered.push(event)
		if (buffered.length > 128) buffered.shift()
		bufferedPublicEvents.set(sessionId, buffered)
	} else {
		void deliverPublicEvent(tabId, event)
	}
	if (event.type === 'session.terminal') publicSessionTabs.delete(sessionId)
})

export function configurePublicSessionGateway(next: PublicSessionGateway | undefined): void {
	gateway = next
}

export function registerPublicRunnerPort(port: chrome.runtime.Port): void {
	registerRunnerPort(port)
}

type GrantSummary = Pick<
	import('@/security/OriginGrants').OriginGrant,
	'grantId' | 'origin' | 'capabilities' | 'expiresAt'
>

export async function listOriginGrants(
	sender: chrome.runtime.MessageSender
): Promise<{ ok: true; grants: GrantSummary[] } | { ok: false; code: string; message: string }> {
	if (!isTrustedExtensionPageSender(sender))
		return {
			ok: false,
			code: 'PROTOCOL_UNAUTHORIZED_SENDER',
			message: 'Only an extension page may list grants',
		}
	return { ok: true, grants: (await grants.list()).filter((grant) => !grant.revokedAt) }
}

export async function revokeOriginGrant(
	message: unknown,
	sender: chrome.runtime.MessageSender
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
	if (!isTrustedExtensionPageSender(sender) || !isGrantRevokeMessage(message))
		return {
			ok: false,
			code: 'PROTOCOL_UNAUTHORIZED_SENDER',
			message: 'Only an extension page may revoke a grant',
		}
	const result = await grants.revoke(message.grantId)
	return result.ok ? { ok: true } : result
}

export async function createOriginGrant(
	message: unknown,
	sender: chrome.runtime.MessageSender
): Promise<
	| {
			ok: true
			grantId: string
			origin: string
			capabilities: Capability[]
			expiresAt: string
	  }
	| { ok: false; code: string; message: string }
> {
	if (!isTrustedExtensionPageSender(sender) || !isGrantCreateMessage(message))
		return {
			ok: false,
			code: 'PROTOCOL_UNAUTHORIZED_SENDER',
			message: 'Only an extension page may create a grant',
		}
	try {
		const grant = await grants.create(message.origin, message.capabilities, message.ttlMs)
		return {
			ok: true,
			grantId: grant.grantId,
			origin: grant.origin,
			capabilities: grant.capabilities,
			expiresAt: grant.expiresAt,
		}
	} catch (error) {
		return {
			ok: false,
			code: 'GRANT_INVALID',
			message: error instanceof Error ? error.message : String(error),
		}
	}
}

export async function handlePublicApiMessage(
	message: unknown,
	sender: chrome.runtime.MessageSender
): Promise<PublicApiResponse> {
	if (!isPublicMessage(message))
		return failure('PROTOCOL_MALFORMED', 'Malformed public API request', false, 'unknown')
	const request = message.payload
	if (sender.tab?.id === undefined)
		return failure(
			'PROTOCOL_UNAUTHORIZED_SENDER',
			'Public API request has no tab sender',
			false,
			request.requestId
		)
	const tab = await chrome.tabs.get(sender.tab.id)
	const actualOrigin = originOf(tab.url)
	if (!actualOrigin || request.origin !== actualOrigin)
		return failure(
			'ORIGIN_MISMATCH',
			'Request origin does not match the sender tab',
			false,
			request.requestId
		)
	if (!gateway)
		return failure(
			'RUNNER_UNAVAILABLE',
			'The extension runner is not connected',
			true,
			request.requestId
		)

	try {
		if (request.type === 'session.start') {
			const issued = await grants.issueSessionForOrigin({
				origin: request.origin,
				nonce: request.nonce,
				requestedCapabilities: request.payload.capabilities,
			})
			if (!issued.ok) return failure(issued.code, issued.message, false, request.requestId)
			const created = await gateway.start({
				...request.payload,
				origin: request.origin,
				sessionToken: issued.value.sessionToken,
				initialTabId: String(sender.tab.id),
			})
			publicSessionTabs.set(created.sessionId, sender.tab.id)
			flushBufferedEvents(created.sessionId, sender.tab.id)
			return {
				requestId: request.requestId,
				ok: true,
				payload: { sessionId: created.sessionId, sessionToken: issued.value.sessionToken },
			}
		}

		const valid = await grants.validateSession(request.sessionToken, request.origin)
		if (!valid.ok) return failure(valid.code, valid.message, false, request.requestId)
		if (request.type === 'session.cancel') {
			await gateway.cancel(request)
			return { requestId: request.requestId, ok: true, payload: { status: 'cancelled' } }
		}
		if (request.type === 'session.reply') {
			await gateway.reply({ ...request, text: request.text! })
			return { requestId: request.requestId, ok: true, payload: { status: 'running' } }
		}
		return { requestId: request.requestId, ok: true, payload: await gateway.result(request) }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message === 'RUNNER_UNAVAILABLE') {
			await ensureRunnerTab()
			return failure(
				'RUNNER_STARTING',
				'The extension runner is starting; retry the request',
				true,
				request.requestId
			)
		}
		return failure('RUNNER_ERROR', message, true, request.requestId)
	}
}

function flushBufferedEvents(sessionId: string, tabId: number): void {
	const buffered = bufferedPublicEvents.get(sessionId)
	if (!buffered) return
	bufferedPublicEvents.delete(sessionId)
	for (const event of buffered) void deliverPublicEvent(tabId, event)
	if (buffered.some((event) => event.type === 'session.terminal'))
		publicSessionTabs.delete(sessionId)
}

async function deliverPublicEvent(tabId: number, event: PublicSessionEvent): Promise<void> {
	try {
		await chrome.tabs.sendMessage(tabId, {
			type: 'PAGE_AGENT_V2_PUBLIC_EVENT',
			payload: event,
		})
	} catch {
		// The page may have navigated or closed before the event was delivered.
	}
}

function isPublicMessage(
	value: unknown
): value is { type: 'PAGE_AGENT_V2_PUBLIC'; payload: PublicApiRequest } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (
		candidate.type !== 'PAGE_AGENT_V2_PUBLIC' ||
		typeof candidate.payload !== 'object' ||
		candidate.payload === null
	)
		return false
	const payload = candidate.payload as Record<string, unknown>
	if (
		typeof payload.type !== 'string' ||
		!['session.start', 'session.cancel', 'session.result', 'session.reply'].includes(
			payload.type
		) ||
		typeof payload.requestId !== 'string' ||
		typeof payload.origin !== 'string'
	)
		return false
	if (payload.type === 'session.start') {
		const start = payload.payload
		const startRecord =
			typeof start === 'object' && start !== null ? (start as Record<string, unknown>) : null
		return (
			typeof payload.nonce === 'string' &&
			startRecord !== null &&
			typeof startRecord.task === 'string' &&
			isCapabilityList(startRecord.capabilities)
		)
	}
	return (
		typeof payload.sessionId === 'string' &&
		typeof payload.sessionToken === 'string' &&
		(payload.type !== 'session.reply' ||
			(typeof payload.text === 'string' && payload.text.trim().length > 0))
	)
}

function isGrantCreateMessage(value: unknown): value is {
	type: 'PAGE_AGENT_V2_GRANT_CREATE'
	origin: string
	capabilities: Capability[]
	ttlMs: number
} {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_GRANT_CREATE' &&
		typeof candidate.origin === 'string' &&
		Array.isArray(candidate.capabilities) &&
		candidate.capabilities.every(isCapability) &&
		typeof candidate.ttlMs === 'number' &&
		Number.isFinite(candidate.ttlMs) &&
		candidate.ttlMs > 0
	)
}

function isCapability(value: unknown): value is Capability {
	return (
		typeof value === 'string' &&
		['dom.read', 'dom.write', 'navigation', 'tabs.read', 'tabs.write', 'sensitive.submit'].includes(
			value
		)
	)
}

function isCapabilityList(value: unknown): value is Capability[] {
	return Array.isArray(value) && value.every(isCapability)
}

function isGrantRevokeMessage(value: unknown): value is {
	type: 'PAGE_AGENT_V2_GRANT_REVOKE'
	grantId: string
} {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return candidate.type === 'PAGE_AGENT_V2_GRANT_REVOKE' && typeof candidate.grantId === 'string'
}

function originOf(url: string | undefined): string | undefined {
	if (!url) return undefined
	try {
		const parsed = new URL(url)
		return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : undefined
	} catch {
		return undefined
	}
}

function failure(
	code: string,
	message: string,
	retryable: boolean,
	requestId: string
): PublicApiResponse {
	return { requestId, ok: false, error: { code, message, retryable } }
}

export type { PublicSessionGrant }
