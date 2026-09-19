import type {
	BrowserAction,
	ElementRef,
	PageObservation,
	SecretAwareString,
	SelectOptionRef,
} from '@page-agent/browser'

import { type CandidateOperation, generateCandidates } from '../candidates/CandidateGenerator'
import type { DecisionNeed, GoalContract } from '../domain'
import type { DecisionResult, DecisionRouter } from '../ports'

export type DeterministicActionPlan =
	| { type: 'click'; label: string }
	| { type: 'input'; label: string; text: SecretAwareString; replace?: boolean }
	| { type: 'select'; label: string; option: SelectOptionRef }
	| { type: 'focus'; label: string }

export class DeterministicDecisionRouter implements DecisionRouter {
	private readonly plans: ReadonlyMap<string, DeterministicActionPlan>

	constructor(
		plans: ReadonlyMap<string, DeterministicActionPlan> | Record<string, DeterministicActionPlan>
	) {
		this.plans = plans instanceof Map ? plans : new Map(Object.entries(plans))
	}

	async decide(
		input: {
			session: import('../domain').Session
			goal: GoalContract
			observation: PageObservation
			need: DecisionNeed
		},
		signal: AbortSignal
	): Promise<DecisionResult> {
		if (signal.aborted) return { kind: 'failed', reason: 'CANCELLED' }
		const plan = this.plans.get(input.goal.goalId)
		if (!plan) return { kind: 'failed', reason: `No deterministic plan for ${input.goal.goalId}` }

		const generated = generateCandidates({
			observation: input.observation,
			operation: plan.type as CandidateOperation,
			goalText: plan.label,
		})
		const candidate = generated.candidates[0]
		if (!candidate?.target) {
			return { kind: 'failed', reason: `No compatible candidate for ${plan.type}: ${plan.label}` }
		}

		return {
			kind: 'action',
			candidateId: candidate.candidateId,
			action: actionForPlan(plan, candidate.target),
		}
	}
}

function actionForPlan(plan: DeterministicActionPlan, target: ElementRef): BrowserAction {
	switch (plan.type) {
		case 'click':
			return { type: 'click', target }
		case 'input':
			return { type: 'input', target, text: plan.text, replace: plan.replace ?? true }
		case 'select':
			return { type: 'select', target, option: plan.option }
		case 'focus':
			return { type: 'focus', target }
	}
}
