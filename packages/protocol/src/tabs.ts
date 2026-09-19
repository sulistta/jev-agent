import type { JsonObject } from './json'

export interface WireTabDescriptor {
	tabId: string
	windowId?: string
	url: string
	title: string
	ownedBy?: string
	active: boolean
}

export type TabRpcRequest =
	| { type: 'tabs.list'; requestId: string; sessionId: string; scope: 'owned' | 'available' }
	| { type: 'tabs.open'; requestId: string; sessionId: string; url: string; activate?: boolean }
	| { type: 'tabs.switch'; requestId: string; sessionId: string; tabId: string }
	| { type: 'tabs.close'; requestId: string; sessionId: string; tabId: string }
	| { type: 'tabs.claim'; requestId: string; sessionId: string; tabId: string }
	| { type: 'tabs.release'; requestId: string; sessionId: string; tabId: string }

export type TabRpcResponse =
	| { type: 'tabs.result'; requestId: string; ok: true; value: JsonObject }
	| {
			type: 'tabs.result'
			requestId: string
			ok: false
			error: { code: string; message: string; retryable: boolean }
	  }
