import type { AgentRuntime, SessionHandle, SessionSnapshot, StartTaskInput } from './AgentRuntime'
import type { SessionOwner } from './domain'
import type { PublicEvent } from './events/EventLog'
import type { EventSink, SessionStore } from './ports'

export interface SessionEventLog extends EventSink {
	subscribe(sessionId: string, fromSequence?: number): AsyncIterable<PublicEvent>
}

export type SessionCommand =
	| { type: 'pause'; sessionId: string }
	| { type: 'resume'; sessionId: string }
	| { type: 'session.reply'; sessionId: string; text: string }
	| { type: 'cancel'; sessionId: string; reason?: string }
	| { type: 'confirmation.approve'; sessionId: string; confirmationId: string }
	| { type: 'confirmation.deny'; sessionId: string; confirmationId: string }

export interface CreateSessionInput extends Omit<StartTaskInput, 'owner'> {
	owner: SessionOwner
}

export interface RecoveryReport {
	inspected: number
	active: number
	terminal: number
}

export class SessionManager {
	private readonly runtime: AgentRuntime
	private readonly sessions: SessionStore
	private readonly events: SessionEventLog

	constructor(runtime: AgentRuntime, sessions: SessionStore, events: SessionEventLog) {
		this.runtime = runtime
		this.sessions = sessions
		this.events = events
	}

	create(input: CreateSessionInput): Promise<SessionHandle> {
		return this.runtime.start(input)
	}

	async command(command: SessionCommand): Promise<void> {
		switch (command.type) {
			case 'pause':
				return this.runtime.pause(command.sessionId)
			case 'resume':
				return this.runtime.resume(command.sessionId)
			case 'session.reply':
				return this.runtime.reply(command.sessionId, command.text)
			case 'cancel':
				return this.runtime.cancel(command.sessionId, command.reason)
			case 'confirmation.approve':
				return this.runtime.approveConfirmation(command.sessionId, command.confirmationId)
			case 'confirmation.deny':
				return this.runtime.denyConfirmation(command.sessionId, command.confirmationId)
		}
	}

	get(sessionId: string): Promise<SessionSnapshot | undefined> {
		return this.runtime.getSession(sessionId)
	}

	async list(): Promise<SessionSnapshot[]> {
		const sessions = await this.sessions.list()
		return sessions.map((session) => ({
			sessionId: session.sessionId,
			status: session.status,
			revision: session.revision,
			currentGoalId: session.currentGoalId,
			pendingConfirmationId: session.pendingConfirmation?.confirmationId,
			finalResponse: session.finalResponse,
		}))
	}

	subscribe(sessionId: string, fromSequence = 0): AsyncIterable<PublicEvent> {
		return this.events.subscribe(sessionId, fromSequence)
	}

	async recover(): Promise<RecoveryReport> {
		const sessions = await this.sessions.list()
		const active = sessions.filter(
			(session) =>
				!['completed', 'partially_completed', 'blocked', 'failed', 'cancelled'].includes(
					session.status
				)
		).length
		return { inspected: sessions.length, active, terminal: sessions.length - active }
	}
}
