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
			{ content: expect.stringContaining('A value is required before input') },
			{ content: expect.stringContaining('Waiting for user input') },
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
