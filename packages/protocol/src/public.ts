import type { Capability } from './commands'
import type { JsonValue } from './json'

export interface PublicSessionEvent {
	eventId: string
	sequence: number
	sessionId: string
	type: string
	at: string
	payload: JsonValue
}

export interface PublicSessionStartPayload {
	task: string
	capabilities: Capability[]
	providerProfile?: string
}

export interface PublicSessionStartRequest {
	type: 'session.start'
	requestId: string
	origin: string
	nonce: string
	payload: PublicSessionStartPayload
}

export interface PublicSessionCommandRequest {
	type: 'session.cancel' | 'session.result' | 'session.reply'
	requestId: string
	origin: string
	sessionId: string
	sessionToken: string
	text?: string
}

export type PublicApiRequest = PublicSessionStartRequest | PublicSessionCommandRequest

export interface PublicApiResponse {
	requestId: string
	ok: boolean
	payload?: { sessionId: string; sessionToken: string } | { status: string; summary?: string }
	error?: { code: string; message: string; retryable: boolean }
}
