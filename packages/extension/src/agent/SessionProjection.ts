import type { AgentActivity, AgentStatus, HistoricalEvent } from '@page-agent/core'
import type { JsonValue, PublicSessionEvent } from '@page-agent/protocol'

export function projectSessionEvent(
	history: HistoricalEvent[],
	event: PublicSessionEvent
): HistoricalEvent[] {
	const payload = asObject(event.payload)
	switch (event.type) {
		case 'assistant.message': {
			const purpose = text(payload.purpose)
			const message = text(payload.text)
			if (
				!message ||
				(purpose !== 'response' && purpose !== 'clarification' && purpose !== 'summary')
			)
				return history
			return [...history, { type: 'assistant_message', text: message, purpose }]
		}
		case 'decision.selected': {
			const candidateLabel = text(payload.candidateLabel)
			const choices = parseChoices(text(payload.choices))
			if (
				(payload.kind === 'failed' || payload.kind === 'blocked') &&
				choices.length === 0
			)
				return history
			return [
				...history,
				{
					type: 'decision',
					kind: text(payload.kind) ?? 'unknown',
					selectedLabel: candidateLabel,
					selectedOptionId: text(payload.selectedOptionId),
					candidateCount: Number(text(payload.candidateCount)) || choices.length,
					choices,
				},
			]
		}
		case 'session.status_changed':
			if (payload.status === 'waiting_user' || payload.status === 'paused')
				return [
					...history,
					{
						type: 'observation',
						content: 'Waiting for user input. Reply in this session.',
					},
				]
			return history
		case 'user.reply':
			return [...history, { type: 'observation', content: 'Reply received. Continuing task.' }]
		case 'observation.captured':
			return history
		case 'goal.updated':
			return [
				...history,
				{
					type: 'observation',
					content: `Goal ${text(payload.goalId) ?? 'updated'}: ${text(payload.status) ?? 'changed'}.`,
				},
			]
		case 'action.started':
			return [
				...history,
				{
					type: 'step',
					stepIndex: stepCount(history),
					reflection: {},
					action: {
						name: text(payload.actionType) ?? 'action',
						input: payload,
						output: 'Running…',
					},
					usage: emptyUsage(),
				},
			]
		case 'action.completed':
			return updateLastAction(
				history,
				actionOutput(
					text(payload.status) ?? 'completed',
					text(payload.errorCode),
					text(payload.errorMessage)
				)
			)
		case 'reference.validated':
			if (payload.status === 'stale' || payload.status === 'missing')
				return [
					...history,
					{
						type: 'observation',
						content: 'The page changed before the action; observing the updated page.',
					},
				]
			return history
		case 'session.failed':
		case 'session.blocked':
			return [
				...history,
				{ type: 'error', message: text(payload.reason) ?? 'Session did not complete.' },
			]
		case 'session.terminal': {
			const status = text(payload.status) ?? 'unknown'
			if (status === 'completed' || status === 'partially_completed') {
				return [
					...history,
					{
						type: 'step',
						stepIndex: stepCount(history),
						reflection: {},
						action: {
							name: 'done',
							input: { success: status === 'completed', text: status },
							output: status,
						},
						usage: emptyUsage(),
					},
				]
			}
			return history
		}
		default:
			return history
	}
}

export function activityForSessionEvent(event: PublicSessionEvent): AgentActivity | null {
	const payload = asObject(event.payload)
	switch (event.type) {
		case 'observation.captured':
		case 'decision.selected':
		case 'policy.decision':
			return { type: 'thinking' }
		case 'action.started':
			return {
				type: 'executing',
				tool: text(payload.actionType) ?? 'action',
				input: payload,
			}
		case 'action.completed':
			return {
				type: 'executed',
				tool: text(payload.actionType) ?? 'action',
				input: payload,
				output: text(payload.status) ?? 'completed',
				duration: 0,
			}
		case 'session.failed':
		case 'session.blocked':
			return { type: 'error', message: text(payload.reason) ?? 'Session blocked' }
		default:
			return null
	}
}

export function statusForSessionEvent(
	previous: AgentStatus,
	event: PublicSessionEvent
): AgentStatus {
	const payload = asObject(event.payload)
	if (event.type === 'session.failed' || event.type === 'session.blocked') return 'error'
	if (event.type === 'session.terminal') return terminalStatus(text(payload.status))
	if (event.type === 'session.started' || event.type === 'session.status_changed') {
		const status = text(payload.status)
		if (status === 'running') return 'running'
		if (status === 'paused' || status === 'waiting_user') return 'running'
	}
	return previous
}

function terminalStatus(status: string | undefined): AgentStatus {
	if (status === 'completed' || status === 'partially_completed') return 'completed'
	if (status === 'cancelled') return 'stopped'
	return 'error'
}

function updateLastAction(history: HistoricalEvent[], output: string): HistoricalEvent[] {
	const next = [...history]
	for (let index = next.length - 1; index >= 0; index -= 1) {
		const event = next[index]
		if (event.type !== 'step' || !event.action) continue
		next[index] = { ...event, action: { ...event.action, output } }
		break
	}
	return next
}

function actionOutput(status: string, errorCode?: string, errorMessage?: string): string {
	if (status !== 'failed') return status
	const detail = [errorCode, errorMessage].filter(Boolean).join(': ')
	return detail ? `${status} — ${detail}` : status
}

function stepCount(history: HistoricalEvent[]): number {
	return history.filter((event) => event.type === 'step').length
}

function emptyUsage(): {
	promptTokens: number
	completionTokens: number
	totalTokens: number
} {
	return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

function asObject(value: JsonValue): Record<string, JsonValue> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

function text(value: JsonValue | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function parseChoices(value?: string): { id: string; label: string }[] {
	if (!value) return []
	try {
		const parsed: unknown = JSON.parse(value)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(
			(item): item is { id: string; label: string } =>
				typeof item === 'object' &&
				item !== null &&
				typeof item.id === 'string' &&
				typeof item.label === 'string'
		)
	} catch {
		return []
	}
}
