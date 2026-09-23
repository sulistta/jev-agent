import { describe, expect, it } from 'vitest'

import {
	activityForSessionEvent,
	projectSessionEvent,
	statusForSessionEvent,
} from './SessionProjection'

function event(type: string, payload: Record<string, string> = {}) {
	return {
		eventId: `event-${type}`,
		sequence: 1,
		sessionId: 'session-1',
		type,
		at: '2026-09-19T10:00:00.000Z',
		payload,
	} as const
}

describe('SessionProjection', () => {
	it('shows the clarification reason and waiting state in history', () => {
		const decision = projectSessionEvent(
			[],
			event('decision.selected', { kind: 'clarify', reason: 'A value is required before input' })
		)
		const history = projectSessionEvent(
			decision,
			event('session.status_changed', { status: 'waiting_user' })
		)
		expect(history).toMatchObject([
			{ type: 'decision', kind: 'clarify' },
			{ content: expect.stringContaining('Waiting for user input') },
		])
	})

	it('records the semantic label of the selected browser control', () => {
		const history = projectSessionEvent(
			[],
			event('decision.selected', {
				kind: 'action',
				candidateLabel: 'click Like this video',
				selectedOptionId: 'button-2',
				candidateCount: '2',
				choices: JSON.stringify([
					{ id: 'button-1', label: 'click Subscribe' },
					{ id: 'button-2', label: 'click Like this video' },
				]),
			})
		)
		expect(history).toMatchObject([
			{
				type: 'decision',
				selectedLabel: 'click Like this video',
				selectedOptionId: 'button-2',
				candidateCount: 2,
				choices: expect.any(Array),
			},
		])
	})

	it('does not show a repeated technical decision error before the final error card', () => {
		const history = projectSessionEvent(
			[],
			event('decision.selected', {
				kind: 'failed',
				reason: 'Jev HTTP 400',
				candidateCount: '1',
				choices: JSON.stringify([{ id: 'button-1', label: 'click Like' }]),
			})
		)
		expect(
			projectSessionEvent(history, event('session.failed', { reason: 'Jev HTTP 400' }))
		).toEqual([
			{
				type: 'decision',
				kind: 'failed',
				selectedLabel: undefined,
				selectedOptionId: undefined,
				candidateCount: 1,
				choices: [{ id: 'button-1', label: 'click Like' }],
			},
			{ type: 'error', message: 'Jev HTTP 400' },
		])
	})

	it('projects runtime actions into the existing timeline model', () => {
		const started = projectSessionEvent([], event('action.started', { actionType: 'click' }))
		const completed = projectSessionEvent(
			started,
			event('action.completed', { status: 'executed' })
		)

		expect(completed).toMatchObject([
			{ type: 'step', action: { name: 'click', output: 'executed' } },
		])
		expect(activityForSessionEvent(event('action.started', { actionType: 'click' }))).toMatchObject(
			{
				type: 'executing',
				tool: 'click',
			}
		)
	})

	it('renders semantic model output as a dedicated assistant message', () => {
		const history = projectSessionEvent(
			[],
			event('assistant.message', { purpose: 'clarification', text: 'Qual vídeo você quer?' })
		)
		expect(history).toEqual([
			{ type: 'assistant_message', purpose: 'clarification', text: 'Qual vídeo você quer?' },
		])
	})

	it('confirms that a session reply was accepted without persisting its text', () => {
		const history = projectSessionEvent([], event('user.reply', { received: 'true' }))
		expect(history).toEqual([{ type: 'observation', content: 'Reply received. Continuing task.' }])
	})

	it('shows the browser error that caused an action to fail', () => {
		const started = projectSessionEvent([], event('action.started', { actionType: 'input' }))
		const completed = projectSessionEvent(
			started,
			event('action.completed', {
				status: 'failed',
				errorCode: 'STALE_REFERENCE',
				errorMessage: 'The selected field changed',
			})
		)

		expect(completed).toMatchObject([
			{
				type: 'step',
				action: {
					name: 'input',
					output: 'failed — STALE_REFERENCE: The selected field changed',
				},
			},
		])
	})

	it('maps terminal statuses and emits a visible completed result', () => {
		const history = projectSessionEvent([], event('session.terminal', { status: 'completed' }))

		expect(history).toMatchObject([{ type: 'step', action: { name: 'done' } }])
		expect(
			statusForSessionEvent('running', event('session.terminal', { status: 'completed' }))
		).toBe('completed')
		expect(
			statusForSessionEvent('running', event('session.terminal', { status: 'cancelled' }))
		).toBe('stopped')
	})
})
