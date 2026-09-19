import type { ElementRef, PageObservation } from '@page-agent/browser'
import { describe, expect, it } from 'vitest'

import { generateCandidates } from './CandidateGenerator'

function ref(localId: string): ElementRef {
	return {
		kind: 'element',
		sessionId: 'session-1',
		tabId: 'in-page',
		documentId: 'document-1',
		observationId: 'observation-1',
		revision: 1,
		localId,
		fingerprint: `fingerprint:${localId}`,
	}
}

const observation: PageObservation = {
	observationId: 'observation-1',
	sessionId: 'session-1',
	tabId: 'in-page',
	documentId: 'document-1',
	revision: 1,
	capturedAt: '2026-09-19T10:00:00.000Z',
	page: { url: 'https://example.test/cart', title: 'Cart', origin: 'https://example.test' },
	viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
	regions: [
		{ regionId: 'region:form', kind: 'form', elementIds: ['button-continue', 'input-name'] },
	],
	elements: [
		{
			ref: ref('button-continue'),
			tagName: 'button',
			role: 'button',
			accessibleName: 'Continuar para checkout',
			visible: true,
			enabled: true,
			editable: false,
			attributes: {},
			sensitivity: 'public',
		},
		{
			ref: ref('button-disabled'),
			tagName: 'button',
			accessibleName: 'Continuar para checkout',
			visible: true,
			enabled: false,
			editable: false,
			attributes: {},
			sensitivity: 'public',
		},
		{
			ref: ref('input-name'),
			tagName: 'input',
			accessibleName: 'Nome',
			visible: true,
			enabled: true,
			editable: true,
			attributes: { name: 'name' },
			sensitivity: 'public',
		},
		{
			ref: ref('select-color'),
			tagName: 'select',
			accessibleName: 'Cor',
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

describe('generateCandidates', () => {
	it('filters incompatible and disabled elements, then ranks by goal tokens', () => {
		const result = generateCandidates({
			observation,
			operation: 'click',
			goalText: 'continuar para checkout',
		})

		expect(result.candidates).toHaveLength(1)
		expect(result.candidates[0]).toMatchObject({
			candidateId: 'observation-1:candidate:0',
			semanticLabel: 'Continuar para checkout',
			regionId: 'region:form',
		})
		expect(result.report).toMatchObject({ initialCount: 4, compatibleCount: 1, returnedCount: 1 })
	})

	it('generates operation-specific candidates with opaque revision-bound ids', () => {
		const input = generateCandidates({
			observation,
			operation: 'input',
			goalText: 'preencher nome',
		})
		const select = generateCandidates({
			observation,
			operation: 'select',
			goalText: 'escolher cor',
		})

		expect(input.candidates[0]).toMatchObject({
			action: 'input',
			target: ref('input-name'),
			args: { replace: true },
		})
		expect(select.candidates[0]).toMatchObject({ action: 'select', target: ref('select-color') })
		expect(input.candidates[0].observationId).toBe(observation.observationId)
	})

	it('honors the candidate limit without changing local identity', () => {
		const result = generateCandidates({ observation, operation: 'focus', maxCandidates: 1 })

		expect(result.candidates).toHaveLength(1)
		expect(result.report.expansionLevel).toBe(1)
	})
})
