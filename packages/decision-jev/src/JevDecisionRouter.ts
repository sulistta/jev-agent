import type { PageObservation, SecretAwareString } from '@page-agent/browser'
import type { JsonObject, JsonValue } from '@page-agent/protocol'
import type { DecisionNeed, GoalContract, ObservationChanges, Session } from '@page-agent/runtime'
import type {
	DecisionResult,
	DecisionRouter,
	SemanticTextProvider,
	TaskRouter,
} from '@page-agent/runtime'

import { JevDecisionProvider } from './JevDecisionProvider'
import { jsonStateBytes } from './transports'
import { JevTransportError } from './types'
import type { JevDecisionResult, JevOption } from './types'

const elementActions = ['click', 'input', 'select'] as const
// The API allows 255 Choice options; reserve one for "none of the above".
const choiceOptionLimit = 254
const maxLabelChars = 180
const maxRecentSelectionsInState = 8

type ConcreteAction = (typeof elementActions)[number] | 'scroll' | 'tab.open'

interface ConcreteCandidate {
	candidateId: string
	action: ConcreteAction
	label: string
	target?: PageObservation['elements'][number]['ref']
	regionId?: string
	args: JsonObject
}

interface RecentSelection {
	action: string
	label: string
	status: 'executed' | 'failed'
	candidateSignature: string
	fromUrl: string
	fromTitle: string
	fromObservationHash: string
	fromScrollY?: number
	viewportHeight?: number
}

export class JevDecisionRouter implements DecisionRouter {
	private readonly provider: JevDecisionProvider
	private readonly semanticText: SemanticTextProvider
	private sequence = 0

	constructor(
		provider: JevDecisionProvider,
		semanticText: SemanticTextProvider = unavailableSemanticText
	) {
		this.provider = provider
		this.semanticText = semanticText
	}

