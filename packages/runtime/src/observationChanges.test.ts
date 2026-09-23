import type { PageObservation } from '@page-agent/browser'
import { describe, expect, it } from 'vitest'

import { compareObservations } from './observationChanges'

function page(elements: PageObservation['elements']): PageObservation {
	return {
		observationId: 'observation',
		sessionId: 'session',
		tabId: 'tab',
		documentId: 'document',
		revision: 1,
		capturedAt: new Date().toISOString(),
		page: { url: 'https://example.test', title: 'Example', origin: 'https://example.test' },
		viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 },
		regions: [],
		elements,
		signals: [],
		sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
	}
}

function control(id: string, name: string, enabled = true): PageObservation['elements'][number] {
	return {
		ref: {
			kind: 'element',
			sessionId: 'session',
			tabId: 'tab',
			documentId: 'document',
			observationId: 'observation',
			revision: 1,
			localId: `index:${id}`,
			fingerprint: id,
		},
		tagName: 'button',
		accessibleName: name,
		visible: true,
		enabled,
		editable: false,
		attributes: { id },
		sensitivity: 'public',
		supportedActions: ['click'],
		bounds: { x: 0, y: 300, width: 100, height: 30 },
	}
}

describe('post-action observation changes', () => {
	it('reports a button created only after input and a newly enabled control', () => {
		const before = page([control('disabled', 'Publish', false)])
		const after = page([control('disabled', 'Publish'), control('new', 'Send')])
		expect(compareObservations(before, after, 'input').controls).toEqual([
			{
				localId: 'index:disabled',
				label: 'Publish',
				change: 'enabled',
				actions: ['click'],
				y: 300,
			},
			{ localId: 'index:new', label: 'Send', change: 'appeared', actions: ['click'], y: 300 },
		])
	})

	it('reports a changed label without treating a stable control as newly created', () => {
		expect(
			compareObservations(
				page([control('send', 'Saving')]),
				page([control('send', 'Saved')]),
				'click'
			).controls
		).toMatchObject([{ change: 'renamed', label: 'Saved' }])
	})

	it('does not expose labels of sensitive controls', () => {
		const hidden = { ...control('secret', 'Private value'), sensitivity: 'secret' as const }
		expect(compareObservations(page([]), page([hidden]), 'input').controls).toEqual([])
	})
})
