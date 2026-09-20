import type { SupportedLanguage } from '@page-agent/core'
import type { LLMConfig } from '@page-agent/llms'

/** Language preference: undefined means follow system. */
export type LanguagePreference = SupportedLanguage | undefined

export interface ExtConfig extends LLMConfig {
	language?: LanguagePreference
}
