import type { BrowserAction } from '@page-agent/browser'

import type { PendingConfirmation, Session } from '../domain'
import { type RuntimeError, runtimeError } from '../errors/RuntimeError'

export interface ConfirmationInput {
	session: Session
	actionId: string
	action: BrowserAction
	observationRevision: number
	ttlMs: number
}

export interface ConfirmationUse {
	confirmationId: string
	sessionId: string
	actionId: string
	action: BrowserAction
	observationRevision: number
}

export class ConfirmationTokenManager {
	private readonly tokens = new Map<string, PendingConfirmation>()
	private readonly now: () => string
	private readonly nextId: () => string

	constructor(
		now: () => string = () => new Date().toISOString(),
		nextId: () => string = () => `confirmation-${Date.now()}`
	) {
		this.now = now
		this.nextId = nextId
	}

	issue(input: ConfirmationInput): PendingConfirmation {
		const confirmation: PendingConfirmation = {
			confirmationId: this.nextId(),
			sessionId: input.session.sessionId,
			actionId: input.actionId,
			targetDigest: digest('target' in input.action ? input.action.target : undefined),
			argsDigest: digest(actionArgs(input.action)),
			observationRevision: input.observationRevision,
			expiresAt: new Date(Date.parse(this.now()) + input.ttlMs).toISOString(),
			status: 'pending',
		}
		this.tokens.set(confirmation.confirmationId, confirmation)
		return confirmation
	}

	approve(confirmationId: string): PendingConfirmation | RuntimeError {
		const token = this.tokens.get(confirmationId)
		if (!token) return runtimeError('CONFIRMATION_INVALID', 'Confirmation not found', false)
		if (this.isExpired(token)) {
			const expired = { ...token, status: 'expired' as const }
			this.tokens.set(confirmationId, expired)
			return runtimeError('CONFIRMATION_INVALID', 'Confirmation expired', false)
		}
		if (token.status !== 'pending')
			return runtimeError('CONFIRMATION_INVALID', 'Confirmation is not pending', false)
		const approved = { ...token, status: 'approved' as const }
		this.tokens.set(confirmationId, approved)
		return approved
	}

	invalidate(confirmationId: string): void {
		const token = this.tokens.get(confirmationId)
		if (token) this.tokens.set(confirmationId, { ...token, status: 'invalidated' })
	}

	consume(
		input: ConfirmationUse
	): { ok: true; token: PendingConfirmation } | { ok: false; error: RuntimeError } {
		const token = this.tokens.get(input.confirmationId)
		if (!token)
			return {
				ok: false,
				error: runtimeError('CONFIRMATION_INVALID', 'Confirmation not found', false),
			}
		if (this.isExpired(token)) {
			this.tokens.set(input.confirmationId, { ...token, status: 'expired' })
			return {
				ok: false,
				error: runtimeError('CONFIRMATION_INVALID', 'Confirmation expired', false),
			}
		}
		if (
			token.status !== 'approved' ||
			token.sessionId !== input.sessionId ||
			token.actionId !== input.actionId ||
			token.observationRevision !== input.observationRevision ||
			token.targetDigest !== digest('target' in input.action ? input.action.target : undefined) ||
			token.argsDigest !== digest(actionArgs(input.action))
		) {
			return {
				ok: false,
				error: runtimeError('CONFIRMATION_INVALID', 'Confirmation binding mismatch', false),
			}
		}
		const consumed = { ...token, status: 'invalidated' as const }
		this.tokens.set(input.confirmationId, consumed)
		return { ok: true, token: consumed }
	}

	private isExpired(token: PendingConfirmation): boolean {
		return Date.parse(this.now()) >= Date.parse(token.expiresAt)
	}
}

function digest(value: unknown): string {
	// JSON.stringify(undefined) returns undefined rather than a string. Tab
	// actions do not have an element target, so bind them to an explicit
	// sentinel instead of crashing while issuing the confirmation token.
	const serialized = value === undefined ? 'undefined' : (JSON.stringify(value) ?? typeof value)
	let hash = 2166136261
	for (let index = 0; index < serialized.length; index += 1) {
		hash ^= serialized.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return `fnv1a:${(hash >>> 0).toString(16)}`
}

function actionArgs(action: BrowserAction): unknown {
	if (action.type === 'input') return { type: action.type, replace: action.replace }
	if (action.type === 'select') return { type: action.type, option: action.option }
	if (action.type === 'scroll')
		return { type: action.type, axis: action.axis, amount: action.amount }
	if (action.type === 'tab.open') return { type: action.type, url: action.url }
	if (action.type === 'tab.switch' || action.type === 'tab.close')
		return { type: action.type, tabId: action.tabId }
	return { type: action.type }
}