	async decide(
		input: {
			session: Session
			goal: GoalContract
			observation: PageObservation
			changes?: ObservationChanges
			need: DecisionNeed
		},
		signal: AbortSignal
	): Promise<DecisionResult> {
		if (signal.aborted) return { kind: 'failed', reason: 'CANCELLED' }
		const history = this.historyFor(input.session, input.goal.goalId)
		const allCandidates = concreteCandidates(input, history)
		const observationHash = observationStateHash(input.observation)
		const attempted = new Set(
			history
				.filter((item) => item.fromObservationHash === observationHash)
				.map((item) => item.candidateSignature)
		)
		const candidates = allCandidates.filter(
			(candidate) => !attempted.has(candidateSignature(candidate))
		)
		const fingerprint = decisionFingerprint(input, candidates)
		const state = decisionState(
			input,
			allCandidates.filter((candidate) => attempted.has(candidateSignature(candidate))),
			history
		)
		const targetChoices = candidates.map(candidateOption)
		const diagnostics = {
			primitive: (candidates.length <= choiceOptionLimit ? 'choice' : 'noul') as
				| 'choice'
				| 'noul',
			candidateCount: candidates.length,
			choices: targetChoices,
			stateBytes: jsonStateBytes(state),
		}
		const judgeCompletion = shouldOfferCompletion(history, input.observation)
		if (input.session.decisionFingerprints?.includes(fingerprint))
			return {
				kind: 'blocked',
				reason:
					'The complete candidate set and browser state are unchanged; repeating the same judgment cannot make progress.',
				fingerprint,
				diagnostics,
			}
		if (candidates.length === 0) {
			if (judgeCompletion) {
				try {
					const completion = await this.provider.decide(
						{
							requestId: this.nextRequestId(input.observation),
							state,
							...completionJudgment(input.need),
						},
						signal
					)
					if (completion.status === 'invalid')
						return {
							kind: 'failed',
							reason: completion.reason ?? 'Invalid Jev completion judgment',
							fingerprint,
							diagnostics,
						}
					if (completionProbability(completion) > 0.5) return this.goalSatisfied(input, fingerprint)
				} catch (error) {
					return {
						kind: 'failed',
						reason: `${error instanceof Error ? error.message : 'Jev request failed'} (complete candidate count: ${allCandidates.length}; state: ${jsonStateBytes(state)} bytes; no candidates were truncated)`,
						fingerprint,
						diagnostics,
					}
				}
			}
			return {
				kind: 'blocked',
				reason:
					allCandidates.length === 0
						? 'No structurally valid action or unexplored viewport area is available for the current goal.'
						: 'Every concrete action in this page state has already been executed; refusing to repeat an action cycle.',
				fingerprint,
				diagnostics,
			}
		}

		let selected: {
			candidate?: ConcreteCandidate
			goalSatisfied?: boolean
			reason?: string
			failed?: boolean
			operation?: ConcreteAction
			targetStrategy?: 'choice' | 'noul' | 'none'
			requestCount: number
		}
		try {
			selected = await this.selectTransition(
				input,
				candidates,
				targetChoices,
				state,
				judgeCompletion,
				signal
			)
		} catch (error) {
			return {
				kind: 'failed',
				reason: `${error instanceof Error ? error.message : 'Jev request failed'} (complete candidate count: ${candidates.length}; state: ${jsonStateBytes(state)} bytes; no candidates were truncated)`,
				fingerprint,
				diagnostics,
			}
		}
		if (selected.goalSatisfied)
			return {
				...this.goalSatisfied(input, fingerprint),
				diagnostics: {
					...diagnostics,
					requestCount: selected.requestCount,
					selectedTransition: 'complete',
				},
			}
		const selectionDiagnostics = {
			...diagnostics,
			operation: selected.operation,
			targetStrategy: selected.targetStrategy,
			requestCount: selected.requestCount,
			primitive: selected.targetStrategy === 'noul' ? ('noul' as const) : ('choice' as const),
		}

		if (!selected.candidate)
			return {
				kind: selected.failed ? 'failed' : 'blocked',
				reason:
					selected.reason ??
					`Jev evaluated all ${candidates.length} concrete candidates and found no suitable next action.`,
				fingerprint,
				diagnostics: { ...selectionDiagnostics, selectedTransition: 'none' },
			}

		const candidate = selected.candidate
		const decision = await this.toDecision(input, candidate, history, fingerprint, signal)
		if (decision.kind !== 'action') return decision
		return {
			...decision,
			diagnostics: {
				...selectionDiagnostics,
				selectedTransition: 'action',
				selectedOptionId: candidate.candidateId,
			},
			selection: {
				action: candidate.action,
				label: candidate.label,
				candidateSignature: candidateSignature(candidate),
				observationSignature: observationStateHash(input.observation),
				...(candidate.target
					? {
							targetLocalId: candidate.target.localId,
							documentId: candidate.target.documentId,
						}
					: {}),
				page: {
					url: input.observation.page.url,
					title: input.observation.page.title,
				},
				viewport: {
					scrollY: input.observation.viewport.scrollY,
					height: input.observation.viewport.height,
				},
			},
		}
	}

