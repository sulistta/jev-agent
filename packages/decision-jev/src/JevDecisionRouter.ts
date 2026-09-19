import type {
	BrowserAction,
	Candidate,
	PageObservation,
	SecretAwareString,
} from '@page-agent/browser'
import type { JsonObject, JsonValue } from '@page-agent/protocol'
import type { DecisionNeed, GoalContract, Session } from '@page-agent/runtime'
import type {
	DecisionResult,
	DecisionRouter,
	SemanticTextProvider,
	TaskRouter,
} from '@page-agent/runtime'

import { JevDecisionProvider, buildDecisionState } from './JevDecisionProvider'
import { jsonStateBytes } from './transports'
import type { JevDecisionResult, JevOption } from './types'

const candidateOperations = ['click', 'input', 'select'] as const
// Jev is a judgment primitive, not a DOM search engine. Keep the deterministic
// retrieval stage narrow so equivalent controls do not dilute confidence.
const maxJevCandidates = 32
// Leave room for the synthetic tab.open and completion options.
const maxJevOptionBytes = 11_000
const maxPageStateBytes = 16_000
const maxGoalChars = 2_000
const maxLabelChars = 180
const maxRecentSelections = 8

interface RecentSelection {
	goalId: string
	action: string
	label: string
	fromUrl: string
	fromTitle: string
}

export class JevDecisionRouter implements DecisionRouter {
	private readonly provider: JevDecisionProvider
	private readonly semanticText: SemanticTextProvider
	private readonly recentSelections = new Map<string, RecentSelection[]>()
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
		const history = this.historyFor(input.session.sessionId, input.goal.goalId)
		if (shouldJudgeCompletion(history, input.observation)) {
			const completion = await this.provider.decide(
				{
					requestId: this.nextRequestId(input.observation),
					need: 'judge_outcome',
					risk: input.need.risk,
					state: completionState(input.goal, input.observation, history),
					options: [
						{
							id: 'goal:continue',
							label:
								'The complete user goal is not yet proven by the current page and recent actions.',
						},
						{
							id: 'goal:satisfied',
							label:
								'The current page and recent actions together prove that the complete user goal has been achieved.',
						},
					],
				},
				signal
			)
			if (completion.selectedOptionId === 'goal:satisfied') {
				this.recentSelections.delete(input.session.sessionId)
				return {
					kind: 'goal_satisfied',
					reason: 'Jev verified the completed browser transition',
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
				}
			}
		}

		const allCandidates = candidateOperations.flatMap((operation) =>
			input.observation.elements
				.filter((element) => isCandidateFor(element, operation))
				.map((element) => candidateFor(input.observation, operation, element))
		)
		const candidates = selectCandidatesForJev(
			activeCandidateScope(allCandidates),
			input.goal.description
		)
		const observedByLocalId = new Map(
			input.observation.elements.map((element) => [element.ref.localId, element] as const)
		)
		const options: JevOption[] = candidates.map((candidate) => ({
			id: candidate.candidateId,
			label: candidateOptionLabel(
				candidate,
				candidate.target ? observedByLocalId.get(candidate.target.localId) : undefined
			),
		}))
		if (input.session.task.allowedCapabilities.includes('tabs.write'))
			options.push({
				id: 'tab.open',
				label:
					'Open a new HTTP(S) tab. Choose only when navigation to a destination is required before an on-page action.',
			})
		options.push({
			id: 'goal:satisfied',
			label:
				'Finish the task only when the current URL, page title, element states, and visible labels prove that the complete user goal has already been achieved.',
		})

		const result = await this.provider.decide(
			{
				requestId: this.nextRequestId(input.observation),
				need: input.need.kind,
				risk: input.need.risk,
				state: buildDecisionState({
					goal: truncate(input.goal.description, maxGoalChars),
					options,
					page: pageState(input.observation, candidates, history),
				}),
				options,
			},
			signal
		)

