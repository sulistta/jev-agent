import { describe, expect, it } from 'vitest'

import type { Session } from '../domain'
import { RuntimeInvariantError } from '../errors/RuntimeError'
import { canTransitionSession, isTerminalSessionStatus, transitionSession } from './state'

const session: Session = {
	sessionId: 'session-1',
	owner: { kind: 'in_page', ownerId: 'owner-1' },
	task: {
		taskId: 'task-1',
		request: 'Fill a form',
		goals: [],
		constraints: [],
		allowedCapabilities: ['dom.read'],
		completionPolicy: 'all_required',
		createdAt: '2026-09-19T10:00:00.000Z',
	},
	status: 'created',
	revision: 0,
	budgets: {
		maxSteps: 10,
		maxElapsedMs: 10_000,
		maxActions: 10,
		maxConsecutiveNoProgress: 3,
		maxProviderCalls: {},
		maxRetriesPerErrorCode: {},
		maxTabs: 1,
	},
	browserScope: { ownedTabIds: [], allowedOrigins: [], maxTabs: 1 },
	createdAt: '2026-09-19T10:00:00.000Z',
	updatedAt: '2026-09-19T10:00:00.000Z',
}

describe('session state machine', () => {
	it('allows start and keeps revisions monotonic', () => {
		const running = transitionSession(session, 'running', '2026-09-19T10:00:01.000Z')

		expect(running.status).toBe('running')
		expect(running.revision).toBe(1)
		expect(canTransitionSession('running', 'waiting_user')).toBe(true)
	})

	it('makes terminal states immutable', () => {
		expect(isTerminalSessionStatus('completed')).toBe(true)
		expect(canTransitionSession('completed', 'running')).toBe(false)
		expect(() =>
			transitionSession({ ...session, status: 'completed' }, 'running', session.updatedAt)
		).toThrow(RuntimeInvariantError)
	})
})
