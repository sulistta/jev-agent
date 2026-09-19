import type { Candidate } from '../elements/Candidate'
import type { ElementRef } from '../elements/ElementRef'

export type SecretAwareString = string & { readonly __brand: 'SecretAwareString' }

export type ScrollAmount = { kind: 'pages'; value: number } | { kind: 'pixels'; value: number }

export type SelectOptionRef =
	| { kind: 'value'; value: string }
	| { kind: 'label'; label: string }
	| { kind: 'index'; index: number }

export type BrowserAction =
	| { type: 'click'; target: ElementRef; button?: 'primary' }
	| { type: 'input'; target: ElementRef; text: SecretAwareString; replace: boolean }
	| { type: 'select'; target: ElementRef; option: SelectOptionRef }
	| { type: 'scroll'; target?: ElementRef; axis: 'x' | 'y'; amount: ScrollAmount }
	| { type: 'focus'; target: ElementRef }
	| { type: 'tab.open'; url: string }
	| { type: 'tab.switch'; tabId: string }
	| { type: 'tab.close'; tabId: string }

export interface BrowserActionRequest {
	sessionId: string
	actionId: string
	expectedSessionRevision: number
	action: BrowserAction
}

export type ActionEffect =
	| { type: 'element.updated'; ref: ElementRef }
	| { type: 'tab.opened'; tabId: string }
	| { type: 'tab.switched'; tabId: string }
	| { type: 'tab.closed'; tabId: string }
	| { type: 'viewport.scrolled'; axis: 'x' | 'y'; amount: ScrollAmount }

export type BrowserActionResult =
	| {
			ok: true
			effect: ActionEffect
			signals: import('../observation/PageObservation').BrowserSignal[]
	  }
	| { ok: false; error: import('../errors/BrowserRuntimeError').BrowserRuntimeError }

export interface ActionReceipt {
	actionId: string
	sessionId: string
	candidateId?: string
	startedAt: string
	endedAt: string
	status: 'executed' | 'rejected' | 'cancelled' | 'failed'
	result?: BrowserActionResult
	error?: import('../errors/BrowserRuntimeError').BrowserRuntimeError
	observedSignals: import('../observation/PageObservation').BrowserSignal[]
}

export interface CandidateActionRequest {
	candidate: Candidate
	expectedSessionRevision: number
}
