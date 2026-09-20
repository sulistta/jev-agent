import type {
	BrowserAction,
	ElementRef,
	ExpectedChange,
	PageObservation,
} from '@page-agent/browser'

import type {
	EvidenceItem,
	ExecutionBudgets,
	GoalContract,
	GoalStatus,
	Session,
	SessionStatus,
	TaskPlan,
	TaskWorkItem,
} from './domain'
import { type RuntimeError } from './errors/RuntimeError'
import { type RuntimeDependencies, createDefaultBudgets, createTaskContract } from './ports'
import { isTerminalSessionStatus, transitionSession } from './session/state'

export interface StartTaskInput {
	request: string
	owner: import('./domain').SessionOwner
	goals?: import('./domain').GoalContract[]
	capabilities?: import('./domain').Capability[]
	budgets?: Partial<ExecutionBudgets>
	/** The browser tab that owns the first observation for extension sessions. */
	initialTabId?: string
}

export interface SessionSnapshot {
	sessionId: string
	status: SessionStatus
	revision: number
	currentGoalId?: string
	pendingConfirmationId?: string
	finalResponse?: string
	data?: { plan?: TaskPlan; evidence: EvidenceItem[] }
}

export interface SessionHandle {
	id: string
	result: Promise<SessionSnapshot>
	pause(): Promise<void>
	resume(): Promise<void>
	cancel(reason?: string): Promise<void>
}

export interface AgentRuntime {
	start(input: StartTaskInput, signal?: AbortSignal): Promise<SessionHandle>
	pause(sessionId: string): Promise<void>
	resume(sessionId: string): Promise<void>
	reply(sessionId: string, text: string): Promise<void>
	cancel(sessionId: string, reason?: string): Promise<void>
	approveConfirmation(sessionId: string, confirmationId: string): Promise<void>
	denyConfirmation(sessionId: string, confirmationId: string): Promise<void>
	getSession(sessionId: string): Promise<SessionSnapshot | undefined>
}

export interface AgentRuntimeFactory {
	create(dependencies: RuntimeDependencies): AgentRuntime
}

export function createAgentRuntime(dependencies: RuntimeDependencies): AgentRuntime {
	return new DefaultAgentRuntime({
		...dependencies,
		// Compatibility defaults keep generic runtime consumers browser-oriented;
		// the extension always supplies the JEV and semantic-model pair explicitly.
		taskRouter: dependencies.taskRouter ?? { route: async () => 'browser' },
	})
}

class DefaultAgentRuntime implements AgentRuntime {
	private readonly executions = new Map<string, SessionExecution>()
	private readonly dependencies: RuntimeDependencies & {
		taskRouter: NonNullable<RuntimeDependencies['taskRouter']>
	}

	constructor(
		dependencies: RuntimeDependencies & {
			taskRouter: NonNullable<RuntimeDependencies['taskRouter']>
		}
	) {
		this.dependencies = dependencies
	}

	async start(input: StartTaskInput, signal?: AbortSignal): Promise<SessionHandle> {
		const createdAt = this.dependencies.clock.now()
		const sessionId = this.dependencies.ids.next('session')
		const task = createTaskContract({
			taskId: this.dependencies.ids.next('task'),
			request: input.request,
			goals: input.goals ?? [],
			createdAt,
			allowedCapabilities: input.capabilities,
		})
		const budgets = { ...createDefaultBudgets(), ...input.budgets }
		const initialTabId = input.initialTabId
		const session: Session = {
			sessionId,
			owner: input.owner,
			task,
			status: 'created',
			revision: 0,
			budgets,
			browserScope: {
				ownedTabIds: initialTabId ? [initialTabId] : [],
				// In-page runtimes own their document implicitly. Extension sessions
				// intentionally remain unbound until JEV selects tab.open.
				activeTabId: initialTabId ?? (input.owner.kind === 'in_page' ? 'in-page' : undefined),
				allowedOrigins: [],
				maxTabs: budgets.maxTabs,
			},
			conversation: [{ role: 'user', text: input.request, at: createdAt }],
			createdAt,
			updatedAt: createdAt,
		}
		if (initialTabId && this.dependencies.browser.tabs)
			await this.dependencies.browser.tabs.claim(initialTabId, sessionId)
		await this.dependencies.sessions.create(session)
		await this.dependencies.events.append({
			eventId: this.dependencies.ids.next('event'),
			at: createdAt,
			sessionId,
			type: 'session.created',
			payload: { status: 'created' },
			sensitivity: 'public',
		})

		const execution = new SessionExecution(this.dependencies, sessionId, signal)
		this.executions.set(sessionId, execution)
		void execution.result.finally(() => this.executions.delete(sessionId))
		return execution
	}

	async pause(sessionId: string): Promise<void> {
		await this.requireExecution(sessionId).pause()
	}

	async resume(sessionId: string): Promise<void> {
		await this.requireExecution(sessionId).resume()
	}

	async reply(sessionId: string, text: string): Promise<void> {
		await this.requireExecution(sessionId).reply(text)
	}

	async cancel(sessionId: string, reason?: string): Promise<void> {
		await this.requireExecution(sessionId).cancel(reason)
	}

