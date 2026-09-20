import type { SessionId } from './ids'
import type { JsonValue } from './json'

export type WireSessionStatus =
	| 'created'
	| 'running'
	| 'waiting_user'
	| 'paused'
	| 'completed'
	| 'partially_completed'
	| 'blocked'
	| 'failed'
	| 'cancelled'

export interface SessionStatusPayload {
	status: WireSessionStatus
	revision: number
	reason?: string
}

export interface SessionResultPayload {
	status: Exclude<WireSessionStatus, 'created' | 'running' | 'waiting_user' | 'paused'>
	summary?: string
	data?: JsonValue
}

export interface SessionEventPayloads {
	'session.status': SessionStatusPayload
	'session.result': SessionResultPayload
	'question.required': { questionId: string; prompt: string }
	'confirmation.required': { confirmationId: string; summary: string }
	'action.preview': { actionId: string; actionType: string; targetDigest?: string }
	'action.result': { actionId: string; ok: boolean; errorCode?: string }
	'error.reported': { code: string; message: string; retryable: boolean }
}

export type SessionEventType = keyof SessionEventPayloads

export interface SessionEvent<TType extends SessionEventType = SessionEventType> {
	type: TType
	sessionId: SessionId
	eventId: string
	sequence: number
	payload: SessionEventPayloads[TType]
}
