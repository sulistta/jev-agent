import { describe, expect, it } from 'vitest'

import { InMemoryEventLog } from './EventLog'

describe('InMemoryEventLog', () => {
	it('orders events, resumes after sequence, and redacts secrets in public projection', async () => {
		const log = new InMemoryEventLog()
		await log.append({
			eventId: 'event-1',
			sessionId: 'session-1',
			type: 'action.execution',
			at: '2026-09-19T10:00:00.000Z',
			sensitivity: 'internal',
			payload: { action: 'input', password: 'never-log-this', nested: { token: 'also-secret' } },
		})
		await log.append({
			eventId: 'event-2',
			sessionId: 'session-2',
			type: 'session.result',
			at: '2026-09-19T10:00:01.000Z',
			sensitivity: 'public',
			payload: { status: 'completed' },
		})

		expect(log.list('session-1')).toHaveLength(1)
		expect(log.list('session-1', 1)).toHaveLength(0)
		expect(log.projectPublic('session-1')[0]).toMatchObject({
			sequence: 1,
			payload: { password: '[REDACTED]', nested: { token: '[REDACTED]' } },
		})
	})
})
