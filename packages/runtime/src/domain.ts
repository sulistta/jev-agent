import type { BrowserSignal, ElementRef, RiskTier } from '@page-agent/browser'
import type { JsonValue } from '@page-agent/protocol'

export type Capability =
	'dom.read' | 'dom.write' | 'navigation' | 'tabs.read' | 'tabs.write' | 'sensitive.submit'

export type SessionStatus =
	| 'created'
	| 'running'
	| 'waiting_user'
	| 'paused'
	| 'completed'
	| 'partially_completed'
	| 'blocked'
	| 'failed'
	| 'cancelled'

export type GoalStatus = 'pending' | 'active' | 'satisfied' | 'blocked' | 'failed' | 'skipped'

export interface SessionOwner {
	kind: 'in_page' | 'extension' | 'hub' | 'external_client'
	ownerId: string
}

export interface TaskConstraint {
	name: string
	value: JsonValue
}

export type OutcomeContract =
	| { kind: 'all'; conditions: OutcomeContract[] }
	| { kind: 'any'; conditions: OutcomeContract[] }
	| { kind: 'none'; condition: OutcomeContract }
	| { kind: 'predicate'; predicate: OutcomePredicate }
	| { kind: 'deadline'; at: string; condition: OutcomeContract }

export type OutcomePredicate =
	| { kind: 'url.matches'; pattern: string }
	| { kind: 'text.contains'; text: string; scope?: string }
	| { kind: 'element.present'; ref?: ElementRef; label?: string }
	| { kind: 'element.value'; ref: ElementRef; value: string }
	| { kind: 'tab.exists'; tabId: string }
	| { kind: 'runtime.managed' }

export interface TaskContract {
	taskId: string
	request: string
	goals: GoalContract[]
	constraints: TaskConstraint[]
	allowedCapabilities: Capability[]
	completionPolicy: 'all_required' | 'explicit_partial_allowed'
	createdAt: string
}

export interface GoalContract {
	goalId: string
	description: string
	required: boolean
	outcome: OutcomeContract
	status: GoalStatus
	evidenceIds: string[]
	dependsOn?: string[]
}

export interface ExecutionBudgets {
	maxSteps: number
	maxElapsedMs: number
	maxActions: number
	maxConsecutiveNoProgress: number
	maxProviderCalls: Record<string, number>
	maxRetriesPerErrorCode: Record<string, number>
	maxTabs: number
}

export interface BrowserScope {
	ownedTabIds: string[]
	activeTabId?: string
	allowedOrigins: string[]
	maxTabs: number
}

export interface PendingConfirmation {
	confirmationId: string
	sessionId: string
	actionId: string
	targetDigest: string
	argsDigest: string
	observationRevision: number
	expiresAt: string
	status: 'pending' | 'approved' | 'denied' | 'expired' | 'invalidated'
}

export interface Session {
	sessionId: string
	owner: SessionOwner
	task: TaskContract
	status: SessionStatus
	revision: number
	budgets: ExecutionBudgets
	browserScope: BrowserScope
	/** The routing decision is persisted so a resumed session never reroutes itself. */
	taskMode?: TaskMode
	/** Session-local conversational context. It is never shared with another task. */
	conversation?: ConversationMessage[]
	/** The user-facing terminal response produced by the semantic provider. */
	finalResponse?: string
	/** Structured plan for browser work. Rebuilt after each clarification reply. */
	plan?: TaskPlan
	/** Verified, source-backed facts collected across pages and tabs. */
	evidence?: EvidenceItem[]
	/** Current runtime phase, persisted so diagnostics describe actual workflow state. */
	phase?: ExecutionPhase
	/** Fingerprints already judged by Jev; identical judgments are never repeated. */
	decisionFingerprints?: string[]
	/** Receipts and verified outcomes, rather than merely proposed selections. */
	actionJournal?: ActionJournalEntry[]
	/** Research observations already offered to extraction, including empty results. */
	extractionFingerprints?: string[]
	currentGoalId?: string
	pendingConfirmation?: PendingConfirmation
	createdAt: string
	updatedAt: string
}

export type ExecutionPhase =
	| 'planning'
	| 'waiting_user'
	| 'observing'
	| 'deciding'
	| 'executing'
	| 'settling'
	| 'verifying'
	| 'extracting'
	| 'synthesizing'

export interface TaskPlan {
	version: 1
	canonicalGoal: string
	originalLanguage: string
	missingInputs: { key: string; question: string }[]
	workItems: TaskWorkItem[]
	/** Ordered semantic hints retained for Jev; never executable goals. */
	planningHints?: { description: string; successCriteria: string[] }[]
	coverage: CoverageRequirement[]
	deliverable: string
	externalActions: string[]
}

export interface TaskWorkItem {
	workItemId: string
	description: string
	/** Observable semantic facts that must hold before this work item can finish. */
	successCriteria?: string[]
	/** Semantic work items compiled into this executable work item by the runtime. */
	sourceWorkItemIds?: string[]
	kind: 'navigate' | 'research' | 'interact'
	required: boolean
	dependsOn: string[]
	status: GoalStatus
}

export interface CoverageRequirement {
	requirementId: string
	workItemId: string
	description: string
	minimum: number
	distinctBy?: string
	requiredTags?: string[]
}

export interface EvidenceItem {
	evidenceId: string
	workItemId: string
	entityType: string
	entityName: string
	attributes: Record<string, JsonValue>
	tags: string[]
	source: {
		url: string
		title: string
		origin: string
		quote: string
		contentBlockId?: string
		capturedAt: string
	}
	verification: 'pending' | 'verified' | 'unsupported' | 'contradicted'
}

export interface ActionJournalEntry {
	actionId: string
	workItemId?: string
	action: string
	label: string
	selection?: ActionSelection
	status: 'executed' | 'failed'
	observationId: string
	completedAt: string
}

/**
 * A sanitized, durable description of an action selected from a page
 * observation. It deliberately excludes generated input values and element
 * references, both of which can be sensitive or stale on the next turn.
 */
export interface ActionSelection {
	action: string
	label: string
	candidateSignature: string
	observationSignature: string
	page: { url: string; title: string }
	viewport?: { scrollY: number; height: number }
	targetLocalId?: string
	documentId?: string
}

export type TaskMode = 'conversation' | 'browser'

export interface ConversationMessage {
	role: 'user' | 'assistant'
	text: string
	purpose?: 'response' | 'clarification' | 'summary'
	at: string
}

export interface Evidence {
	evidenceId: string
	type: string
	source: 'browser' | 'policy' | 'user' | 'jev' | 'deterministic' | 'generative'
	observationId?: string
	actionId?: string
	value: JsonValue
	capturedAt: string
	sensitivity: 'public' | 'internal' | 'sensitive' | 'secret'
}

export interface ActionReceipt {
	actionId: string
	sessionId: string
	candidateId: string
	startedAt: string
	endedAt: string
	status: 'executed' | 'rejected' | 'cancelled' | 'failed'
	result?: JsonValue
	errorCode?: string
	observedSignals: BrowserSignal[]
}

export type DecisionNeedKind =
	'select_operation' | 'select_candidate' | 'judge_outcome' | 'generate_value' | 'replan'

export interface DecisionNeed {
	kind: DecisionNeedKind
	closedWorld: boolean
	computable: boolean
	risk: RiskTier
	requiredCapabilities: string[]
}
