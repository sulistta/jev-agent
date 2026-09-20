import type { BrowserAction } from '@page-agent/browser'
import { describe, expect, it } from 'vitest'

import type { Session } from '../domain'
import { DefaultPolicyEngine } from './DefaultPolicyEngine'

const session: Session = {
	sessionId: 'session-1',
	owner: { kind: 'in_page', ownerId: 'owner-1' },
	task: {
		taskId: 'task-1',
		request: 'test',
		goals: [],
		constraints: [],
		allowedCapabilities: ['dom.read', 'dom.write', 'tabs.write'],
		completionPolicy: 'all_required',
		createdAt: '2026-09-19T10:00:00.000Z',
	},
	status: 'running',
	revision: 1,
	budgets: {
		maxSteps: 10,
		maxElapsedMs: 10_000,
		maxActions: 10,
		maxConsecutiveNoProgress: 3,
		maxProviderCalls: {},
		maxRetriesPerErrorCode: {},
		maxTabs: 1,
	},
	browserScope: { ownedTabIds: [], allowedOrigins: ['https://example.test'], maxTabs: 1 },
	createdAt: '2026-09-19T10:00:00.000Z',
	updatedAt: '2026-09-19T10:00:00.000Z',
}

const decision = (action: BrowserAction) => ({ kind: 'action' as const, action })

describe('DefaultPolicyEngine', () => {
	const policy = new DefaultPolicyEngine()

	it('allows low-risk DOM actions when capability is granted', async () => {
		await expect(
			policy.authorize(
				{
					session,
					decision: decision({ type: 'scroll', axis: 'y', amount: { kind: 'pixels', value: 100 } }),
				},
				new AbortController().signal
			)
		).resolves.toBe('allow')
	})

	it('denies missing capabilities and disallowed destinations', async () => {
		await expect(
			policy.authorize(
				{
					session: { ...session, task: { ...session.task, allowedCapabilities: ['dom.read'] } },
					decision: decision({
						type: 'click',
						target: {
							kind: 'element',
							sessionId: 's',
							tabId: 't',
							documentId: 'd',
							observationId: 'o',
							revision: 1,
							localId: 'l',
							fingerprint: 'f',
						},
					}),
				},
				new AbortController().signal
			)
		).resolves.toBe('deny')

		await expect(
			policy.authorize(
				{ session, decision: decision({ type: 'tab.open', url: 'https://evil.test' }) },
				new AbortController().signal
			)
		).resolves.toBe('deny')
	})

	it('allows opening an HTTP(S) tab requested by a tabs.write task', async () => {
		await expect(
			policy.authorize(
				{ session, decision: decision({ type: 'tab.open', url: 'https://example.test/new' }) },
				new AbortController().signal
			)
		).resolves.toBe('allow')
	})

	it('enforces the session tab ownership limit without an extra confirmation class', async () => {
		await expect(
			policy.authorize(
				{
					session: {
						...session,
						browserScope: {
							...session.browserScope,
							ownedTabIds: ['tab-1'],
							maxTabs: 1,
						},
					},
					decision: decision({ type: 'tab.open', url: 'https://example.test/new' }),
				},
				new AbortController().signal
			)
		).resolves.toBe('deny')

		await expect(
			policy.authorize(
				{
					session,
					decision: decision({ type: 'tab.close', tabId: 'tab-1' }),
				},
				new AbortController().signal
			)
		).resolves.toBe('allow')
	})
})
