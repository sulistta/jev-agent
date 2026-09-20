import type { ActionName, RiskTier } from '@page-agent/browser'
import type { JsonValue } from '@page-agent/protocol'

export type JevPrimitive = 'choice' | 'noul' | 'score'

export interface JevOption {
	id: string
	label: string
}

export interface JevQuestion {
	questionId: string
	templateId: string
	templateVersion: string
	primitive: JevPrimitive
	prompt: string
	state: JsonValue
	options?: JevOption[]
	allowNone?: boolean
}

export interface JevRequest {
	requestId: string
	model: string
	questions: JevQuestion[]
	language: 'preserve' | 'english_questions' | 'normalized_bilingual'
	stateBytes: number
}

export interface JevAnswer {
	questionId: string
	selectedOptionId?: string
	value?: boolean | number
	confidence?: number
	probabilities?: Record<string, number>
}

export interface JevResponse {
	requestId: string
	answers: JevAnswer[]
	usage?: { inputTokens?: number; outputTokens?: number }
	model?: string
}

export interface JevTransport {
	systemOne(request: JevRequest, signal: AbortSignal): Promise<JevResponse>
}

export type JevTransportErrorCode =
	| 'AUTH'
	| 'INVALID_REQUEST'
	| 'RATE_LIMITED'
	| 'TIMEOUT'
	| 'CANCELLED'
	| 'UNAVAILABLE'
	| 'INVALID_RESPONSE'

export class JevTransportError extends Error {
	readonly code: JevTransportErrorCode
	readonly retryable: boolean

	constructor(code: JevTransportErrorCode, message: string, retryable: boolean) {
		super(message)
		this.name = 'JevTransportError'
		this.code = code
		this.retryable = retryable
	}
}

export interface JevDecisionContext {
	need: string
	risk: RiskTier
	action?: ActionName
	state: JsonValue
	primitive?: JevPrimitive
	options?: JevOption[]
	questionId?: string
	prompt?: string
	allowNone?: boolean
}

export interface JevDecisionResult {
	status: 'selected' | 'none' | 'escalate' | 'invalid'
	selectedOptionId?: string
	confidence?: number
	answer?: JevAnswer
	reason?: string
}
