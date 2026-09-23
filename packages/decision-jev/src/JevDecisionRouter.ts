import type { PageObservation, SecretAwareString } from '@page-agent/browser'
import type { JsonObject, JsonValue } from '@page-agent/protocol'
import type { DecisionNeed, GoalContract, Session } from '@page-agent/runtime'
import type {
	DecisionResult,
	DecisionRouter,
	SemanticTextProvider,
	TaskRouter,
} from '@page-agent/runtime'

import { JevDecisionProvider } from './JevDecisionProvider'
import { jsonStateBytes } from './transports'
import type { JevDecisionResult, JevOption } from './types'

const elementActions = ['click', 'input', 'select'] as const
// Reserve one Choice option for the explicit "none of the above" transition.
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
	candidateSignature: string
	fromUrl: string
	fromTitle: string
	fromObservationHash: string
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
			need: DecisionNeed
		},
		signal: AbortSignal
	): Promise<DecisionResult> {
		if (signal.aborted) return { kind: 'failed', reason: 'CANCELLED' }
		const history = this.historyFor(input.session, input.goal.goalId)
		const allCandidates = concreteCandidates(input)
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
			candidates,
			allCandidates.filter((candidate) => attempted.has(candidateSignature(candidate))),
			history
		)
		const judgeCompletion = shouldOfferCompletion(history, input.observation)
		if (input.session.decisionFingerprints?.includes(fingerprint))
			return {
				kind: 'blocked',
				reason:
					'The complete candidate set and browser state are unchanged; repeating the same judgment cannot make progress.',
				fingerprint,
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
						}
					if (completionProbability(completion) > 0.5) return this.goalSatisfied(input, fingerprint)
				} catch (error) {
					return {
						kind: 'failed',
						reason: `${error instanceof Error ? error.message : 'Jev request failed'} (complete candidate count: ${allCandidates.length}; state: ${jsonStateBytes(state)} bytes; no candidates were truncated)`,
						fingerprint,
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
			}
		}

		let selected: {
			candidate?: ConcreteCandidate
			goalSatisfied?: boolean
			reason?: string
			failed?: boolean
		}
		try {
			selected =
				candidates.length <= choiceOptionLimit
					? await this.selectWithChoice(input, candidates, state, judgeCompletion, signal)
					: await this.selectWithNoul(input, candidates, state, judgeCompletion, signal)
		} catch (error) {
			return {
				kind: 'failed',
				reason: `${error instanceof Error ? error.message : 'Jev request failed'} (complete candidate count: ${candidates.length}; state: ${jsonStateBytes(state)} bytes; no candidates were truncated)`,
				fingerprint,
			}
		}
		if (selected.goalSatisfied) return this.goalSatisfied(input, fingerprint)

		if (!selected.candidate)
			return {
				kind: selected.failed ? 'failed' : 'blocked',
				reason:
					selected.reason ??
					`Jev evaluated all ${candidates.length} concrete candidates and found no suitable next action.`,
				fingerprint,
			}

		const candidate = selected.candidate
		const decision = await this.toDecision(input, candidate, history, fingerprint, signal)
		if (decision.kind !== 'action') return decision
		return {
			...decision,
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
			},
		}
	}

	private async selectWithChoice(
		input: { observation: PageObservation; need: DecisionNeed },
		candidates: ConcreteCandidate[],
		state: JsonValue,
		judgeCompletion: boolean,
		signal: AbortSignal
	): Promise<{
		candidate?: ConcreteCandidate
		goalSatisfied?: boolean
		reason?: string
		failed?: boolean
	}> {
		const results = await this.provider.decideMany(
			{
				requestId: this.nextRequestId(input.observation),
				state,
				judgments: [
					{
						questionId: 'action',
						need: input.need.kind,
						risk: input.need.risk,
						prompt:
							'Which concrete candidate is the best immediate next step toward the current goal?',
						options: candidates.map(candidateOption),
						allowNone: true,
					},
					...(judgeCompletion ? [completionJudgment(input.need)] : []),
				],
			},
			signal
		)
		const completion = results.completion
		if (completion?.status === 'invalid')
			return { failed: true, reason: completion.reason ?? 'Invalid Jev completion judgment' }
		if (completionProbability(completion) > 0.5) return { goalSatisfied: true }
		const result = results.action
		if (result.status === 'invalid')
			return { failed: true, reason: result.reason ?? 'Invalid Jev decision' }
		// Choice confidence measures separation from the other valid options. It
		// must not erase the winner after the runtime has already restricted the
		// set to visible, enabled and supported concrete actions.
		const selectedOptionId = result.selectedOptionId ?? result.answer?.selectedOptionId
		const candidate = candidates.find((item) => item.candidateId === selectedOptionId)
		return {
			candidate,
			reason:
				result.status === 'none'
					? result.reason ?? 'Jev found no suitable action in the current page state'
					: result.reason,
		}
	}

	private async selectWithNoul(
		input: { observation: PageObservation; need: DecisionNeed },
		candidates: ConcreteCandidate[],
		state: JsonValue,
		judgeCompletion: boolean,
		signal: AbortSignal
	): Promise<{
		candidate?: ConcreteCandidate
		goalSatisfied?: boolean
		reason?: string
		failed?: boolean
	}> {
		const results = await this.provider.decideMany(
			{
				requestId: this.nextRequestId(input.observation),
				state,
				judgments: [
					...candidates.map((_, index) => ({
						questionId: `candidate:${index}`,
						primitive: 'noul' as const,
						need: input.need.kind,
						risk: input.need.risk,
						prompt: `Is candidate ${index} an appropriate immediate next action toward the current goal?`,
					})),
					...(judgeCompletion ? [completionJudgment(input.need)] : []),
				],
			},
			signal
		)
		const completion = results.completion
		if (completion?.status === 'invalid')
			return { failed: true, reason: completion.reason ?? 'Invalid Jev completion judgment' }
		if (completionProbability(completion) > 0.5) return { goalSatisfied: true }
		let bestIndex = -1
		let bestProbability = 0.5
		for (let index = 0; index < candidates.length; index += 1) {
			const result = results[`candidate:${index}`]
			if (result?.status === 'invalid')
				return { failed: true, reason: result.reason ?? 'Invalid Jev Noul decision' }
			const probability = result?.answer?.value
			if (typeof probability === 'number' && probability > bestProbability) {
				bestProbability = probability
				bestIndex = index
			}
		}
		return bestIndex >= 0
			? { candidate: candidates[bestIndex] }
			: {
					reason: `Jev evaluated all ${candidates.length} candidates; none exceeded the 0.5 suitability threshold.`,
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
					request: input.goal.description,
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
					request: input.goal.description,
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
					candidateSignature: selection.candidateSignature,
					fromUrl: truncate(selection.page.url, 512),
					fromTitle: truncate(selection.page.title, 512),
					fromObservationHash: selection.observationSignature,
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
			'Do the current page and the recorded executed actions prove that the complete current goal has been achieved?',
	}
}

