// @vitest-environment happy-dom
import type { PageObservation } from '@page-agent/browser'
import { afterEach, describe, expect, it } from 'vitest'

import { ObservationOverlay } from './ObservationOverlay'

const overlays: ObservationOverlay[] = []
afterEach(() => {
	for (const overlay of overlays) overlay.dispose()
	overlays.length = 0
})

function observation(ids: string[]): PageObservation {
	return {
		elements: ids.map((id, index) => ({
			ref: { localId: id },
			visible: true,
			enabled: true,
			supportedActions: ['click'],
			bounds: { x: index * 30, y: 10, width: 25, height: 20 },
		})),
	} as PageObservation
}

describe('ObservationOverlay', () => {
	it('updates boxes in place across observations and removes them at session end', () => {
		const overlay = new ObservationOverlay()
		overlays.push(overlay)
		overlay.update(observation(['a', 'b']))
		const root = document.querySelector('[data-page-agent-ignore="true"]')
		expect(root?.children).toHaveLength(2)
		const firstBox = root?.children[0]
		overlay.update(observation(['a', 'c']))
		expect(root?.children).toHaveLength(2)
		expect(root?.children[0]).toBe(firstBox)
		overlay.dispose()
		expect(root?.isConnected).toBe(false)
	})
})
