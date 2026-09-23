import { describe, expect, it } from 'vitest'

import type { TaskPlan } from '../domain'
import { compileTaskPlan } from './compileTaskPlan'

function plan(workItems: TaskPlan['workItems']): TaskPlan {
	return {
		version: 1,
		canonicalGoal: 'Like the second oldest video on the requested channel',
		originalLanguage: 'pt-BR',
		missingInputs: [],
		workItems,
		coverage: [],
		deliverable: 'The second oldest video is liked',
		externalActions: ['Like the requested video'],
	}
}

describe('compileTaskPlan', () => {
	it('compiles locate, identify, and interact suggestions into one operational goal', () => {
		const compiled = compileTaskPlan(
			plan([
				workItem('locate-channel', 'navigate'),
				workItem('identify-target', 'navigate', ['locate-channel']),
				workItem('like-target', 'interact', ['identify-target']),
			])
		)

		expect(compiled.workItems).toEqual([
			expect.objectContaining({
				workItemId: 'runtime:operation',
				description: compiled.canonicalGoal,
				kind: 'interact',
				dependsOn: [],
				sourceWorkItemIds: ['locate-channel', 'identify-target', 'like-target'],
				successCriteria: expect.arrayContaining([
					'Like the requested video',
					'The second oldest video is liked',
				]),
			}),
		])
		expect(compiled.workItems.some((item) => item.workItemId === 'identify-target')).toBe(false)
	})

	it('keeps research coverage separate and runs the operation after required research', () => {
		const input = plan([
			{ ...workItem('compare-options', 'research'), successCriteria: ['Three sources compared'] },
			workItem('submit-choice', 'interact', ['compare-options']),
		])
		input.coverage = [
			{
				requirementId: 'three-sources',
				workItemId: 'compare-options',
				description: 'Compare three sources',
				minimum: 3,
			},
		]

		const compiled = compileTaskPlan(input)

		expect(compiled.workItems).toHaveLength(2)
		expect(compiled.workItems[0]).toMatchObject({
			workItemId: 'compare-options',
			kind: 'research',
		})
		expect(compiled.workItems[1]).toMatchObject({
			workItemId: 'runtime:operation',
			dependsOn: ['compare-options'],
		})
		expect(compiled.coverage).toEqual(input.coverage)
	})

	it('compiles a navigation-only plan into one complete navigation goal', () => {
		const input = plan([workItem('open-destination', 'navigate')])
		input.externalActions = []

		expect(compileTaskPlan(input).workItems).toEqual([
			expect.objectContaining({ kind: 'navigate', sourceWorkItemIds: ['open-destination'] }),
		])
	})
})

function workItem(
	workItemId: string,
	kind: TaskPlan['workItems'][number]['kind'],
	dependsOn: string[] = []
): TaskPlan['workItems'][number] {
	return {
		workItemId,
		description: workItemId,
		successCriteria: [`${workItemId} completed`],
		kind,
		required: true,
		dependsOn,
		status: 'pending',
	}
}
