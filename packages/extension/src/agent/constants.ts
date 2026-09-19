import type { LLMConfig } from '@page-agent/llms'

/** OpenAI-compatible defaults. Users provide their own API key. */
export const DEFAULT_LLM_MODEL = 'openrouter/free'
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1'

export const DEFAULT_LLM_CONFIG: LLMConfig = {
	baseURL: DEFAULT_LLM_BASE_URL,
	model: DEFAULT_LLM_MODEL,
}