	async approveConfirmation(sessionId: string, confirmationId: string): Promise<void> {
		await this.requireExecution(sessionId).approveConfirmation(confirmationId)
	}

	async denyConfirmation(sessionId: string, confirmationId: string): Promise<void> {
		await this.requireExecution(sessionId).denyConfirmation(confirmationId)
	}

	async getSession(sessionId: string): Promise<SessionSnapshot | undefined> {
		const session = await this.dependencies.sessions.get(sessionId)
		return session ? snapshot(session) : undefined
	}

	private requireExecution(sessionId: string): SessionExecution {
		const execution = this.executions.get(sessionId)
		if (!execution) throw new Error(`Session is not running: ${sessionId}`)
		return execution
	}
}

class SessionExecution implements SessionHandle {
	readonly id: string
	readonly result: Promise<SessionSnapshot>

	private readonly abortController = new AbortController()
	private readonly resumeWaiters: (() => void)[] = []
	private paused = false
	private startedAt: string | undefined
	private pendingAction:
		| {
				confirmationId: string
				actionId: string
				action: BrowserAction
				observationRevision: number
		  }
		| undefined
	private readonly dependencies: RuntimeDependencies
	private readonly sessionId: string
	private terminalEventEmitted = false

	constructor(dependencies: RuntimeDependencies, sessionId: string, externalSignal?: AbortSignal) {
		this.dependencies = dependencies
		this.sessionId = sessionId
		this.id = sessionId
		if (externalSignal) {
			if (externalSignal.aborted) this.abortController.abort(externalSignal.reason)
			else
				externalSignal.addEventListener(
					'abort',
					() => this.abortController.abort(externalSignal.reason),
					{ once: true }
				)
		}
		this.result = this.run()
	}

	async pause(): Promise<void> {
		this.paused = true
		const session = await this.currentSession()
		if (session.status === 'running') await this.transition(session, 'paused')
	}

	async resume(): Promise<void> {
		this.paused = false
		const session = await this.currentSession()
		if (session.status === 'paused' || session.status === 'waiting_user')
			await this.transition(session, 'running')
		this.resumeWaiters.splice(0).forEach((resolve) => resolve())
	}

	async reply(text: string): Promise<void> {
		const value = text.trim()
		if (!value) throw new Error('A reply cannot be empty')
		let session = await this.currentSession()
		if (session.status !== 'waiting_user') throw new Error('Session is not waiting for user input')
		session = await this.save({
			...session,
			conversation: [
				...(session.conversation ?? []),
				{ role: 'user', text: value, at: this.dependencies.clock.now() },
			],
		})
		// Replies remain in session-local conversation memory. The event log records only receipt so
		// user-supplied values are not duplicated into diagnostics or public projections.
		await this.emit(session.sessionId, 'user.reply', { received: 'true' })
		await this.resume()
	}

	async cancel(_reason?: string): Promise<void> {
		this.abortController.abort()
		this.paused = false
		this.resumeWaiters.splice(0).forEach((resolve) => resolve())
		await this.result
	}

	async approveConfirmation(confirmationId: string): Promise<void> {
		if (!this.dependencies.confirmations) throw new Error('Confirmation manager is not configured')
		const result = this.dependencies.confirmations.approve(confirmationId)
		if ('code' in result) throw new Error(result.message)
		const session = await this.currentSession()
		if (session.pendingConfirmation?.confirmationId !== confirmationId)
			throw new Error('CONFIRMATION_INVALID')
		this.paused = false
		await this.transition(session, 'running')
		this.resumeWaiters.splice(0).forEach((resolve) => resolve())
	}

	async denyConfirmation(confirmationId: string): Promise<void> {
		if (!this.dependencies.confirmations) throw new Error('Confirmation manager is not configured')
		this.dependencies.confirmations.invalidate(confirmationId)
		const session = await this.currentSession()
		if (session.pendingConfirmation?.confirmationId !== confirmationId)
			throw new Error('CONFIRMATION_INVALID')
		await this.block(session, 'POLICY_BLOCKED', 'Confirmation denied')
		this.paused = false
		this.resumeWaiters.splice(0).forEach((resolve) => resolve())
	}

