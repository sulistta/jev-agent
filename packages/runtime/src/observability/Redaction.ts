import type { JsonValue } from '@page-agent/protocol'

const sensitiveKey = /(password|passwd|secret|token|authorization|cookie|credential|api[-_]?key)/i

export function redactJson(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map(redactJson)
	if (value === null || typeof value !== 'object') return value
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			sensitiveKey.test(key) ? '[REDACTED]' : redactJson(item),
		])
	)
}

export function redactRecord(value: Record<string, JsonValue>): Record<string, JsonValue> {
	return redactJson(value) as Record<string, JsonValue>
}
