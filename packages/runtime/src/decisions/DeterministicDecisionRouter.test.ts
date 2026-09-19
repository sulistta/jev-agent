import type { ElementRef, PageObservation, SecretAwareString } from '@page-agent/browser'
import { describe, expect, it } from 'vitest'

import type { GoalContract } from '../domain'
import { DeterministicDecisionRouter } from './DeterministicDecisionRouter'

const ref: ElementRef = {
	kind: 'element',
	sessionId: 'session-1',
	tabId: 'in-page',
	documentId: 'document-1',
	observationId: 'observation-1',
	revision: 1,
	localId: 'continue',
	fingerprint: 'fingerprint:continue',
}

const observation: PageObservation = {
	observationId: 'observation-1',
	sessionId: 'session-1',
	tabId: 'in-page',
	documentId: 'document-1',
	revision: 1,
	capturedAt: '2026-09-19T10:00:00.000Z',
	page: { url: 'https://example.test/', title: 'Form', origin: 'https://example.test' },
	viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
	regions: [],
	elements: [
		{
			ref,
			tagName: 'button',
			role: 'button',
			accessibleName: 'Continue',
			visible: true,
			enabled: true,
			editable: false,
			attributes: {},
			sensitivity: 'public',
		},
	],
	signals: [],
	sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
}

const goal: GoalContract = {
	goalId: 'goal-1',
	description: 'Continue',
	required: true,
	outcome: { kind: 'predicate', predicate: { kind: 'url.matches', pattern: 'example' } },
	status: 'active',
	evidenceIds: [],
}

describe('DeterministicDecisionRouter', () => {
	it('maps a plan to a current candidate without touching the browser', async () => {
		const router = new DeterministicDecisionRouter({
			'goal-1': { type: 'click', label: 'continue' },
		})
		const result = await router.decide(
			{
				session: {} as never,
				goal,
				observation,
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: true,
					risk: 'R1',
					requiredCapabilities: ['dom.write'],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({
			kind: 'action',
			candidateId: 'observation-1:candidate:0',
			action: { type: 'click', target: ref },
		})
	})

	it('returns a failed decision when the plan has no compatible target', async () => {
		const router = new DeterministicDecisionRouter({
			'goal-1': { type: 'input', label: 'name', text: 'Ada' as SecretAwareString },
		})
		const result = await router.decide(
			{
				session: {} as never,
				goal,
				observation,
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: true,
					risk: 'R1',
					requiredCapabilities: ['dom.write'],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({ kind: 'failed' })
	})
})
