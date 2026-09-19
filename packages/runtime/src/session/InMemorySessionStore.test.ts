import { describe, expect, it } from 'vitest'

import { InMemorySessionStore } from './InMemorySessionStore'

describe('InMemorySessionStore', () => {
	it('enforces compare-and-set revisions', async () => {
		const store = new InMemorySessionStore()
		const initial = {
			sessionId: 'session-1',
			owner: { kind: 'in_page' as const, ownerId: 'owner-1' },
			task: {
				taskId: 'task-1',
				request: 'test',
				goals: [],
				constraints: [],
				allowedCapabilities: ['dom.read' as const],
				completionPolicy: 'all_required' as const,
				createdAt: '2026-09-19T10:00:00.000Z',
			},
			status: 'created' as const,
			revision: 0,
			budgets: {
				maxSteps: 1,
				maxElapsedMs: 1_000,
				maxActions: 1,
				maxConsecutiveNoProgress: 1,
				maxProviderCalls: {},
				maxRetriesPerErrorCode: {},
				maxTabs: 1,
			},
			browserScope: { ownedTabIds: [], allowedOrigins: [], maxTabs: 1 },
			createdAt: '2026-09-19T10:00:00.000Z',
			updatedAt: '2026-09-19T10:00:00.000Z',
		}

		await store.create(initial)
		await expect(
			store.update({ ...initial, revision: 1, status: 'running' }, 0)
		).resolves.toMatchObject({
			revision: 1,
			status: 'running',
		})
		await expect(store.update({ ...initial, revision: 2, status: 'paused' }, 0)).rejects.toThrow(
			'Expected revision 0, got 1'
		)
	})
})
