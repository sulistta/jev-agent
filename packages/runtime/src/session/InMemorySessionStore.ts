import type { Session } from '../domain'
import { RuntimeInvariantError } from '../errors/RuntimeError'
import type { SessionStore } from '../ports'

export class InMemorySessionStore implements SessionStore {
	private readonly sessions = new Map<string, Session>()

	async create(session: Session): Promise<Session> {
		if (this.sessions.has(session.sessionId)) {
			throw new RuntimeInvariantError(
				'REVISION_CONFLICT',
				`Session already exists: ${session.sessionId}`
			)
		}
		this.sessions.set(session.sessionId, session)
		return session
	}

	async get(sessionId: string): Promise<Session | undefined> {
		return this.sessions.get(sessionId)
	}

	async list(): Promise<Session[]> {
		return [...this.sessions.values()]
	}

	async update(session: Session, expectedRevision: number): Promise<Session> {
		const current = this.sessions.get(session.sessionId)
		if (!current) throw new RuntimeInvariantError('SESSION_NOT_FOUND', session.sessionId)
		if (current.revision !== expectedRevision) {
			throw new RuntimeInvariantError(
				'REVISION_CONFLICT',
				`Expected revision ${expectedRevision}, got ${current.revision}`
			)
		}
		if (session.revision <= current.revision) {
			throw new RuntimeInvariantError('REVISION_CONFLICT', 'Updated session must advance revision')
		}
		this.sessions.set(session.sessionId, session)
		return session
	}
}
