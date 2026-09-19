export const PROTOCOL_MAJOR = 2 as const
export const PROTOCOL_MINOR = 0 as const
export const PROTOCOL_VERSION = `${PROTOCOL_MAJOR}.${PROTOCOL_MINOR}` as const

export type ProtocolVersion = typeof PROTOCOL_VERSION

export function isSupportedProtocolVersion(version: unknown): version is ProtocolVersion {
	return version === PROTOCOL_VERSION
}
