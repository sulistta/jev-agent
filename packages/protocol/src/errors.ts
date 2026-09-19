import type { JsonValue } from './json'

export type ProtocolErrorCode =
	| 'PROTOCOL_MALFORMED'
	| 'PROTOCOL_MISMATCH'
	| 'PROTOCOL_UNSUPPORTED_ACTION'
	| 'PROTOCOL_UNAUTHORIZED_SENDER'
	| 'PROTOCOL_SESSION_MISMATCH'
	| 'PROTOCOL_DUPLICATE_MESSAGE'

export interface WireError {
	code: ProtocolErrorCode
	message: string
	retryable: boolean
	details?: JsonValue
}

export function wireError(
	code: ProtocolErrorCode,
	message: string,
	retryable: boolean,
	details?: JsonValue
): WireError {
	return details === undefined
		? { code, message, retryable }
		: { code, message, retryable, details }
}
