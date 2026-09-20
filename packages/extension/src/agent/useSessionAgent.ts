import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	SupportedLanguage,
} from '@page-agent/core'
import type { Capability, PublicSessionEvent } from '@page-agent/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getSession } from '@/lib/db'
import { OpenAiCompatibleSemanticTextProvider } from '@/runtime/OpenAiCompatibleSemanticTextProvider'

import {
	activityForSessionEvent,
	projectSessionEvent,
	statusForSessionEvent,
} from './SessionProjection'
import type { ExtConfig } from './config'
import { ACTIVE_UI_SESSION_KEY, DEFAULT_LLM_CONFIG } from './constants'

export interface UseSessionAgentResult {
	waitingForUser: boolean
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
	config: ExtConfig | null
	execute: (task: string) => Promise<ExecutionResult>
	reply: (text: string) => Promise<void>
	stop: () => void
	configure: (config: ExtConfig) => Promise<void>
}

interface PendingExecution {
	resolve: (result: ExecutionResult) => void
	reject: (error: unknown) => void
}

export function useSessionAgent(): UseSessionAgentResult {
	const [waitingForUser, setWaitingForUser] = useState(false)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
	const [config, setConfig] = useState<ExtConfig | null>(null)
	const currentSessionRef = useRef<string | undefined>(undefined)
	const historyRef = useRef<HistoricalEvent[]>([])
	const pendingEventsRef = useRef(new Map<string, PublicSessionEvent[]>())
	const pendingExecutionRef = useRef<PendingExecution | null>(null)
	const statusRef = useRef<AgentStatus>('idle')

	const recordRuntimeError = useCallback((message: string) => {
		statusRef.current = 'error'
		setStatus('error')
		setActivity(null)
		const nextHistory: HistoricalEvent[] = [...historyRef.current, { type: 'error', message }]
		historyRef.current = nextHistory
		setHistory(nextHistory)
	}, [])

	const consumeEvent = useCallback((event: PublicSessionEvent) => {
		if (
			event.type === 'session.status_changed' &&
			typeof event.payload === 'object' &&
			event.payload !== null &&
			!Array.isArray(event.payload)
		) {
			setWaitingForUser(
				event.payload.status === 'waiting_user' || event.payload.status === 'paused'
			)
		}
		const nextHistory = projectSessionEvent(historyRef.current, event)
		historyRef.current = nextHistory
		setHistory(nextHistory)

		const nextActivity = activityForSessionEvent(event)
		setActivity(nextActivity?.type === 'error' ? null : nextActivity)
		const nextStatus = statusForSessionEvent(statusRef.current, event)
		statusRef.current = nextStatus
		setStatus(nextStatus)

		if (event.type === 'session.terminal') {
			setWaitingForUser(false)
			setActivity(null)
			currentSessionRef.current = undefined
			const pending = pendingExecutionRef.current
			if (!pending) return
			pendingExecutionRef.current = null
			pending.resolve({
				success: nextStatus === 'completed',
				data: terminalSummary(event),
				history: nextHistory,
			})
		}
	}, [])

	useEffect(() => {
		const onMessage = (message: unknown) => {
			if (!isUiEventMessage(message)) return
			const event = message.payload
			if (currentSessionRef.current === event.sessionId) {
				consumeEvent(event)
				return
			}
			const events = pendingEventsRef.current.get(event.sessionId) ?? []
			events.push(event)
			if (events.length > 128) events.shift()
			pendingEventsRef.current.set(event.sessionId, events)
		}
		chrome.runtime.onMessage.addListener(onMessage)
		return () => chrome.runtime.onMessage.removeListener(onMessage)
	}, [consumeEvent])

	useEffect(() => {
		chrome.storage.local
			.get(['llmConfig', 'language', ACTIVE_UI_SESSION_KEY])
			.then(async (result) => {
				const llmConfig = (result.llmConfig as ExtConfig | undefined) ?? DEFAULT_LLM_CONFIG
				const language = (result.language as SupportedLanguage) || undefined
				if (!result.llmConfig) void chrome.storage.local.set({ llmConfig: DEFAULT_LLM_CONFIG })
				setConfig({ ...llmConfig, language })
				const activeSessionId = result[ACTIVE_UI_SESSION_KEY]
				if (typeof activeSessionId !== 'string') return
				const record = await getSession(activeSessionId)
				if (!record || (record.status !== 'running' && record.status !== 'waiting_user')) {
					await chrome.storage.local.remove(ACTIVE_UI_SESSION_KEY)
					return
				}
				currentSessionRef.current = activeSessionId
				historyRef.current = record.history
				setHistory(record.history)
				setCurrentTask(record.task)
				setWaitingForUser(record.status === 'waiting_user')
				statusRef.current = 'running'
				setStatus('running')
				const buffered = pendingEventsRef.current.get(activeSessionId) ?? []
				pendingEventsRef.current.delete(activeSessionId)
				for (const event of buffered) consumeEvent(event)
			})
	}, [consumeEvent])

	const execute = useCallback(
		async (task: string): Promise<ExecutionResult> => {
			setWaitingForUser(false)
			setCurrentTask(task)
			currentSessionRef.current = undefined
			historyRef.current = []
			setHistory([])
			statusRef.current = 'idle'
			setActivity(null)

			let pending!: PendingExecution
			const result = new Promise<ExecutionResult>((resolve, reject) => {
				pending = { resolve, reject }
				pendingExecutionRef.current = pending
			})

			try {
				const response = await chrome.runtime.sendMessage({
					type: 'PAGE_AGENT_V2_UI_START',
					task,
					capabilities: [
						'dom.read',
						'dom.write',
						'navigation',
						'tabs.read',
						'tabs.write',
					] satisfies Capability[],
					providerProfile: 'user-default',
				})
				if (!isStartSuccess(response)) {
					const error = new Error(response?.message ?? 'Unable to start runtime session')
					pendingExecutionRef.current = null
					recordRuntimeError(error.message)
					pending.reject(error)
					return await result
				}

				currentSessionRef.current = response.sessionId
				statusRef.current = 'running'
				setStatus('running')
				setActivity({ type: 'thinking' })
				const buffered = pendingEventsRef.current.get(response.sessionId) ?? []
				pendingEventsRef.current.delete(response.sessionId)
				for (const event of buffered) consumeEvent(event)
				return await result
			} catch (error) {
				const ownsPendingExecution = pendingExecutionRef.current === pending
				if (ownsPendingExecution) {
					pendingExecutionRef.current = null
					recordRuntimeError(error instanceof Error ? error.message : String(error))
					pending.reject(error)
				}
				throw error
			}
		},
		[consumeEvent, recordRuntimeError]
	)

	const stop = useCallback(() => {
		const sessionId = currentSessionRef.current
		if (!sessionId) return
		void chrome.runtime
			.sendMessage({ type: 'PAGE_AGENT_V2_UI_CANCEL', sessionId })
			.catch((error: unknown) => {
				console.error('[SidePanel] Failed to cancel session:', error)
			})
	}, [])

	const reply = useCallback(async (text: string) => {
		const sessionId = currentSessionRef.current
		if (!sessionId) throw new Error('No session is waiting for a reply')
		const response = await chrome.runtime.sendMessage({
			type: 'PAGE_AGENT_V2_UI_REPLY',
			sessionId,
			text,
		})
		if (!isStartSuccess(response)) throw new Error(response?.message ?? 'Unable to send reply')
		setWaitingForUser(false)
		statusRef.current = 'running'
		setStatus('running')
	}, [])

	const configure = useCallback(async (next: ExtConfig) => {
		const { language, ...llmConfig } = next
		const probeController = new AbortController()
		const probeTimeout = setTimeout(() => probeController.abort(), 15_000)
		try {
			await new OpenAiCompatibleSemanticTextProvider(llmConfig).probe(probeController.signal)
		} finally {
			clearTimeout(probeTimeout)
		}
		await chrome.storage.local.set({ llmConfig })
		if (language) await chrome.storage.local.set({ language })
		else await chrome.storage.local.remove('language')
		await chrome.storage.local.remove('advancedConfig')
		setConfig({ ...llmConfig, language })
	}, [])

	return {
		status,
		waitingForUser,
		history,
		activity,
		currentTask,
		config,
		execute,
		reply,
		stop,
		configure,
	}
}

function isUiEventMessage(
	value: unknown
): value is { type: 'PAGE_AGENT_V2_UI_EVENT'; payload: PublicSessionEvent } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	const payload = candidate.payload
	if (candidate.type !== 'PAGE_AGENT_V2_UI_EVENT') return false
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

function isStartSuccess(value: unknown): value is { ok: true; sessionId: string } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return candidate.ok === true && typeof candidate.sessionId === 'string'
}

function terminalSummary(event: PublicSessionEvent): string {
	if (
		typeof event.payload === 'object' &&
		event.payload !== null &&
		!Array.isArray(event.payload)
	) {
		const status = (event.payload as Record<string, unknown>).status
		const summary = (event.payload as Record<string, unknown>).summary
		if (typeof summary === 'string' && summary) return summary
		if (typeof status === 'string') return status
	}
	return 'Session ended'
}