function completionProbability(result: JevDecisionResult | undefined): number {
	return typeof result?.answer?.value === 'number' ? result.answer.value : 0
}

function concreteCandidates(input: {
	session: Session
	goal: GoalContract
	observation: PageObservation
}): ConcreteCandidate[] {
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
		candidates.push(...scrollCandidates(observation))
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
	const actions = element.supportedActions ?? legacySupportedActions(element)
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

function legacySupportedActions(
	element: PageObservation['elements'][number]
): (typeof elementActions)[number][] {
	const actions: (typeof elementActions)[number][] = []
	if (element.editable) actions.push('input')
	if (element.tagName === 'select') actions.push('select')
	if (
		element.tagName === 'button' ||
		element.tagName === 'a' ||
		['button', 'link', 'menuitem', 'option', 'tab', 'combobox'].includes(
			element.role?.toLocaleLowerCase() ?? ''
		)
	)
		actions.push('click')
	return actions
}

function scrollCandidates(observation: PageObservation): ConcreteCandidate[] {
	const candidates: ConcreteCandidate[] = []
	const documentHeight = observation.viewport.documentHeight
	if (
		typeof documentHeight === 'number' &&
		observation.viewport.scrollY + observation.viewport.height < documentHeight - 1
	)
		candidates.push({
			candidateId: `${observation.observationId}:jev:scroll:down`,
			action: 'scroll',
			label: 'Scroll down one viewport to observe content below the current viewport',
			args: { amount: 1, fromScrollY: observation.viewport.scrollY },
		})
	if (observation.viewport.scrollY > 0)
		candidates.push({
			candidateId: `${observation.observationId}:jev:scroll:up`,
			action: 'scroll',
			label: 'Scroll up one viewport to observe content above the current viewport',
			args: { amount: -1, fromScrollY: observation.viewport.scrollY },
		})
	return candidates
}

function decisionState(
	input: { session: Session; goal: GoalContract; observation: PageObservation },
	candidates: ConcreteCandidate[],
	attemptedCandidates: ConcreteCandidate[],
	history: RecentSelection[]
): JsonValue {
	return {
		originalRequest: input.session.task.request,
		canonicalGoal: input.session.plan?.canonicalGoal ?? input.goal.description,
		currentGoal: input.goal.description,
		page: {
			url: truncate(input.observation.page.url, 512),
			title: truncate(input.observation.page.title, 512),
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
		candidates: candidates.map((candidate, index) => compactCandidate(candidate, index)),
		attemptedCandidates: attemptedCandidates.map((candidate) => ({
			action: candidate.action,
			label: truncate(candidate.label, maxLabelChars),
			signature: candidateSignature(candidate),
		})),
		recentSelections: historyState(history),
	}
}

function compactCandidate(candidate: ConcreteCandidate, index: number): JsonObject {
	return {
		index,
		id: candidate.candidateId,
		action: candidate.action,
		label: truncate(candidate.label, maxLabelChars),
		...(candidate.regionId ? { region: candidate.regionId } : {}),
		...candidate.args,
	}
}

function candidateOption(candidate: ConcreteCandidate): JevOption {
	const destination = stringArg(candidate, 'href')
	const position = numberArg(candidate, 'y')
	return {
		id: candidate.candidateId,
		label: `${candidate.label}${destination ? ` -> ${destination}` : ''}${
			position === undefined ? '' : ` at y=${position}`
		}`,
	}
}

function candidateSignature(candidate: ConcreteCandidate): string {
	return shortHash(
		JSON.stringify({
			action: candidate.action,
			label: candidate.label,
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
			content: (observation.content ?? []).map((block) => block.contentHash),
			elements: observation.elements.map((element) => ({
				id: element.ref.localId,
				label: element.accessibleName ?? element.text ?? '',
				valueState: element.valueState,
				selected: element.state?.selected,
				expanded: element.state?.expanded,
			})),
		})
	)
}

function historyState(history: RecentSelection[]): JsonValue {
	return history.slice(-maxRecentSelectionsInState).map((item) => ({
		action: item.action,
		label: item.label,
		fromPage: { url: item.fromUrl, title: item.fromTitle },
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
					'Can useful browser execution begin now, with unspecified preferences discovered from pages or resolved using reasonable defaults? Ask only when an answer is strictly required before any productive browser step.',
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
