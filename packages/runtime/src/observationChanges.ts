import type { ObservedElement, PageObservation } from '@page-agent/browser'

export interface ControlChange {
	localId: string
	label: string
	change: 'appeared' | 'enabled' | 'renamed'
	actions: string[]
	y?: number
}

export interface ObservationChanges {
	afterAction: string
	controls: ControlChange[]
	viewportChanged: boolean
	pageChanged: boolean
	submission?: 'draft' | 'clicked_unverified' | 'published'
}

function identity(element: ObservedElement): string {
	const stable = element.attributes.id || element.attributes.name || element.attributes.href
	return stable
		? `${element.tagName}:${stable}`
		: `${element.tagName}:${element.role ?? ''}:${element.ref.localId}`
}

function label(element: ObservedElement): string {
	const name = element.editable
		? element.placeholder || element.attributes['aria-label'] || element.tagName
		: element.accessibleName || element.placeholder || element.text || element.tagName
	return name.replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function compareObservations(
	before: PageObservation,
	after: PageObservation,
	afterAction: string
): ObservationChanges {
	const previous = new Map(before.elements.map((element) => [identity(element), element]))
	const controls: ControlChange[] = []
	for (const element of after.elements) {
		if (!element.visible || element.sensitivity !== 'public') continue
		const prior = previous.get(identity(element))
		const change = !prior
			? 'appeared'
			: !prior.enabled && element.enabled
				? 'enabled'
				: label(prior) !== label(element)
					? 'renamed'
					: undefined
		if (!change) continue
		controls.push({
			localId: element.ref.localId,
			label: label(element),
			change,
			actions: element.supportedActions ?? [],
			...(element.bounds ? { y: Math.round(element.bounds.y) } : {}),
		})
	}
	return {
		afterAction,
		controls,
		viewportChanged:
			before.viewport.scrollX !== after.viewport.scrollX ||
			before.viewport.scrollY !== after.viewport.scrollY,
		pageChanged: before.page.url !== after.page.url || before.documentId !== after.documentId,
	}
}
