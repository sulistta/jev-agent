import type { PublicApiRequest, PublicApiResponse, PublicSessionEvent } from '@page-agent/protocol'

export function initPublicApiEndpoint(): void {
	chrome.runtime.onMessage.addListener((message: unknown) => {
		if (!isPublicEventMessage(message)) return
		window.postMessage(
			{ channel: 'PAGE_AGENT_EXT_V2_EVENT', payload: message.payload },
			window.location.origin
		)
	})

	window.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (event.source !== window || event.origin !== window.location.origin) return
		if (!isPublicRequestMessage(event.data)) return

		const request = event.data.payload
		if (request.origin !== window.location.origin) {
			postResponse({
				requestId: request.requestId,
				ok: false,
				error: {
					code: 'ORIGIN_MISMATCH',
					message: 'Origin does not match the document',
					retryable: false,
				},
			})
			return
		}

		void chrome.runtime
			.sendMessage({ type: 'PAGE_AGENT_V2_PUBLIC', payload: request })
			.then((response: unknown) => {
				if (isPublicResponse(response)) postResponse(response)
				else
					postResponse({
						requestId: request.requestId,
						ok: false,
						error: {
							code: 'PROTOCOL_MALFORMED',
							message: 'Malformed worker response',
							retryable: false,
						},
					})
			})
			.catch((error: unknown) =>
				postResponse({
					requestId: request.requestId,
					ok: false,
					error: {
						code: 'TRANSPORT_UNAVAILABLE',
						message: error instanceof Error ? error.message : String(error),
						retryable: true,
					},
				})
			)
	})
}

function isPublicEventMessage(
	value: unknown
): value is { type: 'PAGE_AGENT_V2_PUBLIC_EVENT'; payload: PublicSessionEvent } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	const payload = candidate.payload
	if (candidate.type !== 'PAGE_AGENT_V2_PUBLIC_EVENT') return false
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
	const event = payload as Record<string, unknown>
	return (
		typeof event.eventId === 'string' &&
		typeof event.sequence === 'number' &&
		typeof event.sessionId === 'string' &&
		typeof event.type === 'string' &&
		typeof event.at === 'string' &&
		'payload' in event
	)
}

function postResponse(response: PublicApiResponse): void {
	window.postMessage(
		{ channel: 'PAGE_AGENT_EXT_V2_RESPONSE', payload: response },
		window.location.origin
	)
}

function isPublicRequestMessage(
	value: unknown
): value is { channel: 'PAGE_AGENT_EXT_V2_REQUEST'; payload: PublicApiRequest } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (
		candidate.channel !== 'PAGE_AGENT_EXT_V2_REQUEST' ||
		typeof candidate.payload !== 'object' ||
		candidate.payload === null
	)
		return false
	const payload = candidate.payload as Record<string, unknown>
	return (
		typeof payload.type === 'string' &&
		['session.start', 'session.cancel', 'session.result', 'session.reply'].includes(payload.type) &&
		typeof payload.requestId === 'string' &&
		typeof payload.origin === 'string'
	)
}

function isPublicResponse(value: unknown): value is PublicApiResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (typeof candidate.requestId !== 'string' || typeof candidate.ok !== 'boolean') return false
	if (candidate.ok) return true
	if (typeof candidate.error !== 'object' || candidate.error === null) return false
	const error = candidate.error as Record<string, unknown>
	return (
		typeof error.code === 'string' &&
		typeof error.message === 'string' &&
		typeof error.retryable === 'boolean'
	)
}