	private async selectTransition(
		input: {
			session: Session
			goal: GoalContract
			observation: PageObservation
			changes?: ObservationChanges
			need: DecisionNeed
		},
		candidates: ConcreteCandidate[],
		targetChoices: JevOption[],
		state: JsonValue,
		judgeCompletion: boolean,
		signal: AbortSignal
	): Promise<{
		candidate?: ConcreteCandidate
		goalSatisfied?: boolean
		reason?: string
		failed?: boolean
		operation?: ConcreteAction
		targetStrategy?: 'choice' | 'noul' | 'none'
		requestCount: number
	}> {
		if (candidates.length > choiceOptionLimit) {
			const [selected, completion] = await Promise.all([
				this.selectWithNoul(input, candidates, state, signal),
				judgeCompletion ? this.judgeCompletion(input, state, signal) : Promise.resolve(undefined),
			])
			if (completion?.status === 'invalid')
				return { requestCount: selected.requestCount + 1, failed: true, reason: completion.reason }
			if (completionProbability(completion) > 0.5)
				return { requestCount: selected.requestCount + 1, goalSatisfied: true }
			return {
				...selected,
				operation: selected.candidate?.action,
				requestCount: selected.requestCount + (judgeCompletion ? 1 : 0),
			}
		}
		try {
			const results = await this.provider.decideMany(
				{
					requestId: this.nextRequestId(input.observation),
					state,
					judgments: [
						{
							questionId: 'transition',
							need: input.need.kind,
							risk: input.need.risk,
							prompt: 'Which concrete browser action best advances the current goal from this page? Select none only if none of the listed actions is useful. A control already marked pressed=true or checked=true may be turned off by clicking it.',
							options: targetChoices,
							allowNone: true,
						},
						...(judgeCompletion ? [completionJudgment(input.need)] : []),
					],
				},
				signal
			)
			const completion = results.completion
			if (completion?.status === 'invalid')
				return { requestCount: 1, failed: true, reason: completion.reason }
			if (completionProbability(completion) > 0.5) return { requestCount: 1, goalSatisfied: true }
			const result = results.transition
			if (!result || result.status === 'invalid')
				return { requestCount: 1, failed: true, reason: result?.reason ?? 'Invalid Jev transition' }
			const candidate = candidates.find((item) => item.candidateId === result.selectedOptionId)
			if (result.status === 'selected' && !candidate)
				return { requestCount: 1, failed: true, reason: 'Jev selected an action that was not offered' }
			return {
				candidate,
				operation: candidate?.action,
				targetStrategy: 'choice',
				requestCount: 1,
				reason: candidate ? undefined : result.reason ?? 'Jev found no suitable action',
			}
		} catch (error) {
			if (!isContextLimit(error)) throw error
			const selected = await this.selectWithNoul(input, candidates, state, signal)
			const completion = judgeCompletion
				? await this.judgeCompletion(input, state, signal)
				: undefined
			if (completion?.status === 'invalid')
				return { requestCount: selected.requestCount + 2, failed: true, reason: completion.reason }
			if (completionProbability(completion) > 0.5)
				return { requestCount: selected.requestCount + 2, goalSatisfied: true }
			return {
				...selected,
				operation: selected.candidate?.action,
				requestCount: selected.requestCount + 1 + (judgeCompletion ? 1 : 0),
			}
		}
	}

	private async judgeCompletion(
		input: { observation: PageObservation; need: DecisionNeed },
		state: JsonValue,
		signal: AbortSignal
	): Promise<JevDecisionResult> {
		return this.provider.decide(
			{
				requestId: this.nextRequestId(input.observation),
				state,
				...completionJudgment(input.need),
			},
			signal
		)
	}

	private async selectWithNoul(
		input: { observation: PageObservation; need: DecisionNeed },
		candidates: ConcreteCandidate[],
		state: JsonValue,
		signal: AbortSignal
	): Promise<{
		candidate?: ConcreteCandidate
		reason?: string
		targetStrategy: 'noul'
		requestCount: number
	}> {
		let bestIndex = -1
		let bestProbability = 0.5
		let requestCount = 0
		const evaluate = async (start: number, end: number): Promise<void> => {
			try {
				requestCount += 1
				const results = await this.provider.decideMany(
					{
						requestId: this.nextRequestId(input.observation),
						state,
						judgments: [
							...candidates.slice(start, end).map((candidate, offset) => ({
								questionId: `candidate:${start + offset}`,
								primitive: 'noul' as const,
								need: input.need.kind,
								risk: input.need.risk,
								prompt: `Is this an appropriate immediate next action toward the current goal: ${candidateOption(candidate).label}?`,
							})),
						],
					},
					signal
				)
				for (let index = start; index < end; index += 1) {
					const result = results[`candidate:${index}`]
					if (!result || result.status === 'invalid')
						throw new Error(result?.reason ?? 'Invalid Jev Noul decision')
					const probability = result.answer?.value
					if (typeof probability === 'number' && probability > bestProbability) {
						bestProbability = probability
						bestIndex = index
					}
				}
			} catch (error) {
				if (!isContextLimit(error) || end - start <= 1) throw error
				const middle = start + Math.floor((end - start) / 2)
				await evaluate(start, middle)
				await evaluate(middle, end)
			}
		}
		await evaluate(0, candidates.length)
		return bestIndex >= 0
			? { candidate: candidates[bestIndex], targetStrategy: 'noul', requestCount }
			: {
					reason: `Jev evaluated all ${candidates.length} candidates; none exceeded the 0.5 suitability threshold.`,
					targetStrategy: 'noul',
					requestCount,
				}
	}

