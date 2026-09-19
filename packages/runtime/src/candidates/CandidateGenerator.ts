import type { ActionName, Candidate, CandidateSignal, PageObservation } from '@page-agent/browser'
import type { JsonValue } from '@page-agent/protocol'

export type CandidateOperation = Extract<ActionName, 'click' | 'input' | 'select' | 'focus'>

export interface CandidateGenerationRequest {
	observation: PageObservation
	operation: CandidateOperation
	goalText?: string
	maxCandidates?: number
}

export interface CandidateGenerationReport {
	operation: CandidateOperation
	initialCount: number
	compatibleCount: number
	returnedCount: number
	expansionLevel: number
}

export interface CandidateGenerationResult {
	candidates: Candidate[]
	report: CandidateGenerationReport
}

export function generateCandidates(request: CandidateGenerationRequest): CandidateGenerationResult {
	const maxCandidates = request.maxCandidates ?? 30
	const terms = tokenize(request.goalText ?? '')
	const ranked = request.observation.elements
		.map((element, index) => ({ element, index, score: scoreElement(element, terms) }))
		.filter(({ element }) => isCompatible(element, request.operation))
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.element.ref.localId.localeCompare(right.element.ref.localId)
		)
	const candidates = ranked.slice(0, maxCandidates).map(({ element, index, score }) => {
		const action = request.operation
		const signals = candidateSignals(element, terms, score)
		return {
			candidateId: `${request.observation.observationId}:candidate:${index}`,
			observationId: request.observation.observationId,
			action,
			target: element.ref,
			args: (action === 'input' ? { replace: true } : {}) as JsonValue,
			semanticLabel: element.accessibleName ?? element.text ?? element.tagName,
			regionId: findRegion(request.observation, element.ref.localId),
			deterministicSignals: signals,
			risk: { tier: 'R1', reasons: ['candidate filtered and ranked deterministically'] },
		} satisfies Candidate
	})

	return {
		candidates,
		report: {
			operation: request.operation,
			initialCount: request.observation.elements.length,
			compatibleCount: ranked.length,
			returnedCount: candidates.length,
			expansionLevel: maxCandidates < ranked.length ? 1 : 0,
		},
	}
}

function isCompatible(
	element: PageObservation['elements'][number],
	operation: CandidateOperation
): boolean {
	if (!element.visible || !element.enabled) return false
	const role = element.role?.toLowerCase()
	const tag = element.tagName.toLowerCase()
	switch (operation) {
		case 'click':
			return (
				tag === 'button' ||
				tag === 'a' ||
				role === 'button' ||
				role === 'link' ||
				role === 'menuitem'
			)
		case 'input':
			return element.editable
		case 'select':
			return tag === 'select' || role === 'combobox' || role === 'listbox'
		case 'focus':
			return element.editable || tag === 'button' || tag === 'a' || Boolean(role)
	}
}

function scoreElement(element: PageObservation['elements'][number], terms: string[]): number {
	const text = normalize(
		[
			element.accessibleName,
			element.text,
			element.role,
			element.attributes.id,
			element.attributes.name,
		]
			.filter(Boolean)
			.join(' ')
	)
	return terms.reduce(
		(score, term) => score + (text.includes(term) ? 10 : 0),
		element.enabled ? 2 : 0
	)
}

function candidateSignals(
	element: PageObservation['elements'][number],
	terms: string[],
	score: number
): CandidateSignal[] {
	const signals: CandidateSignal[] = [
		{ type: 'visibility', value: element.visible },
		{ type: 'enabled', value: element.enabled },
		{ type: 'heuristic', value: score },
	]
	if (element.role) signals.push({ type: 'role', value: element.role })
	if (element.accessibleName) signals.push({ type: 'label', value: element.accessibleName })
	if (terms.length > 0 && score > 2) signals.push({ type: 'text', value: 'goal-token-match' })
	return signals
}

function findRegion(observation: PageObservation, localId: string): string | undefined {
	return observation.regions.find((region) => region.elementIds.includes(localId))?.regionId
}

function tokenize(value: string): string[] {
	return normalize(value)
		.split(/\s+/)
		.filter((term) => term.length > 1)
}

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
}