	private async run(): Promise<SessionSnapshot> {
		try {
			let session = await this.currentSession()
			this.startedAt = this.dependencies.clock.now()
			session = await this.transition(session, 'running')
			await this.emit(session.sessionId, 'session.started', { status: session.status })
			if (this.paused) session = await this.transition(session, 'paused')
			if (!session.taskMode) {
				const taskMode = await this.dependencies.taskRouter!.route(
					{ session, request: session.task.request, conversation: session.conversation ?? [] },
					this.abortController.signal
				)
				session = await this.save({ ...session, taskMode })
				await this.emit(session.sessionId, 'task.routed', { mode: taskMode })
			}
			if (session.taskMode === 'conversation') return await this.completeConversation(session)
			session = await this.prepareBrowserSession(session)

			let steps = 0
			let actions = 0
			let noProgress = 0
			let stateBeforeLastExecutedAction: string | undefined

			while (true) {
				await this.waitUntilRunnable()
				session = await this.currentSession()
				this.assertNotCancelled()
				if (session.budgets.maxElapsedMs > 0 && this.elapsedMs() >= session.budgets.maxElapsedMs) {
					return await this.block(session, 'BUDGET_EXCEEDED', 'Execution deadline exceeded')
				}

				const goal = nextGoal(session)
				if (!goal) return await this.finishWithoutPendingGoals(session)
				if (
					(session.budgets.maxSteps > 0 && steps >= session.budgets.maxSteps) ||
					(session.budgets.maxActions > 0 && actions >= session.budgets.maxActions)
				) {
					return await this.block(session, 'BUDGET_EXCEEDED', 'Execution budget exceeded')
				}

				if (goal.status === 'pending')
					session = await this.updateGoal(session, goal.goalId, 'active')
				steps += 1

				session = await this.setPhase(session, 'observing')
				const observation = await this.observe(session, workItemForGoal(session.plan, goal.goalId))
				const observationFingerprint = runtimeObservationFingerprint(observation)
				if (stateBeforeLastExecutedAction !== undefined) {
					noProgress = stateBeforeLastExecutedAction === observationFingerprint ? noProgress + 1 : 0
					stateBeforeLastExecutedAction = undefined
				}
				session = await this.collectEvidence(session, goal, observation)
				if (researchGoalSatisfied(session, goal.goalId)) {
					session = await this.updateGoal(session, goal.goalId, 'satisfied')
					noProgress = 0
					continue
				}
				session = await this.setPhase(session, 'verifying')
				const verification = await this.dependencies.verifier.verify(
					{ goal, observation },
					this.abortController.signal
				)
				await this.emit(session.sessionId, 'outcome.verification', {
					goalId: goal.goalId,
					status: verification.status,
					evidenceCount: String(verification.evidence.length),
				})
				if (verification.status === 'satisfied') {
					session = await this.updateGoal(session, goal.goalId, 'satisfied', verification.evidence)
					noProgress = 0
					continue
				}
				if (verification.status === 'failed' && goal.required)
					return await this.fail(session, 'Goal verification failed')
				if (noProgress >= session.budgets.maxConsecutiveNoProgress)
					return await this.block(
						session,
						'NO_PROGRESS',
						'The page state did not change after repeated completed actions'
					)

				session = await this.setPhase(session, 'deciding')
				const decision = await this.dependencies.decisions.decide(
					{
						session,
						goal,
						observation,
						need: {
							kind: 'select_operation',
							closedWorld: true,
							computable: false,
							risk: 'R1',
							requiredCapabilities: session.task.allowedCapabilities,
						},
					},
					this.abortController.signal
				)
				await this.emit(session.sessionId, 'decision.selected', {
					kind: decision.kind,
					reason: decision.reason ?? '',
					candidateId: decision.candidateId ?? '',
				})
				if (decision.fingerprint && !session.decisionFingerprints?.includes(decision.fingerprint))
					session = await this.save({
						...session,
						decisionFingerprints: [
							...(session.decisionFingerprints ?? []),
							decision.fingerprint,
						].slice(-100),
					})

				if (decision.kind === 'goal_satisfied') {
					const workItem = workItemForGoal(session.plan, goal.goalId)
					if (workItem?.kind === 'research' && !researchGoalSatisfied(session, goal.goalId)) {
						noProgress += 1
						continue
					}
					session = await this.updateGoal(session, goal.goalId, 'satisfied', decision.evidence)
					noProgress = 0
					continue
				}
				if (decision.kind === 'clarify' || decision.kind === 'confirm') {
					if (decision.kind === 'clarify')
						session = await this.askForClarification(session, decision.reason)
					this.paused = true
					session = await this.transition(session, 'waiting_user')
					continue
				}
				if (decision.kind === 'blocked')
					return await this.block(session, 'POLICY_BLOCKED', decision.reason ?? 'Decision blocked')
				if (decision.kind === 'failed')
					return await this.fail(session, decision.reason ?? 'Decision failed')
				if (decision.kind === 'replan') {
					noProgress += 1
					if (noProgress >= session.budgets.maxConsecutiveNoProgress) {
						return await this.block(session, 'NO_PROGRESS', 'No progress after replanning')
					}
					continue
				}
				if (decision.kind !== 'action' || !decision.action) {
					return await this.fail(
						session,
						decision.reason ?? 'Decision did not provide an executable action'
					)
				}

				let executableDecision = decision
				const target = actionTarget(decision.action)
				if (target) {
					const validation = await this.dependencies.browser.revalidate(
						target,
						this.abortController.signal
					)
					await this.emit(session.sessionId, 'reference.validated', {
						status: validation.status,
						reason: validation.reason ?? '',
						localId: target.localId,
					})
					if (validation.status === 'forbidden') {
						return await this.block(
							session,
							'POLICY_BLOCKED',
							validation.reason ?? 'The selected page element is no longer allowed'
						)
					}
					if (validation.status === 'stale' || validation.status === 'missing') {
						// A dynamic page replacing a control is new browser state, not a failed
						// attempt. The global step budget still bounds pages that never settle.
						continue
					}
					executableDecision = {
						...decision,
						action: replaceActionTarget(decision.action, validation.ref),
					}
				}
				const action = executableDecision.action!

				const authorization = await this.dependencies.policy.authorize(
					{ session, decision: executableDecision },
					this.abortController.signal
				)
				await this.emit(session.sessionId, 'policy.decision', {
					actionType: action.type,
					result: authorization,
				})
				const generatedActionId = this.dependencies.ids.next('action')
				const isPendingApproval =
					this.pendingAction !== undefined &&
					this.pendingAction.confirmationId === session.pendingConfirmation?.confirmationId &&
					this.pendingAction.observationRevision === observation.revision
				const actionId = isPendingApproval ? this.pendingAction!.actionId : generatedActionId
				if (authorization === 'confirm') {
					if (isPendingApproval) {
						this.pendingAction = undefined
						if (this.dependencies.confirmations) {
							const consumed = this.dependencies.confirmations.consume({
								confirmationId: session.pendingConfirmation!.confirmationId,
								sessionId: session.sessionId,
								actionId,
								action,
								observationRevision: observation.revision,
							})
							if (!consumed.ok)
								return await this.block(session, 'CONFIRMATION_INVALID', consumed.error.message)
						}
						session = await this.save({ ...session, pendingConfirmation: undefined })
					} else {
						if (!this.dependencies.confirmations)
							return await this.block(
								session,
								'CONFIRMATION_REQUIRED',
								'Confirmation manager is not configured'
							)
						const pending = this.dependencies.confirmations.issue({
							session,
							actionId,
							action,
							observationRevision: observation.revision,
							ttlMs: 60_000,
						})
						this.pendingAction = {
							confirmationId: pending.confirmationId,
							actionId,
							action,
							observationRevision: observation.revision,
						}
						session = await this.save({ ...session, pendingConfirmation: pending })
						await this.emit(session.sessionId, 'confirmation.required', {
							confirmationId: pending.confirmationId,
							actionId,
						})
					}
					this.paused = true
					session = await this.transition(session, 'waiting_user')
					continue
				}
				if (authorization === 'deny')
					return await this.block(session, 'POLICY_BLOCKED', 'Policy denied action')

				session = await this.setPhase(session, 'executing')
				await this.emit(session.sessionId, 'action.started', {
					actionId,
					actionType: action.type,
				})
				const receipt = await this.dependencies.browser.execute(
					{
						actionId,
						sessionId: session.sessionId,
						expectedSessionRevision: observation.revision,
						action,
					},
					this.abortController.signal
				)
				if (receipt.result?.ok) {
					const effect = receipt.result.effect
					if (effect.type === 'tab.opened' || effect.type === 'tab.switched') {
						session = await this.save({
							...session,
							browserScope: {
								...session.browserScope,
								activeTabId: effect.tabId,
								ownedTabIds: [...new Set([...session.browserScope.ownedTabIds, effect.tabId])],
							},
						})
					} else if (effect.type === 'tab.closed') {
						const ownedTabIds = session.browserScope.ownedTabIds.filter(
							(tabId) => tabId !== effect.tabId
						)
						session = await this.save({
							...session,
							browserScope: {
								...session.browserScope,
								ownedTabIds,
								activeTabId:
									session.browserScope.activeTabId === effect.tabId
										? ownedTabIds.at(-1)
										: session.browserScope.activeTabId,
							},
						})
					}
				}
				actions += 1
				await this.emit(session.sessionId, 'action.completed', {
					actionId: receipt.actionId,
					actionType: action.type,
					status: receipt.status,
					errorCode: receipt.error?.code ?? '',
					errorMessage: receipt.error?.message ?? '',
					retryable: String(receipt.error?.retryable ?? false),
				})
				const journalEntry: import('./domain').ActionJournalEntry = {
					actionId: receipt.actionId,
					workItemId: goal.goalId,
					action: action.type,
					label: decision.candidateId ?? action.type,
					status: receipt.status === 'executed' ? 'executed' : 'failed',
					observationId: observation.observationId,
					completedAt: receipt.endedAt,
				}
				session = await this.save({
					...session,
					actionJournal: [...(session.actionJournal ?? []), journalEntry].slice(-200),
				})
				session = await this.setPhase(session, 'settling')
				const synchronization = tabEffectConfirmsAction(receipt, action)
					? {
							status: 'satisfied' as const,
							signals: receipt.observedSignals,
							endedAt: receipt.endedAt,
						}
					: await this.dependencies.browser.waitFor(
							{
								sessionId: session.sessionId,
								tabId: session.browserScope.activeTabId ?? 'in-page',
								since: receipt.startedAt,
								expected: expectedChanges(action),
								settle: { quietWindowMs: 500, maxWaitMs: 10_000 },
							},
							this.abortController.signal
						)
				await this.emit(session.sessionId, 'synchronization.completed', {
					status: synchronization.status,
				})
				if (receipt.status === 'executed') {
					stateBeforeLastExecutedAction = observationFingerprint
					continue
				}
				noProgress += 1
				if (noProgress >= session.budgets.maxConsecutiveNoProgress) {
					return await this.block(
						session,
						'NO_PROGRESS',
						receipt.error?.message ?? 'Action made no progress'
					)
				}
			}
		} catch (error) {
			const session = await this.currentSession()
			if (this.abortController.signal.aborted) {
				if (!isTerminalSessionStatus(session.status)) {
					const terminal = await this.transition(session, 'cancelled')
					await this.emitTerminal(terminal)
					return snapshot(terminal)
				}
				await this.emitTerminal(session)
				return snapshot(session)
			}
			if (!isTerminalSessionStatus(session.status))
				return snapshot(await this.fail(session, errorMessage(error)))
			await this.emitTerminal(session)
			return snapshot(session)
		}
	}

