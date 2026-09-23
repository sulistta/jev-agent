import { OpenAIClient } from './OpenAIClient'
import { InvokeError, InvokeErrorTypes } from './errors'
import type {
	InvokeOptions,
	InvokeResult,
	LLMClient,
	LLMConfig,
	Message,
	ResolvedLLMConfig,
	Tool,
} from './types'

export { InvokeError, InvokeErrorTypes }
export type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool }

/**
 * LLM module
 */
export class LLM extends EventTarget {
	config: ResolvedLLMConfig
	client: LLMClient

	constructor(config: LLMConfig) {
		super()
		this.config = parseLLMConfig(config)

		// Default to OpenAI client
		this.client = new OpenAIClient(this.config)
	}

	/**
	 * - call llm api *once*
	 * - invoke tool call *once*
	 * - return the result of the tool
	 */
	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		return await withRetry(async () => this.client.invoke(messages, tools, abortSignal, options), {
			maxRetries: this.config.maxRetries,
			abortSignal,
			onRetry: (attempt, lastError) => {
				this.dispatchEvent(
					new CustomEvent('retry', {
						detail: { attempt, maxAttempts: this.config.maxRetries, lastError },
					})
				)
			},
		})
	}
}

/**
 * Retry a function until it succeeds or reaches the maximum number of retries.
 */
async function withRetry<T>(
	fn: () => Promise<T>,
	settings: {
		maxRetries: number
		abortSignal?: AbortSignal
		onRetry: (attempt: number, lastError: Error) => void
	}
): Promise<T> {
	let attempt = 0
	while (true) {
		try {
			return await fn()
		} catch (error: unknown) {
			if ((error as any)?.name === 'AbortError') throw error
			if (error instanceof InvokeError && !error.retryable) throw error
			attempt++
			if (attempt > settings.maxRetries) throw error

			console.debug('[LLM] retryable failure, will retry:', error)
			settings.onRetry(attempt, error as Error)

			await retryDelay(error, attempt, settings.abortSignal)
		}
	}
}

const MAX_PROVIDER_RETRY_DELAY_MS = 60_000

async function retryDelay(error: unknown, attempt: number, signal?: AbortSignal): Promise<void> {
	const providerDelay = error instanceof InvokeError ? error.retryAfterMs : undefined
	const delayMs =
		providerDelay === undefined
			? Math.min(1_000 * 2 ** (attempt - 1), 10_000)
			: Math.min(Math.max(providerDelay, 0), MAX_PROVIDER_RETRY_DELAY_MS)

	if (delayMs === 0) {
		signal?.throwIfAborted()
		return
	}

	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, delayMs)
		const onAbort = () => {
			clearTimeout(timer)
			const reason = signal?.reason
			reject(
				reason instanceof Error
					? reason
					: new DOMException('The operation was aborted', 'AbortError')
			)
		}
		if (signal?.aborted) onAbort()
		else signal?.addEventListener('abort', onAbort, { once: true })
	})
}

export function parseLLMConfig(config: LLMConfig): ResolvedLLMConfig {
	// Runtime validation as defensive programming (types already guarantee these)
	if (!config.baseURL || !config.model) {
		throw new Error(
			'[PageAgent] LLM configuration required. Please provide: baseURL, model. ' +
				'See: https://alibaba.github.io/page-agent/docs/features/models'
		)
	}

	if (config.temperature !== undefined) {
		console.warn(
			'[PageAgent] LLMConfig.temperature is deprecated and will be removed in a future version. ' +
				'Use transformRequestBody to set it only for models you have verified accept it.'
		)
	}

	return {
		baseURL: config.baseURL,
		model: config.model,
		apiKey: config.apiKey || '',
		temperature: config.temperature,
		maxRetries: config.maxRetries ?? 2,
		transformRequestBody: config.transformRequestBody ?? ((requestBody) => requestBody),
		disableNamedToolChoice: config.disableNamedToolChoice ?? false,
		customFetch: (config.customFetch ?? fetch).bind(globalThis), // fetch will be illegal unless bound
	}
}