		if (result.status === 'invalid')
			return { kind: 'failed', reason: result.reason ?? 'Invalid Jev decision' }
		const selectedOptionId =
			result.selectedOptionId ?? reversibleCandidateSelection(result, candidates, input.need.risk)
		if (!selectedOptionId) return { kind: 'replan', reason: result.reason }

		if (selectedOptionId === 'tab.open') {
			const generated = await this.semanticText.generate(
				{
					purpose: 'url',
					request: input.goal.description,
					conversation: input.session.conversation ?? [],
					page: { url: input.observation.page.url, title: input.observation.page.title },
					actionHistory: history.map(({ action, label }) => ({ action, label })),
				},
				signal
			)
			const url = validateHttpUrl(generated.url)
			this.remember(input, 'tab.open', url)
			return { kind: 'action', action: { type: 'tab.open', url }, candidateId: 'tab.open' }
		}
		if (selectedOptionId === 'goal:satisfied') {
			this.recentSelections.delete(input.session.sessionId)
			return { kind: 'goal_satisfied', evidence: [], reason: 'Jev judged the goal satisfied' }
		}
		const candidate = candidates.find((item) => item.candidateId === selectedOptionId)
		if (!candidate?.target) return { kind: 'replan', reason: 'Jev selected an unknown candidate' }
		if (candidate.action === 'input') {
			const generated = await this.semanticText.generate(
				{
					purpose: 'input',
					request: input.goal.description,
					conversation: input.session.conversation ?? [],
					field: candidate.semanticLabel,
					page: { url: input.observation.page.url, title: input.observation.page.title },
					actionHistory: history.map(({ action, label }) => ({ action, label })),
				},
				signal
			)
			const text = validateInputText(generated.text)
			this.remember(input, candidate.action, candidate.semanticLabel)
			return {
				kind: 'action',
				candidateId: candidate.candidateId,
				action: {
					type: 'input',
					target: candidate.target,
					text: text as SecretAwareString,
					replace: true,
				},
			}
		}
		if (candidate.action === 'select') {
			const observed = candidate.target
				? observedByLocalId.get(candidate.target.localId)
				: undefined
			const selectOptions = observed?.options ?? []
			if (selectOptions.length === 0)
				return { kind: 'replan', reason: 'The selected control has no native options' }
			const optionDecision = await this.provider.decide(
				{
					requestId: this.nextRequestId(input.observation),
					need: 'generate_value',
					risk: input.need.risk,
					state: {
						goal: truncate(input.goal.description, maxGoalChars),
						field: truncate(candidate.semanticLabel, maxLabelChars),
						url: truncate(input.observation.page.url, 512),
					},
					options: selectOptions.map((option, index) => ({
						id: `select-value:${index}`,
						label: option.label,
					})),
				},
				signal
			)
			const selectedOptionId =
				optionDecision.selectedOptionId ?? optionDecision.answer?.selectedOptionId
			const optionIndex = selectOptions.findIndex(
				(_, index) => selectedOptionId === `select-value:${index}`
			)
			if (optionIndex < 0)
				return { kind: 'replan', reason: optionDecision.reason ?? 'Unable to select a value' }
			this.remember(
				input,
				candidate.action,
				`${candidate.semanticLabel}: ${selectOptions[optionIndex].label}`
			)
			return {
				kind: 'action',
				candidateId: candidate.candidateId,
				action: {
					type: 'select',
					target: candidate.target,
					option: { kind: 'value', value: selectOptions[optionIndex].value },
				},
			}
		}
		this.remember(input, candidate.action, candidate.semanticLabel)
		return {
			kind: 'action',
			candidateId: candidate.candidateId,
			action: { type: candidate.action, target: candidate.target } as BrowserAction,
		}
	}

	private nextRequestId(observation: PageObservation): string {
		this.sequence += 1
		return `jev:${observation.observationId}:${this.sequence}`
	}

	private historyFor(sessionId: string, goalId: string): RecentSelection[] {
		return (this.recentSelections.get(sessionId) ?? []).filter((item) => item.goalId === goalId)
	}

	private remember(
		input: { session: Session; goal: GoalContract; observation: PageObservation },
		action: string,
		label: string
	): void {
		const history = this.historyFor(input.session.sessionId, input.goal.goalId)
		history.push({
			goalId: input.goal.goalId,
			action,
			label: truncate(label, maxLabelChars),
			fromUrl: truncate(input.observation.page.url, 512),
			fromTitle: truncate(input.observation.page.title, 512),
		})
		this.recentSelections.set(input.session.sessionId, history.slice(-maxRecentSelections))
	}
}