	private async prepareBrowserSession(session: Session): Promise<Session> {
		const semanticText = this.dependencies.semanticText
		if (!semanticText?.plan) {
			if (session.task.goals.length === 0)
				throw new Error('Semantic model does not support typed task planning')
			return session
		}
		while (true) {
			if (!session.plan) {
				session = await this.setPhase(session, 'planning')
				const plan = await semanticText.plan(
					{ request: session.task.request, conversation: session.conversation ?? [] },
					this.abortController.signal
				)
				validatePlan(plan)
				session = await this.save({
					...session,
					plan,
					task: { ...session.task, goals: plan.workItems.map(goalFromWorkItem) },
					decisionFingerprints: [],
				})
				await this.emit(session.sessionId, 'plan.created', {
					workItems: String(plan.workItems.length),
					missingInputs: String(plan.missingInputs.length),
				})
			}
			const plan = session.plan
			if (!plan) throw new Error('Task plan was not persisted')
			if (plan.missingInputs.length === 0) return session
			const shouldClarify = this.dependencies.taskRouter?.shouldClarify
				? await this.dependencies.taskRouter.shouldClarify(
						{ session, plan },
						this.abortController.signal
					)
				: true
			if (!shouldClarify) {
				session = await this.save({
					...session,
					plan: { ...plan, missingInputs: [] },
				})
				await this.emit(session.sessionId, 'plan.clarification_deferred', {
					count: String(plan.missingInputs.length),
				})
				return session
			}
			const question = plan.missingInputs.map((item) => item.question.trim()).join('\n')
			session = await this.addAssistantMessage(
				session,
				requireSemanticText(question, 'clarification'),
				'clarification'
			)
			session = await this.setPhase(session, 'waiting_user')
			this.paused = true
			await this.transition(session, 'waiting_user')
			await this.waitUntilRunnable()
			session = await this.currentSession()
			session = await this.save({ ...session, plan: undefined })
		}
	}

