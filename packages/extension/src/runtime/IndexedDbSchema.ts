import type { DomainEvent, Session } from '@page-agent/runtime'
import type { DBSchema, IDBPDatabase } from 'idb'

export const RUNTIME_DB_NAME = 'page-agent-runtime-v2'
export const RUNTIME_DB_VERSION = 2

export interface RuntimeDb extends DBSchema {
	sessions: {
		key: string
		value: Session
		indexes: { 'by-updated': string }
	}
	events: {
		key: string
		value: DomainEvent
		indexes: { 'by-session': string; 'by-sequence': number }
	}
	metadata: {
		key: string
		value: { key: string; value: number }
	}
}

export function upgradeRuntimeDb(database: IDBPDatabase<RuntimeDb>): void {
	if (!database.objectStoreNames.contains('sessions')) {
		const sessions = database.createObjectStore('sessions', { keyPath: 'sessionId' })
		sessions.createIndex('by-updated', 'updatedAt')
	}
	if (!database.objectStoreNames.contains('events')) {
		const events = database.createObjectStore('events', { keyPath: 'eventId' })
		events.createIndex('by-session', 'sessionId')
		events.createIndex('by-sequence', 'sequence')
	}
	if (!database.objectStoreNames.contains('metadata'))
		database.createObjectStore('metadata', { keyPath: 'key' })
}
