export type RuntimeErrorCode =
	| 'STALE_REFERENCE'
	| 'TARGET_NOT_FOUND'
	| 'TAB_UNAVAILABLE'
	| 'DOCUMENT_CHANGED'
	| 'PERMISSION_DENIED'
	| 'CONFIRMATION_REQUIRED'
	| 'CONFIRMATION_INVALID'
	| 'POLICY_BLOCKED'
	| 'PROVIDER_TIMEOUT'
	| 'PROVIDER_RATE_LIMITED'
	| 'PROVIDER_INVALID_RESPONSE'
	| 'TRANSPORT_UNAVAILABLE'
	| 'PROTOCOL_MISMATCH'
	| 'SYNC_TIMEOUT'
	| 'NO_PROGRESS'
	| 'RESEARCH_COVERAGE_INCOMPLETE'
	| 'BUDGET_EXCEEDED'
	| 'CANCELLED'
	| 'INVALID_SESSION_TRANSITION'
	| 'SESSION_NOT_FOUND'
	| 'REVISION_CONFLICT'
	| 'INTERNAL'

export interface RuntimeError {
	code: RuntimeErrorCode
	message: string
	retryable: boolean
	details?: Record<string, string | number | boolean>
}

export class RuntimeInvariantError extends Error {
	readonly code: RuntimeErrorCode

	constructor(code: RuntimeErrorCode, message: string) {
		super(message)
		this.name = 'RuntimeInvariantError'
		this.code = code
	}
}

export function runtimeError(
	code: RuntimeErrorCode,
	message: string,
	retryable: boolean,
	details?: Record<string, string | number | boolean>
): RuntimeError {
	return details === undefined
		? { code, message, retryable }
		: { code, message, retryable, details }
}