	private async toDecision(
		input: { session: Session; goal: GoalContract; observation: PageObservation },
		candidate: ConcreteCandidate,
		history: RecentSelection[],
		fingerprint: string,
		signal: AbortSignal
	): Promise<DecisionResult> {
		if (candidate.action === 'tab.open') {
			const generated = await this.semanticText.generate(
				{
					purpose: 'url',
					request: input.session.plan?.canonicalGoal ?? input.session.task.request,
					conversation: input.session.conversation ?? [],
					page: { url: input.observation.page.url, title: input.observation.page.title },
					actionHistory: history
						.slice(-maxRecentSelectionsInState)
						.map(({ action, label }) => ({ action, label })),
					plan: input.session.plan,
					evidence: input.session.evidence,
				},
				signal
			)
			const url = validateHttpUrl(generated.url)
			return {
				kind: 'action',
				action: { type: 'tab.open', url },
				candidateId: candidate.candidateId,
				fingerprint,
			}
		}
		if (candidate.action === 'scroll') {
			const amount = numberArg(candidate, 'amount')
			if (amount === undefined)
				return { kind: 'failed', reason: 'Jev selected an invalid scroll candidate', fingerprint }
			return {
				kind: 'action',
				action: { type: 'scroll', axis: 'y', amount: { kind: 'pages', value: amount } },
				candidateId: candidate.candidateId,
				fingerprint,
			}
		}
		if (!candidate.target)
			return { kind: 'failed', reason: 'Jev selected an action without a target', fingerprint }
		if (candidate.action === 'input') {
			const generated = await this.semanticText.generate(
				{
					purpose: 'input',
					request: input.session.plan?.canonicalGoal ?? input.session.task.request,
					conversation: input.session.conversation ?? [],
					field: candidate.label,
					page: { url: input.observation.page.url, title: input.observation.page.title },
					actionHistory: history
						.slice(-maxRecentSelectionsInState)
						.map(({ action, label }) => ({ action, label })),
					plan: input.session.plan,
					evidence: input.session.evidence,
				},
				signal
			)
			const text = validateInputText(generated.text)
			return {
				kind: 'action',
				action: {
					type: 'input',
					target: candidate.target,
					text: text as SecretAwareString,
					replace: true,
				},
				candidateId: candidate.candidateId,
				fingerprint,
			}
		}
		if (candidate.action === 'select') {
			const value = stringArg(candidate, 'optionValue')
			if (value === undefined)
				return { kind: 'failed', reason: 'Jev selected an invalid select option', fingerprint }
			return {
				kind: 'action',
				action: {
					type: 'select',
					target: candidate.target,
					option: { kind: 'value', value },
				},
				candidateId: candidate.candidateId,
				fingerprint,
			}
		}
		return {
			kind: 'action',
			action: { type: 'click', target: candidate.target },
			candidateId: candidate.candidateId,
			fingerprint,
		}
	}

	private nextRequestId(observation: PageObservation): string {
		this.sequence += 1
		return `jev:${observation.observationId}:${this.sequence}`
	}

	private historyFor(session: Session, goalId: string): RecentSelection[] {
		return (session.actionJournal ?? []).flatMap((entry) => {
			const selection = entry.selection
			if (entry.workItemId !== goalId || !selection) return []
			return [
				{
					action: selection.action,
					label: truncate(selection.label, maxLabelChars),
					status: entry.status,
					candidateSignature: selection.candidateSignature,
					fromUrl: truncate(selection.page.url, 512),
					fromTitle: truncate(selection.page.title, 512),
					fromObservationHash: selection.observationSignature,
					fromScrollY: selection.viewport?.scrollY,
					viewportHeight: selection.viewport?.height,
				},
			]
		})
	}

	private goalSatisfied(
		input: { session: Session; observation: PageObservation },
		fingerprint: string
	): DecisionResult {
		return {
			kind: 'goal_satisfied',
			reason: 'Jev verified the complete goal from the current page and recent actions',
			evidence: [
				{
					evidenceId: `evidence:jev:${input.observation.observationId}`,
					type: 'outcome.verified',
					source: 'jev',
					observationId: input.observation.observationId,
					value: true,
					capturedAt: input.observation.capturedAt,
					sensitivity: 'public',
				},
			],
			fingerprint,
		}
	}
}

const unavailableSemanticText: SemanticTextProvider = {
	async generate() {
		throw new Error('Semantic model provider is not configured')
	},
}