const unavailableSemanticText: SemanticTextProvider = {
	async generate() {
		throw new Error('Semantic model provider is not configured')
	},
}

function candidateFor(
	observation: PageObservation,
	action: (typeof candidateOperations)[number],
	element: PageObservation['elements'][number]
): Candidate {
	const args: JsonObject = {
		tagName: element.tagName,
	}
	if (action === 'input') args.valueState = element.valueState ?? 'unknown'
	if (element.attributes.href) args.href = element.attributes.href
	if (element.regionId) args.regionId = element.regionId
	if (element.role) args.role = element.role.toLocaleLowerCase()
	if (element.state?.selected !== undefined) args.selected = element.state.selected
	if (element.state?.expanded !== undefined) args.expanded = element.state.expanded
	if (element.bounds) {
		args.x = Math.round(element.bounds.x)
		args.y = Math.round(element.bounds.y)
	}
	const domOrder = Number(/\d+$/.exec(element.ref.localId)?.[0])
	if (Number.isFinite(domOrder)) args.domOrder = domOrder
	return {
		candidateId: `${observation.observationId}:jev:${action}:${element.ref.localId}`,
		observationId: observation.observationId,
		action,
		target: element.ref,
		args,
		semanticLabel:
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
				.slice(0, maxLabelChars) || `${element.role ?? element.tagName} control`,
		regionId: element.regionId,
		deterministicSignals: [
			{ type: 'visibility', value: element.visible },
			{ type: 'enabled', value: element.enabled },
		],
		risk: { tier: 'R1', reasons: ['candidate generated from the current observation'] },
	}
}

function isCandidateFor(
	element: PageObservation['elements'][number],
	action: (typeof candidateOperations)[number]
): boolean {
	if (!element.visible || !element.enabled) return false
	if (action === 'input') return element.editable
	if (action === 'select') return element.tagName === 'select'
	return (
		element.tagName === 'button' ||
		element.tagName === 'a' ||
		['button', 'link', 'menuitem', 'option', 'tab', 'combobox'].includes(
			element.role?.toLocaleLowerCase() ?? ''
		)
	)
}

function pageState(
	observation: PageObservation,
	candidates: Candidate[],
	history: RecentSelection[]
): JsonValue {
	const observedByLocalId = new Map(
		observation.elements.map((element) => [element.ref.localId, element] as const)
	)
	const elements: JsonObject[] = candidates.map((candidate) => {
		const observed = candidate.target ? observedByLocalId.get(candidate.target.localId) : undefined
		const item: JsonObject = {
			id: candidate.candidateId,
			action: candidate.action,
			label: truncate(candidate.semanticLabel, maxLabelChars),
		}
		if (observed?.tagName) item.tagName = observed.tagName
		if (observed?.role) item.role = observed.role
		if (observed?.valueState) item.valueState = observed.valueState
		const href = candidateStringArg(candidate, 'href')
		if (href) item.href = truncate(href, 500)
		if (candidate.regionId) item.region = candidate.regionId
		const x = candidateNumberArg(candidate, 'x')
		const y = candidateNumberArg(candidate, 'y')
		const domOrder = candidateNumberArg(candidate, 'domOrder')
		if (x !== undefined) item.x = x
		if (y !== undefined) item.y = y
		if (domOrder !== undefined) item.domOrder = domOrder
		if (observed?.state?.selected !== undefined) item.selected = observed.state.selected
		if (observed?.state?.expanded !== undefined) item.expanded = observed.state.expanded
		if (observed?.sensitivity === 'public' && observed.value)
			item.value = truncate(observed.value, maxLabelChars)
		return item
	})
	const state: JsonObject = {
		url: truncate(observation.page.url, 512),
		title: truncate(observation.page.title, 512),
		elements,
	}
	if (history.length > 0) state.recentSelections = historyState(history)

	while (elements.length > 0 && jsonStateBytes(state) > maxPageStateBytes) elements.pop()
	if (jsonStateBytes(state) > maxPageStateBytes) delete state.elements
	return state
}

