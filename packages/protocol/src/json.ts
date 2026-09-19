export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
	[key: string]: JsonValue
}

export function isJsonValue(value: unknown): value is JsonValue {
	if (value === null) return true
	if (typeof value === 'string' || typeof value === 'boolean') return true
	if (typeof value === 'number') return Number.isFinite(value)
	if (Array.isArray(value)) return value.every(isJsonValue)
	if (typeof value !== 'object') return false

	return Object.values(value).every(isJsonValue)
}