	private async observe(session: Session, workItem?: TaskWorkItem): Promise<PageObservation> {
		if (!session.browserScope.activeTabId) {
			const observation: PageObservation = {
				observationId: `observation:unbound:${session.revision}`,
				sessionId: session.sessionId,
				tabId: 'unbound',
				documentId: 'unbound',
				revision: session.revision,
				capturedAt: this.dependencies.clock.now(),
				page: { url: 'about:blank', title: '', origin: '' },
				viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0 },
				regions: [],
				elements: [],
				signals: [],
				sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
			}
			await this.emit(session.sessionId, 'observation.captured', {
				observationId: observation.observationId,
				revision: String(observation.revision),
				elementCount: '0',
				redactedFields: '0',
			})
			return observation
		}
		const observation = await this.dependencies.browser.observe(
			{
				sessionId: session.sessionId,
				tabId: session.browserScope.activeTabId ?? 'in-page',
				scope: workItem?.kind === 'research' ? 'document' : 'viewport',
				includeText: true,
				includeNonInteractive: workItem?.kind === 'research',
				attributes: [],
				sensitivityPolicyId: 'default',
			},
			this.abortController.signal
		)
		await this.emit(session.sessionId, 'observation.captured', {
			observationId: observation.observationId,
			revision: String(observation.revision),
			elementCount: String(observation.elements.length),
			redactedFields: String(observation.sanitization.redactedFields),
		})
		return observation
	}

	private async collectEvidence(
		session: Session,
		goal: GoalContract,
		observation: PageObservation
	): Promise<Session> {
		const plan = session.plan
		const semanticText = this.dependencies.semanticText
		const workItem = workItemForGoal(plan, goal.goalId)
		if (
			!plan ||
			!semanticText?.extract ||
			workItem?.kind !== 'research' ||
			!observation.content?.length
		)
			return session
		const fingerprint = extractionFingerprint(workItem.workItemId, observation)
		if (session.extractionFingerprints?.includes(fingerprint)) return session
		session = await this.setPhase(session, 'extracting')
		const extracted = await semanticText.extract(
			{
				request: session.task.request,
				plan,
				workItemId: workItem.workItemId,
				page: {
					url: observation.page.url,
					title: observation.page.title,
					content: observation.content
						.map((block) => `[${block.blockId}] ${block.text}`)
						.join('\n'),
				},
			},
			this.abortController.signal
		)
		const verified = extracted
			.map((item) => verifyEvidenceItem(item, workItem.workItemId, observation))
			.filter((item): item is EvidenceItem => item !== undefined)
		const evidence = dedupeEvidence([...(session.evidence ?? []), ...verified])
		const saved = await this.save({
			...session,
			evidence,
			extractionFingerprints: [...(session.extractionFingerprints ?? []), fingerprint].slice(-500),
		})
		await this.emit(saved.sessionId, 'evidence.extracted', {
			workItemId: workItem.workItemId,
			extracted: String(extracted.length),
			verified: String(verified.length),
		})
		return saved
	}

	private async updateGoal(
		session: Session,
		goalId: string,
		status: GoalStatus,
		evidence: import('./domain').Evidence[] = []
	): Promise<Session> {
		const goals = session.task.goals.map((goal) =>
			goal.goalId === goalId
				? {
						...goal,
						status,
						evidenceIds: [...goal.evidenceIds, ...evidence.map((item) => item.evidenceId)],
					}
				: goal
		)
		const next = await this.save({
			...session,
			task: { ...session.task, goals },
			plan: session.plan
				? {
						...session.plan,
						workItems: session.plan.workItems.map((item) =>
							item.workItemId === goalId ? { ...item, status } : item
						),
					}
				: undefined,
			currentGoalId: goalId,
		})
		await this.emit(session.sessionId, 'goal.updated', { goalId, status })
		return next
	}

	private async finishWithoutPendingGoals(session: Session): Promise<SessionSnapshot> {
		const required = session.task.goals.filter((goal) => goal.required)
		const status: SessionStatus = required.every((goal) => goal.status === 'satisfied')
			? 'completed'
			: required.some((goal) => goal.status === 'failed')
				? 'failed'
				: 'partially_completed'
		let completed = session
		if (
			status === 'completed' &&
			completed.taskMode === 'browser' &&
			completed.finalResponse === undefined &&
			this.dependencies.semanticText
		)
			completed = await this.addSummary(completed)
		const terminal = await this.transition(completed, status)
		await this.emitTerminal(terminal)
		return snapshot(terminal)
	}

	private async completeConversation(session: Session): Promise<SessionSnapshot> {
		const response = await this.dependencies.semanticText!.generate(
			{
				purpose: 'response',
				request: session.task.request,
				conversation: session.conversation ?? [],
			},
			this.abortController.signal
		)
		const text = requireSemanticText(response.text, 'response')
		session = await this.addAssistantMessage(session, text, 'response', true)
		for (const goal of session.task.goals.filter((goal) => goal.status !== 'satisfied'))
			session = await this.updateGoal(session, goal.goalId, 'satisfied')
		const terminal = await this.transition(session, 'completed')
		await this.emitTerminal(terminal)
		return snapshot(terminal)
	}

	private async askForClarification(session: Session, reason?: string): Promise<Session> {
		const response = await this.dependencies.semanticText!.generate(
			{
				purpose: 'clarification',
				request: session.task.request,
				conversation: session.conversation ?? [],
				reason,
			},
			this.abortController.signal
		)
		return this.addAssistantMessage(
			session,
			requireSemanticText(response.text, 'clarification'),
			'clarification'
		)
	}

	private async addSummary(session: Session): Promise<Session> {
		session = await this.setPhase(session, 'synthesizing')
		const response = await this.dependencies.semanticText!.generate(
			{
				purpose: 'summary',
				request: session.task.request,
				conversation: session.conversation ?? [],
				actionHistory: (session.actionJournal ?? []).map(({ action, label }) => ({
					action,
					label,
				})),
				plan: session.plan,
				evidence: session.evidence,
			},
			this.abortController.signal
		)
		return this.addAssistantMessage(
			session,
			requireSemanticText(response.text, 'summary'),
			'summary',
			true
		)
	}

	private async setPhase(session: Session, phase: NonNullable<Session['phase']>): Promise<Session> {
		if (session.phase === phase) return session
		const saved = await this.save({ ...session, phase })
		await this.emit(saved.sessionId, 'execution.phase', { phase })
		return saved
	}

	private async addAssistantMessage(
		session: Session,
		text: string,
		purpose: 'response' | 'clarification' | 'summary',
		final = false
	): Promise<Session> {
		const saved = await this.save({
			...session,
			conversation: [
				...(session.conversation ?? []),
				{ role: 'assistant', text, purpose, at: this.dependencies.clock.now() },
			],
			finalResponse: final ? text : session.finalResponse,
		})
		await this.emit(saved.sessionId, 'assistant.message', { text, purpose })
		return saved
	}

	private async block(
		session: Session,
		code: RuntimeError['code'],
		reason: string
	): Promise<SessionSnapshot> {
		await this.emit(session.sessionId, 'session.blocked', { code, reason })
		const terminal = await this.transition(session, 'blocked', reason)
		await this.emitTerminal(terminal)
		return snapshot(terminal)
	}

	private async fail(session: Session, reason: string): Promise<Session> {
		await this.emit(session.sessionId, 'session.failed', { reason })
		const terminal = await this.transition(session, 'failed', reason)
		await this.emitTerminal(terminal)
		return terminal
	}

	private async transition(
		session: Session,
		status: SessionStatus,
		reason?: string
	): Promise<Session> {
		if (session.status === status) return session
		const next = transitionSession(session, status, this.dependencies.clock.now(), reason)
		const saved = await this.dependencies.sessions.update(next, session.revision)
		await this.emit(session.sessionId, 'session.status_changed', { status })
		return saved
	}

	private async save(session: Session): Promise<Session> {
		const next = {
			...session,
			revision: session.revision + 1,
			updatedAt: this.dependencies.clock.now(),
		}
		return this.dependencies.sessions.update(next, session.revision)
	}

	private async currentSession(): Promise<Session> {
		const session = await this.dependencies.sessions.get(this.sessionId)
		if (!session) throw new Error(`Session not found: ${this.sessionId}`)
		return session
	}

	private async emit(
		sessionId: string,
		type: string,
		payload: Record<string, string>
	): Promise<void> {
		await this.dependencies.events.append({
			eventId: this.dependencies.ids.next('event'),
			at: this.dependencies.clock.now(),
			sessionId,
			type,
			payload,
			sensitivity: 'internal',
		})
	}

	private async emitTerminal(session: Session): Promise<void> {
		if (this.terminalEventEmitted || !isTerminalSessionStatus(session.status)) return
		this.terminalEventEmitted = true
		await this.releaseOwnedTabs(session)
		await this.emit(session.sessionId, 'session.terminal', {
			status: session.status,
			summary: session.finalResponse ?? '',
		})
	}

	private async releaseOwnedTabs(session: Session): Promise<void> {
		if (!this.dependencies.browser.tabs) return
		await Promise.all(
			session.browserScope.ownedTabIds.map(async (tabId) => {
				try {
					await this.dependencies.browser.tabs!.release(tabId, session.sessionId)
				} catch {
					// Cleanup must not change the already-recorded terminal outcome.
				}
			})
		)
	}

	private async waitUntilRunnable(): Promise<void> {
		this.assertNotCancelled()
		if (!this.paused) return
		await new Promise<void>((resolve) => this.resumeWaiters.push(resolve))
		this.assertNotCancelled()
	}

	private elapsedMs(): number {
		if (!this.startedAt) return 0
		const started = Date.parse(this.startedAt)
		const current = Date.parse(this.dependencies.clock.now())
		return Number.isFinite(started) && Number.isFinite(current) ? Math.max(0, current - started) : 0
	}

	private assertNotCancelled(): void {
		if (this.abortController.signal.aborted) throw new Error('CANCELLED')
	}
}

