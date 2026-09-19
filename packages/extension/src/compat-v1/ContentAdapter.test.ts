import type { PublicSessionEvent } from '@page-agent/protocol'
import { describe, expect, it } from 'vitest'

import { legacyActivityForEvent, legacyStatusForEvent, projectLegacyEvent } from './ContentAdapter'

function event(type: string, payload: Record<string, string> = {}): PublicSessionEvent {
	return {
		eventId: `event-${type}`,
		sequence: 1,
		sessionId: 'session-1',
		type,
		at: '2026-09-19T10:00:00.000Z',
		payload,
	}
}

describe('v1 compatibility projection', () => {
	it('preserves legacy activity and history shapes at the edge', () => {
		const started = event('action.started', { actionType: 'click' })
		const completed = event('action.completed', { actionType: 'click', status: 'executed' })
		const history = projectLegacyEvent(projectLegacyEvent([], started), completed)

		expect(legacyActivityForEvent(started)).toMatchObject({ type: 'executing', tool: 'click' })
		expect(legacyActivityForEvent(completed)).toMatchObject({
			type: 'executed',
			output: 'executed',
		})
		expect(history).toMatchObject([{ type: 'step', action: { name: 'click', output: 'executed' } }])
	})

	it('maps terminal runtime status to the old callback/result vocabulary', () => {
		const terminal = event('session.terminal', { status: 'completed' })

		expect(legacyStatusForEvent(terminal)).toBe('completed')
		expect(projectLegacyEvent([], terminal)).toMatchObject([
			{ type: 'step', action: { name: 'done', input: { success: true }, output: 'completed' } },
		])
	})
})