function shouldJudgeCompletion(history: RecentSelection[], observation: PageObservation): boolean {
	const previous = history.at(-1)
	return Boolean(
		previous &&
		(previous.fromUrl !== observation.page.url || previous.fromTitle !== observation.page.title)
	)
}

function completionState(
	goal: GoalContract,
	observation: PageObservation,
	history: RecentSelection[]
): JsonValue {
	return {
		goal: truncate(goal.description, maxGoalChars),
		currentPage: {
			url: truncate(observation.page.url, 512),
			title: truncate(observation.page.title, 512),
		},
		recentSelections: historyState(history),
	}
}

function historyState(history: RecentSelection[]): JsonValue {
	return history.map((item) => ({
		action: item.action,
		label: item.label,
		fromPage: { url: item.fromUrl, title: item.fromTitle },
	}))
}

function selectCandidatesForJev(allCandidates: Candidate[], goal: string): Candidate[] {
	const ranked = allCandidates
		.map((candidate, index) => ({ candidate, index, score: candidateScore(candidate, goal) }))
		.sort((left, right) => right.score - left.score || left.index - right.index)
	const selected: Candidate[] = []
	const selectedKeys = new Set<string>()
	const reserveKeys = new Set<string>()
	const addCandidate = (candidate: Candidate): boolean => {
		if (selected.length >= maxJevCandidates) return false
		const semanticKey = candidateSemanticKey(candidate)
		if (selectedKeys.has(semanticKey)) return false
		const next = [...selected, candidate]
		const options = next.map((item) => ({
			id: item.candidateId,
			label: `${item.action}: ${item.semanticLabel}`,
		}))
		if (jsonStateBytes(options) > maxJevOptionBytes) return false
		selected.push(candidate)
		selectedKeys.add(semanticKey)
		return true
	}

	// Reserve one representative of each structural function before filling by
	// lexical score. This keeps a sorter or result link available even when a
	// page has hundreds of unrelated navigation controls before its main content.
	for (const { candidate } of ranked) {
		const role = candidateStringArg(candidate, 'role') ?? candidateStringArg(candidate, 'tagName')
		const keys = [
			`operation:${candidate.action}`,
			`role:${candidate.action}:${role}`,
			`region-role:${candidate.action}:${candidate.regionId ?? ''}:${role}`,
		]
		if (keys.some((key) => !reserveKeys.has(key)) && addCandidate(candidate))
			keys.forEach((key) => reserveKeys.add(key))
	}

	for (const { candidate } of ranked) {
		if (selected.length >= maxJevCandidates) break
		if (selected.includes(candidate)) continue
		addCandidate(candidate)
	}
	return selected.slice(0, maxJevCandidates)
}

function activeCandidateScope(candidates: Candidate[]): Candidate[] {
	const modalCandidates = candidates.filter((candidate) => candidate.regionId === 'region:modal')
	return modalCandidates.length > 0 ? modalCandidates : candidates
}

