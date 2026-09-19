import type { ElementRef, PageObservation } from '@page-agent/browser'
import { describe, expect, it } from 'vitest'

import type { GoalContract } from '../domain'
import { DeterministicOutcomeVerifier } from './DeterministicOutcomeVerifier'

const elementRef: ElementRef = {
	kind: 'element',
	sessionId: 'session-1',
	tabId: 'in-page',
	documentId: 'document-1',
	observationId: 'observation-1',
	revision: 1,
	localId: 'index:0',
	fingerprint: 'fnv1a:test',
}

const observation: PageObservation = {
	observationId: 'observation-1',
	sessionId: 'session-1',
	tabId: 'in-page',
	documentId: 'document-1',
	revision: 1,
	capturedAt: '2026-09-19T10:00:00.000Z',
	page: { url: 'https://example.test/saved', title: 'Saved', origin: 'https://example.test' },
	viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
	regions: [{ regionId: 'region:form', kind: 'form', elementIds: ['index:0'] }],
	elements: [
		{
			ref: elementRef,
			tagName: 'input',
			accessibleName: 'Name',
			text: 'Saved',
			value: 'Ada',
			visible: true,
			enabled: true,
			editable: true,
			attributes: { id: 'name' },
			sensitivity: 'public',
		},
	],
	signals: [],
	sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
}

function goal(outcome: GoalContract['outcome']): GoalContract {
	return {
		goalId: 'goal-1',
		description: 'Verify the result',
		required: true,
		outcome,
		status: 'active',
		evidenceIds: [],
	}
}

describe('DeterministicOutcomeVerifier', () => {
	const verifier = new DeterministicOutcomeVerifier(() => '2026-09-19T10:00:00.000Z')

	it('verifies URL, scoped text, presence, and value predicates', async () => {
		for (const outcome of [
			{
				kind: 'predicate' as const,
				predicate: { kind: 'url.matches' as const, pattern: '/saved$' },
			},
			{
				kind: 'predicate' as const,
				predicate: { kind: 'text.contains' as const, text: 'Saved', scope: 'region:form' },
			},
			{
				kind: 'predicate' as const,
				predicate: { kind: 'element.present' as const, label: 'Name' },
			},
			{
				kind: 'predicate' as const,
				predicate: { kind: 'element.value' as const, ref: elementRef, value: 'Ada' },
			},
		]) {
			await expect(
				verifier.verify({ goal: goal(outcome), observation }, new AbortController().signal)
			).resolves.toMatchObject({
				status: 'satisfied',
				evidence: [{ source: 'deterministic' }],
			})
		}
	})

	it('supports all/any/none and reports unmet outcomes as inconclusive', async () => {
		await expect(
			verifier.verify(
				{
					goal: goal({
						kind: 'all',
						conditions: [
							{ kind: 'predicate', predicate: { kind: 'url.matches', pattern: '/saved$' } },
							{ kind: 'predicate', predicate: { kind: 'text.contains', text: 'missing' } },
						],
					}),
					observation,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ status: 'inconclusive', evidence: [] })

		await expect(
			verifier.verify(
				{
					goal: goal({
						kind: 'any',
						conditions: [
							{ kind: 'predicate', predicate: { kind: 'text.contains', text: 'missing' } },
							{ kind: 'predicate', predicate: { kind: 'text.contains', text: 'Saved' } },
						],
					}),
					observation,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ status: 'satisfied' })

		await expect(
			verifier.verify(
				{
					goal: goal({
						kind: 'none',
						condition: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'absent' } },
					}),
					observation,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ status: 'satisfied' })
	})

	it('fails an expired deadline without claiming completion', async () => {
		await expect(
			verifier.verify(
				{
					goal: goal({
						kind: 'deadline',
						at: '2026-09-19T09:59:00.000Z',
						condition: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'missing' } },
					}),
					observation,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ status: 'failed', evidence: [] })
	})
})
