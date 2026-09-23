import type { PageObservation } from '@page-agent/browser'
import type { DecisionResult, GoalContract, Session } from '@page-agent/runtime'
import { describe, expect, it } from 'vitest'

import { JevDecisionProvider } from './JevDecisionProvider'
import {
	JevDecisionRouter,
	JevTaskRouter,
	validateHttpUrl,
	validateInputText,
} from './JevDecisionRouter'
import { MockJevTransport } from './transports'
import { type JevRequest, JevTransportError } from './types'

const goal: GoalContract = {
	goalId: 'goal-1',
	description: 'open the second item and publish a comment',
	required: true,
	outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'posted' } },
	status: 'active',
	evidenceIds: [],
}
const session: Session = {
	sessionId: 'session-1',
	owner: { kind: 'in_page', ownerId: 'owner-1' },
	task: {
		taskId: 'task-1',
		request: goal.description,
		goals: [goal],
		constraints: [],
		allowedCapabilities: ['dom.read', 'dom.write'],
		completionPolicy: 'all_required',
		createdAt: '2026-09-19T10:00:00.000Z',
	},
	status: 'running',
	revision: 1,
	budgets: {
		maxSteps: 20,
		maxElapsedMs: 10_000,
		maxActions: 20,
		maxConsecutiveNoProgress: 3,
		maxProviderCalls: {},
		maxRetriesPerErrorCode: {},
		maxTabs: 2,
	},
	browserScope: { ownedTabIds: [], maxTabs: 2, allowedOrigins: [] },
	createdAt: '2026-09-19T10:00:00.000Z',
	updatedAt: '2026-09-19T10:00:00.000Z',
}
function element(
	index: number,
	label: string,
	actions: ('click' | 'input' | 'select')[] = ['click']
): PageObservation['elements'][number] {
	return {
		ref: {
			kind: 'element',
			sessionId: 'session-1',
			tabId: 'tab-1',
			documentId: 'document-1',
			observationId: 'observation-1',
			revision: 1,
			localId: `index:${index}`,
			fingerprint: `fnv1a:${index}`,
		},
		tagName: actions.includes('input') ? 'input' : 'button',
		accessibleName: label,
		text: label,
		visible: true,
		enabled: true,
		editable: actions.includes('input'),
		attributes: {},
		sensitivity: 'public',
		supportedActions: actions,
		bounds: { x: 10, y: index * 10, width: 100, height: 20 },
	}
}
const observation: PageObservation = {
	observationId: 'observation-1',
	sessionId: 'session-1',
	tabId: 'tab-1',
	documentId: 'document-1',
	revision: 1,
	capturedAt: '2026-09-19T10:00:00.000Z',
	page: { url: 'https://example.test', title: 'Example', origin: 'https://example.test' },
	viewport: {
		width: 1280,
		height: 720,
		scrollX: 0,
		scrollY: 0,
		documentWidth: 1280,
		documentHeight: 720,
	},
	regions: [],
	elements: [element(0, 'Save')],
	signals: [],
	sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
}
const need = {
	kind: 'select_candidate' as const,
	closedWorld: true,
	computable: false,
	risk: 'R1' as const,
	requiredCapabilities: ['dom.write'],
}
function provider(transport: MockJevTransport): JevDecisionProvider {
	return new JevDecisionProvider({ model: 'jev-test', transport, telemetry: 'off' })
}
function response(request: JevRequest, selectedOptionId: string, completion = 0.1) {
	return {
		requestId: request.requestId,
		answers: request.questions.map((question) =>
			question.questionId === 'completion'
				? { questionId: question.questionId, value: completion }
				: { questionId: question.questionId, selectedOptionId, confidence: 0.05 }
		),
	}
}
function choose(target: string): MockJevTransport {
	return new MockJevTransport((request) => response(request, target))
}
function executed(current: Session, decision: DecisionResult): Session {
	if (decision.kind !== 'action' || !decision.selection) throw new Error('Expected action')
	return {
		...current,
		actionJournal: [
			...(current.actionJournal ?? []),
			{
				actionId: 'action-1',
				workItemId: goal.goalId,
				action: decision.action!.type,
				label: decision.selection.label,
				selection: decision.selection,
				status: 'executed',
				observationId: observation.observationId,
				completedAt: observation.capturedAt,
			},
		],
	}
}

