import type { WireActor, WireEnvelope } from './envelope'
import type { JsonValue } from './json'
import { isJsonValue } from './json'
import { isSupportedProtocolVersion } from './version'

const actors: readonly WireActor[] = [
	'in_page',
	'main_world',
	'content_script',
	'service_worker',
	'runner',
	'side_panel',
	'hub',
	'external_client',
]

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isWireEnvelope(value: unknown): value is WireEnvelope {
	if (!isRecord(value)) return false
	if (!isSupportedProtocolVersion(value.protocolVersion)) return false
	if (typeof value.messageId !== 'string' || value.messageId.length === 0) return false
	if (typeof value.requestId !== 'string' || value.requestId.length === 0) return false
	if (!actors.includes(value.actor as WireActor)) return false
	if (typeof value.type !== 'string' || value.type.length === 0) return false
	if (typeof value.sentAt !== 'string' || Number.isNaN(Date.parse(value.sentAt))) return false
	return isJsonValue(value.payload)
}

export function encodeEnvelope(envelope: WireEnvelope): string {
	return JSON.stringify(envelope)
}

export function decodeEnvelope(serialized: string): WireEnvelope {
	let value: JsonValue
	try {
		value = JSON.parse(serialized) as JsonValue
	} catch {
		throw new Error('PROTOCOL_MALFORMED')
	}

	if (!isWireEnvelope(value)) throw new Error('PROTOCOL_MALFORMED')
	return value
}
