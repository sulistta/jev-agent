import type { Session } from '@page-agent/runtime'
import type { SessionStore } from '@page-agent/runtime'
import { RuntimeInvariantError } from '@page-agent/runtime'
import { type IDBPDatabase, openDB } from 'idb'

import {
	RUNTIME_DB_NAME,
	RUNTIME_DB_VERSION,
	type RuntimeDb,
	upgradeRuntimeDb,
} from './IndexedDbSchema'

export class IndexedDbSessionStore implements SessionStore {
	private readonly database: Promise<IDBPDatabase<RuntimeDb>>

	constructor(databaseName = RUNTIME_DB_NAME) {
		this.database = openDB<RuntimeDb>(databaseName, RUNTIME_DB_VERSION, {
			upgrade: upgradeRuntimeDb,
		})
	}

	async create(session: Session): Promise<Session> {
		const database = await this.database
		const existing = await database.get('sessions', session.sessionId)
		if (existing)
			throw new RuntimeInvariantError(
				'REVISION_CONFLICT',
				`Session already exists: ${session.sessionId}`
			)
		await database.add('sessions', session)
		return session
	}

	async get(sessionId: string): Promise<Session | undefined> {
		return (await this.database).get('sessions', sessionId)
	}

	async list(): Promise<Session[]> {
		return (await this.database).getAllFromIndex('sessions', 'by-updated')
	}

	async update(session: Session, expectedRevision: number): Promise<Session> {
		const database = await this.database
		const current = await database.get('sessions', session.sessionId)
		if (!current) throw new RuntimeInvariantError('SESSION_NOT_FOUND', session.sessionId)
		if (current.revision !== expectedRevision || session.revision <= current.revision) {
			throw new RuntimeInvariantError('REVISION_CONFLICT', 'Session revision conflict')
		}
		await database.put('sessions', session)
		return session
	}
}
