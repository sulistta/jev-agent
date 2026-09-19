import type { Session, SessionStatus } from '../domain'
import { RuntimeInvariantError } from '../errors/RuntimeError'

const terminalStatuses: ReadonlySet<SessionStatus> = new Set([
	'completed',
	'partially_completed',
	'blocked',
	'failed',
	'cancelled',
])

const allowedTransitions: Record<SessionStatus, readonly SessionStatus[]> = {
	created: ['running', 'cancelled', 'failed'],
	running: [
		'waiting_user',
		'paused',
		'completed',
		'partially_completed',
		'blocked',
		'failed',
		'cancelled',
	],
	waiting_user: ['running', 'cancelled', 'failed'],
	paused: ['running', 'cancelled', 'failed'],
	completed: [],
	partially_completed: [],
	blocked: [],
	failed: [],
	cancelled: [],
}

export function isTerminalSessionStatus(status: SessionStatus): boolean {
	return terminalStatuses.has(status)
}

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
	return allowedTransitions[from].includes(to)
}

export function transitionSession(
	session: Session,
	to: SessionStatus,
	updatedAt: string,
	reason?: string
): Session {
	if (!canTransitionSession(session.status, to)) {
		throw new RuntimeInvariantError(
			'INVALID_SESSION_TRANSITION',
			`Cannot transition session from ${session.status} to ${to}${reason ? `: ${reason}` : ''}`
		)
	}

	return {
		...session,
		status: to,
		revision: session.revision + 1,
		updatedAt,
	}
}
