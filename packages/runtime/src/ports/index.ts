import type { BrowserAction, BrowserRuntime, PageObservation } from '@page-agent/browser'
import type { JsonValue } from '@page-agent/protocol'

import type {
	ActionSelection,
	ConversationMessage,
	DecisionNeed,
	Evidence,
	EvidenceItem,
	GoalContract,
	Session,
	TaskContract,
	TaskMode,
	TaskPlan,
} from '../domain'
import type { RuntimeError } from '../errors/RuntimeError'
import type { ObservationChanges } from '../observationChanges'
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
	kind: 'action' | 'clarify' | 'confirm' | 'goal_satisfied' | 'blocked' | 'failed'
	candidateId?: string
	selection?: ActionSelection
	action?: BrowserAction
	evidence?: Evidence[]
	reason?: string
	error?: RuntimeError
	fingerprint?: string
	diagnostics?: DecisionDiagnostics
}

export interface DecisionDiagnostics {
	primitive: 'choice' | 'noul'
	candidateCount: number
	choices?: { id: string; label: string }[]
	operation?: string
	targetStrategy?: 'choice' | 'noul' | 'none'
	requestCount?: number
	batchCount?: number
	stateBytes?: number
	inputTokens?: number
	outputTokens?: number
	selectedTransition?: 'action' | 'complete' | 'none'
	selectedOptionId?: string
	selectedProbability?: number
	confidence?: number
}

export interface DecisionRouter {
	decide(
		input: {
			session: Session
			goal: GoalContract
			observation: PageObservation
			changes?: ObservationChanges
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
	shouldClarify?(input: { session: Session; plan: TaskPlan }, signal: AbortSignal): Promise<boolean>
}

export type SemanticPurpose = 'response' | 'clarification' | 'summary' | 'input' | 'url'

/**
 * The semantic model is deliberately limited to free-form values. It receives no operation or
 * element authority; callers validate its result before execution.
 */
export interface SemanticTextProvider {
	plan?(
		input: { request: string; conversation: ConversationMessage[] },
		signal: AbortSignal
	): Promise<TaskPlan>
	extract?(
		input: {
			request: string
			plan: TaskPlan
			workItemId: string
			page: { url: string; title: string; content: string }
		},
		signal: AbortSignal
	): Promise<EvidenceItem[]>
	generate(
		input: {
			purpose: SemanticPurpose
			request: string
			conversation: ConversationMessage[]
			field?: string
			page?: { url: string; title: string }
			reason?: string
			actionHistory?: { action: string; label: string }[]
			plan?: TaskPlan
			evidence?: EvidenceItem[]
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
		maxSteps: 0,
		maxElapsedMs: 0,
		maxActions: 0,
		maxConsecutiveNoProgress: 3,
		maxProviderCalls: {},
		maxRetriesPerErrorCode: {},
		maxTabs: 5,
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
