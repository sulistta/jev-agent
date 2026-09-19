import type { BrowserSignal } from '../observation/PageObservation'

export interface ExpectedChange {
	type:
		| 'navigation'
		| 'document'
		| 'dom'
		| 'target.value'
		| 'target.appeared'
		| 'target.disappeared'
		| 'url'
		| 'tab.created'
		| 'tab.closed'
		| 'tab.activated'
	targetLocalId?: string
	urlPattern?: string
}

export interface SynchronizationRequest {
	sessionId: string
	tabId: string
	since: string
	expected: ExpectedChange[]
	settle: { quietWindowMs: number; maxWaitMs: number }
}

export type SynchronizationResult =
	| { status: 'satisfied'; signals: BrowserSignal[]; endedAt: string }
	| { status: 'stabilized'; signals: BrowserSignal[]; endedAt: string }
	| { status: 'timeout'; signals: BrowserSignal[]; endedAt: string }
	| { status: 'cancelled'; signals: BrowserSignal[]; endedAt: string }
	| {
			status: 'error'
			error: import('../errors/BrowserRuntimeError').BrowserRuntimeError
			endedAt: string
	  }
