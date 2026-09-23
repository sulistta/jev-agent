import type { TaskPlan, TaskWorkItem } from '../domain'

/**
 * Compiles semantic planning suggestions into executable runtime goals.
 * Research remains separate because it has durable coverage. Navigation and
 * interaction share one complete operational goal so no hidden target identity
 * has to cross an intermediate goal boundary.
 */
export function compileTaskPlan(plan: TaskPlan): TaskPlan {
	const researchIds = new Set(
		plan.workItems.filter((item) => item.kind === 'research').map((item) => item.workItemId)
	)
	const researchItems = plan.workItems
		.filter((item) => item.kind === 'research')
		.map((item) => ({
			...item,
			dependsOn: item.dependsOn.filter((dependency) => researchIds.has(dependency)),
		}))
	const operationalSources = plan.workItems.filter((item) => item.kind !== 'research')
	if (operationalSources.length === 0)
		return {
			...plan,
			workItems: researchItems,
			coverage: plan.coverage.filter((requirement) => researchIds.has(requirement.workItemId)),
		}

	const usedIds = new Set(plan.workItems.map((item) => item.workItemId))
	const operationalItem: TaskWorkItem = {
		workItemId: uniqueId('runtime:operation', usedIds),
		description: plan.canonicalGoal,
		successCriteria: uniqueNonEmpty([
			...operationalSources.flatMap((item) => item.successCriteria ?? []),
			...plan.externalActions,
			plan.deliverable,
		]),
		sourceWorkItemIds: operationalSources.map((item) => item.workItemId),
		kind:
			operationalSources.some((item) => item.kind === 'interact') || plan.externalActions.length > 0
				? 'interact'
				: 'navigate',
		required:
			operationalSources.some((item) => item.required) || plan.externalActions.length > 0,
		dependsOn: researchItems.filter((item) => item.required).map((item) => item.workItemId),
		status: 'pending',
	}

	return {
		...plan,
		workItems: [...researchItems, operationalItem],
		coverage: plan.coverage.filter((requirement) => researchIds.has(requirement.workItemId)),
	}
}

function uniqueId(base: string, usedIds: ReadonlySet<string>): string {
	if (!usedIds.has(base)) return base
	let suffix = 2
	while (usedIds.has(`${base}:${suffix}`)) suffix += 1
	return `${base}:${suffix}`
}

function uniqueNonEmpty(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
