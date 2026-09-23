import type { DomRpcRequest, TabRpcRequest } from '@page-agent/protocol'

export type ExtensionRpcPayload = DomRpcRequest | TabRpcRequest

export interface ExtensionRpcSuccess {
	ok: true
	value: unknown
}

export interface ExtensionRpcFailure {
	ok: false
	error: {
		code: string
		message: string
		retryable: boolean
	}
}

export type ExtensionRpcResponse = ExtensionRpcSuccess | ExtensionRpcFailure

export class ExtensionRpcError extends Error {
	readonly code: string
	readonly retryable: boolean

	constructor(code: string, message: string, retryable = false) {
		super(message)
		this.name = 'ExtensionRpcError'
		this.code = code
		this.retryable = retryable
	}
}

/**
 * Side-panel transport. The service worker owns routing and Chrome APIs;
 * this class only validates the response envelope and propagates cancellation.
 */
export class ChromeRuntimeRpc {
	async request<T>(payload: ExtensionRpcPayload, signal: AbortSignal): Promise<T> {
		if (signal.aborted) throw new ExtensionRpcError('CANCELLED', 'Request was cancelled', true)

		const response = await raceAbort(
			chrome.runtime.sendMessage({ type: 'PAGE_AGENT_V2_RPC', payload }),
			signal
		)
		if (!isRpcResponse(response)) {
			throw new ExtensionRpcError('PROTOCOL_MALFORMED', 'Malformed extension RPC response')
		}
		if (!response.ok) {
			throw new ExtensionRpcError(
				response.error.code,
				response.error.message,
				response.error.retryable
			)
		}
		return response.value as T
	}
}

function isRpcResponse(value: unknown): value is ExtensionRpcResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (candidate.ok === true) return true
	if (candidate.ok !== false || typeof candidate.error !== 'object' || candidate.error === null)
		return false
	const error = candidate.error as Record<string, unknown>
	return (
		typeof error.code === 'string' &&
		typeof error.message === 'string' &&
		typeof error.retryable === 'boolean'
	)
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(new ExtensionRpcError('CANCELLED', 'Request was cancelled', true))
		if (signal.aborted) {
			onAbort()
			return
		}
		signal.addEventListener('abort', onAbort, { once: true })
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
	})
}
