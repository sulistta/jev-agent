import type { BrowserAction, BrowserRuntime, PageObservation } from '@page-agent/browser'
import type { JsonValue } from '@page-agent/protocol'

import type {
	ConversationMessage,
	DecisionNeed,
	Evidence,
	GoalContract,
	Session,
	TaskContract,
	TaskMode,
} from '../domain'
import type { RuntimeError } from '../errors/RuntimeError'
import type { ConfirmationTokenManager } from '../security/ConfirmationTokens'

export interface Clock {
	now(): string
}

export interface IdGenerator {
	next(kind: 'session' | 'task' | 'goal' | 'step' | 'action' | 'event' | 'request'): string
}

export interface DomainEvent<TPayload extends JsonValue = JsonValue> {
	eventId: string
	sequence: number
	sessionId: string
	type: string
	at: string
	payload: TPayload
	sensitivity: 'public' | 'internal' | 'sensitive' | 'secret'
}

export interface EventSink {
	append(event: Omit<DomainEvent, 'sequence'>): Promise<DomainEvent>
}

export interface SessionStore {
	create(session: Session): Promise<Session>
	get(sessionId: string): Promise<Session | undefined>
	list(): Promise<Session[]>
	update(session: Session, expectedRevision: number): Promise<Session>
}

export interface DecisionResult {
	kind:
		| 'action'
		| 'observe'
		| 'clarify'
		| 'confirm'
		| 'replan'
		| 'goal_satisfied'
		| 'blocked'
		| 'failed'
	candidateId?: string
	action?: BrowserAction
	evidence?: Evidence[]
	reason?: string
	error?: RuntimeError
}

export interface DecisionRouter {
	decide(
		input: {
			session: Session
			goal: GoalContract
			observation: PageObservation
			need: DecisionNeed
		},
		signal: AbortSignal
	): Promise<DecisionResult>
}

/** A narrow JEV judgment made before any browser or DOM capability is used. */
export interface TaskRouter {
	route(
		input: { session: Session; request: string; conversation: ConversationMessage[] },
		signal: AbortSignal
	): Promise<TaskMode>
}

export type SemanticPurpose = 'response' | 'clarification' | 'summary' | 'input' | 'url'

/**
 * The semantic model is deliberately limited to free-form values. It receives no operation or
 * element authority; callers validate its result before execution.
 */
export interface SemanticTextProvider {
	generate(
		input: {
			purpose: SemanticPurpose
			request: string
			conversation: ConversationMessage[]
			field?: string
			page?: { url: string; title: string }
			reason?: string
			actionHistory?: { action: string; label: string }[]
		},
		signal: AbortSignal
	): Promise<{ text?: string; url?: string }>
}

export interface PolicyEngine {
	authorize(
		input: {
			session: Session
			decision: DecisionResult
		},
		signal: AbortSignal
	): Promise<'allow' | 'confirm' | 'deny'>
}

export interface OutcomeVerifier {
	verify(
		input: {
			goal: GoalContract
			observation: PageObservation
			receipt?: import('@page-agent/browser').ActionReceipt
		},
		signal: AbortSignal
	): Promise<{ status: 'satisfied' | 'inconclusive' | 'failed'; evidence: Evidence[] }>
}

export interface RuntimeDependencies {
	browser: BrowserRuntime
	decisions: DecisionRouter
	taskRouter?: TaskRouter
	semanticText?: SemanticTextProvider
	policy: PolicyEngine
	sessions: SessionStore
	clock: Clock
	ids: IdGenerator
	events: EventSink
	verifier: OutcomeVerifier
	confirmations?: ConfirmationTokenManager
}

export function createDefaultBudgets(): import('../domain').ExecutionBudgets {
	return {
		maxSteps: 50,
		maxElapsedMs: 120_000,
		maxActions: 50,
		maxConsecutiveNoProgress: 3,
		maxProviderCalls: {},
		maxRetriesPerErrorCode: {},
		maxTabs: 1,
	}
}

export function createTaskContract(input: {
	taskId: string
	request: string
	goals: GoalContract[]
	createdAt: string
	allowedCapabilities?: import('../domain').Capability[]
}): TaskContract {
	return {
		taskId: input.taskId,
		request: input.request,
		goals: input.goals,
		constraints: [],
		allowedCapabilities: input.allowedCapabilities ?? ['dom.read'],
		completionPolicy: 'all_required',
		createdAt: input.createdAt,
	}
}
