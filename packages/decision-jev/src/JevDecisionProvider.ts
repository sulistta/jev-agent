import type { ActionName, RiskTier } from '@page-agent/browser'
import type { JsonValue } from '@page-agent/protocol'

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
		const results = await this.decideMany(
			{
				requestId: context.requestId,
				state: context.state,
				judgments: [{ ...context, questionId: context.questionId ?? this.template.id }],
			},
			signal
		)
		return (
			results[context.questionId ?? this.template.id] ?? {
				status: 'invalid',
				reason: 'Jev response omitted the requested question',
			}
		)
	}

	async decideMany(
		input: {
			requestId: string
			state: JsonValue
			judgments: (Omit<JevDecisionContext, 'state'> & { questionId: string })[]
		},
		signal: AbortSignal
	): Promise<Record<string, JevDecisionResult>> {
		const stateBytes = jsonStateBytes(input.state)
		const questions = input.judgments.map((judgment) => {
			const question = this.template.build(input.state, judgment.options)
			return {
				...question,
				questionId: judgment.questionId,
				primitive: judgment.primitive ?? question.primitive,
				...(judgment.prompt ? { prompt: judgment.prompt } : {}),
				...(judgment.allowNone !== undefined ? { allowNone: judgment.allowNone } : {}),
			}
		})
		const request: JevRequest = {
			requestId: input.requestId,
			model: this.config.model,
			questions,
			language: 'preserve',
			stateBytes,
		}
		const response = await this.config.transport.systemOne(request, signal)
		return Object.fromEntries(
			input.judgments.map((judgment, index) => {
				const question = questions[index]
				const answer = response.answers.find(
					(candidate) => candidate.questionId === question.questionId
				)
				return [judgment.questionId, this.routeAnswer(question, answer)]
			})
		)
	}

	private routeAnswer(
		question: ReturnType<QuestionTemplate['build']>,
		answer: JevDecisionResult['answer']
	): JevDecisionResult {
		if (!answer) return { status: 'invalid', reason: 'Jev response omitted the requested question' }
		if (question.primitive === 'noul') {
			if (typeof answer.value !== 'number' || !Number.isFinite(answer.value))
				return { status: 'invalid', answer, reason: 'Jev Noul answer has no probability' }
			return {
				status: answer.value > 0.5 ? 'selected' : 'none',
				answer,
				confidence: answer.confidence,
			}
		}
		const confidence = answer.confidence
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
			status: 'selected',
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
