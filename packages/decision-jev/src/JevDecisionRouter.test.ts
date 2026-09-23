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
import { SeedThresholdPolicy } from './gates'
import { MockJevTransport } from './transports'
import { type JevRequest, JevTransportError } from './types'

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

const goal: GoalContract = {
	goalId: 'goal-1',
	description: 'save the form',
	required: true,
	outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'saved' } },
	status: 'active',
	evidenceIds: [],
}

const session = {
	sessionId: 'session-1',
	owner: { kind: 'in_page' as const, ownerId: 'owner-1' },
	task: {
		taskId: 'task-1',
		request: 'save the form',
		goals: [goal],
		constraints: [],
		allowedCapabilities: ['dom.read', 'dom.write'] as const,
		completionPolicy: 'all_required' as const,
		createdAt: '2026-09-19T10:00:00.000Z',
	},
	status: 'running' as const,
	revision: 1,
	budgets: {
		maxSteps: 10,
		maxElapsedMs: 10_000,
		maxActions: 10,
		maxConsecutiveNoProgress: 3,
		maxProviderCalls: {},
		maxRetriesPerErrorCode: {},
		maxTabs: 1,
	},
	browserScope: { ownedTabIds: [], maxTabs: 1, allowedOrigins: [] },
	createdAt: '2026-09-19T10:00:00.000Z',
	updatedAt: '2026-09-19T10:00:00.000Z',
} satisfies Session

function element(index: number, label: string): PageObservation['elements'][number] {
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
		tagName: 'button',
		accessibleName: label,
		text: label,
		visible: true,
		enabled: true,
		editable: false,
		attributes: {},
		sensitivity: 'public',
		supportedActions: ['click'],
		bounds: { x: 10, y: index * 10, width: 100, height: 20 },
	}
}

function provider(transport: MockJevTransport): JevDecisionProvider {
	return new JevDecisionProvider({
		model: 'jev-test',
		transport,
		thresholds: new SeedThresholdPolicy(),
		telemetry: 'off',
	})
}

function choiceResponse(request: JevRequest, candidateId: string, confidence = 0.99) {
	return {
		requestId: request.requestId,
		answers: request.questions.map((question) => ({
			questionId: question.questionId,
			selectedOptionId: candidateId,
			confidence,
		})),
	}
}

const need = {
	kind: 'select_candidate' as const,
	closedWorld: true,
	computable: false,
	risk: 'R1' as const,
	requiredCapabilities: ['dom.write'],
}

function withExecutedAction(current: Session, decision: DecisionResult): Session {
	if (decision.kind !== 'action' || !decision.selection) throw new Error('Expected selected action')
	return {
		...current,
		actionJournal: [
			...(current.actionJournal ?? []),
			{
				actionId: `action-${(current.actionJournal?.length ?? 0) + 1}`,
				workItemId: goal.goalId,
				action: decision.action?.type ?? 'click',
				label: decision.selection.label,
				selection: decision.selection,
				status: 'executed',
				observationId: decision.candidateId?.split(':')[0] ?? '',
				completedAt: '2026-09-19T10:00:00.000Z',
			},
		],
	}
}

