import type { ElementRef, PageObservation } from '@page-agent/browser'

import type { Evidence, OutcomeContract, OutcomePredicate } from '../domain'
import type { OutcomeVerifier } from '../ports'

export class DeterministicOutcomeVerifier implements OutcomeVerifier {
	private readonly clock: () => string

	constructor(clock: () => string = () => new Date().toISOString()) {
		this.clock = clock
	}

	async verify(
		input: Parameters<OutcomeVerifier['verify']>[0],
		signal: AbortSignal
	): Promise<{ status: 'satisfied' | 'inconclusive' | 'failed'; evidence: Evidence[] }> {
		if (signal.aborted) return { status: 'inconclusive', evidence: [] }
		const evaluation = evaluateContract(input.goal.outcome, input.observation, this.clock())
		if (evaluation.status === 'satisfied') {
			return {
				status: 'satisfied',
				evidence: [
					{
						evidenceId: `evidence:${input.goal.goalId}:${input.observation.observationId}`,
						type: 'outcome.verified',
						source: 'deterministic',
						value: evaluation.value,
						capturedAt: input.observation.capturedAt,
						sensitivity: 'public',
					},
				],
			}
		}
		return { status: evaluation.status, evidence: [] }
	}
}

function evaluateContract(
	contract: OutcomeContract,
	observation: PageObservation,
	now: string
): { status: 'satisfied' | 'inconclusive' | 'failed'; value: boolean } {
	switch (contract.kind) {
		case 'all': {
			const results = contract.conditions.map((condition) =>
				evaluateContract(condition, observation, now)
			)
			if (results.some((result) => result.status === 'failed'))
				return { status: 'failed', value: false }
			return results.every((result) => result.value)
				? { status: 'satisfied', value: true }
				: { status: 'inconclusive', value: false }
		}
		case 'any': {
			const results = contract.conditions.map((condition) =>
				evaluateContract(condition, observation, now)
			)
			if (results.some((result) => result.status === 'satisfied'))
				return { status: 'satisfied', value: true }
			return results.every((result) => result.status === 'failed')
				? { status: 'failed', value: false }
				: { status: 'inconclusive', value: false }
		}
		case 'none': {
			const result = evaluateContract(contract.condition, observation, now)
			return result.value
				? { status: 'inconclusive', value: false }
				: { status: 'satisfied', value: true }
		}
		case 'deadline': {
			const result = evaluateContract(contract.condition, observation, now)
			if (result.value) return { status: 'satisfied', value: true }
			return now >= contract.at
				? { status: 'failed', value: false }
				: { status: 'inconclusive', value: false }
		}
		case 'predicate':
			return predicateResult(contract.predicate, observation)
	}
}

function predicateResult(
	predicate: OutcomePredicate,
	observation: PageObservation
): { status: 'satisfied' | 'inconclusive'; value: boolean } {
	switch (predicate.kind) {
		case 'url.matches': {
			const value = new RegExp(predicate.pattern).test(observation.page.url)
			return { status: value ? 'satisfied' : 'inconclusive', value }
		}
		case 'text.contains': {
			const elements = predicate.scope
				? observation.regions
						.filter((region) => region.regionId === predicate.scope)
						.flatMap((region) => region.elementIds)
						.map((elementId) =>
							observation.elements.find((element) => element.ref.localId === elementId)
						)
						.filter((element) => element !== undefined)
				: observation.elements
			const text = elements
				.map((element) =>
					[element.accessibleName, element.text, element.value].filter(Boolean).join(' ')
				)
				.join(' ')
			const value = text.includes(predicate.text)
			return { status: value ? 'satisfied' : 'inconclusive', value }
		}
		case 'element.present': {
			const found = predicate.ref
				? hasElementRef(observation, predicate.ref)
				: observation.elements.some((element) =>
						[element.accessibleName, element.text].some((value) =>
							value?.includes(predicate.label ?? '')
						)
					)
			return { status: found ? 'satisfied' : 'inconclusive', value: found }
		}
		case 'element.value': {
			const value = observation.elements.some(
				(element) =>
					predicate.ref !== undefined &&
					sameRef(element.ref, predicate.ref) &&
					element.value === predicate.value
			)
			return { status: value ? 'satisfied' : 'inconclusive', value }
		}
		case 'tab.exists': {
			const value = observation.tabId === predicate.tabId
			return { status: value ? 'satisfied' : 'inconclusive', value }
		}
	}
}

function hasElementRef(observation: PageObservation, ref: ElementRef): boolean {
	return observation.elements.some((element) => sameRef(element.ref, ref))
}

function sameRef(left: PageObservation['elements'][number]['ref'], right: typeof left): boolean {
	return (
		left.sessionId === right.sessionId &&
		left.tabId === right.tabId &&
		left.documentId === right.documentId &&
		left.localId === right.localId
	)
}
