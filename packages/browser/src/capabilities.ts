import type { ActionName } from './elements/Candidate'

export interface BrowserCapabilities {
	mode: 'in_page' | 'extension'
	tabs: boolean
	dom: boolean
	mutationSignals: boolean
	navigationSignals: boolean
	screenshots: false
	arbitraryJavascript: false
	supportedActions: ActionName[]
	protocolVersion?: string
}