describe('JevDecisionRouter concrete transition selection', () => {
	it('validates semantic values before execution', () => {
		expect(validateHttpUrl('https://example.test/path')).toBe('https://example.test/path')
		for (const value of [
			'javascript:alert(1)',
			'file:///tmp/x',
			'https://user:secret@example.test',
			'not a url',
		])
			expect(() => validateHttpUrl(value)).toThrow()
		expect(() => validateInputText('   ')).toThrow()
	})

	it('selects among concrete actions in one Jev request', async () => {
		const elements = [element(0, 'Search', ['input']), element(1, 'Save'), element(2, 'Publish')]
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].questionId).toBe('transition')
			expect(request.questions[0].options?.map((item) => item.id)).toEqual([
				'observation-1:jev:input:index:0',
				'observation-1:jev:click:index:1',
				'observation-1:jev:click:index:2',
			])
			return response(request, 'observation-1:jev:click:index:2')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation: { ...observation, elements }, need },
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'action',
			action: { type: 'click', target: { localId: 'index:2' } },
			diagnostics: { operation: 'click', requestCount: 1 },
		})
		expect(transport.requests).toHaveLength(1)
	})

	it('preserves duplicate labels and collection positions in the target judgment', async () => {
		const elements = [0, 1].map((index) => ({
			...element(index, 'Open'),
			collectionItem: {
				collectionId: 'videos',
				itemId: `video-${index}`,
				position: index + 1,
				text: `Video ${index + 1}`,
			},
		}))
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options?.map((item) => item.label)).toEqual([
				expect.stringContaining('collection item 1'),
				expect.stringContaining('collection item 2'),
			])
			return response(request, 'observation-1:jev:click:index:1')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation: { ...observation, elements }, need },
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ target: { localId: 'index:1' } })
	})

	it('restricts a blocking modal to its controls', async () => {
		const modal = { ...element(1, 'Oldest'), regionId: 'dialog:sort' }
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options?.map((item) => item.id)).toEqual([
				'observation-1:jev:click:index:1',
			])
			return response(request, 'observation-1:jev:click:index:1')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: {
					...observation,
					regions: [{ regionId: 'dialog:sort', kind: 'modal', elementIds: [modal.ref.localId] }],
					elements: [element(0, 'Behind dialog'), modal],
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ target: { localId: 'index:1' } })
	})

	it('does not offer a filled editor for input again when a publish control is available', async () => {
		const editor = { ...element(0, 'Comment', ['input', 'click']), valueState: 'present' as const }
		const firstSession: Session = {
			...session,
			actionJournal: [
				{
					actionId: 'filled',
					workItemId: goal.goalId,
					action: 'input',
					label: 'input Comment',
					selection: {
						action: 'input',
						label: 'input Comment',
						candidateSignature: 'draft',
						observationSignature: 'before-input',
						page: observation.page,
						targetLocalId: editor.ref.localId,
						documentId: observation.documentId,
					},
					status: 'executed',
					observationId: observation.observationId,
					completedAt: observation.capturedAt,
				},
			],
		}
		const transport = choose('observation-1:jev:click:index:1')
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session: firstSession,
				goal,
				observation: { ...observation, elements: [editor, element(1, 'Publish')] },
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'click', target: { localId: 'index:1' } })
	})

	it('uses a target Choice for 254 targets and an exhaustive Noul fan-out above that', async () => {
		for (const size of [254, 274]) {
			const elements = Array.from({ length: size }, (_, index) =>
				element(index, `Control ${index}`)
			)
			const transport = new MockJevTransport((request) => {
				if (size === 254) {
					expect(request.questions).toHaveLength(1)
					expect(request.questions[0].options).toHaveLength(size)
					return response(request, `observation-1:jev:click:index:${size - 1}`)
				}
				expect(request.questions).toHaveLength(size)
				expect(request.questions.every((question) => question.primitive === 'noul')).toBe(true)
				return {
					requestId: request.requestId,
					answers: request.questions.map((question) => ({
						questionId: question.questionId,
						value: question.questionId === `candidate:${size - 1}` ? 0.99 : 0.1,
					})),
				}
			})
			const result = await new JevDecisionRouter(provider(transport)).decide(
				{ session, goal, observation: { ...observation, elements }, need },
				new AbortController().signal
			)
			expect(result.action).toMatchObject({ target: { localId: `index:${size - 1}` } })
			expect(transport.requests).toHaveLength(1)
		}
	})

	it('splits target Noul questions sequentially on context overflow without dropping targets', async () => {
		const elements = Array.from({ length: 255 }, (_, index) => element(index, `Control ${index}`))
		const transport = new MockJevTransport((request) => {
			if (request.questions.length > 8)
				throw new JevTransportError('CONTEXT_LIMIT', 'max_tokens_exceeded', false)
			return {
				requestId: request.requestId,
				answers: request.questions.map((question) => ({
					questionId: question.questionId,
					value: question.questionId === 'candidate:254' ? 0.99 : 0.1,
				})),
			}
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation: { ...observation, elements }, need },
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ target: { localId: 'index:254' } })
		const evaluated = transport.requests.flatMap((request) =>
			request.questions.length <= 8 && request.questions[0].primitive === 'noul'
				? request.questions.map((question) => question.questionId)
				: []
		)
		expect(evaluated).toEqual(Array.from({ length: 255 }, (_, index) => `candidate:${index}`))
	})

	it('selects input and native select values only after choosing the concrete action', async () => {
		const field = { ...element(0, 'Search', ['input']), valueState: 'empty' as const }
		const inputTransport = choose('observation-1:jev:input:index:0')
		const inputResult = await new JevDecisionRouter(provider(inputTransport), {
			generate: async () => ({ text: 'ルーカス・モンターノ' }),
		}).decide(
			{ session, goal, observation: { ...observation, elements: [field] }, need },
			new AbortController().signal
		)
		expect(inputResult.action).toMatchObject({ type: 'input', text: 'ルーカス・モンターノ' })
		const select = {
			...element(0, 'Sort', ['select']),
			tagName: 'select',
			options: [
				{ label: 'Newest', value: 'new', selected: true },
				{ label: 'Oldest', value: 'old', selected: false },
			],
		}
		const selectTransport = choose('observation-1:jev:select:index:0:option:1')
		const selectResult = await new JevDecisionRouter(provider(selectTransport)).decide(
			{ session, goal, observation: { ...observation, elements: [select] }, need },
			new AbortController().signal
		)
		expect(selectResult.action).toMatchObject({
			type: 'select',
			option: { kind: 'value', value: 'old' },
		})
	})

	it('opens a tab with one Jev request and delegates only URL generation', async () => {
		const tabsSession: Session = {
			...session,
			task: { ...session.task, allowedCapabilities: ['dom.read', 'dom.write', 'tabs.write'] },
		}
		const transport = choose('observation-1:jev:tab.open')
		const result = await new JevDecisionRouter(provider(transport), {
			generate: async () => ({ url: 'https://unregistered.example/path' }),
		}).decide(
			{
				session: tabsSession,
				goal,
				observation: { ...observation, elements: [], tabId: 'unbound' },
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toEqual({ type: 'tab.open', url: 'https://unregistered.example/path' })
		expect(transport.requests).toHaveLength(1)
	})

	it('uses the complete task for navigation while retaining the narrow work item for verification', async () => {
		const tabsSession: Session = {
			...session,
			task: { ...session.task, allowedCapabilities: ['dom.read', 'dom.write', 'tabs.write'] },
			plan: {
				version: 1,
				canonicalGoal: 'Open the second oldest video, like it and publish a comment',
				originalLanguage: 'en',
				missingInputs: [],
				workItems: [],
				coverage: [],
				deliverable: '',
				externalActions: [],
			},
		}
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].state).toMatchObject({
				currentGoal: tabsSession.plan?.canonicalGoal,
				currentWorkItem: 'read_title',
			})
			return response(request, 'observation-1:jev:tab.open')
		})
		let textRequest = ''
		const result = await new JevDecisionRouter(provider(transport), {
			generate: async (input) => {
				textRequest = input.request
				return { url: 'https://example.test' }
			},
		}).decide(
			{
				session: tabsSession,
				goal: { ...goal, description: 'read_title' },
				observation: { ...observation, elements: [], tabId: 'unbound' },
				need,
			},
			new AbortController().signal
		)
		expect(result.kind).toBe('action')
		expect(textRequest).toBe(tabsSession.plan?.canonicalGoal)
	})

	it('offers a newly available control in the concrete action judgment', async () => {
		const controls = Array.from({ length: 100 }, (_, index) =>
			element(index, `Other control ${index}`)
		)
		controls.push(element(100, 'Publish comment'))
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].state).toMatchObject({
				page: { offViewportControls: { above: 0, below: 1 } },
				observedAfterLastAction: {
					afterAction: 'input',
					controls: [{ localId: 'index:100', label: 'Publish comment', change: 'appeared' }],
				},
			})
			expect(request.questions[0].options).toContainEqual(
				expect.objectContaining({ id: `${observation.observationId}:jev:click:index:100` })
			)
			return response(request, `${observation.observationId}:jev:click:index:100`)
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: {
					...observation,
					elements: controls,
					metadata: { offViewportControls: { above: 0, below: 1 } },
				},
				changes: {
					afterAction: 'input',
					controls: [
						{
							localId: 'index:100',
							label: 'Publish comment',
							change: 'appeared',
							actions: ['click'],
						},
					],
					viewportChanged: false,
					pageChanged: false,
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'click', target: { localId: 'index:100' } })
		expect(transport.requests).toHaveLength(1)
	})

	it('lets Jev select scroll direction after selecting scroll', async () => {
		const transport = choose('observation-1:jev:scroll:down')
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: {
					...observation,
					viewport: { ...observation.viewport, documentHeight: 2200 },
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toEqual({
			type: 'scroll',
			axis: 'y',
			amount: { kind: 'pages', value: 1 },
		})
	})

	it('offers scrolling toward a named off-viewport control after filling an editor', async () => {
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].state).toMatchObject({
				observedAfterLastAction: { afterAction: 'input', submission: 'draft' },
				page: {
					offViewportControls: {
						below: 1,
						nextScrollTargets: [{ direction: 'down', label: 'Publish comment', distancePx: 40 }],
					},
				},
			})
			expect(request.questions[0].options).toContainEqual(
				expect.objectContaining({ label: expect.stringContaining('Publish comment') })
			)
			return response(request, 'observation-1:jev:scroll:down')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: {
					...observation,
					viewport: { ...observation.viewport, documentHeight: 2200 },
					metadata: {
						offViewportControls: {
							above: 0,
							below: 1,
							nextScrollTargets: [{ direction: 'down', label: 'Publish comment', distancePx: 40 }],
						},
					},
				},
				changes: {
					afterAction: 'input',
					controls: [],
					viewportChanged: false,
					pageChanged: false,
					submission: 'draft',
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'scroll', axis: 'y', amount: { kind: 'pages' } })
		if (result.action?.type !== 'scroll') throw new Error('Expected scroll')
		expect(result.action.amount.value).toBeCloseTo(220 / 720)
		expect(720 + 40 - result.action.amount.value * 720).toBeGreaterThan(0)
		expect(720 + 40 - result.action.amount.value * 720).toBeLessThan(720)
		expect(transport.requests).toHaveLength(1)
	})

	it('shows an offscreen submit control as a concrete scroll option in one judgment', async () => {
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].state).toMatchObject({
				observedAfterLastAction: { submission: 'draft' },
				page: { offViewportControls: {
					nextScrollTargets: [{ direction: 'down', label: 'Publish comment' }],
				} },
			})
			return response(request, 'observation-1:jev:scroll:down')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: {
					...observation,
					viewport: { ...observation.viewport, documentHeight: 2200 },
					metadata: {
						offViewportControls: {
							above: 0,
							below: 1,
							nextScrollTargets: [{ direction: 'down', label: 'Publish comment', distancePx: 40 }],
						},
					},
				},
				changes: {
					afterAction: 'input',
					controls: [],
					viewportChanged: false,
					pageChanged: false,
					submission: 'draft',
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'scroll', axis: 'y', amount: { kind: 'pages' } })
		if (result.action?.type !== 'scroll') throw new Error('Expected scroll')
		expect(result.action.amount.value).toBeCloseTo(220 / 720)
		expect(result.diagnostics?.requestCount).toBe(1)
		expect(transport.requests).toHaveLength(1)
	})

	it('reconsiders a previously viewed area after input creates an offscreen control', async () => {
		const scrollHistory: Session['actionJournal'] = [0, 1440].map((scrollY, index) => ({
			actionId: `scroll-${index}`,
			workItemId: goal.goalId,
			action: 'scroll',
			label: 'scroll',
			selection: {
				action: 'scroll',
				label: 'scroll',
				candidateSignature: `scroll-${index}`,
				observationSignature: `old-${index}`,
				page: observation.page,
				viewport: { scrollY, height: 720 },
			},
			status: 'executed',
			observationId: `old-${index}`,
			completedAt: observation.capturedAt,
		}))
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].state).toMatchObject({
				observedAfterLastAction: { submission: 'draft' },
				page: { offViewportControls: {
					nextScrollTargets: [{ direction: 'down', label: 'Publish comment' }],
				} },
			})
			return response(request, 'observation-1:jev:scroll:down')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session: { ...session, actionJournal: scrollHistory },
				goal,
				observation: {
					...observation,
					viewport: { ...observation.viewport, scrollY: 720, documentHeight: 2200 },
					metadata: {
						offViewportControls: {
							above: 0,
							below: 1,
							nextScrollTargets: [
								{ direction: 'down', label: 'Publish comment', distancePx: 40 },
							],
						},
					},
				},
				changes: {
					afterAction: 'input',
					controls: [],
					viewportChanged: false,
					pageChanged: false,
					submission: 'draft',
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'scroll', axis: 'y' })
		expect(transport.requests).toHaveLength(1)
	})

	it('offers a newly enabled control without a separate operation choice', async () => {
		const transport = choose('observation-1:jev:click:index:1')
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: { ...observation, elements: [element(0, 'Other'), element(1, 'Publish')] },
				changes: {
					afterAction: 'input',
					controls: [
						{ localId: 'index:1', label: 'Publish', change: 'enabled', actions: ['click'] },
					],
					viewportChanged: false,
					pageChanged: false,
					submission: 'draft',
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'click', target: { localId: 'index:1' } })
		expect(transport.requests).toHaveLength(1)
	})

	it('places an active toggle state before its target label', async () => {
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options).toContainEqual(
				expect.objectContaining({
					id: 'observation-1:jev:click:index:0',
					label: expect.stringMatching(/^\[pressed=true\] click /),
				})
			)
			return response(request, 'observation-1:jev:click:index:1')
		})
		const active = element(0, 'Toggle favorite')
		active.state = { visible: true, enabled: true, editable: false, pressed: true }
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: { ...observation, elements: [active, element(1, 'Continue')] },
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'click', target: { localId: 'index:1' } })
	})

	it('offers unexplored page areas in the concrete action choice', async () => {
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].state).toMatchObject({
				page: { offViewportControls: { below: 1 } },
			})
			return response(request, 'observation-1:jev:scroll:down')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: {
					...observation,
					viewport: { ...observation.viewport, documentHeight: 2200 },
					metadata: {
						offViewportControls: {
							above: 0,
							below: 1,
							nextScrollTargets: [
								{ direction: 'down', label: 'Comment field', distancePx: 40 },
							],
						},
					},
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'scroll', axis: 'y' })
		expect(transport.requests).toHaveLength(1)
	})

	it('marks a scroll back to an observed viewport as a return, not new discovery', async () => {
		const scrolledSession: Session = {
			...session,
			actionJournal: [
				{
					actionId: 'scroll-1',
					workItemId: goal.goalId,
					action: 'scroll',
					label: 'scroll down',
					selection: {
						action: 'scroll',
						label: 'scroll down',
						candidateSignature: 'previous-scroll',
						observationSignature: 'before-scroll',
						page: observation.page,
						viewport: { scrollY: 0, height: 720 },
					},
					status: 'executed',
					observationId: observation.observationId,
					completedAt: observation.capturedAt,
				},
			],
		}
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options).toContainEqual(
				expect.objectContaining({
					id: 'observation-1:jev:scroll:up',
					label: expect.stringContaining('previously observed content'),
				})
			)
			return response(request, 'observation-1:jev:scroll:up')
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session: scrolledSession,
				goal,
				observation: {
					...observation,
					viewport: { ...observation.viewport, scrollY: 720, documentHeight: 2200 },
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({ type: 'scroll', amount: { value: -1 } })
	})

	it('blocks once when no concrete action is suitable', async () => {
		const transport = new MockJevTransport((request) => response(request, 'none_of_the_above'))
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation, need },
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'blocked',
			diagnostics: { selectedTransition: 'none', requestCount: 1 },
		})
		expect(transport.requests).toHaveLength(1)
	})

	it('does not retry another question after none', async () => {
		const transport = choose('none_of_the_above')
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation, need },
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'blocked',
			diagnostics: { requestCount: 1, candidateCount: 1 },
		})
		expect(transport.requests).toHaveLength(1)
	})

	it('selects input directly when a click is also available', async () => {
		const elements = [element(0, 'Search', ['input']), element(1, 'Save')]
		const transport = new MockJevTransport((request) => {
			const question = request.questions[0]
			expect(question.options?.map((item) => item.id)).toEqual([
				'observation-1:jev:input:index:0',
				'observation-1:jev:click:index:1',
			])
			return response(request, 'observation-1:jev:input:index:0')
		})
		const result = await new JevDecisionRouter(provider(transport), {
			generate: async () => ({ text: 'query' }),
		}).decide(
			{ session, goal, observation: { ...observation, elements }, need },
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'action',
			action: { type: 'input' },
			diagnostics: { requestCount: 1 },
		})
		expect(transport.requests).toHaveLength(1)
	})

	it('checks completion in parallel with concrete action selection after observed change', async () => {
		const transport = choose('observation-1:jev:click:index:0')
		const router = new JevDecisionRouter(provider(transport))
		const first = await router.decide(
			{ session, goal, observation, need },
			new AbortController().signal
		)
		const after = executed(session, first)
		const completionTransport = new MockJevTransport((request) => {
			expect(request.questions.map((question) => question.questionId)).toEqual([
				'transition',
				'completion',
			])
			return response(request, 'observation-1:jev:click:index:0', 0.99)
		})
		const second = await new JevDecisionRouter(provider(completionTransport)).decide(
			{
				session: after,
				goal,
				observation: { ...observation, page: { ...observation.page, title: 'Posted' } },
				need,
			},
			new AbortController().signal
		)
		expect(second.kind).toBe('goal_satisfied')
		expect(completionTransport.requests).toHaveLength(1)
	})

	it('does not retry executed candidates in an unchanged state', async () => {
		const transport = choose('observation-1:jev:click:index:0')
		const router = new JevDecisionRouter(provider(transport))
		const first = await router.decide(
			{ session, goal, observation, need },
			new AbortController().signal
		)
		const result = await router.decide(
			{ session: executed(session, first), goal, observation, need },
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'blocked',
			reason: expect.stringContaining('already been executed'),
		})
		expect(transport.requests).toHaveLength(1)
	})
})

describe('JevTaskRouter', () => {
	it('routes a greeting without observing the DOM', async () => {
		const transport = new MockJevTransport((request) => response(request, 'task:conversation'))
		await expect(
			new JevTaskRouter(provider(transport)).route(
				{ session, request: 'oi' },
				new AbortController().signal
			)
		).resolves.toBe('conversation')
	})
})
