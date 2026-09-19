import type { Capability, PublicSessionEvent } from '@page-agent/protocol'

import { isTrustedExtensionPageSender } from '@/security/ExtensionSender'

import { ensureRunnerTab, runnerGateway, subscribeRunnerEvents } from './RunnerPort.background'

type UiMessage =
	| {
			type: 'PAGE_AGENT_V2_UI_START'
			task: string
			capabilities: Capability[]
			providerProfile?: string
	  }
	| { type: 'PAGE_AGENT_V2_UI_CANCEL'; sessionId: string }
	| { type: 'PAGE_AGENT_V2_UI_REPLY'; sessionId: string; text: string }

interface UiSuccess {
	ok: true
	sessionId: string
}

interface UiFailure {
	ok: false
	code: string
	message: string
	retryable: boolean
}

const gateway = runnerGateway()
const uiSessions = new Set<string>()
const bufferedEvents = new Map<string, PublicSessionEvent[]>()
let pendingUiStarts = 0

subscribeRunnerEvents(({ sessionId, event }) => {
	if (uiSessions.has(sessionId)) {
		broadcastEvent(event)
	} else if (pendingUiStarts > 0) {
		const events = bufferedEvents.get(sessionId) ?? []
		events.push(event)
		if (events.length > 128) events.shift()
		bufferedEvents.set(sessionId, events)
	}
	if (event.type === 'session.terminal') uiSessions.delete(sessionId)
})

export async function handleRunnerUiMessage(
	message: unknown,
	sender: chrome.runtime.MessageSender
): Promise<UiSuccess | UiFailure> {
	if (!isTrustedExtensionPageSender(sender))
		return failure('PROTOCOL_UNAUTHORIZED_SENDER', 'Unauthorized extension sender', false)
	if (!isUiMessage(message))
		return failure('PROTOCOL_MALFORMED', 'Malformed UI session message', false)

	if (message.type === 'PAGE_AGENT_V2_UI_CANCEL') {
		if (!uiSessions.has(message.sessionId))
			return failure('SESSION_INVALID', 'Session is not owned by the side panel', false)
		try {
			await gateway.cancel({
				origin: extensionOrigin(),
				sessionId: message.sessionId,
				sessionToken: internalToken(),
			})
			return { ok: true, sessionId: message.sessionId }
		} catch (error) {
			return runnerFailure(error)
		}
	}
	if (message.type === 'PAGE_AGENT_V2_UI_REPLY') {
		if (!uiSessions.has(message.sessionId))
			return failure('SESSION_INVALID', 'Session is not owned by the side panel', false)
		try {
			await gateway.reply({
				origin: extensionOrigin(),
				sessionId: message.sessionId,
				sessionToken: internalToken(),
				text: message.text,
			})
			return { ok: true, sessionId: message.sessionId }
		} catch (error) {
			return runnerFailure(error)
		}
	}

	pendingUiStarts += 1
	try {
		const initialTabId = await resolveUiTargetTabId(sender)
		const input = {
			task: message.task,
			capabilities: message.capabilities,
			providerProfile: message.providerProfile,
			origin: extensionOrigin(),
			sessionToken: internalToken(),
			initialTabId,
		}
		let created: { sessionId: string }
		try {
			created = await gateway.start(input)
		} catch (error) {
			const result = runnerFailure(error)
			if (result.code !== 'RUNNER_UNAVAILABLE') throw error
			await ensureRunnerTab()
			created = await gateway.start(input)
		}
		uiSessions.add(created.sessionId)
		flushEvents(created.sessionId)
		return { ok: true, sessionId: created.sessionId }
	} catch (error) {
		const result = runnerFailure(error)
		if (result.code === 'RUNNER_UNAVAILABLE') {
			await ensureRunnerTab()
			return failure('RUNNER_STARTING', 'The extension runner is starting; retry the request', true)
		}
		return result
	} finally {
		pendingUiStarts -= 1
	}
}

async function resolveUiTargetTabId(
	sender: chrome.runtime.MessageSender
): Promise<string | undefined> {
	if (sender.tab?.id !== undefined) return String(sender.tab.id)
	const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
	const activePage = activeTabs.find(isBrowserPageTab)
	if (activePage?.id !== undefined) return String(activePage.id)

	// `lastFocusedWindow` can be empty while Chrome is restoring a window.
	// A final active-tab lookup still gives us a usable target in that short
	// transition without falling back to the invalid `'in-page'` sentinel.
	const anyActiveTabs = await chrome.tabs.query({ active: true })
	const fallbackPage = anyActiveTabs.find(isBrowserPageTab)
	return fallbackPage?.id === undefined ? undefined : String(fallbackPage.id)
}

function isBrowserPageTab(tab: chrome.tabs.Tab): boolean {
	if (tab.id === undefined) return false
	if (!tab.url) return false
	try {
		return ['http:', 'https:'].includes(new URL(tab.url).protocol)
	} catch {
		return false
	}
}

function flushEvents(sessionId: string): void {
	const events = bufferedEvents.get(sessionId)
	if (!events) return
	bufferedEvents.delete(sessionId)
	for (const event of events) broadcastEvent(event)
	if (events.some((event) => event.type === 'session.terminal')) uiSessions.delete(sessionId)
}

function broadcastEvent(event: PublicSessionEvent): void {
	void chrome.runtime
		.sendMessage({ type: 'PAGE_AGENT_V2_UI_EVENT', payload: event })
		.catch(() => {})
}

function isUiMessage(value: unknown): value is UiMessage {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (candidate.type === 'PAGE_AGENT_V2_UI_CANCEL')
		return typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0
	if (candidate.type === 'PAGE_AGENT_V2_UI_REPLY')
		return (
			typeof candidate.sessionId === 'string' &&
			candidate.sessionId.length > 0 &&
			typeof candidate.text === 'string' &&
			candidate.text.trim().length > 0
		)
	if (candidate.type !== 'PAGE_AGENT_V2_UI_START') return false
	return (
		typeof candidate.task === 'string' &&
		candidate.task.trim().length > 0 &&
		Array.isArray(candidate.capabilities) &&
		candidate.capabilities.every(isCapability) &&
		(candidate.providerProfile === undefined || typeof candidate.providerProfile === 'string')
	)
}

function isCapability(value: unknown): value is Capability {
	return (
		value === 'dom.read' ||
		value === 'dom.write' ||
		value === 'navigation' ||
		value === 'tabs.read' ||
		value === 'tabs.write' ||
		value === 'sensitive.submit'
	)
}

function extensionOrigin(): string {
	return `chrome-extension://${chrome.runtime.id}`
}

function internalToken(): string {
	return `ui-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
}

function runnerFailure(error: unknown): UiFailure {
	const message = error instanceof Error ? error.message : String(error)
	return failure(message, message, true)
}

function failure(code: string, message: string, retryable: boolean): UiFailure {
	return { ok: false, code, message, retryable }
}

export type { UiFailure, UiSuccess }
