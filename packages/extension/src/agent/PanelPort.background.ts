import type { JsonValue, PublicSessionEvent, PublicSessionStartPayload } from '@page-agent/protocol'
import { projectPublicEvent } from '@page-agent/runtime'

import { IndexedDbEventLog } from '@/runtime/IndexedDbEventLog'
import { IndexedDbSessionStore } from '@/runtime/IndexedDbSessionStore'

import { endVisualSession, releaseSessionTabOwners } from './ProtocolRpc.background'

export interface PanelStartInput extends PublicSessionStartPayload {
	origin: string
	sessionToken: string
	/** Resolved by the trusted extension boundary; never supplied by page code. */
	initialTabId?: string
}

type PanelRequestPayload =
	| { type: 'session.start'; input: PanelStartInput }
	| { type: 'session.cancel'; input: { origin: string; sessionId: string; sessionToken: string } }
	| {
			type: 'session.reply'
			input: { origin: string; sessionId: string; sessionToken: string; text: string }
	  }
	| { type: 'session.result'; input: { origin: string; sessionId: string; sessionToken: string } }

interface PanelResponse {
	type: 'PAGE_AGENT_V2_PANEL_RESPONSE'
	requestId: string
	ok: boolean
	value?: unknown
	error?: { code: string; message: string }
}

export interface PanelEvent {
	sessionId: string
	event: PublicSessionEvent
}

let panelPort: chrome.runtime.Port | undefined
const activeSessions = new Set<string>()
let requestSequence = 0
const eventListeners = new Set<(event: PanelEvent) => void>()
const panelReadyWaiters = new Set<{
	resolve: (ready: boolean) => void
	timer: ReturnType<typeof setTimeout>
}>()
const pending = new Map<
	string,
	{
		resolve: (value: unknown) => void
		reject: (error: Error) => void
		start: boolean
	}
>()

export function registerPanelPort(port: chrome.runtime.Port): void {
	if (port.sender?.url !== chrome.runtime.getURL('sidepanel.html')) {
		port.disconnect()
		return
	}
	// A second side panel must not displace a host that owns live executions.
	if (panelPort) {
		port.disconnect()
		return
	}
	panelPort = port
	for (const waiter of panelReadyWaiters) {
		clearTimeout(waiter.timer)
		waiter.resolve(true)
	}
	panelReadyWaiters.clear()
	port.onMessage.addListener((message: unknown) => {
		if (isPanelEvent(message)) {
			if (message.event.type === 'session.terminal') {
				activeSessions.delete(message.sessionId)
				endVisualSession(message.sessionId)
			}
			for (const listener of eventListeners) listener(message)
			return
		}
		if (!isPanelResponse(message)) return
		const request = pending.get(message.requestId)
		if (!request) return
		pending.delete(message.requestId)
		if (message.ok) {
			if (request.start && isSessionStartResult(message.value))
				activeSessions.add(message.value.sessionId)
			request.resolve(message.value)
		} else request.reject(new Error(message.error?.message ?? 'Panel request failed'))
	})
	port.onDisconnect.addListener(() => {
		if (panelPort !== port) return
		panelPort = undefined
		for (const [requestId, request] of pending) {
			pending.delete(requestId)
			request.reject(new Error('PANEL_NOT_OPEN'))
		}
		const abandoned = [...activeSessions]
		activeSessions.clear()
		const disconnectedAt = new Date().toISOString()
		void cancelAbandonedSessions(abandoned, disconnectedAt).catch((error: unknown) => {
			console.error('[PanelHost] Failed to finalize closed-panel sessions:', error)
		})
	})
}

async function cancelAbandonedSessions(
	knownSessionIds: string[],
	disconnectedAt: string
): Promise<void> {
	// A start response may be lost when the panel closes mid-request. The panel is
	// the sole execution host, so all unfinished persisted sessions are orphaned.
	const sessions = await new IndexedDbSessionStore().list()
	const ids = new Set([
		...knownSessionIds,
		...sessions
			.filter(
				(session) =>
					session.createdAt <= disconnectedAt &&
					!['completed', 'partially_completed', 'blocked', 'failed', 'cancelled'].includes(
						session.status
					)
			)
			.map((session) => session.sessionId),
	])
	await Promise.all([...ids].map(cancelAbandonedSession))
}