function expectedChanges(action: BrowserAction): ExpectedChange[] {
	switch (action.type) {
		case 'input':
			return [{ type: 'target.value', targetLocalId: action.target.localId }, { type: 'dom' }]
		case 'tab.open':
			// The creation receipt identifies the new tab, but it does not mean the
			// document or its content-script endpoint is ready. An empty expectation
			// lets the target document settle for the normal quiet window first.
			return []
		case 'tab.switch':
			return [{ type: 'tab.activated' }]
		case 'tab.close':
			return [{ type: 'tab.closed' }]
		case 'click':
			return [{ type: 'dom' }, { type: 'navigation' }]
		default:
			return [{ type: 'dom' }]
	}
}

function tabEffectConfirmsAction(
	receipt: import('@page-agent/browser').ActionReceipt,
	action: BrowserAction
): boolean {
	if (!receipt.result?.ok) return false
	const effect = receipt.result.effect
	return (
		(action.type === 'scroll' && effect.type === 'viewport.scrolled') ||
		(action.type === 'tab.switch' &&
			effect.type === 'tab.switched' &&
			effect.tabId === action.tabId) ||
		(action.type === 'tab.close' && effect.type === 'tab.closed' && effect.tabId === action.tabId)
	)
}

function actionTarget(action: BrowserAction): ElementRef | undefined {
	return 'target' in action ? action.target : undefined
}

