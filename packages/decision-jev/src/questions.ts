import type { JsonValue } from '@page-agent/protocol'

import type { JevOption, JevPrimitive, JevQuestion } from './types'

export interface QuestionTemplate<TState extends JsonValue = JsonValue, TAnswer = unknown> {
	id: string
	version: string
	primitive: JevPrimitive
	calibrationKey: string
	build(state: TState, options?: JevOption[]): JevQuestion
	interpret(answer: unknown): TAnswer
}

export class QuestionTemplateRegistry {
	private readonly templates = new Map<string, QuestionTemplate>()

	register(template: QuestionTemplate): void {
		const key = `${template.id}@${template.version}`
		if (this.templates.has(key)) throw new Error(`Duplicate Jev question template: ${key}`)
		this.templates.set(key, template)
	}

	get(id: string, version: string): QuestionTemplate {
		const template = this.templates.get(`${id}@${version}`)
		if (!template) throw new Error(`Unknown Jev question template: ${id}@${version}`)
		return template
	}

	list(): QuestionTemplate[] {
		return [...this.templates.values()]
	}
}

export const candidateSelectTemplate: QuestionTemplate = {
	id: 'candidate.select',
	version: 'v1',
	primitive: 'choice',
	calibrationKey: 'candidate-selection',
	build: (state, options = []) => ({
		questionId: 'candidate.select',
		templateId: 'candidate.select',
		templateVersion: 'v1',
		primitive: 'choice',
		prompt:
			'Which listed candidate best matches the goal? Select none if no candidate is suitable.',
		state,
		options,
		allowNone: true,
	}),
	interpret: (answer) => {
		if (typeof answer !== 'object' || answer === null) return { status: 'invalid' as const }
		const value = answer as { selectedOptionId?: unknown }
		return typeof value.selectedOptionId === 'string'
			? {
					status:
						value.selectedOptionId === 'none_of_the_above'
							? ('none' as const)
							: ('selected' as const),
					selectedOptionId: value.selectedOptionId,
				}
			: { status: 'invalid' as const }
	},
}

export const candidateAbsoluteFitTemplate: QuestionTemplate = {
	id: 'candidate.absolute_fit',
	version: 'v1',
	primitive: 'noul',
	calibrationKey: 'candidate-absolute-fit',
	build: (state) => ({
		questionId: 'candidate.absolute_fit',
		templateId: 'candidate.absolute_fit',
		templateVersion: 'v1',
		primitive: 'noul',
		prompt: 'Is the selected candidate an appropriate match for the goal?',
		state,
	}),
	interpret: (answer) => (typeof answer === 'boolean' ? answer : undefined),
}