function candidateScore(candidate: Candidate, goal: string): number {
	const label = normalizeSemanticText(candidate.semanticLabel)
	const href = normalizeSemanticText(candidateStringArg(candidate, 'href') ?? '')
	const tokens = tokenize(goal)
	let score = candidate.semanticLabel ? 2 : 0
	const valueState = candidateValueState(candidate)
	if (candidate.action === 'input' && valueState === 'empty') score += 4
	if (candidate.action === 'input' && valueState === 'present') score -= 16
	if (candidate.action === 'select') score += 4
	if (candidateBooleanArg(candidate, 'selected')) score -= 10
	if (candidateStringArg(candidate, 'tagName') === 'a' && href) score += 3
	for (const token of tokens) {
		if (label.includes(token)) score += token.length >= 4 ? 6 : 2
		if (href.includes(token)) score += token.length >= 4 ? 3 : 1
	}
	return score
}

function candidateOptionLabel(
	candidate: Candidate,
	observed?: PageObservation['elements'][number]
): string {
	const state = [
		observed?.valueState ? `value ${observed.valueState}` : undefined,
		observed?.state?.selected === true ? 'already selected' : undefined,
		observed?.state?.expanded === true ? 'expanded' : undefined,
	]
		.filter(Boolean)
		.join(', ')
	const href = candidateStringArg(candidate, 'href')
	const destination = href ? ` -> ${href}` : ''
	const position = candidateNumberArg(candidate, 'y')
	const location = `${candidate.regionId ? ` in ${candidate.regionId}` : ''}${
		position === undefined ? '' : ` at y=${position}`
	}`
	return `${candidate.action}: ${candidate.semanticLabel}${destination}${location}${state ? ` (${state})` : ''}`
}

function candidateSemanticKey(candidate: Candidate): string {
	return `${candidate.action}:${canonicalSemanticLabel(candidate.semanticLabel)}:${candidateValueState(candidate)}`
}

function canonicalSemanticLabel(label: string): string {
	const tokens = tokenize(normalizeSemanticText(label))
	if (tokens.length > 1 && tokens.length % 2 === 0) {
		const half = tokens.length / 2
		if (tokens.slice(0, half).every((token, index) => token === tokens[index + half]))
			return tokens.slice(0, half).join(' ')
	}
	return tokens.join(' ')
}

function normalizeSemanticText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase()
		.replace(/[^\p{L}\d]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function candidateStringArg(candidate: Candidate, name: string): string | undefined {
	if (
		typeof candidate.args !== 'object' ||
		candidate.args === null ||
		Array.isArray(candidate.args)
	)
		return undefined
	const value = candidate.args[name]
	return typeof value === 'string' ? value : undefined
}

function candidateNumberArg(candidate: Candidate, name: string): number | undefined {
	if (
		typeof candidate.args !== 'object' ||
		candidate.args === null ||
		Array.isArray(candidate.args)
	)
		return undefined
	const value = candidate.args[name]
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function candidateBooleanArg(candidate: Candidate, name: string): boolean | undefined {
	if (
		typeof candidate.args !== 'object' ||
		candidate.args === null ||
		Array.isArray(candidate.args)
	)
		return undefined
	const value = candidate.args[name]
	return typeof value === 'boolean' ? value : undefined
}

function candidateValueState(candidate: Candidate): string {
	if (
		typeof candidate.args !== 'object' ||
		candidate.args === null ||
		Array.isArray(candidate.args)
	)
		return ''
	const value = candidate.args.valueState
	return typeof value === 'string' ? value : ''
}

function reversibleCandidateSelection(
	result: JevDecisionResult,
	candidates: Candidate[],
	risk: DecisionNeed['risk']
): string | undefined {
	if (risk !== 'R0' && risk !== 'R1') return undefined
	const selected = result.answer?.selectedOptionId
	return selected && candidates.some((candidate) => candidate.candidateId === selected)
		? selected
		: undefined
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
				state: { request: truncate(input.request, maxGoalChars) },
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

function tokenize(value: string): string[] {
	return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\d]{3,}/gu) ?? [])]
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value
	const edgeLength = Math.floor((maxLength - 1) / 2)
	return `${value.slice(0, edgeLength)}…${value.slice(-edgeLength)}`
}