function replaceActionTarget(action: BrowserAction, target: ElementRef): BrowserAction {
	return 'target' in action ? ({ ...action, target } as BrowserAction) : action
}

function nextGoal(session: Session): GoalContract | undefined {
	return session.task.goals.find(
		(goal) =>
			(goal.status === 'pending' || goal.status === 'active') &&
			(goal.dependsOn ?? []).every((dependency) =>
				session.task.goals.some(
					(candidate) => candidate.goalId === dependency && candidate.status === 'satisfied'
				)
			)
	)
}

function goalFromWorkItem(workItem: TaskWorkItem): GoalContract {
	return {
		goalId: workItem.workItemId,
		description: workItem.description,
		required: workItem.required,
		outcome: { kind: 'predicate', predicate: { kind: 'runtime.managed' } },
		status: workItem.status,
		evidenceIds: [],
		dependsOn: workItem.dependsOn,
	}
}

function workItemForGoal(plan: TaskPlan | undefined, goalId: string): TaskWorkItem | undefined {
	return plan?.workItems.find((item) => item.workItemId === goalId)
}

function validatePlan(plan: TaskPlan): void {
	if (plan.version !== 1 || !plan.canonicalGoal.trim() || plan.workItems.length === 0)
		throw new Error('Semantic model returned an invalid task plan')
	const ids = new Set<string>()
	for (const item of plan.workItems) {
		if (!item.workItemId.trim() || ids.has(item.workItemId))
			throw new Error('Semantic model returned duplicate or empty work item IDs')
		ids.add(item.workItemId)
	}
	for (const item of plan.workItems) {
		if (
			item.dependsOn.includes(item.workItemId) ||
			item.dependsOn.some((dependency) => !ids.has(dependency))
		)
			throw new Error('Semantic model returned an invalid work item dependency')
	}
	const completed = new Set<string>()
	while (completed.size < plan.workItems.length) {
		const ready = plan.workItems.filter(
			(item) =>
				!completed.has(item.workItemId) &&
				item.dependsOn.every((dependency) => completed.has(dependency))
		)
		if (ready.length === 0) throw new Error('Semantic model returned cyclic work item dependencies')
		ready.forEach((item) => completed.add(item.workItemId))
	}
	for (const requirement of plan.coverage) {
		if (!ids.has(requirement.workItemId) || requirement.minimum < 1)
			throw new Error('Semantic model returned an invalid coverage requirement')
	}
	for (const item of plan.workItems.filter((candidate) => candidate.kind === 'research')) {
		if (!plan.coverage.some((requirement) => requirement.workItemId === item.workItemId))
			throw new Error(`Research work item has no coverage requirement: ${item.workItemId}`)
	}
}

