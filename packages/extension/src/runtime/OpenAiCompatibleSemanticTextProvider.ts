import { LLM, type LLMConfig, type Message, type Tool } from '@page-agent/llms'
import type { SemanticTextProvider } from '@page-agent/runtime'
import * as z from 'zod/v4'

/**
 * Generic OpenAI-compatible semantic adapter. Tool calls are forced so the
 * configured model returns typed data only; it never receives browser authority.
 */
export class OpenAiCompatibleSemanticTextProvider implements SemanticTextProvider {
	private readonly llm: LLM

	constructor(config: LLMConfig) {
		// This component's safety contract depends on named, forced tool calls.
		this.llm = new LLM({ ...config, disableNamedToolChoice: false })
	}

	async probe(signal: AbortSignal): Promise<void> {
		await this.invokeTyped(
			'provider_capability_probe',
			'Return the typed capability probe result.',
			z.object({ ok: z.literal(true) }),
			[
				{
					role: 'system',
					content: 'This is a configuration capability probe. Call the required tool with ok=true.',
				},
			],
			signal
		)
	}

	async plan(input: Parameters<NonNullable<SemanticTextProvider['plan']>>[0], signal: AbortSignal) {
		const schema = z.object({
			version: z.literal(1),
			canonicalGoal: z.string().min(1),
			originalLanguage: z.string().min(1),
			missingInputs: z.array(z.object({ key: z.string().min(1), question: z.string().min(1) })),
			workItems: z.array(
				z.object({
					workItemId: z.string().min(1),
					description: z.string().min(1),
					successCriteria: z.array(z.string().min(1)).min(1).optional(),
					kind: z.enum(['navigate', 'research', 'interact']),
					required: z.boolean(),
					dependsOn: z.array(z.string()),
					status: z.literal('pending'),
				})
			),
			coverage: z.array(
				z.object({
					requirementId: z.string().min(1),
					workItemId: z.string().min(1),
					description: z.string().min(1),
					minimum: z.number().int().min(1),
					distinctBy: z.string().optional(),
					requiredTags: z.array(z.string()).optional(),
				})
			),
			deliverable: z.string().min(1),
			externalActions: z.array(z.string()),
		})
		return this.invokeTyped(
			'provide_task_plan',
			'Create a structured browser task plan. List missing inputs only when no productive browser work can begin without them. Optional preferences, discoverable facts, and values that can use reasonable defaults are not missing inputs. Keep work items semantic; never choose DOM elements or browser operations. Every non-research work item must end in an observable browser-state transition. Do not create a standalone work item that merely finds or identifies a target needed by a later interaction; combine discovery with navigating to or opening that target so its identity does not need to be carried as hidden state. Give every work item observable successCriteria. Use research only when the requested deliverable requires retaining, comparing, or reporting a source-backed set of facts. Discovering a page, entity, item, or UI target solely so it can be opened or acted on is navigation, never research.',
			schema,
			[
				{
					role: 'system',
					content:
						'You plan browser work but do not control the browser. Preserve the user intent exactly, including explicitly requested external actions. Produce canonicalGoal in English and all user-facing questions in the user language. Every research work item must have one or more coverage requirements linked by workItemId.',
				},
				...conversationMessages(input.conversation),
				{ role: 'user', content: `Original request: ${input.request}` },
			],
			signal
		)
	}

