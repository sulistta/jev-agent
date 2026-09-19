import type { RequestId, SessionId } from './ids'
import type { JsonValue } from './json'
import { PROTOCOL_VERSION, type ProtocolVersion } from './version'

export type WireActor =
	| 'in_page'
	| 'main_world'
	| 'content_script'
	| 'service_worker'
	| 'runner'
	| 'side_panel'
	| 'hub'
	| 'external_client'

export interface WireEnvelope<
	TType extends string = string,
	TPayload extends JsonValue = JsonValue,
> {
	protocolVersion: ProtocolVersion
	messageId: string
	requestId: RequestId
	actor: WireActor
	type: TType
	sentAt: string
	sessionId?: SessionId
	payload: TPayload
}

export function createEnvelope<TType extends string, TPayload extends JsonValue>(input: {
	messageId: string
	requestId: RequestId
	actor: WireActor
	type: TType
	sentAt: string
	sessionId?: SessionId
	payload: TPayload
}): WireEnvelope<TType, TPayload> {
	return {
		protocolVersion: PROTOCOL_VERSION,
		...input,
	}
}
