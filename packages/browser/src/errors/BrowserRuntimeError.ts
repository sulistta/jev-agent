export type BrowserRuntimeErrorCode =
	| 'STALE_REFERENCE'
	| 'TARGET_NOT_FOUND'
	| 'INPUT_NOT_APPLIED'
	| 'TAB_UNAVAILABLE'
	| 'DOCUMENT_CHANGED'
	| 'PERMISSION_DENIED'
	| 'CONFIRMATION_REQUIRED'
	| 'TRANSPORT_UNAVAILABLE'
	| 'SYNC_TIMEOUT'
	| 'CANCELLED'
	| 'INTERNAL'

export interface BrowserRuntimeError {
	code: BrowserRuntimeErrorCode
	message: string
	retryable: boolean
	details?: Record<string, string | number | boolean>
}

export function browserError(
	code: BrowserRuntimeErrorCode,
	message: string,
	retryable: boolean,
	details?: Record<string, string | number | boolean>
): BrowserRuntimeError {
	return details === undefined
		? { code, message, retryable }
		: { code, message, retryable, details }
}