async function cancelAbandonedSession(sessionId: string): Promise<void> {
	const sessions = new IndexedDbSessionStore()
	const events = new IndexedDbEventLog()
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const session = await sessions.get(sessionId)
		if (
			!session ||
			['completed', 'partially_completed', 'blocked', 'failed', 'cancelled'].includes(
				session.status
			)
		)
			return
		try {
			await sessions.update(
				{
					...session,
					status: 'cancelled',
					revision: session.revision + 1,
					updatedAt: new Date().toISOString(),
				},
				session.revision
			)
			break
		} catch (error) {
			if (attempt === 2) throw error
		}
	}
	try {
		await releaseSessionTabOwners(sessionId)
	} catch (error) {
		console.error('[PanelHost] Failed to release tab ownership:', error)
	}
	endVisualSession(sessionId)
	for (const [type, payload] of [
		['session.status_changed', { status: 'cancelled' }],
		['session.terminal', { status: 'cancelled', summary: 'The side panel was closed.' }],
	] as const) {
		const event = await events.append({
			eventId: `event-${crypto.randomUUID()}`,
			at: new Date().toISOString(),
			sessionId,
			type,
			payload,
			sensitivity: 'internal',
		})
		const publicEvent = projectPublicEvent(event) as PublicSessionEvent
		for (const listener of eventListeners) listener({ sessionId, event: publicEvent })
	}
}

export function subscribePanelEvents(listener: (event: PanelEvent) => void): () => void {
	eventListeners.add(listener)
	return () => eventListeners.delete(listener)
}

export function waitForPanelPort(timeoutMs = 5_000): Promise<boolean> {
	if (panelPort) return Promise.resolve(true)
	return new Promise((resolve) => {
		const waiter = {
			resolve,
			timer: setTimeout(() => {
				panelReadyWaiters.delete(waiter)
				resolve(false)
			}, timeoutMs),
		}
		panelReadyWaiters.add(waiter)
	})
}

export function requestPanel<T>(payload: PanelRequestPayload): Promise<T> {
	const connectedPort = panelPort
	if (!connectedPort) return Promise.reject(new Error('PANEL_NOT_OPEN'))
	const requestId = `panel-${++requestSequence}`
	const timeoutMs = payload.type === 'session.result' ? 150_000 : 30_000
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(requestId)
			reject(new Error('PANEL_TIMEOUT'))
		}, timeoutMs)
		pending.set(requestId, {
			start: payload.type === 'session.start',
			resolve: (value) => {
				clearTimeout(timer)
				resolve(value as T)
			},
			reject: (error) => {
				clearTimeout(timer)
				reject(error)
			},
		})
		connectedPort.postMessage({ type: 'PAGE_AGENT_V2_PANEL_REQUEST', requestId, payload })
	})
}

function isSessionStartResult(value: unknown): value is { sessionId: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { sessionId?: unknown }).sessionId === 'string'
	)
}

export function panelGateway() {
	return {
		start: (input: PanelStartInput) =>
			requestPanel<{ sessionId: string }>({ type: 'session.start', input }),
		cancel: (input: { origin: string; sessionId: string; sessionToken: string }) =>
			requestPanel<unknown>({ type: 'session.cancel', input }).then(() => undefined),
		reply: (input: { origin: string; sessionId: string; sessionToken: string; text: string }) =>
			requestPanel<unknown>({ type: 'session.reply', input }).then(() => undefined),
		result: (input: { origin: string; sessionId: string; sessionToken: string }) =>
			requestPanel<{ status: string; summary?: string; data?: JsonValue }>({
				type: 'session.result',
				input,
			}),
	}
}

function isPanelResponse(value: unknown): value is PanelResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_PANEL_RESPONSE' &&
		typeof candidate.requestId === 'string' &&
		typeof candidate.ok === 'boolean'
	)
}

function isPanelEvent(value: unknown): value is PanelEvent {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	const event = candidate.event
	if (typeof event !== 'object' || event === null || Array.isArray(event)) return false
	const eventRecord = event as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_PANEL_EVENT' &&
		typeof candidate.sessionId === 'string' &&
		typeof eventRecord.eventId === 'string' &&
		typeof eventRecord.sequence === 'number' &&
		typeof eventRecord.sessionId === 'string' &&
		typeof eventRecord.type === 'string' &&
		typeof eventRecord.at === 'string' &&
		'payload' in eventRecord
	)
}

export type { PanelRequestPayload }
