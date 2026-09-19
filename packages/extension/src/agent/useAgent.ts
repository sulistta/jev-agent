/**
 * Compatibility name for extension pages that still import the old hook.
 * The implementation is now the session-manager client used by both the
 * side panel and Hub; no legacy PageAgentCore is constructed here.
 */
import { useSessionAgent } from './useSessionAgent'

export type { AdvancedConfig, ExtConfig, LanguagePreference } from './config'
export type { UseSessionAgentResult as UseAgentResult } from './useSessionAgent'

export function useAgent() {
	return useSessionAgent()
}