describe('JevDecisionRouter', () => {
	it('rejects unsafe semantic values before execution', () => {
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

	it('uses one Choice for 254 actions and reserves the remaining option for none', async () => {
		const elements = Array.from({ length: 254 }, (_, index) => element(index, `Control ${index}`))
		const selectedId = 'observation-1:jev:click:index:253'
		const transport = new MockJevTransport((request) => {
			expect(request.questions).toHaveLength(1)
			expect(request.questions[0]).toMatchObject({ primitive: 'choice', allowNone: true })
			expect(request.questions[0].options).toHaveLength(254)
			expect(request.questions[0].options?.at(-1)?.id).toBe(selectedId)
			return choiceResponse(request, selectedId)
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation: { ...observation, elements }, need },
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'action',
			candidateId: selectedId,
			selection: { label: 'click Control 253' },
			action: { type: 'click', target: { localId: 'index:253' } },
		})
		expect(transport.requests).toHaveLength(1)
	})

	it('recovers from a Choice context overflow by evaluating every candidate in smaller Noul batches', async () => {
		const elements = Array.from({ length: 200 }, (_, index) => element(index, `Control ${index}`))
		const transport = new MockJevTransport((request) => {
			if (request.questions[0].primitive === 'choice')
				throw new JevTransportError('CONTEXT_LIMIT', 'max_tokens_exceeded', false)
			if (request.questions.length > 8)
				throw new JevTransportError('CONTEXT_LIMIT', 'max_tokens_exceeded', false)
			return {
				requestId: request.requestId,
				answers: request.questions.map((question) => ({
					questionId: question.questionId,
					value: question.questionId === 'candidate:199' ? 0.99 : 0.1,
				})),
			}
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation: { ...observation, elements }, need },
			new AbortController().signal
		)
		expect(result).toMatchObject({ kind: 'action', action: { target: { localId: 'index:199' } } })
		const evaluated = transport.requests.flatMap((request) =>
			request.questions.length <= 8 && request.questions[0].primitive === 'noul'
				? request.questions.map((question) => question.questionId)
				: []
		)
		expect(evaluated).toEqual(Array.from({ length: 200 }, (_, index) => `candidate:${index}`))
	})

	it('evaluates every Noul candidate without duplicating the option list in state', async () => {
		const elements = Array.from({ length: 274 }, (_, index) =>
			element(index, index === 273 ? 'Gostei' : `Control ${index}`)
		)
		const transport = new MockJevTransport((request) => {
			expect(request.questions).toHaveLength(274)
			expect(request.questions.every((question) => question.primitive === 'noul')).toBe(true)
			expect(request.questions[0].state).toMatchObject({
				originalRequest: 'save the form',
				currentGoal: 'Like the second oldest video',
			})
			expect(request.questions[0].state).not.toHaveProperty('candidates')
			return {
				requestId: request.requestId,
				answers: request.questions.map((question) => ({
					questionId: question.questionId,
					value: question.questionId === 'candidate:273' ? 0.98 : 0.1,
					confidence: 0.9,
				})),
			}
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal: { ...goal, description: 'Like the second oldest video' },
				observation: { ...observation, elements },
				need,
			},
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'action',
			action: { type: 'click', target: { localId: 'index:273' } },
		})
		expect(transport.requests.flatMap((request) => request.questions)).toHaveLength(274)
		expect(transport.requests).toHaveLength(1)
	})

	it('does not merge controls with identical labels at different positions', async () => {
		const selectedId = 'observation-1:jev:click:index:1'
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options).toEqual([
				expect.objectContaining({ id: 'observation-1:jev:click:index:0' }),
				expect.objectContaining({ id: selectedId }),
			])
			return choiceResponse(request, selectedId)
		})
		await expect(
			new JevDecisionRouter(provider(transport)).decide(
				{
					session,
					goal,
					observation: {
						...observation,
						elements: [element(0, 'Like'), element(1, 'Like')],
					},
					need,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ action: { target: { localId: 'index:1' } } })
	})

	it('exposes collection positions and context to the action judgment', async () => {
		const selectedId = 'observation-1:jev:click:index:1'
		const transport = new MockJevTransport((request) => {
			const options = request.questions[0].options
			expect(options?.[0]).toMatchObject({
				label: expect.stringContaining('collection item 1:'),
			})
			expect(options?.[1]).toMatchObject({
				id: selectedId,
				label: expect.stringContaining('collection item 2:'),
			})
			return choiceResponse(request, selectedId)
		})
		const elements = [element(0, 'Open'), element(1, 'Open')].map((item, index) => ({
			...item,
			collectionItem: {
				collectionId: 'videos',
				itemId: `video-${index + 1}`,
				position: index + 1,
				text: `Video ${index + 1} by the channel`,
			},
		}))
		await expect(
			new JevDecisionRouter(provider(transport)).decide(
				{ session, goal, observation: { ...observation, elements }, need },
				new AbortController().signal
			)
		).resolves.toMatchObject({ action: { target: { localId: 'index:1' } } })
	})

	it('selects a publish control after a successfully filled editor without offering input again', async () => {
		const editor = {
			...element(0, 'Write a message'),
			tagName: 'div',
			editable: true,
			valueState: 'present' as const,
			supportedActions: ['input' as const, 'click' as const],
		}
		const publish = element(1, 'Publish')
		const selectedId = 'observation-2:jev:click:index:1'
		const transport = new MockJevTransport((request) => {
			const options = request.questions.find(
				(question) => question.questionId === 'action'
			)?.options
			expect(options?.map((option) => option.id)).toEqual([
				'observation-2:jev:click:index:0',
				selectedId,
			])
			return {
				requestId: request.requestId,
				answers: request.questions.map((question) =>
					question.questionId === 'completion'
						? { questionId: question.questionId, value: 0.1 }
						: { questionId: question.questionId, selectedOptionId: selectedId, confidence: 0.99 }
				),
			}
		})
		const filledSession: Session = {
			...session,
			actionJournal: [
				{
					actionId: 'fill-editor',
					workItemId: goal.goalId,
					action: 'input',
					label: 'input Write a message',
					selection: {
						action: 'input',
						label: 'input Write a message',
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
		const decision = await new JevDecisionRouter(provider(transport)).decide(
			{
				session: filledSession,
				goal,
				observation: {
					...observation,
					observationId: 'observation-2',
					elements: [editor, publish],
				},
				need,
			},
			new AbortController().signal
		)
		expect(decision.kind, decision.reason).toBe('action')
		expect(decision).toMatchObject({ action: { type: 'click', target: publish.ref } })
	})

	it('uses supportedActions as the structural source of truth', async () => {
		const input = {
			...element(0, 'Search'),
			tagName: 'div',
			editable: false,
			supportedActions: ['input' as const],
			valueState: 'empty' as const,
		}
		const selectedId = 'observation-1:jev:input:index:0'
		const transport = new MockJevTransport((request) => choiceResponse(request, selectedId))
		const result = await new JevDecisionRouter(provider(transport), {
			generate: async () => ({ text: 'ルーカス・モンターノ' }),
		}).decide(
			{ session, goal, observation: { ...observation, elements: [input] }, need },
			new AbortController().signal
		)
		expect(result.action).toMatchObject({
			type: 'input',
			text: 'ルーカス・モンターノ',
			replace: true,
		})
	})

	it('represents every native select option as a complete action', async () => {
		const select = {
			...element(0, 'Sort'),
			tagName: 'select',
			supportedActions: ['select' as const],
			options: [
				{ label: 'Newest', value: 'new', selected: true },
				{ label: 'Oldest', value: 'old', selected: false },
			],
		}
		const selectedId = 'observation-1:jev:select:index:0:option:1'
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options).toEqual([
				expect.objectContaining({ id: selectedId, label: expect.stringContaining('Oldest') }),
			])
			return choiceResponse(request, selectedId)
		})
		const result = await new JevDecisionRouter(provider(transport)).decide(
			{ session, goal, observation: { ...observation, elements: [select] }, need },
			new AbortController().signal
		)
		expect(result.action).toMatchObject({
			type: 'select',
			option: { kind: 'value', value: 'old' },
		})
		expect(transport.requests).toHaveLength(1)
	})

	it('offers scroll candidates for unobserved viewport areas', async () => {
		const selectedId = 'observation-1:jev:scroll:down'
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options).toContainEqual(
				expect.objectContaining({ id: selectedId })
			)
			return choiceResponse(request, selectedId)
		})
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

	it('restricts a blocking modal to its own controls', async () => {
		const modal = { ...element(1, 'Oldest'), regionId: 'dialog:sort' }
		const selectedId = 'observation-1:jev:click:index:1'
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options).toEqual([expect.objectContaining({ id: selectedId })])
			return choiceResponse(request, selectedId)
		})
		await new JevDecisionRouter(provider(transport)).decide(
			{
				session,
				goal,
				observation: {
					...observation,
					regions: [{ regionId: 'dialog:sort', kind: 'modal', elementIds: [modal.ref.localId] }],
					elements: [element(0, 'Behind dialog'), modal],
					viewport: { ...observation.viewport, documentHeight: 2200 },
				},
				need,
			},
			new AbortController().signal
		)
	})

	it('opens arbitrary destinations without a DOM and delegates only the URL text', async () => {
		const candidateId = 'observation-1:jev:tab.open'
		const tabsSession = {
			...session,
			task: { ...session.task, allowedCapabilities: ['dom.read', 'dom.write', 'tabs.write'] },
		} satisfies Session
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0]).toMatchObject({
				primitive: 'choice',
				allowNone: true,
				options: [
					expect.objectContaining({
						id: candidateId,
						label: expect.stringContaining('semantic model derives the destination URL'),
					}),
				],
			})
			return choiceResponse(request, candidateId)
		})
		const result = await new JevDecisionRouter(provider(transport), {
			generate: async () => ({ url: 'https://unregistered.example/path' }),
		}).decide(
			{
				session: { ...tabsSession, browserScope: { ...tabsSession.browserScope } },
				goal,
				observation: {
					...observation,
					tabId: 'unbound',
					documentId: 'unbound',
					elements: [],
				},
				need,
			},
			new AbortController().signal
		)
		expect(result.action).toEqual({ type: 'tab.open', url: 'https://unregistered.example/path' })
	})

	it('allows Jev to reject every concrete action without executing one', async () => {
		const selectedId = 'observation-1:jev:click:index:0'
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0]).toMatchObject({ allowNone: true })
			expect(request.questions[0].options).toEqual([expect.objectContaining({ id: selectedId })])
			return choiceResponse(request, 'none_of_the_above')
		})
		await expect(
			new JevDecisionRouter(provider(transport)).decide(
				{ session, goal, observation, need },
				new AbortController().signal
			)
		).resolves.toMatchObject({ kind: 'blocked', reason: expect.stringContaining('safe none') })
		expect(transport.requests).toHaveLength(1)
	})

	it('preserves the concrete Choice winner when relative confidence is low', async () => {
		const selectedId = 'observation-1:jev:click:index:0'
		const transport = new MockJevTransport((request) => choiceResponse(request, selectedId, 0.05))
		await expect(
			new JevDecisionRouter(provider(transport)).decide(
				{ session, goal, observation, need },
				new AbortController().signal
			)
		).resolves.toMatchObject({
			kind: 'action',
			candidateId: selectedId,
			action: { type: 'click', target: { localId: 'index:0' } },
		})
	})

	it('blocks after every Noul candidate is evaluated as unsuitable', async () => {
		const elements = Array.from({ length: 255 }, (_, index) => element(index, `Control ${index}`))
		const transport = new MockJevTransport((request) => ({
			requestId: request.requestId,
			answers: request.questions.map((question) => ({
				questionId: question.questionId,
				value: 0.1,
				confidence: 0.9,
			})),
		}))
		await expect(
			new JevDecisionRouter(provider(transport)).decide(
				{ session, goal, observation: { ...observation, elements }, need },
				new AbortController().signal
			)
		).resolves.toMatchObject({
			kind: 'blocked',
			reason: expect.stringContaining('all 255 candidates'),
		})
		expect(transport.requests).toHaveLength(1)
	})

	it('does not repeat an already attempted action on an unchanged page', async () => {
		const selectedId = 'observation-1:jev:click:index:0'
		const transport = new MockJevTransport((request) => choiceResponse(request, selectedId))
		const router = new JevDecisionRouter(provider(transport))
		const first = await router.decide(
			{ session, goal, observation, need },
			new AbortController().signal
		)
		await expect(
			router.decide({ session, goal, observation, need }, new AbortController().signal)
		).resolves.toMatchObject({ kind: 'action', candidateId: selectedId })
		await expect(
			router.decide(
				{
					session: withExecutedAction(session, first),
					goal,
					observation,
					need,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({
			kind: 'blocked',
			reason: expect.stringContaining('already been executed'),
		})
		expect(transport.requests).toHaveLength(2)
	})

	it('breaks an A-B-A cycle while allowing actions in a genuinely changed state', async () => {
		let call = 0
		const firstId = 'observation-1:jev:click:index:0'
		const changedStateId = 'observation-2:jev:click:index:0'
		const alternativeId = 'observation-3:jev:click:index:1'
		const transport = new MockJevTransport((request) => {
			call += 1
			if (call === 1) return choiceResponse(request, firstId)
			const selectedId = call === 2 ? changedStateId : alternativeId
			const options = request.questions.find(
				(question) => question.questionId === 'action'
			)?.options
			if (call === 2)
				expect(options).toContainEqual(expect.objectContaining({ id: changedStateId }))
			else expect(options).toEqual([expect.objectContaining({ id: alternativeId })])
			return {
				requestId: request.requestId,
				answers: request.questions.map((question) =>
					question.questionId === 'completion'
						? { questionId: question.questionId, value: 0.1, confidence: 0.9 }
						: {
								questionId: question.questionId,
								selectedOptionId: selectedId,
								confidence: 0.9,
							}
				),
			}
		})
		const router = new JevDecisionRouter(provider(transport))
		const cycleElements = [element(0, 'Toggle menu'), element(1, 'Continue')]
		const first = await router.decide(
			{ session, goal, observation: { ...observation, elements: cycleElements }, need },
			new AbortController().signal
		)
		expect(first).toMatchObject({ candidateId: firstId })
		const afterFirst = withExecutedAction(session, first)
		const changedObservation = {
			...observation,
			observationId: 'observation-2',
			page: { ...observation.page, title: 'Menu open' },
			elements: cycleElements,
		}
		const second = await router.decide(
			{
				session: afterFirst,
				goal,
				observation: changedObservation,
				need,
			},
			new AbortController().signal
		)
		expect(second).toMatchObject({ kind: 'action', candidateId: changedStateId })
		await expect(
			router.decide(
				{
					session: withExecutedAction(afterFirst, second),
					goal,
					observation: {
						...observation,
						observationId: 'observation-3',
						elements: cycleElements,
					},
					need,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ kind: 'action', candidateId: alternativeId })
		expect(transport.requests).toHaveLength(3)
	})

	it('offers completion in the same decision request after the page changes', async () => {
		let call = 0
		const transport = new MockJevTransport((request) => {
			call += 1
			const selectedId = 'observation-1:jev:click:index:0'
			if (call === 2) {
				expect(request.questions).toHaveLength(2)
				expect(request.questions[1]).toMatchObject({
					questionId: 'completion',
					primitive: 'noul',
				})
				return {
					requestId: request.requestId,
					answers: [
						{ questionId: 'action', selectedOptionId: selectedId, confidence: 0.9 },
						{ questionId: 'completion', value: 0.95, confidence: 0.95 },
					],
				}
			}
			return choiceResponse(request, selectedId)
		})
		const router = new JevDecisionRouter(provider(transport))
		const first = await router.decide(
			{ session, goal, observation, need },
			new AbortController().signal
		)
		expect(first).toMatchObject({ kind: 'action' })
		await expect(
			router.decide(
				{
					session: withExecutedAction(session, first),
					goal,
					observation: {
						...observation,
						observationId: 'observation-2',
						page: { ...observation.page, title: 'Saved' },
					},
					need,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ kind: 'goal_satisfied' })
		expect(transport.requests).toHaveLength(2)
	})
})

describe('JevTaskRouter', () => {
	it('routes a greeting as conversation before any DOM observation', async () => {
		const transport = new MockJevTransport((request) =>
			choiceResponse(request, 'task:conversation')
		)
		await expect(
			new JevTaskRouter(provider(transport)).route(
				{ session, request: 'oi' },
				new AbortController().signal
			)
		).resolves.toBe('conversation')
	})
})