	async extract(
		input: Parameters<NonNullable<SemanticTextProvider['extract']>>[0],
		signal: AbortSignal
	) {
		const schema = z.object({
			items: z.array(
				z.object({
					evidenceId: z.string().min(1),
					workItemId: z.string().min(1),
					entityType: z.string().min(1),
					entityName: z.string().min(1),
					attributes: z.record(z.string(), z.json()),
					tags: z.array(z.string()),
					source: z.object({
						url: z.string().url(),
						title: z.string(),
						origin: z.string(),
						quote: z.string().min(1),
						contentBlockId: z.string().optional(),
						capturedAt: z.string(),
					}),
					verification: z.literal('pending'),
				})
			),
		})
		const result = await this.invokeTyped(
			'extract_evidence',
			'Extract only facts explicitly supported by the supplied page content. Every item must include an exact short quote from that content.',
			schema,
			[
				{
					role: 'system',
					content:
						'You extract source-backed browser research records. Do not infer missing prices, dates, ratings, durations, locations, or categories.',
				},
				{
					role: 'user',
					content: JSON.stringify(input),
				},
			],
			signal
		)
		return result.items
	}

	async generate(input: Parameters<SemanticTextProvider['generate']>[0], signal: AbortSignal) {
		const isUrl = input.purpose === 'url'
		const name = isUrl ? 'open_url' : 'provide_text'
		const schema = isUrl
			? z.object({ url: z.string().min(1) })
			: z.object({ text: z.string().min(1) })
		const tool: Tool = {
			description: isUrl
				? 'Return only the HTTP(S) URL required by the already selected tab.open action.'
				: 'Return only the requested text value.',
			inputSchema: schema,
			execute: async (args) => args,
		}
		let result: Awaited<ReturnType<LLM['invoke']>>
		try {
			result = await this.llm.invoke(messagesFor(input), { [name]: tool }, signal, {
				toolChoiceName: name,
			})
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Semantic model provider failed: ${message}`, { cause: error })
		}
		const parsed = schema.safeParse(result.toolResult)
		if (!parsed.success) throw new Error(`Semantic model returned malformed ${input.purpose} data`)
		return parsed.data
	}

	private async invokeTyped<T>(
		name: string,
		description: string,
		schema: z.ZodType<T>,
		messages: Message[],
		signal: AbortSignal
	): Promise<T> {
		const tool: Tool = { description, inputSchema: schema, execute: async (args) => args }
		try {
			const result = await this.llm.invoke(messages, { [name]: tool }, signal, {
				toolChoiceName: name,
			})
			const parsed = schema.safeParse(result.toolResult)
			if (!parsed.success) throw new Error(`Semantic model returned malformed ${name} data`)
			return parsed.data
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Semantic model provider failed: ${message}`, { cause: error })
		}
	}
}

function conversationMessages(
	conversation: Parameters<NonNullable<SemanticTextProvider['plan']>>[0]['conversation']
): Message[] {
	return conversation.slice(-20).map((message) => ({ role: message.role, content: message.text }))
}

function messagesFor(input: Parameters<SemanticTextProvider['generate']>[0]): Message[] {
	const directive: Record<typeof input.purpose, string> = {
		response:
			'Write a helpful direct response to the user. Do not mention internal tools or browser control.',
		clarification:
			'Ask one concise question that resolves the missing information. Do not choose an action.',
		summary:
			'Write a concise factual summary of what was completed. Do not claim unobserved results.',
		input:
			'Provide only the exact text value to enter into the already selected field. Do not choose a field or action.',
		url: 'Provide only the HTTP(S) destination URL for the already selected tab.open action. Do not choose any other action.',
	}
	const conversation = input.conversation.slice(-12).map((message) => ({
		role: message.role,
		content: message.text,
	})) as Message[]
	const context = JSON.stringify({
		request: input.request,
		purpose: input.purpose,
		field: input.field,
		page: input.page,
		reason: input.reason,
		actions: input.actionHistory,
		plan: input.plan,
		evidence: input.evidence?.filter((item) => item.verification === 'verified').slice(-100),
	})
	return [
		{
			role: 'system',
			content:
				'You are the semantic text component of a browser agent. ' +
				`${directive[input.purpose]} Use the same language as the user when appropriate. ` +
				'You have no authority to select browser operations or page elements. Return data only through the required tool.',
		},
		...conversation,
		{ role: 'user', content: `Structured context: ${context}` },
	]
}
