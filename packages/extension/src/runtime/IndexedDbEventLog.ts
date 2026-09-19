import type { DomainEvent, PublicEvent, SessionEventLog } from '@page-agent/runtime'
import { projectPublicEvent, redactJson } from '@page-agent/runtime'
import { type IDBPDatabase, openDB } from 'idb'

import {
	RUNTIME_DB_NAME,
	RUNTIME_DB_VERSION,
	type RuntimeDb,
	upgradeRuntimeDb,
} from './IndexedDbSchema'

const SEQUENCE_KEY = 'global-sequence'

export class IndexedDbEventLog implements SessionEventLog {
	private readonly database: Promise<IDBPDatabase<RuntimeDb>>

	constructor(databaseName = RUNTIME_DB_NAME) {
		this.database = openDB<RuntimeDb>(databaseName, RUNTIME_DB_VERSION, {
			upgrade: upgradeRuntimeDb,
		})
	}

	async append(event: Omit<DomainEvent, 'sequence'>): Promise<DomainEvent> {
		const database = await this.database
		const transaction = database.transaction(['events', 'metadata'], 'readwrite')
		const current = await transaction.objectStore('metadata').get(SEQUENCE_KEY)
		const stored: DomainEvent = {
			...event,
			sequence: (current?.value ?? 0) + 1,
			payload: redactJson(event.payload),
		}
		await transaction.objectStore('events').put(stored)
		await transaction.objectStore('metadata').put({ key: SEQUENCE_KEY, value: stored.sequence })
		await transaction.done
		return stored
	}

	async list(sessionId?: string, afterSequence = 0): Promise<DomainEvent[]> {
		const events = await (await this.database).getAll('events')
		return events
			.filter(
				(event) =>
					event.sequence > afterSequence &&
					(sessionId === undefined || event.sessionId === sessionId)
			)
			.sort((left, right) => left.sequence - right.sequence)
	}

	async projectPublic(sessionId: string, afterSequence = 0): Promise<PublicEvent[]> {
		return (await this.list(sessionId, afterSequence)).map(projectPublicEvent)
	}

	async *subscribe(sessionId: string, afterSequence = 0): AsyncIterable<PublicEvent> {
		let sequence = afterSequence
		while (true) {
			const pending = await this.projectPublic(sessionId, sequence)
			if (pending.length > 0) {
				for (const event of pending) {
					sequence = event.sequence
					yield event
				}
				continue
			}
			await delay(100)
		}
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