function completionJudgment(need: DecisionNeed): {
	questionId: string
	primitive: 'noul'
	need: string
	risk: DecisionNeed['risk']
	prompt: string
} {
	return {
		questionId: 'completion',
		primitive: 'noul',
		need: 'judge_outcome',
		risk: need.risk,
		prompt:
			'Do the current page and the recorded executed actions prove that `currentWorkItem` has been achieved? Judge this work item only; the complete user task may still have later work items.',
	}
}

function completionProbability(result: JevDecisionResult | undefined): number {
	return typeof result?.answer?.value === 'number' ? result.answer.value : 0
}

function concreteCandidates(
	input: {
		session: Session
		goal: GoalContract
		observation: PageObservation
	},
	history: RecentSelection[]
): ConcreteCandidate[] {
	const { observation } = input
	const filledFields = new Set(
		(input.session.actionJournal ?? [])
			.filter(
				(entry) =>
					entry.status === 'executed' &&
					entry.workItemId === input.goal.goalId &&
					entry.action === 'input' &&
					entry.selection?.page.url === observation.page.url &&
					entry.selection.documentId === observation.documentId
			)
			.map((entry) => entry.selection?.targetLocalId)
			.filter((id): id is string => id !== undefined)
	)
	const allElementCandidates = observation.elements.flatMap((element) =>
		elementCandidates(observation, element).filter(
			(candidate) =>
				candidate.action !== 'input' ||
				element.valueState !== 'present' ||
				!filledFields.has(element.ref.localId)
		)
	)
	const modalRegionIds = new Set(
		observation.regions.filter((region) => region.kind === 'modal').map((region) => region.regionId)
	)
	const modalCandidates = allElementCandidates.filter(
		(candidate) =>
			candidate.regionId === 'region:modal' ||
			(candidate.regionId !== undefined && modalRegionIds.has(candidate.regionId))
	)
	const candidates = modalCandidates.length > 0 ? modalCandidates : allElementCandidates
	if (modalCandidates.length === 0) {
		candidates.push(...scrollCandidates(observation, history))
		if (input.session.task.allowedCapabilities.includes('tabs.write'))
			candidates.push({
				candidateId: `${observation.observationId}:jev:tab.open`,
				action: 'tab.open',
				label:
					'Open a new HTTP(S) tab. After this action is selected, the semantic model derives the destination URL from the current goal.',
				args: {},
			})
	}
	return candidates
}

function elementCandidates(
	observation: PageObservation,
	element: PageObservation['elements'][number]
): ConcreteCandidate[] {
	if (!element.visible || !element.enabled) return []
	const actions = element.supportedActions ?? []
	const candidates: ConcreteCandidate[] = []
	for (const action of elementActions) {
		if (!actions.includes(action)) continue
		if (action === 'select') {
			for (const [optionIndex, option] of (element.options ?? []).entries()) {
				if (option.selected) continue
				candidates.push(
					elementCandidate(observation, element, action, optionIndex, option.label, option.value)
				)
			}
			continue
		}
		candidates.push(elementCandidate(observation, element, action))
	}
	return candidates
}

function elementCandidate(
	observation: PageObservation,
	element: PageObservation['elements'][number],
	action: (typeof elementActions)[number],
	optionIndex?: number,
	optionLabel?: string,
	optionValue?: string
): ConcreteCandidate {
	const args: JsonObject = { tagName: element.tagName }
	if (action === 'input') args.valueState = element.valueState ?? 'unknown'
	if (element.attributes.href) args.href = element.attributes.href
	if (element.role) args.role = element.role.toLocaleLowerCase()
	if (element.state?.selected !== undefined) args.selected = element.state.selected
	if (element.state?.pressed !== undefined) args.pressed = element.state.pressed
	if (element.state?.checked !== undefined) args.checked = element.state.checked
	if (element.state?.expanded !== undefined) args.expanded = element.state.expanded
	if (element.bounds) {
		args.x = Math.round(element.bounds.x)
		args.y = Math.round(element.bounds.y)
	}
	if (optionValue !== undefined) args.optionValue = optionValue
	if (element.collectionItem) {
		args.collectionPosition = element.collectionItem.position
		args.collectionText = truncate(element.collectionItem.text, maxLabelChars)
	}
	const baseLabel =
		[
			...new Set(
				[
					element.accessibleName,
					element.placeholder,
					element.attributes['aria-label'],
					element.attributes.name,
					element.text,
				].filter(Boolean)
			),
		]
			.join(' — ')
			.slice(0, maxLabelChars) || `${element.role ?? element.tagName} control`
	const candidateId = `${observation.observationId}:jev:${action}:${element.ref.localId}${
		optionIndex === undefined ? '' : `:option:${optionIndex}`
	}`
	return {
		candidateId,
		action,
		target: element.ref,
		regionId: element.regionId,
		label:
			action === 'select'
				? `select ${optionLabel || '(empty option)'} in ${baseLabel}`
				: `${action} ${element.collectionItem ? `collection item ${element.collectionItem.position}: ` : ''}${baseLabel}${
						element.collectionItem?.text && !element.collectionItem.text.includes(baseLabel)
							? ` — ${truncate(element.collectionItem.text, maxLabelChars)}`
							: ''
					}`,
		args,
	}
}

