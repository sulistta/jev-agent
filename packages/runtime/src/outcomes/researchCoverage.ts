import type { EvidenceItem, Session } from '../domain'

/**
 * Coverage is a deterministic lower bound for a research result. It is never
 * a semantic conclusion on its own; the decision router must still verify the
 * work item against the browser state and the recorded evidence.
 */
export function researchCoverageSatisfied(session: Session, goalId: string): boolean {
	const workItem = session.plan?.workItems.find((item) => item.workItemId === goalId)
	if (!workItem || workItem.kind !== 'research' || !session.plan) return false
	const requirements = session.plan.coverage.filter(
		(requirement) => requirement.workItemId === workItem.workItemId
	)
	return (
		requirements.length > 0 &&
		requirements.every((requirement) => {
			const matching = (session.evidence ?? []).filter(
				(item) =>
					item.workItemId === workItem.workItemId &&
					item.verification === 'verified' &&
					(requirement.requiredTags ?? []).every((tag) => item.tags.includes(tag))
			)
			if (!requirement.distinctBy) return matching.length >= requirement.minimum
			const values = new Set(
				matching
					.map((item) => evidenceDistinctValue(item, requirement.distinctBy!))
					.filter((value) => value !== undefined)
					.map((value) => JSON.stringify(value))
			)
			return values.size >= requirement.minimum
		})
	)
}

export function researchCoverageState(session: Session, goalId: string): {
	satisfied: boolean
	requirements: {
		description: string
		minimum: number
		distinctBy?: string
		requiredTags?: string[]
		verifiedCount: number
		distinctCount?: number
	}[]
} | undefined {
	const workItem = session.plan?.workItems.find((item) => item.workItemId === goalId)
	if (!workItem || workItem.kind !== 'research' || !session.plan) return undefined
	const requirements = session.plan.coverage.filter(
		(requirement) => requirement.workItemId === workItem.workItemId
	)
	return {
		satisfied: researchCoverageSatisfied(session, goalId),
		requirements: requirements.map((requirement) => {
			const matching = (session.evidence ?? []).filter(
				(item) =>
					item.workItemId === workItem.workItemId &&
					item.verification === 'verified' &&
					(requirement.requiredTags ?? []).every((tag) => item.tags.includes(tag))
			)
			const distinctValues = requirement.distinctBy
				? new Set(
						matching
							.map((item) => evidenceDistinctValue(item, requirement.distinctBy!))
							.filter((value) => value !== undefined)
							.map((value) => JSON.stringify(value))
					)
				: undefined
			return {
				description: requirement.description,
				minimum: requirement.minimum,
				...(requirement.distinctBy ? { distinctBy: requirement.distinctBy } : {}),
				...(requirement.requiredTags ? { requiredTags: requirement.requiredTags } : {}),
				verifiedCount: matching.length,
				...(distinctValues ? { distinctCount: distinctValues.size } : {}),
			}
		}),
	}
}

function evidenceDistinctValue(
	item: EvidenceItem,
	field: string
): import('@page-agent/protocol').JsonValue | undefined {
	if (field === 'entityName') return item.entityName
	if (field === 'source.origin' || field === 'origin') return item.source.origin
	if (field === 'source.url' || field === 'url') return item.source.url
	return item.attributes[field]
}
