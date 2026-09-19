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
		actions: input.actionHistory?.slice(-8),
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