function scrollCandidates(
	observation: PageObservation,
	history: RecentSelection[]
): ConcreteCandidate[] {
	const candidates: ConcreteCandidate[] = []
	const documentHeight = observation.viewport.documentHeight
	const nearbyControls = observation.metadata?.offViewportControls
	const nextScrollTargets =
		nearbyControls && typeof nearbyControls === 'object' && !Array.isArray(nearbyControls)
			? nearbyControls.nextScrollTargets
			: undefined
	const nearest = (direction: 'up' | 'down'): { label: string; distancePx: number } | undefined => {
		if (!Array.isArray(nextScrollTargets)) return undefined
		const matches = nextScrollTargets.filter(
			(item): item is { direction: 'up' | 'down'; label: string; distancePx: number } =>
				typeof item === 'object' &&
				item !== null &&
				!Array.isArray(item) &&
				item.direction === direction &&
				typeof item.label === 'string' &&
				typeof item.distancePx === 'number' &&
				Number.isFinite(item.distancePx)
		)
		return matches.sort((left, right) => left.distancePx - right.distancePx)[0]
	}
	const scrollAmount = (target: { distancePx: number } | undefined): number =>
		target && observation.viewport.height > 0
			? (Math.max(0, target.distancePx) + Math.max(80, observation.viewport.height / 4)) /
				observation.viewport.height
			: 1
	const seenPositions = history
		.filter((item) => item.action === 'scroll' && item.fromUrl === observation.page.url)
		.flatMap((item) => (item.fromScrollY === undefined ? [] : [item.fromScrollY]))
	const previouslySeen = (targetY: number): boolean =>
		seenPositions.some(
			(position) => Math.abs(position - targetY) < Math.max(1, observation.viewport.height / 2)
		)
	if (
		typeof documentHeight === 'number' &&
		observation.viewport.scrollY + observation.viewport.height < documentHeight - 1
	) {
		const target = nearest('down')
		const amount = scrollAmount(target)
		candidates.push({
			candidateId: `${observation.observationId}:jev:scroll:down`,
			action: 'scroll',
			label: target
				? `Scroll down to reveal ${truncate(target.label, maxLabelChars)}`
				: previouslySeen(observation.viewport.scrollY + observation.viewport.height)
					? 'Scroll down one viewport to return to previously observed content'
					: 'Scroll down one viewport to observe content below the current viewport',
			args: {
				amount,
				fromScrollY: observation.viewport.scrollY,
				unobserved: !previouslySeen(observation.viewport.scrollY + observation.viewport.height),
			},
		})
	}
	if (observation.viewport.scrollY > 0) {
		const target = nearest('up')
		const amount = scrollAmount(target)
		candidates.push({
			candidateId: `${observation.observationId}:jev:scroll:up`,
			action: 'scroll',
			label: target
				? `Scroll up to reveal ${truncate(target.label, maxLabelChars)}`
				: previouslySeen(Math.max(0, observation.viewport.scrollY - observation.viewport.height))
					? 'Scroll up one viewport to return to previously observed content'
					: 'Scroll up one viewport to observe content above the current viewport',
			args: {
				amount: -amount,
				fromScrollY: observation.viewport.scrollY,
				unobserved: !previouslySeen(Math.max(0, observation.viewport.scrollY - observation.viewport.height)),
			},
		})
	}
	return candidates
}

