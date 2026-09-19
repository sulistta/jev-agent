import type { BrowserRuntime } from '@page-agent/browser'
import type {
	DecisionRouter,
	OutcomeVerifier,
	PolicyEngine,
	SemanticTextProvider,
	SessionStore,
	TaskRouter,
} from '@page-agent/runtime'
import {
	type AgentRuntime,
	type Clock,
	ConfirmationTokenManager,
	DefaultPolicyEngine,
	DeterministicOutcomeVerifier,
	type IdGenerator,
	InMemoryEventLog,
	InMemorySessionStore,
	type SessionEventLog,
	SessionManager,
	createAgentRuntime,
} from '@page-agent/runtime'

import { IndexedDbEventLog } from './IndexedDbEventLog'
import { IndexedDbSessionStore } from './IndexedDbSessionStore'

export interface RunnerHostConfig {
	browser: BrowserRuntime
	decisions: DecisionRouter
	taskRouter: TaskRouter
	semanticText: SemanticTextProvider
	sessions?: SessionStore
	events?: SessionEventLog
	policy?: PolicyEngine
	verifier?: OutcomeVerifier
	clock?: Clock
	ids?: IdGenerator
}

export interface RunnerHost {
	runtime: AgentRuntime
	sessions: SessionStore
	events: SessionEventLog
	manager: SessionManager
}

/**
 * Creates the long-lived runner composition. The service worker and UI talk to
 * this host; neither owns session state or the execution loop.
 */
export function createRunnerHost(config: RunnerHostConfig): RunnerHost {
	const sessions = config.sessions ?? new IndexedDbSessionStore()
	const events = config.events ?? new IndexedDbEventLog()
	const clock = config.clock ?? systemClock
	const ids = config.ids ?? randomIds
	const runtime = createAgentRuntime({
		browser: config.browser,
		decisions: config.decisions,
		taskRouter: config.taskRouter,
		semanticText: config.semanticText,
		policy: config.policy ?? new DefaultPolicyEngine(),
		sessions,
		clock,
		ids,
		events,
		verifier: config.verifier ?? new DeterministicOutcomeVerifier(() => clock.now()),
		confirmations: new ConfirmationTokenManager(
			() => clock.now(),
			() => ids.next('request')
		),
	})
	return { runtime, sessions, events, manager: new SessionManager(runtime, sessions, events) }
}

const systemClock: Clock = { now: () => new Date().toISOString() }

const randomIds: IdGenerator = {
	next(kind) {
		const suffix =
			globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
		return `${kind}-${suffix}`
	},
}

export { InMemoryEventLog, InMemorySessionStore }
