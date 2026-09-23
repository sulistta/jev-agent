import type { JsonObject, JsonValue } from './json'

export interface WireElementRef {
	kind: 'element'
	sessionId: string
	tabId: string
	documentId: string
	observationId: string
	revision: number
	localId: string
	fingerprint: string
}

export type DomRpcRequest =
	| {
			type: 'dom.observe'
			requestId: string
			sessionId: string
			tabId?: string
			scope: 'viewport' | 'document' | 'region' | 'targets'
			includeText: boolean
			includeNonInteractive: boolean
			attributes: string[]
			sensitivityPolicyId: string
	  }
	| {
			type: 'dom.execute'
			requestId: string
			sessionId: string
			actionId: string
			expectedSessionRevision: number
			tabId?: string
			action: JsonObject
	  }
	| {
			type: 'dom.wait'
			requestId: string
			sessionId: string
			tabId: string
			since: string
			expected: JsonValue[]
			quietWindowMs: number
			maxWaitMs: number
	  }
	| {
			type: 'dom.revalidate'
			requestId: string
			sessionId: string
			ref: WireElementRef
	  }

export type DomRpcResponse =
	| {
			type: 'dom.result'
			requestId: string
			ok: true
			value: JsonValue
	  }
	| {
			type: 'dom.result'
			requestId: string
			ok: false
			error: WireDomError
	  }

export type WireDomErrorCode =
	| 'STALE_REFERENCE'
	| 'TARGET_NOT_FOUND'
	| 'DOCUMENT_CHANGED'
	| 'PERMISSION_DENIED'
	| 'CANCELLED'
	| 'TIMEOUT'
	| 'INTERNAL'

export interface WireDomError {
	code: WireDomErrorCode
	message: string
	retryable: boolean
}
