import type { Capability } from '@page-agent/protocol'
import { describe, expect, it } from 'vitest'

import { InMemoryGrantStore, OriginGrantManager } from './OriginGrants'

const clock = { now: () => '2026-09-19T10:00:00.000Z' }
let sequence = 0
const ids = { next: (kind: 'grant' | 'session-token') => `${kind}-${++sequence}` }

describe('OriginGrantManager', () => {
	it('rejects invalid grant TTLs and capabilities', async () => {
		const manager = new OriginGrantManager(new InMemoryGrantStore(), clock, ids)

		await expect(manager.create('https://example.test', ['dom.read'], 0)).rejects.toThrow(
			'Grant TTL must be positive'
		)
		await expect(
			manager.create('https://example.test', ['unknown' as Capability], 60_000)
		).rejects.toThrow('Grant contains an unsupported capability')
	})

	it('requires origin, capability and fresh nonce for a public session', async () => {
		const manager = new OriginGrantManager(new InMemoryGrantStore(), clock, ids)
		const grant = await manager.create('https://example.test', ['dom.read'], 60_000)

		await expect(
			manager.issueSession({
				grantId: grant.grantId,
				origin: 'https://evil.test',
				nonce: 'nonce-1',
				requestedCapabilities: ['dom.read'],
			})
		).resolves.toMatchObject({ ok: false, code: 'ORIGIN_MISMATCH' })

		const session = await manager.issueSession({
			grantId: grant.grantId,
			origin: 'https://example.test',
			nonce: 'nonce-1',
			requestedCapabilities: ['dom.read'],
		})
		expect(session).toMatchObject({ ok: true, value: { origin: 'https://example.test' } })
		await expect(
			manager.issueSession({
				grantId: grant.grantId,
				origin: 'https://example.test',
				nonce: 'nonce-1',
				requestedCapabilities: ['dom.read'],
			})
		).resolves.toMatchObject({ ok: false, code: 'NONCE_REPLAY' })
	})

	it('revocation invalidates issued session tokens', async () => {
		const manager = new OriginGrantManager(new InMemoryGrantStore(), clock, ids)
		const grant = await manager.create('https://example.test', ['dom.read'], 60_000)
		const issued = await manager.issueSession({
			grantId: grant.grantId,
			origin: 'https://example.test',
			nonce: 'nonce-2',
			requestedCapabilities: ['dom.read'],
		})
		if (!issued.ok) throw new Error('expected session')
		await manager.revoke(grant.grantId)
		await expect(
			manager.authorize(issued.value.sessionToken, 'https://example.test', 'dom.read')
		).resolves.toMatchObject({
			ok: false,
			code: 'SESSION_INVALID',
		})
	})

	it('serializes concurrent attempts to consume the same nonce', async () => {
		const manager = new OriginGrantManager(new InMemoryGrantStore(), clock, ids)
		const grant = await manager.create('https://example.test', ['dom.read'], 60_000)
		const input = {
			grantId: grant.grantId,
			origin: grant.origin,
			nonce: 'nonce-concurrent',
			requestedCapabilities: ['dom.read'] as Capability[],
		}

		const results = await Promise.all([manager.issueSession(input), manager.issueSession(input)])

		expect(results.filter((result) => result.ok)).toHaveLength(1)
		expect(results.filter((result) => !result.ok)).toEqual([
			expect.objectContaining({ code: 'NONCE_REPLAY' }),
		])
	})
})
