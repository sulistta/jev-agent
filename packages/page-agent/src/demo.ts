/**
 * IIFE entry. A provider configuration must be supplied by the user.
 */
import { PageAgent, type PageAgentConfig } from './PageAgent'

const currentScript = document.currentScript as HTMLScriptElement | null
const currentScriptURL = currentScript?.src ? new URL(currentScript.src) : null
const autoInit = currentScriptURL?.searchParams.get('autoInit') !== 'false'

// Clean up existing instances to prevent multiple injections from bookmarklet
if (autoInit && window.pageAgent) {
	window.pageAgent.dispose()
}

// Mount to global window object
window.PageAgent = PageAgent

console.log('🚀 page-agent.js loaded!')

const DEFAULT_MODEL = 'openrouter/free'
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

// in case document.x is not ready yet
if (autoInit) {
	setTimeout(() => {
		let config: PageAgentConfig | undefined
		let showPanel = true

		if (currentScriptURL) {
			const url = currentScriptURL
			const model = url.searchParams.get('model') || DEFAULT_MODEL
			const baseURL = url.searchParams.get('baseURL') || DEFAULT_BASE_URL
			const apiKey = url.searchParams.get('apiKey') || ''
			const language = (url.searchParams.get('lang') as 'zh-CN' | 'en-US') || 'zh-CN'
			showPanel = ((url.searchParams.get('showPanel') as 'true' | 'false') || 'true') === 'true'
			if (apiKey) config = { model, baseURL, apiKey, language }
			else
				console.warn(
					'Page Agent needs an API key. Add apiKey to the script URL or configure LLM_API_KEY at build time.'
				)
		} else {
			const apiKey = import.meta.env.LLM_API_KEY
			if (apiKey)
				config = {
					model: import.meta.env.LLM_MODEL_NAME || DEFAULT_MODEL,
					baseURL: import.meta.env.LLM_BASE_URL || DEFAULT_BASE_URL,
					apiKey,
				}
			else
				console.warn(
					'Page Agent needs an OpenAI-compatible provider configuration. Supply apiKey in the script URL or LLM_API_KEY at build time.'
				)
		}

		if (config) {
			window.pageAgent = new PageAgent(config)
			if (showPanel) window.pageAgent.panel.show()
			console.log('🚀 page-agent.js initialized with configured provider')
		}
	})
}
