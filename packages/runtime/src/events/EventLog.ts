import type { JsonValue } from '@page-agent/protocol'

import { redactJson } from '../observability/Redaction'
import type { DomainEvent, EventSink } from '../ports'

export interface PublicEvent {
	eventId: string
	sequence: number
	sessionId: string
	type: string
	at: string
	payload: JsonValue
}

export class InMemoryEventLog implements EventSink {
	private readonly events: DomainEvent[] = []
	private readonly waiters: (() => void)[] = []

	async append(event: Omit<DomainEvent, 'sequence'>): Promise<DomainEvent> {
		const stored: DomainEvent = {
			...event,
			sequence: this.events.length + 1,
			payload: redactJson(event.payload),
		}
		this.events.push(stored)
		this.waiters.splice(0).forEach((resolve) => resolve())
		return stored
	}

	list(sessionId?: string, afterSequence = 0): DomainEvent[] {
		return this.events.filter(
			(event) =>
				event.sequence > afterSequence && (sessionId === undefined || event.sessionId === sessionId)
		)
	}

	projectPublic(sessionId: string, afterSequence = 0): PublicEvent[] {
		return this.list(sessionId, afterSequence).map(projectPublicEvent)
	}

	async *subscribe(sessionId: string, afterSequence = 0): AsyncIterable<PublicEvent> {
		let sequence = afterSequence
		while (true) {
			const pending = this.projectPublic(sessionId, sequence)
			if (pending.length > 0) {
				for (const event of pending) {
					sequence = event.sequence
					yield event
				}
				continue
			}
			await new Promise<void>((resolve) => this.waiters.push(resolve))
		}
	}
}

export function projectPublicEvent(event: DomainEvent): PublicEvent {
	return {
		eventId: event.eventId,
		sequence: event.sequence,
		sessionId: event.sessionId,
		type: event.type,
		at: event.at,
		payload: redactJson(event.payload),
	}
}
