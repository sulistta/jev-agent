import type {
	Capability,
	JsonValue,
	PublicApiRequest,
	PublicApiResponse,
	PublicSessionEvent,
	PublicSessionStartPayload,
} from '@page-agent/protocol'

interface PublicSession {
	sessionId: string
	onEvent(listener: (event: PublicSessionEvent) => void): () => void
	result: Promise<{ status: string; summary?: string; data?: JsonValue }>
	cancel(): Promise<void>
	reply(text: string): Promise<void>
}

interface PublicApi {
	version: string
	start(input: PublicSessionStartPayload): Promise<PublicSession>
}

interface PublicSuccess<T> {
	requestId: string
	ok: true
	payload: T
}

export default defineUnlistedScript(() => {
	let sequence = 0
	const listeners = new Map<string, Set<(event: PublicSessionEvent) => void>>()
	const bufferedEvents = new Map<string, PublicSessionEvent[]>()

	window.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (event.source !== window || event.origin !== window.location.origin) return
		if (!isEventMessage(event.data)) return
		const payload = event.data.payload
		const sessionListeners = listeners.get(payload.sessionId)
		if (sessionListeners && sessionListeners.size > 0) {
			for (const listener of sessionListeners) listener(payload)
			return
		}
		const buffered = bufferedEvents.get(payload.sessionId) ?? []
		buffered.push(payload)
		if (buffered.length > 128) buffered.shift()
		bufferedEvents.set(payload.sessionId, buffered)
	})

	const request = <T>(payload: PublicApiRequest): Promise<PublicSuccess<T>> =>
		new Promise((resolve, reject) => {
			const handler = (event: MessageEvent<unknown>) => {
				if (event.source !== window || event.origin !== window.location.origin) return
				if (!isResponseMessage(event.data) || event.data.payload.requestId !== payload.requestId)
					return
				window.removeEventListener('message', handler)
				const response = event.data.payload
				if (!response.ok || !response.payload) {
					reject(new Error(response.error?.message ?? 'Public API request failed'))
					return
				}
				resolve(response as PublicSuccess<T>)
			}
			window.addEventListener('message', handler)
			window.postMessage({ channel: 'PAGE_AGENT_EXT_V2_REQUEST', payload }, window.location.origin)
		})

	const start = async (input: PublicSessionStartPayload): Promise<PublicSession> => {
		if (!input || typeof input.task !== 'string' || !input.task.trim())
			throw new Error('Task is required')
		if (
			!Array.isArray(input.capabilities) ||
			input.capabilities.some((item) => typeof item !== 'string')
		)
			throw new Error('Capabilities are required')

		const startResponse = await request<{ sessionId: string; sessionToken: string }>({
			type: 'session.start',
			requestId: nextId('start'),
			origin: window.location.origin,
			nonce: crypto.randomUUID(),
			payload: {
				task: input.task,
				capabilities: input.capabilities as Capability[],
				providerProfile: input.providerProfile,
			},
		})
		const { sessionId, sessionToken } = startResponse.payload

		return {
			sessionId,
			onEvent(listener) {
				const sessionListeners = listeners.get(sessionId) ?? new Set()
				sessionListeners.add(listener)
				listeners.set(sessionId, sessionListeners)
				const buffered = bufferedEvents.get(sessionId) ?? []
				bufferedEvents.delete(sessionId)
				for (const event of buffered) listener(event)
				return () => {
					sessionListeners.delete(listener)
					if (sessionListeners.size === 0) listeners.delete(sessionId)
				}
			},
			result: request<{ status: string; summary?: string; data?: JsonValue }>({
				type: 'session.result',
				requestId: nextId('result'),
				origin: window.location.origin,
				sessionId,
				sessionToken,
			}).then((response) => response.payload),
			cancel: () =>
				request<{ status: string }>({
					type: 'session.cancel',
					requestId: nextId('cancel'),
					origin: window.location.origin,
					sessionId,
					sessionToken,
				}).then(() => undefined),
			reply: (text: string) => {
				if (!text.trim()) return Promise.reject(new Error('Reply is required'))
				return request<{ status: string }>({
					type: 'session.reply',
					requestId: nextId('reply'),
					origin: window.location.origin,
					sessionId,
					sessionToken,
					text,
				}).then(() => undefined)
			},
		}
	}

	;(window as Window & { PAGE_AGENT_EXT_V2?: PublicApi }).PAGE_AGENT_EXT_V2 = {
		version: __VERSION__,
		start,
	}

	function nextId(kind: string): string {
		sequence += 1
		return `public-${kind}-${sequence}`
	}
})

function isResponseMessage(
	value: unknown
): value is { channel: 'PAGE_AGENT_EXT_V2_RESPONSE'; payload: PublicApiResponse } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.channel === 'PAGE_AGENT_EXT_V2_RESPONSE' &&
		typeof candidate.payload === 'object' &&
		candidate.payload !== null
	)
}

function isEventMessage(
	value: unknown
): value is { channel: 'PAGE_AGENT_EXT_V2_EVENT'; payload: PublicSessionEvent } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	const payload = candidate.payload
	if (candidate.channel !== 'PAGE_AGENT_EXT_V2_EVENT') return false
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
