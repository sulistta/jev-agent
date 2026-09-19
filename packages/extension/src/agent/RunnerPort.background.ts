import type { PublicSessionEvent, PublicSessionStartPayload } from '@page-agent/protocol'

export interface RunnerStartInput extends PublicSessionStartPayload {
	origin: string
	sessionToken: string
	/** Resolved by the trusted extension boundary; never supplied by page code. */
	initialTabId?: string
}

type RunnerRequestPayload =
	| { type: 'session.start'; input: RunnerStartInput }
	| { type: 'session.cancel'; input: { origin: string; sessionId: string; sessionToken: string } }
	| {
			type: 'session.reply'
			input: { origin: string; sessionId: string; sessionToken: string; text: string }
	  }
	| { type: 'session.result'; input: { origin: string; sessionId: string; sessionToken: string } }

interface RunnerResponse {
	type: 'PAGE_AGENT_V2_RUNNER_RESPONSE'
	requestId: string
	ok: boolean
	value?: unknown
	error?: { code: string; message: string }
}

export interface RunnerEvent {
	sessionId: string
	event: PublicSessionEvent
}

let runnerPort: chrome.runtime.Port | undefined
let requestSequence = 0
const eventListeners = new Set<(event: RunnerEvent) => void>()
const runnerReadyWaiters = new Set<{
	resolve: (ready: boolean) => void
	timer: ReturnType<typeof setTimeout>
}>()
const pending = new Map<
	string,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>()

export function registerRunnerPort(port: chrome.runtime.Port): void {
	runnerPort?.disconnect()
	runnerPort = port
	for (const waiter of runnerReadyWaiters) {
		clearTimeout(waiter.timer)
		waiter.resolve(true)
	}
	runnerReadyWaiters.clear()
	port.onMessage.addListener((message: unknown) => {
		if (isRunnerEvent(message)) {
			for (const listener of eventListeners) listener(message)
			return
		}
		if (!isRunnerResponse(message)) return
		const request = pending.get(message.requestId)
		if (!request) return
		pending.delete(message.requestId)
		if (message.ok) request.resolve(message.value)
		else request.reject(new Error(message.error?.message ?? 'Runner request failed'))
	})
	port.onDisconnect.addListener(() => {
		if (runnerPort !== port) return
		runnerPort = undefined
		for (const [requestId, request] of pending) {
			pending.delete(requestId)
			request.reject(new Error('RUNNER_UNAVAILABLE'))
		}
	})
}

export function subscribeRunnerEvents(listener: (event: RunnerEvent) => void): () => void {
	eventListeners.add(listener)
	return () => eventListeners.delete(listener)
}

export async function ensureRunnerTab(): Promise<void> {
	const runnerUrl = chrome.runtime.getURL('runner.html')
	const existing = await chrome.tabs.query({ url: `${runnerUrl}*` })
	const existingTab = existing.find((tab) => tab.id !== undefined)
	if (existingTab?.id !== undefined) {
		// A runner page can survive a service-worker restart while its Port does
		// not. Reload the orphaned page so it creates a fresh connection.
		if (!runnerPort) await chrome.tabs.reload(existingTab.id)
	} else {
		await chrome.tabs.create({ url: runnerUrl, active: false, pinned: true })
	}
	await waitForRunnerPort()
}

export function waitForRunnerPort(timeoutMs = 5_000): Promise<boolean> {
	if (runnerPort) return Promise.resolve(true)
	return new Promise((resolve) => {
		const waiter = {
			resolve,
			timer: setTimeout(() => {
				runnerReadyWaiters.delete(waiter)
				resolve(false)
			}, timeoutMs),
		}
		runnerReadyWaiters.add(waiter)
	})
}

export function requestRunner<T>(payload: RunnerRequestPayload): Promise<T> {
	const connectedPort = runnerPort
	if (!connectedPort) return Promise.reject(new Error('RUNNER_UNAVAILABLE'))
	const requestId = `runner-${++requestSequence}`
	const timeoutMs = payload.type === 'session.result' ? 150_000 : 30_000
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(requestId)
			reject(new Error('RUNNER_TIMEOUT'))
		}, timeoutMs)
		pending.set(requestId, {
			resolve: (value) => {
				clearTimeout(timer)
				resolve(value as T)
			},
			reject: (error) => {
				clearTimeout(timer)
				reject(error)
			},
		})
		connectedPort.postMessage({ type: 'PAGE_AGENT_V2_RUNNER_REQUEST', requestId, payload })
	})
}

export function runnerGateway() {
	return {
		start: (input: RunnerStartInput) =>
			requestRunner<{ sessionId: string }>({ type: 'session.start', input }),
		cancel: (input: { origin: string; sessionId: string; sessionToken: string }) =>
			requestRunner<unknown>({ type: 'session.cancel', input }).then(() => undefined),
		reply: (input: { origin: string; sessionId: string; sessionToken: string; text: string }) =>
			requestRunner<unknown>({ type: 'session.reply', input }).then(() => undefined),
		result: (input: { origin: string; sessionId: string; sessionToken: string }) =>
			requestRunner<{ status: string; summary?: string }>({ type: 'session.result', input }),
	}
}

function isRunnerResponse(value: unknown): value is RunnerResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_RUNNER_RESPONSE' &&
		typeof candidate.requestId === 'string' &&
		typeof candidate.ok === 'boolean'
	)
}

function isRunnerEvent(value: unknown): value is RunnerEvent {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	const event = candidate.event
	if (typeof event !== 'object' || event === null || Array.isArray(event)) return false
	const eventRecord = event as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_RUNNER_EVENT' &&
		typeof candidate.sessionId === 'string' &&
		typeof eventRecord.eventId === 'string' &&
		typeof eventRecord.sequence === 'number' &&
		typeof eventRecord.sessionId === 'string' &&
		typeof eventRecord.type === 'string' &&
		typeof eventRecord.at === 'string' &&
		'payload' in eventRecord
	)
}

export type { RunnerRequestPayload }