function decisionState(
	input: {
		session: Session
		goal: GoalContract
		observation: PageObservation
		changes?: ObservationChanges
	},
	attemptedCandidates: ConcreteCandidate[],
	history: RecentSelection[]
): JsonValue {
	const viewportText = [
		...new Set((input.observation.content ?? []).map((block) => block.text.trim()).filter(Boolean)),
	].join('\n')
	return {
		originalRequest: input.session.task.request,
		canonicalGoal: input.session.plan?.canonicalGoal ?? input.goal.description,
		currentGoal: input.session.plan?.canonicalGoal ?? input.goal.description,
		currentWorkItem: input.goal.description,
		successCriteria:
			input.session.plan?.workItems.find((item) => item.workItemId === input.goal.goalId)
				?.successCriteria ?? [],
		planningHints: input.session.plan?.planningHints ?? [],
		observedAfterLastAction: input.changes
			? {
					afterAction: input.changes.afterAction,
					controls: input.changes.controls.map((control) => ({ ...control })),
					viewportChanged: input.changes.viewportChanged,
					pageChanged: input.changes.pageChanged,
					...(input.changes.submission ? { submission: input.changes.submission } : {}),
				}
			: null,
		viewportText: truncate(viewportText, 8_000),
		page: {
			url: truncate(input.observation.page.url, 512),
			title: truncate(input.observation.page.title, 512),
			offViewportControls: input.observation.metadata?.offViewportControls ?? null,
			viewport: {
				width: input.observation.viewport.width,
				height: input.observation.viewport.height,
				scrollX: input.observation.viewport.scrollX,
				scrollY: input.observation.viewport.scrollY,
				...(input.observation.viewport.documentWidth === undefined
					? {}
					: { documentWidth: input.observation.viewport.documentWidth }),
				...(input.observation.viewport.documentHeight === undefined
					? {}
					: { documentHeight: input.observation.viewport.documentHeight }),
			},
		},
		attemptedCandidateCount: attemptedCandidates.length,
		recentSelections: historyState(history),
	}
}

function candidateOption(candidate: ConcreteCandidate): JevOption {
	const destination = stringArg(candidate, 'href')
	const position = numberArg(candidate, 'y')
	const state = ['selected', 'pressed', 'checked', 'expanded', 'valueState']
		.flatMap((key) => {
			const value = candidate.args[key]
			return typeof value === 'boolean' || typeof value === 'string' ? [`${key}=${value}`] : []
		})
		.join(', ')
	return {
		id: candidate.candidateId,
		label: `${state ? `[${state}] ` : ''}${candidate.label}${destination ? ` -> ${truncate(destination, 200)}` : ''}${
			position === undefined ? '' : ` at y=${position}`
		}`,
	}
}

function isContextLimit(error: unknown): boolean {
	return error instanceof JevTransportError && error.code === 'CONTEXT_LIMIT'
}

function candidateSignature(candidate: ConcreteCandidate): string {
	return shortHash(
		JSON.stringify({
			action: candidate.action,
			// Scroll labels describe exploration history and may change without changing the action.
			label: candidate.action === 'scroll' ? undefined : candidate.label,
			regionId: candidate.regionId,
			args: candidate.args,
		})
	)
}

function decisionFingerprint(
	input: { goal: GoalContract; observation: PageObservation },
	candidates: ConcreteCandidate[]
): string {
	return shortHash(
		JSON.stringify({
			goalId: input.goal.goalId,
			goal: input.goal.description,
			page: input.observation.page,
			viewport: input.observation.viewport,
			metadata: input.observation.metadata,
			contentHashes: (input.observation.content ?? []).map((block) => block.contentHash),
			candidates: candidates.map(candidateSignature),
		})
	)
}