function researchGoalSatisfied(session: Session, goalId: string): boolean {
	const workItem = workItemForGoal(session.plan, goalId)
	if (!workItem || workItem.kind !== 'research' || !session.plan) return false
	const requirements = session.plan.coverage.filter(
		(requirement) => requirement.workItemId === workItem.workItemId
	)
	return (
		requirements.length > 0 &&
		requirements.every((requirement) => {
			const matching = (session.evidence ?? []).filter(
				(item) =>
					item.workItemId === workItem.workItemId &&
					item.verification === 'verified' &&
					(requirement.requiredTags ?? []).every((tag) => item.tags.includes(tag))
			)
			if (!requirement.distinctBy) return matching.length >= requirement.minimum
			const values = new Set(
				matching
					.map((item) => evidenceDistinctValue(item, requirement.distinctBy!))
					.filter((value) => value !== undefined)
					.map((value) => JSON.stringify(value))
			)
			return values.size >= requirement.minimum
		})
	)
}

function evidenceDistinctValue(
	item: EvidenceItem,
	field: string
): import('@page-agent/protocol').JsonValue | undefined {
	if (field === 'entityName') return item.entityName
	if (field === 'source.origin' || field === 'origin') return item.source.origin
	if (field === 'source.url' || field === 'url') return item.source.url
	return item.attributes[field]
}

function extractionFingerprint(workItemId: string, observation: PageObservation): string {
	return stableHash(
		[
			workItemId,
			observation.page.url,
			...(observation.content ?? []).map((block) => block.contentHash),
		].join('\n')
	)
}

function runtimeObservationFingerprint(observation: PageObservation): string {
	return stableHash(
		JSON.stringify({
			page: observation.page,
			content: (observation.content ?? []).map((block) => block.contentHash),
			elements: observation.elements.map((element) => ({
				tagName: element.tagName,
				role: element.role,
				name: element.accessibleName,
				text: element.text,
				valueState: element.valueState,
				href: element.attributes.href,
				selected: element.state?.selected,
				expanded: element.state?.expanded,
			})),
		})
	)
}

function verifyEvidenceItem(
	item: EvidenceItem,
	workItemId: string,
	observation: PageObservation
): EvidenceItem | undefined {
	const quote = normalizeEvidenceText(item.source.quote)
	if (!quote) return undefined
	const block = (observation.content ?? []).find((candidate) =>
		normalizeEvidenceText(candidate.text).includes(quote)
	)
	if (!block) return undefined
	const capturedAt = observation.capturedAt
	return {
		...item,
		evidenceId: `evidence:${stableHash(
			`${workItemId}\n${observation.page.url}\n${item.entityName}\n${quote}`
		)}`,
		workItemId,
		source: {
			url: observation.page.url,
			title: observation.page.title,
			origin: observation.page.origin,
			quote: item.source.quote.trim(),
			contentBlockId: block.blockId,
			capturedAt,
		},
		verification: 'verified',
	}
}

function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
	return [...new Map(items.map((item) => [item.evidenceId, item] as const)).values()].slice(-1_000)
}

function normalizeEvidenceText(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function stableHash(value: string): string {
	let hash = 2166136261
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(16).padStart(8, '0')
}

function snapshot(session: Session): SessionSnapshot {
	return {
		sessionId: session.sessionId,
		status: session.status,
		revision: session.revision,
		currentGoalId: session.currentGoalId,
		pendingConfirmationId: session.pendingConfirmation?.confirmationId,
		finalResponse: session.finalResponse,
		data:
			session.plan || session.evidence
				? { plan: session.plan, evidence: session.evidence ?? [] }
				: undefined,
	}
}

function requireSemanticText(value: string | undefined, purpose: string): string {
	const text = value?.trim()
	if (!text) throw new Error(`Semantic model returned no ${purpose} text`)
	return text
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}
