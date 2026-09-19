import { describe, expect, it } from 'vitest'

import type { Session } from '../domain'
import { ConfirmationTokenManager } from './ConfirmationTokens'

const session: Session = {
	sessionId: 'session-1',
	owner: { kind: 'in_page', ownerId: 'owner-1' },
	task: {
		taskId: 'task-1',
		request: 'test',
		goals: [],
		constraints: [],
		allowedCapabilities: ['dom.write'],
		completionPolicy: 'all_required',
		createdAt: '2026-09-19T10:00:00.000Z',
	},
	status: 'waiting_user',
	revision: 2,
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

const action = {
	type: 'click' as const,
	target: {
		kind: 'element' as const,
		sessionId: 'session-1',
		tabId: 'in-page',
		documentId: 'document-1',
		observationId: 'observation-1',
		revision: 1,
		localId: 'save',
		fingerprint: 'fingerprint:save',
	},
}

describe('ConfirmationTokenManager', () => {
	it('binds confirmation to session, action, target, and revision, then consumes once', () => {
		const manager = new ConfirmationTokenManager(
			() => '2026-09-19T10:00:00.000Z',
			() => 'confirmation-1'
		)
		const token = manager.issue({
			session,
			actionId: 'action-1',
			action,
			observationRevision: 1,
			ttlMs: 60_000,
		})
		expect(manager.approve(token.confirmationId)).toMatchObject({ status: 'approved' })
		expect(
			manager.consume({
				confirmationId: token.confirmationId,
				sessionId: session.sessionId,
				actionId: 'action-1',
				action,
				observationRevision: 1,
			})
		).toMatchObject({ ok: true })
		expect(
			manager.consume({
				confirmationId: token.confirmationId,
				sessionId: session.sessionId,
				actionId: 'action-1',
				action,
				observationRevision: 1,
			})
		).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_INVALID' } })
	})

	it('rejects changed target and expiry', () => {
		let now = '2026-09-19T10:00:00.000Z'
		const manager = new ConfirmationTokenManager(
			() => now,
			() => 'confirmation-2'
		)
		const token = manager.issue({
			session,
			actionId: 'action-1',
			action,
			observationRevision: 1,
			ttlMs: 1_000,
		})
		manager.approve(token.confirmationId)
		const changed = { ...action, target: { ...action.target, localId: 'other' } }
		expect(
			manager.consume({
				confirmationId: token.confirmationId,
				sessionId: session.sessionId,
				actionId: 'action-1',
				action: changed,
				observationRevision: 1,
			})
		).toMatchObject({ ok: false })
		now = '2026-09-19T10:00:02.000Z'
		expect(manager.approve(token.confirmationId)).toMatchObject({ code: 'CONFIRMATION_INVALID' })
	})

	it('issues a token for targetless tab actions', () => {
		const manager = new ConfirmationTokenManager(
			() => '2026-09-19T10:00:00.000Z',
			() => 'confirmation-tab-open'
		)
		const tabOpen = { type: 'tab.open' as const, url: 'https://www.youtube.com/' }
		const token = manager.issue({
			session,
			actionId: 'action-tab-open',
			action: tabOpen,
			observationRevision: 1,
			ttlMs: 60_000,
		})

		expect(token).toMatchObject({
			confirmationId: 'confirmation-tab-open',
			targetDigest: expect.stringMatching(/^fnv1a:/),
		})
		expect(manager.approve(token.confirmationId)).toMatchObject({ status: 'approved' })
		expect(
			manager.consume({
				confirmationId: token.confirmationId,
				sessionId: session.sessionId,
				actionId: 'action-tab-open',
				action: tabOpen,
				observationRevision: 1,
			})
		).toMatchObject({ ok: true })
	})
})
