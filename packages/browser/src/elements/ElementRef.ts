export interface ElementRef {
	kind: 'element'
	sessionId: string
	tabId: string
	documentId: string
	observationId: string
	revision: number
	localId: string
	fingerprint: string
}

export type ReferenceValidationStatus = 'fresh' | 'revalidated' | 'stale' | 'missing' | 'forbidden'

export interface ReferenceValidation {
	status: ReferenceValidationStatus
	ref: ElementRef
	reason?: string
}
