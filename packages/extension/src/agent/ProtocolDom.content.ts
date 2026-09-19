import type {
	BrowserAction,
	BrowserActionRequest,
	ObservationRequest,
	ReferenceValidation,
	SynchronizationRequest,
} from '@page-agent/browser'
import { LocalBrowserRuntime } from '@page-agent/page-controller'
import type { ContentDocumentHello, DomRpcRequest, WireDomError } from '@page-agent/protocol'
import { PROTOCOL_VERSION } from '@page-agent/protocol'

export interface DomRpcSuccess {
	ok: true
	value: unknown
}

export interface DomRpcFailure {
	ok: false
	error: WireDomError
}

export type DomRpcResponse = DomRpcSuccess | DomRpcFailure

/** Install the document-local endpoint used by the service worker router. */
export function initProtocolDomEndpoint(): void {
	const documentId = requestId('document')
	let runtime: LocalBrowserRuntime | undefined
	let runtimeTabId: string | undefined
	void chrome.runtime.sendMessage({
		type: 'PAGE_AGENT_V2_CONTENT_HELLO',
		payload: {
			type: 'content.document.hello',
			requestId: requestId('hello'),
			protocolVersion: PROTOCOL_VERSION,
			documentId,
			frameId: 0,
			capabilities: ['dom.read', 'dom.write'],
		} satisfies ContentDocumentHello,
	})

	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!isDomForwardMessage(message)) return

		const requestTabId = domRequestTabId(message.payload)
		const senderTabId = sender.tab?.id
		if (
			requestTabId === undefined ||
			requestTabId !== message.tabId ||
			(senderTabId !== undefined && String(senderTabId) !== message.tabId)
		) {
			sendResponse(failure('PERMISSION_DENIED', 'DOM RPC tab context is invalid', false))
			return
		}

		const tabId = message.tabId
		if (!runtime || runtimeTabId !== tabId) {
			runtime?.dispose()
			runtime = new LocalBrowserRuntime({ tabId, documentId })
			runtimeTabId = tabId
		}

		handleDomRequest(runtime, runtimeTabId!, message.payload)
			.then((value) => sendResponse({ ok: true, value } satisfies DomRpcSuccess))
			.catch((error: unknown) => sendResponse(toFailure(error)))
		return true
	})
}

async function handleDomRequest(
	runtime: LocalBrowserRuntime,
	tabId: string,
	request: DomRpcRequest
): Promise<unknown> {
	switch (request.type) {
		case 'dom.observe': {
			if (request.tabId !== undefined && request.tabId !== tabId) {
				throw new Error('TAB_MISMATCH')
			}
			return runtime.observe(request as ObservationRequest, new AbortController().signal)
		}
		case 'dom.execute':
			return runtime.execute(
				{
					sessionId: request.sessionId,
					actionId: request.actionId,
					expectedSessionRevision: request.expectedSessionRevision,
					action: request.action as unknown as BrowserAction,
				} satisfies BrowserActionRequest,
				new AbortController().signal
			)
		case 'dom.wait':
			return runtime.waitFor(
				{
					sessionId: request.sessionId,
					tabId: request.tabId,
					since: request.since,
					expected: request.expected as unknown as SynchronizationRequest['expected'],
					settle: { quietWindowMs: request.quietWindowMs, maxWaitMs: request.maxWaitMs },
				} satisfies SynchronizationRequest,
				new AbortController().signal
			)
		case 'dom.revalidate':
			return runtime.revalidate(
				request.ref,
				new AbortController().signal
			) as Promise<ReferenceValidation>
	}
}

function isDomForwardMessage(
	value: unknown
): value is { type: 'PAGE_AGENT_V2_DOM'; tabId: string; payload: DomRpcRequest } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_DOM' &&
		typeof candidate.tabId === 'string' &&
		/^\d+$/.test(candidate.tabId) &&
		isDomRequest(candidate.payload)
	)
}

function domRequestTabId(request: DomRpcRequest): string | undefined {
	if (request.type === 'dom.observe' || request.type === 'dom.wait') return request.tabId
	if (request.type === 'dom.revalidate') return request.ref.tabId
	const action = request.action as { target?: { tabId?: unknown } }
	return typeof action.target?.tabId === 'string' ? action.target.tabId : undefined
}

function isDomRequest(value: unknown): value is DomRpcRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.type === 'string' &&
		['dom.observe', 'dom.execute', 'dom.wait', 'dom.revalidate'].includes(candidate.type) &&
		typeof candidate.requestId === 'string' &&
		typeof candidate.sessionId === 'string'
	)
}

function toFailure(error: unknown): DomRpcFailure {
	const message = error instanceof Error ? error.message : String(error)
	const code = message === 'TAB_MISMATCH' ? 'PERMISSION_DENIED' : message
	return failure(code, message, code === 'STALE_REFERENCE' || code === 'CANCELLED')
}

function requestId(prefix: string): string {
	return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function failure(code: string, message: string, retryable: boolean): DomRpcFailure {
	const supported = new Set<WireDomError['code']>([
		'STALE_REFERENCE',
		'TARGET_NOT_FOUND',
		'DOCUMENT_CHANGED',
		'PERMISSION_DENIED',
		'CANCELLED',
		'TIMEOUT',
		'INTERNAL',
	])
	return {
		ok: false,
		error: {
			code: supported.has(code as WireDomError['code'])
				? (code as WireDomError['code'])
				: 'INTERNAL',
			message,
			retryable,
		},
	}
}
