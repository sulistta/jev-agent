import type {
	Capability,
	PublicApiRequest,
	PublicApiResponse,
	PublicSessionEvent,
} from '@page-agent/protocol'

const LEGACY_CHANNEL = 'PAGE_AGENT_EXT_REQUEST'
const LEGACY_RESPONSE_CHANNEL = 'PAGE_AGENT_EXT_RESPONSE'
const PUBLIC_MESSAGE = 'PAGE_AGENT_V2_PUBLIC'
const PUBLIC_EVENT_MESSAGE = 'PAGE_AGENT_V2_PUBLIC_EVENT'

const LEGACY_CAPABILITIES: Capability[] = [
	'dom.read',
	'dom.write',
	'navigation',
	'tabs.read',
	'tabs.write',
]

interface LegacyExecutePayload {
	task?: unknown
	config?: unknown
}

interface LegacyRequest {
	channel: typeof LEGACY_CHANNEL
	id: string | number
	action: 'execute' | 'stop'
	payload?: LegacyExecutePayload
}

interface ActiveExecution {
	requestId: string | number
	sessionId: string
	sessionToken: string
	history: unknown[]
}

let requestSequence = 0

/**
 * v1 compatibility boundary.
 *
 * The old page-facing shape is kept at the edge only. The content script no
 * longer imports or constructs the legacy agent; all execution goes through
 * the v2 public-session grant and side-panel host.
 */
export function initLegacyPageApiAdapter(): void {
	let active: ActiveExecution | undefined
	let starting = false
	const bufferedEvents = new Map<string, PublicSessionEvent[]>()

	chrome.runtime.onMessage.addListener((message: unknown) => {
		if (!isPublicEventMessage(message)) return
		const event = message.payload
		if (!active || active.sessionId !== event.sessionId) {
			const events = bufferedEvents.get(event.sessionId) ?? []
			events.push(event)
			if (events.length > 128) events.shift()
			bufferedEvents.set(event.sessionId, events)
			return
		}
		active = consumeEvent(active, event)
	})

	window.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (event.source !== window || event.origin !== window.location.origin) return
		if (!isLegacyRequest(event.data)) return

		if (event.data.action === 'stop') {
			if (active) void cancelSession(active)
			return
		}

		if (starting) {
			postLegacyError(event.data.id, 'Agent is already starting a task. Please wait.')
			return
		}
		starting = true
		void startSession(event.data)
			.then((next) => {
				active = next
				const buffered = bufferedEvents.get(next.sessionId) ?? []
				bufferedEvents.delete(next.sessionId)
				for (const bufferedEvent of buffered) {
					if (!active || active.sessionId !== bufferedEvent.sessionId) break
					active = consumeEvent(active, bufferedEvent)
				}
			})
			.catch(() => undefined)
			.finally(() => {
				starting = false
			})
	})

	async function startSession(request: LegacyRequest): Promise<ActiveExecution> {
		if (active || starting) {
			postLegacyError(request.id, 'Agent is already running a task. Please wait until it finishes.')
			throw new Error('LEGACY_SESSION_BUSY')
		}

		const payload = request.payload
		const task = payload?.task
		const config = asRecord(payload?.config)
		if (typeof task !== 'string' || !task.trim()) {
			postLegacyError(request.id, 'Task is required')
			throw new Error('LEGACY_TASK_INVALID')
		}
		if (typeof config.baseURL !== 'string' || !config.baseURL.trim()) {
			postLegacyError(request.id, 'Config must have a baseURL')
			throw new Error('LEGACY_CONFIG_INVALID')
		}
		if (typeof config.model !== 'string' || !config.model.trim()) {
			postLegacyError(request.id, 'Config must have a model')
			throw new Error('LEGACY_CONFIG_INVALID')
		}

		const response = await sendPublicRequest({
			type: 'session.start',
			requestId: nextRequestId('start'),
			origin: window.location.origin,
			nonce: nextNonce(),
			payload: {
				task,
				capabilities: LEGACY_CAPABILITIES,
				providerProfile: 'user-default',
			},
		})
		if (!response.ok || !isSessionStartPayload(response.payload)) {
			postLegacyError(request.id, response.error?.message ?? 'Unable to start the v2 session')
			throw new Error(response.error?.message ?? 'Unable to start the v2 session')
		}

		return {
			requestId: request.id,
			sessionId: response.payload.sessionId,
			sessionToken: response.payload.sessionToken,
			history: [],
		}
	}

	async function cancelSession(execution: ActiveExecution): Promise<void> {
		await sendPublicRequest({
			type: 'session.cancel',
			requestId: nextRequestId('cancel'),
			origin: window.location.origin,
			sessionId: execution.sessionId,
			sessionToken: execution.sessionToken,
		}).catch(() => undefined)
	}
}

export function legacyStatusForEvent(event: PublicSessionEvent): string | undefined {
	const status = text(asRecord(event.payload).status)
	if (event.type === 'session.terminal') return status ?? 'error'
	if (event.type === 'session.started' || event.type === 'session.status_changed') return status
	return undefined
}

