import type { ActionName, RiskTier } from '@page-agent/browser'
import type { JsonValue } from '@page-agent/protocol'

import type { LanguagePolicy, ThresholdPolicy } from './gates'
import { routeByConfidence } from './gates'
import { type QuestionTemplate, candidateSelectTemplate } from './questions'
import { jsonStateBytes } from './transports'
import type {
	JevDecisionContext,
	JevDecisionResult,
	JevOption,
	JevRequest,
	JevTransport,
} from './types'

export interface JevDecisionProviderConfig {
	model: string
	transport: JevTransport
	thresholds: ThresholdPolicy
	languagePolicy: LanguagePolicy
	maxStateBytes: number
	telemetry: 'off' | 'metadata' | 'redacted'
	template?: QuestionTemplate
}

export class JevDecisionProvider {
	readonly id = 'jev'
	private readonly template: QuestionTemplate
	private readonly config: JevDecisionProviderConfig

	constructor(config: JevDecisionProviderConfig) {
		this.config = config
		this.template = config.template ?? candidateSelectTemplate
	}

	async decide(
		context: JevDecisionContext & { requestId: string },
		signal: AbortSignal
	): Promise<JevDecisionResult> {
		const stateBytes = jsonStateBytes(context.state)
		if (stateBytes > this.config.maxStateBytes)
			return {
				status: 'invalid',
				reason: `Jev state budget exceeded (${stateBytes} bytes; limit ${this.config.maxStateBytes}). Reduce the observation size.`,
			}
		const question = this.template.build(context.state, context.options)
		const request: JevRequest = {
			requestId: context.requestId,
			model: this.config.model,
			questions: [question],
			language: this.config.languagePolicy,
			stateBytes,
		}
		const response = await this.config.transport.systemOne(request, signal)
		const answer = response.answers.find(
			(candidate) => candidate.questionId === question.questionId
		)
		if (!answer) return { status: 'invalid', reason: 'Jev response omitted the requested question' }
		const confidence = answer.confidence
		const threshold = this.config.thresholds.resolve({
			questionTemplate: question.templateId,
			risk: context.risk,
			action: context.action,
		})
		const route = routeByConfidence(confidence, threshold)
		if (route === 'human')
			return { status: 'escalate', answer, confidence, reason: 'Confidence below human threshold' }
		if (route === 'none')
			return {
				status: 'none',
				answer,
				confidence,
				reason: 'Confidence below verification threshold',
			}
		if (answer.selectedOptionId === 'none_of_the_above')
			return {
				status: 'none',
				answer,
				confidence,
				reason: 'Jev selected the explicit safe none option',
			}
		if (!answer.selectedOptionId)
			return { status: 'invalid', answer, confidence, reason: 'Jev answer has no selected option' }
		return {
			status: route === 'verify' ? 'selected' : 'selected',
			selectedOptionId: answer.selectedOptionId,
			answer,
			confidence,
		}
	}
}

export function buildDecisionState(input: {
	goal: string
	options: JevOption[]
	page: JsonValue
}): JsonValue {
	return {
		goal: input.goal,
		page: input.page,
	} as JsonValue
}

export type { ActionName, RiskTier }