function shortHash(value: string): string {
	let hash = 2166136261
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return `decision:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function shouldOfferCompletion(history: RecentSelection[], observation: PageObservation): boolean {
	const previous = history.at(-1)
	return Boolean(previous && previous.fromObservationHash !== observationStateHash(observation))
}

function observationStateHash(observation: PageObservation): string {
	return shortHash(
		JSON.stringify({
			page: observation.page,
			viewport: observation.viewport,
			metadata: observation.metadata,
			content: (observation.content ?? []).map((block) => block.contentHash),
			elements: observation.elements.map((element) => ({
				id: element.ref.localId,
				label: element.accessibleName ?? element.text ?? '',
				enabled: element.enabled,
				supportedActions: element.supportedActions,
				valueState: element.valueState,
				selected: element.state?.selected,
				pressed: element.state?.pressed,
				checked: element.state?.checked,
				expanded: element.state?.expanded,
			})),
		})
	)
}

function historyState(history: RecentSelection[]): JsonValue {
	return history.slice(-maxRecentSelectionsInState).map((item) => ({
		action: item.action,
		label: item.label,
		status: item.status,
		fromPage: { url: item.fromUrl, title: item.fromTitle },
		...(item.fromScrollY === undefined ? {} : { fromScrollY: item.fromScrollY }),
	}))
}

function stringArg(candidate: ConcreteCandidate, name: string): string | undefined {
	const value = candidate.args[name]
	return typeof value === 'string' ? value : undefined
}

function numberArg(candidate: ConcreteCandidate, name: string): number | undefined {
	const value = candidate.args[name]
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export class JevTaskRouter implements TaskRouter {
	private sequence = 0
	private readonly provider: JevDecisionProvider
	constructor(provider: JevDecisionProvider) {
		this.provider = provider
	}

	async route(
		input: { session: Session; request: string },
		signal: AbortSignal
	): Promise<'conversation' | 'browser'> {
		this.sequence += 1
		const result = await this.provider.decide(
			{
				requestId: `jev:task:${input.session.sessionId}:${this.sequence}`,
				need: 'select_operation',
				risk: 'R0',
				state: { request: input.request },
				options: [
					{
						id: 'task:conversation',
						label: 'Respond conversationally. No browser observation or browser action is needed.',
					},
					{
						id: 'task:browser',
						label: 'Perform a browser task that needs page observation or a browser action.',
					},
				],
			},
			signal
		)
		if (result.selectedOptionId === 'task:conversation') return 'conversation'
		if (result.selectedOptionId === 'task:browser') return 'browser'
		throw new Error(`Jev could not route task: ${result.reason ?? 'no task mode selected'}`)
	}

	async shouldClarify(
		input: { session: Session; plan: import('@page-agent/runtime').TaskPlan },
		signal: AbortSignal
	): Promise<boolean> {
		this.sequence += 1
		const result = await this.provider.decide(
			{
				requestId: `jev:clarify:${input.session.sessionId}:${this.sequence}`,
				need: 'judge_outcome',
				risk: 'R0',
				state: {
					request: input.session.task.request,
					freeTextArgumentsAreGeneratedAtExecution: true,
					missingInputs: input.plan.missingInputs.map((item) => ({
						key: item.key,
						question: truncate(item.question, 300),
					})),
					workItems: input.plan.workItems.map((item) => ({
						id: item.workItemId,
						description: truncate(item.description, 300),
						kind: item.kind,
					})),
				},
				prompt:
					'Can a useful first browser step begin now? Free-text arguments for inputs are generated later by the semantic model. Unspecified preferences do not block navigation or observation. Ask only if no productive first browser step is possible without the user answer.',
				options: [
					{
						id: 'clarification:continue',
						label:
							'Begin browser work now. Missing details can be discovered, inferred from the request, or resolved later only if they become blocking.',
					},
					{
						id: 'clarification:ask',
						label:
							'No productive browser step is possible until the user supplies the listed information.',
					},
				],
			},
			signal
		)
		return result.selectedOptionId === 'clarification:ask'
	}
}

export function validateHttpUrl(value: string | undefined): string {
	const raw = value?.trim()
	if (!raw) throw new Error('Semantic model returned no URL')
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw new Error('Semantic model returned an invalid URL')
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
		throw new Error('Semantic model returned an unsafe URL')
	return url.toString()
}

export function validateInputText(value: string | undefined): string {
	const text = value?.trim()
	if (!text) throw new Error('Semantic model returned no input text')
	if (text.length > 4_000) throw new Error('Semantic model input exceeds the 4000 character limit')
	return text
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value
	const edgeLength = Math.floor((maxLength - 1) / 2)
	return `${value.slice(0, edgeLength)}…${value.slice(-edgeLength)}`
}