export function legacyActivityForEvent(event: PublicSessionEvent): unknown {
	const payload = asRecord(event.payload)
	const actionType = text(payload.actionType) ?? 'action'
	if (event.type === 'observation.captured' || event.type === 'decision.selected')
		return { type: 'thinking' }
	if (event.type === 'action.started')
		return { type: 'executing', tool: actionType, input: payload }
	if (event.type === 'action.completed')
		return {
			type: 'executed',
			tool: actionType,
			input: payload,
			output: text(payload.status) ?? 'completed',
			duration: 0,
		}
	if (event.type === 'session.failed' || event.type === 'session.blocked')
		return { type: 'error', message: text(payload.reason) ?? 'Session blocked' }
	return undefined
}

export function projectLegacyEvent(history: unknown[], event: PublicSessionEvent): unknown[] {
	const payload = asRecord(event.payload)
	if (event.type === 'observation.captured') {
		return [
			...history,
			{
				type: 'observation',
				content: `Observed ${text(payload.elementCount) ?? 'the current page'}.`,
			},
		]
	}
	if (event.type === 'action.started') {
		return [
			...history,
			{
				type: 'step',
				stepIndex: stepCount(history),
				reflection: {},
				action: { name: text(payload.actionType) ?? 'action', input: payload, output: 'Running…' },
				usage: emptyUsage(),
			},
		]
	}
	if (event.type === 'action.completed') {
		const next = [...history]
		for (let index = next.length - 1; index >= 0; index -= 1) {
			const item = asRecord(next[index])
			if (item.type !== 'step') continue
			const action = asRecord(item.action)
			next[index] = { ...item, action: { ...action, output: text(payload.status) ?? 'completed' } }
			break
		}
		return next
	}
	if (event.type === 'session.failed' || event.type === 'session.blocked') {
		return [
			...history,
			{ type: 'error', message: text(payload.reason) ?? 'Session did not complete.' },
		]
	}
	if (event.type === 'session.terminal') {
		const status = text(payload.status) ?? 'unknown'
		if (status === 'completed' || status === 'partially_completed') {
			return [
				...history,
				{
					type: 'step',
					stepIndex: stepCount(history),
					reflection: {},
					action: { name: 'done', input: { success: status === 'completed' }, output: status },
					usage: emptyUsage(),
				},
			]
		}
	}
	return history
}

function consumeEvent(
	execution: ActiveExecution,
	event: PublicSessionEvent
): ActiveExecution | undefined {
	const history = projectLegacyEvent(execution.history, event)
	const status = legacyStatusForEvent(event)
	if (status) postLegacyEvent(execution.requestId, 'status_change_event', status)
	const activity = legacyActivityForEvent(event)
	if (activity !== undefined) postLegacyEvent(execution.requestId, 'activity_event', activity)
	postLegacyEvent(execution.requestId, 'history_change_event', history)

	if (event.type !== 'session.terminal') return { ...execution, history }
	const terminalStatus = text(asRecord(event.payload).status) ?? 'error'
	postLegacyResult(execution.requestId, {
		success: terminalStatus === 'completed',
		data: terminalStatus,
		history,
	})
	return undefined
}

async function sendPublicRequest(request: PublicApiRequest): Promise<PublicApiResponse> {
	const response = (await chrome.runtime.sendMessage({
		type: PUBLIC_MESSAGE,
		payload: request,
	})) as unknown
	if (isPublicResponse(response)) return response
	return {
		requestId: request.requestId,
		ok: false,
		error: { code: 'PROTOCOL_MALFORMED', message: 'Malformed worker response', retryable: false },
	}
}

function postLegacyEvent(id: string | number, action: string, payload: unknown): void {
	window.postMessage(
		{ channel: LEGACY_RESPONSE_CHANNEL, id, action, payload },
		window.location.origin
	)
}

function postLegacyResult(id: string | number, payload: unknown): void {
	postLegacyEvent(id, 'execute_result', payload)
}

function postLegacyError(id: string | number, message: string): void {
	window.postMessage(
		{ channel: LEGACY_RESPONSE_CHANNEL, id, action: 'execute_result', error: message },
		window.location.origin
	)
}

function isLegacyRequest(value: unknown): value is LegacyRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.channel === LEGACY_CHANNEL &&
		(typeof candidate.id === 'string' || typeof candidate.id === 'number') &&
		(candidate.action === 'execute' || candidate.action === 'stop')
	)
}

function isPublicEventMessage(
	value: unknown
): value is { type: typeof PUBLIC_EVENT_MESSAGE; payload: PublicSessionEvent } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	const payload = candidate.payload
	if (candidate.type !== PUBLIC_EVENT_MESSAGE || typeof payload !== 'object' || payload === null)
		return false
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

function isPublicResponse(value: unknown): value is PublicApiResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return typeof candidate.requestId === 'string' && typeof candidate.ok === 'boolean'
}

function isSessionStartPayload(
	value: PublicApiResponse['payload']
): value is { sessionId: string; sessionToken: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'sessionId' in value &&
		'sessionToken' in value &&
		typeof value.sessionId === 'string' &&
		typeof value.sessionToken === 'string'
	)
}

function asRecord(value: unknown): Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, any>)
		: {}
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function stepCount(history: unknown[]): number {
	return history.filter((item) => asRecord(item).type === 'step').length
}

function emptyUsage() {
	return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

function nextRequestId(kind: string): string {
	requestSequence += 1
	return `legacy-${kind}-${requestSequence}`
}

function nextNonce(): string {
	return globalThis.crypto?.randomUUID?.() ?? `legacy-nonce-${Date.now()}-${requestSequence}`
}
