import type {
	ActionReceipt,
	BrowserAction,
	BrowserActionRequest,
	BrowserCapabilities,
	BrowserRuntime,
	ElementRef,
	ObservationRequest,
	PageObservation,
	ReferenceValidation,
	SynchronizationRequest,
	SynchronizationResult,
	TabDescriptor,
	TabsRuntime,
} from '@page-agent/browser'
import type { DomRpcRequest, JsonObject, TabRpcRequest, WireElementRef } from '@page-agent/protocol'

export interface ExtensionRpc {
	request<T>(payload: DomRpcRequest | TabRpcRequest, signal: AbortSignal): Promise<T>
}

export class ExtensionBrowserRuntime implements BrowserRuntime {
	readonly capabilities: BrowserCapabilities = {
		mode: 'extension',
		tabs: true,
		dom: true,
		mutationSignals: true,
		navigationSignals: true,
		screenshots: false,
		arbitraryJavascript: false,
		supportedActions: [
			'click',
			'input',
			'select',
			'scroll',
			'focus',
			'tab.open',
			'tab.switch',
			'tab.close',
		],
		protocolVersion: '2.0',
	}
	readonly tabs: TabsRuntime
	private readonly rpc: ExtensionRpc
	private sessionId: string | undefined

	constructor(rpc: ExtensionRpc) {
		this.rpc = rpc
		this.tabs = new ExtensionTabsRuntime(rpc, () => this.sessionId)
	}

	observe(request: ObservationRequest, signal: AbortSignal): Promise<PageObservation> {
		this.sessionId = request.sessionId
		return this.rpc.request<PageObservation>(
			{
				type: 'dom.observe',
				requestId: requestId(),
				sessionId: request.sessionId,
				tabId: request.tabId,
				scope: request.scope,
				includeText: request.includeText,
				includeNonInteractive: request.includeNonInteractive,
				attributes: request.attributes,
				sensitivityPolicyId: request.sensitivityPolicyId,
			},
			signal
		)
	}

	async execute(request: BrowserActionRequest, signal: AbortSignal): Promise<ActionReceipt> {
		this.sessionId = request.sessionId
		const startedAt = new Date().toISOString()
		try {
			return await this.rpc.request<ActionReceipt>(
				{
					type: 'dom.execute',
					requestId: requestId(),
					sessionId: request.sessionId,
					actionId: request.actionId,
					expectedSessionRevision: request.expectedSessionRevision,
					action: serializeAction(request.action),
				},
				signal
			)
		} catch (error) {
			const code = extensionErrorCode(error)
			if (!['DOCUMENT_CHANGED', 'STALE_REFERENCE', 'TARGET_NOT_FOUND'].includes(code)) throw error
			const runtimeError = {
				code: code as 'DOCUMENT_CHANGED' | 'STALE_REFERENCE' | 'TARGET_NOT_FOUND',
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			}
			return {
				actionId: request.actionId,
				sessionId: request.sessionId,
				startedAt,
				endedAt: new Date().toISOString(),
				status: 'failed',
				result: { ok: false, error: runtimeError },
				error: runtimeError,
				observedSignals: [],
			}
		}
	}

	waitFor(request: SynchronizationRequest, signal: AbortSignal): Promise<SynchronizationResult> {
		this.sessionId = request.sessionId
		return this.rpc.request<SynchronizationResult>(
			{
				type: 'dom.wait',
				requestId: requestId(),
				sessionId: request.sessionId,
				tabId: request.tabId,
				since: request.since,
				expected: request.expected.map((expected) => ({ ...expected })),
				quietWindowMs: request.settle.quietWindowMs,
				maxWaitMs: request.settle.maxWaitMs,
			},
			signal
		)
	}

	revalidate(ref: ElementRef, signal: AbortSignal): Promise<ReferenceValidation> {
		return this.rpc.request<ReferenceValidation>(
			{
				type: 'dom.revalidate',
				requestId: requestId(),
				sessionId: ref.sessionId,
				ref: serializeRef(ref),
			},
			signal
		)
	}

	async dispose(): Promise<void> {
		return undefined
	}
}

class ExtensionTabsRuntime implements TabsRuntime {
	private readonly rpc: ExtensionRpc
	private readonly getSessionId: () => string | undefined

	constructor(rpc: ExtensionRpc, getSessionId: () => string | undefined) {
		this.rpc = rpc
		this.getSessionId = getSessionId
	}

	list(scope: 'owned' | 'available'): Promise<TabDescriptor[]> {
		return this.rpc.request<TabDescriptor[]>(
			{
				type: 'tabs.list',
				requestId: requestId(),
				sessionId: requiredSessionId(this.getSessionId),
				scope,
			},
			new AbortController().signal
		)
	}

	open(input: { url: string; activate?: boolean }, signal: AbortSignal): Promise<TabDescriptor> {
		return this.rpc.request<TabDescriptor>(
			{
				type: 'tabs.open',
				requestId: requestId(),
				sessionId: requiredSessionId(this.getSessionId),
				...input,
			},
			signal
		)
	}

	switch(tabId: string, signal: AbortSignal): Promise<void> {
		return this.requestVoid(
			{
				type: 'tabs.switch',
				requestId: requestId(),
				sessionId: requiredSessionId(this.getSessionId),
				tabId,
			},
			signal
		)
	}

	close(tabId: string, signal: AbortSignal): Promise<void> {
		return this.requestVoid(
			{
				type: 'tabs.close',
				requestId: requestId(),
				sessionId: requiredSessionId(this.getSessionId),
				tabId,
			},
			signal
		)
	}

	claim(tabId: string, sessionId: string): Promise<void> {
		return this.requestVoid(
			{ type: 'tabs.claim', requestId: requestId(), sessionId, tabId },
			new AbortController().signal
		)
	}

	release(tabId: string, sessionId: string): Promise<void> {
		return this.requestVoid(
			{ type: 'tabs.release', requestId: requestId(), sessionId, tabId },
			new AbortController().signal
		)
	}

	private requestVoid(payload: TabRpcRequest, signal: AbortSignal): Promise<void> {
		return this.rpc.request<unknown>(payload, signal).then(() => undefined)
	}
}

function serializeRef(ref: ElementRef): WireElementRef {
	return { ...ref }
}

function serializeAction(action: BrowserAction): JsonObject {
	if ('target' in action && action.target) {
		return { ...action, target: serializeRef(action.target) } as unknown as JsonObject
	}
	return { ...action } as JsonObject
}

function requestId(): string {
	return `rpc-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function extensionErrorCode(error: unknown): string {
	if (typeof error !== 'object' || error === null || !('code' in error)) return ''
	return typeof error.code === 'string' ? error.code : ''
}

function requiredSessionId(getSessionId: () => string | undefined): string {
	const sessionId = getSessionId()
	if (!sessionId) throw new Error('SESSION_NOT_INITIALIZED')
	return sessionId
}
