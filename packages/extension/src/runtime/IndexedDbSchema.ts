import type { DomainEvent, Session } from '@page-agent/runtime'
import type { DBSchema, IDBPDatabase } from 'idb'

export const RUNTIME_DB_NAME = 'page-agent-runtime-v2'
export const RUNTIME_DB_VERSION = 3

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

export function upgradeRuntimeDb(database: IDBPDatabase<RuntimeDb>, oldVersion = 0): void {
	// v3 introduces typed plans, evidence, phases, and action journals. Old sessions cannot be
	// resumed safely under those invariants, so the migration deliberately starts a clean log.
	if (oldVersion > 0 && oldVersion < 3) {
		for (const name of ['sessions', 'events', 'metadata'] as const)
			if (database.objectStoreNames.contains(name)) database.deleteObjectStore(name)
	}
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
