import type { PageObservation } from '@page-agent/browser'
import type { GoalContract, Session } from '@page-agent/runtime'
import { describe, expect, it } from 'vitest'

import { JevDecisionProvider } from './JevDecisionProvider'
import {
	JevDecisionRouter,
	JevTaskRouter,
	validateHttpUrl,
	validateInputText,
} from './JevDecisionRouter'
import { SeedThresholdPolicy } from './gates'
import { MockJevTransport, jsonStateBytes } from './transports'

const observation: PageObservation = {
	observationId: 'observation-1',
	sessionId: 'session-1',
	tabId: 'tab-1',
	documentId: 'document-1',
	revision: 1,
	capturedAt: '2026-09-19T10:00:00.000Z',
	page: { url: 'https://example.test', title: 'Example', origin: 'https://example.test' },
	viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0 },
	regions: [],
	elements: [
		{
			ref: {
				kind: 'element',
				sessionId: 'session-1',
				tabId: 'tab-1',
				documentId: 'document-1',
				observationId: 'observation-1',
				revision: 1,
				localId: 'index:0',
				fingerprint: 'fnv1a:test',
			},
			tagName: 'button',
			accessibleName: 'Save',
			text: 'Save',
			visible: true,
			enabled: true,
			editable: false,
			attributes: {},
			sensitivity: 'public',
		},
	],
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

describe('JevDecisionRouter', () => {
	it('rejects unsafe model URLs before tab.open can execute', () => {
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
	it('offers tab.open without a readable DOM and delegates its URL to the semantic model', async () => {
		const task = 'open an arbitrary destination'
		const selection = 'tab.open'
		const transport = new MockJevTransport((request) => {
			expect(request.questions[0].options?.some((option) => option.id === selection)).toBe(true)
			return {
				requestId: request.requestId,
				answers: [
					{ questionId: 'candidate.select', selectedOptionId: selection, confidence: 0.99 },
				],
			}
		})
		const provider = new JevDecisionProvider({
			model: 'test',
			transport,
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 24000,
			telemetry: 'off',
		})
		const result = await new JevDecisionRouter(provider, {
			generate: async () => ({ url: 'https://example.test/path' }),
		}).decide(
			{
				session: {
					...session,
					task: { ...session.task, allowedCapabilities: ['dom.read', 'dom.write', 'tabs.write'] },
				},
				goal: { ...goal, description: task },
				observation: {
					...observation,
					elements: [],
					page: { url: 'chrome://newtab/', title: 'New tab', origin: 'null' },
				},
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: [],
				},
			},
			new AbortController().signal
		)
		expect(result).toMatchObject({
			kind: 'action',
			action: { type: 'tab.open', url: 'https://example.test/path' },
		})
	})

	it('routes a greeting as conversation before any DOM observation', async () => {
		const provider = new JevDecisionProvider({
			model: 'test',
			transport: new MockJevTransport((request) => ({
				requestId: request.requestId,
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: 'task:conversation',
						confidence: 0.99,
					},
				],
			})),
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 24_000,
			telemetry: 'off',
		})
		await expect(
			new JevTaskRouter(provider).route({ session, request: 'oi' }, new AbortController().signal)
		).resolves.toBe('conversation')
	})

	it('compacts large observations before calling Jev', async () => {
		const transport = new MockJevTransport((request) => {
			const question = request.questions[0]
			expect(jsonStateBytes(question.state)).toBeLessThanOrEqual(16_000)
			expect(question.options?.length).toBeLessThanOrEqual(34)
			expect(
				new TextEncoder().encode(JSON.stringify(question.options ?? [])).byteLength
			).toBeLessThanOrEqual(12_000)
			return {
				requestId: request.requestId,
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: 'none_of_the_above',
						confidence: 0.99,
					},
				],
			}
		})
		const provider = new JevDecisionProvider({
			model: 'test',
			transport,
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 24_000,
			telemetry: 'off',
		})
		const result = await new JevDecisionRouter(provider).decide(
			{
				session,
				goal: { ...goal, description: 'encontre um vídeo específico' },
				observation: {
					...observation,
					elements: Array.from({ length: 306 }, (_, index) => ({
						...observation.elements[0],
						ref: { ...observation.elements[0].ref, localId: `index:${index}` },
						accessibleName: `Ação da página com conteúdo repetido ${index} ${'x'.repeat(160)}`,
						text: `Ação da página com conteúdo repetido ${index} ${'y'.repeat(160)}`,
					})),
				},
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: [],
				},
			},
			new AbortController().signal
		)
		expect(result).toMatchObject({ kind: 'replan' })
	})

	it('keeps the stable destination instead of an equivalent ephemeral suggestion', async () => {
		const stableCandidateId = 'observation-1:jev:click:index:117'
		const transport = new MockJevTransport((request) => {
			const options = request.questions[0].options ?? []
			expect(options.some((option) => option.id === stableCandidateId)).toBe(true)
			expect(options.some((option) => option.id === 'observation-1:jev:click:index:21')).toBe(false)
			return {
				requestId: request.requestId,
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: stableCandidateId,
						confidence: 0.99,
					},
				],
			}
		})
		const provider = new JevDecisionProvider({
			model: 'test',
			transport,
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 24_000,
			telemetry: 'off',
		})
		const elements: PageObservation['elements'] = [
			{
				...observation.elements[0],
				ref: { ...observation.elements[0].ref, localId: 'index:21' },
				tagName: 'button',
				accessibleName: 'lucas montano',
				text: 'lucas montano',
			},
			{
				...observation.elements[0],
				ref: { ...observation.elements[0].ref, localId: 'index:117' },
				tagName: 'a',
				accessibleName: 'Lucas Montano',
				text: 'Lucas Montano',
				attributes: { href: 'https://www.youtube.com/@LucasMontano' },
			},
		]

		const result = await new JevDecisionRouter(provider).decide(
			{
				session,
				goal: {
					...goal,
					description: 'vai no youtube e coloca o primeiro video que o lucas montano postou',
				},
				observation: {
					...observation,
					page: {
						url: 'https://www.youtube.com/',
						title: 'YouTube',
						origin: 'https://www.youtube.com',
					},
					elements,
				},
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: [],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({
			kind: 'action',
			candidateId: stableCandidateId,
			action: { type: 'click', target: { localId: 'index:117' } },
		})
	})

	it('offers ARIA comboboxes as click actions with structural context', async () => {
		const candidateId = 'observation-1:jev:click:index:174'
		const provider = new JevDecisionProvider({
			model: 'test',
			transport: new MockJevTransport((request) => {
				expect(request.questions[0].options).toContainEqual(
					expect.objectContaining({ id: candidateId, label: expect.stringContaining('y=240') })
				)
				return {
					requestId: request.requestId,
					answers: [
						{ questionId: 'candidate.select', selectedOptionId: candidateId, confidence: 0.99 },
					],
				}
			}),
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 24_000,
			telemetry: 'off',
		})
		const result = await new JevDecisionRouter(provider).decide(
			{
				session,
				goal: { ...goal, description: 'coloque o primeiro vídeo publicado' },
				observation: {
					...observation,
					elements: [
						{
							...observation.elements[0],
							ref: { ...observation.elements[0].ref, localId: 'index:174' },
							tagName: 'div',
							role: 'combobox',
							accessibleName: 'Mais recentes',
							text: 'Mais recentes',
							regionId: 'region:results',
							bounds: { x: 20, y: 240, width: 120, height: 32 },
						},
					],
				},
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: [],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({ kind: 'action', action: { type: 'click' } })
	})

	it('limits a decision to an open menu instead of competing with the page behind it', async () => {
		const oldestId = 'observation-1:jev:click:index:202'
		const provider = new JevDecisionProvider({
			model: 'test',
			transport: new MockJevTransport((request) => {
				const options = request.questions[0].options ?? []
				expect(options).toContainEqual(expect.objectContaining({ id: oldestId }))
				expect(options.some((option) => option.id.endsWith('index:1'))).toBe(false)
				return {
					requestId: request.requestId,
					answers: [
						{
							questionId: 'candidate.select',
							selectedOptionId: oldestId,
							confidence: 0.99,
						},
					],
				}
			}),
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 24_000,
			telemetry: 'off',
		})
		const elements: PageObservation['elements'] = [
			{
				...observation.elements[0],
				ref: { ...observation.elements[0].ref, localId: 'index:1' },
				accessibleName: 'Lucas Montano',
				text: 'Lucas Montano',
				regionId: 'region:results',
			},
			...['Mais recentes', 'Em alta', 'Mais antigos'].map((label, index) => ({
				...observation.elements[0],
				ref: { ...observation.elements[0].ref, localId: `index:${200 + index}` },
				role: 'menuitem',
				accessibleName: label,
				text: label,
				regionId: 'region:modal',
			})),
		]

		const result = await new JevDecisionRouter(provider).decide(
			{
				session,
				goal: { ...goal, description: 'coloque o primeiro vídeo publicado pelo canal' },
				observation: { ...observation, elements },
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: [],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({
			kind: 'action',
			candidateId: oldestId,
			action: { type: 'click', target: { localId: 'index:202' } },
		})
	})

	it('selects the input with Jev and obtains multilingual free text from the semantic model', async () => {
		let calls = 0
		const transport = new MockJevTransport((request) => {
			calls++
			if (calls === 1)
				expect(request.questions[0].state).toMatchObject({
					page: {
						elements: [
							expect.objectContaining({
								id: 'observation-1:jev:input:index:0',
								valueState: 'empty',
							}),
						],
					},
				})
			const selectedOptionId = 'observation-1:jev:input:index:0'
			expect(selectedOptionId).toBeDefined()
			return {
				requestId: request.requestId,
				answers: [{ questionId: 'candidate.select', selectedOptionId, confidence: 0.99 }],
			}
		})
		const provider = new JevDecisionProvider({
			model: 'test',
			transport,
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 24000,
			telemetry: 'off',
		})
		const result = await new JevDecisionRouter(provider, {
			generate: async (input) => {
				expect(input.purpose).toBe('input')
				return { text: 'ルーカス・モンターノ' }
			},
		}).decide(
			{
				session,
				goal: { ...goal, description: 'pesquise Lucas Montano no youtube' },
				observation: {
					...observation,
					elements: [
						{
							...observation.elements[0],
							tagName: 'input',
							accessibleName: 'Search',
							editable: true,
							valueState: 'empty',
						},
					],
				},
				need: {
					kind: 'select_operation',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: [],
				},
			},
			new AbortController().signal
		)
		expect(result.action).toMatchObject({
			type: 'input',
			text: 'ルーカス・モンターノ',
			replace: true,
		})
		expect(calls).toBe(1)
	})
	it('turns a high-confidence opaque candidate selection into a browser action', async () => {
		const provider = new JevDecisionProvider({
			model: 'jev-test',
			transport: new MockJevTransport({
				requestId: 'unused',
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: 'observation-1:jev:click:index:0',
						confidence: 0.95,
					},
				],
			}),
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 20_000,
			telemetry: 'off',
		})
		const result = await new JevDecisionRouter(provider).decide(
			{
				session,
				goal,
				observation,
				need: {
					kind: 'select_candidate',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: ['dom.write'],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({ kind: 'action', candidateId: 'observation-1:jev:click:index:0' })
		expect(result.action).toMatchObject({ type: 'click', target: { localId: 'index:0' } })
	})

	it('executes an explicit reversible candidate even when the choice distribution is diffuse', async () => {
		const candidateId = 'observation-1:jev:click:index:0'
		const provider = new JevDecisionProvider({
			model: 'jev-test',
			transport: new MockJevTransport({
				requestId: 'unused',
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: candidateId,
						confidence: 0.05,
					},
				],
			}),
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 20_000,
			telemetry: 'off',
		})

		const result = await new JevDecisionRouter(provider).decide(
			{
				session,
				goal,
				observation,
				need: {
					kind: 'select_candidate',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: ['dom.write'],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({ kind: 'action', candidateId })
	})

	it('does not treat a low-confidence completion judgment as a reversible browser action', async () => {
		const provider = new JevDecisionProvider({
			model: 'jev-test',
			transport: new MockJevTransport({
				requestId: 'unused',
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: 'goal:satisfied',
						confidence: 0.05,
					},
				],
			}),
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 20_000,
			telemetry: 'off',
		})

		const result = await new JevDecisionRouter(provider).decide(
			{
				session,
				goal,
				observation,
				need: {
					kind: 'select_candidate',
					closedWorld: true,
					computable: false,
					risk: 'R1',
					requiredCapabilities: ['dom.write'],
				},
			},
			new AbortController().signal
		)

		expect(result).toMatchObject({ kind: 'replan', reason: 'Confidence below human threshold' })
	})

	it('lets Jev finish a browser goal only through the explicit satisfied option', async () => {
		const provider = new JevDecisionProvider({
			model: 'jev-test',
			transport: new MockJevTransport({
				requestId: 'unused',
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: 'goal:satisfied',
						confidence: 0.95,
					},
				],
			}),
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 20_000,
			telemetry: 'off',
		})

		await expect(
			new JevDecisionRouter(provider).decide(
				{
					session,
					goal,
					observation,
					need: {
						kind: 'select_operation',
						closedWorld: true,
						computable: false,
						risk: 'R1',
						requiredCapabilities: [],
					},
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ kind: 'goal_satisfied' })
	})

	it('verifies a completed page transition before selecting another action', async () => {
		let calls = 0
		const candidateId = 'observation-1:jev:click:index:0'
		const transport = new MockJevTransport((request) => {
			calls += 1
			if (calls === 1) {
				return {
					requestId: request.requestId,
					answers: [
						{
							questionId: 'candidate.select',
							selectedOptionId: candidateId,
							confidence: 0.99,
						},
					],
				}
			}

			expect(request.questions[0].options).toEqual([
				expect.objectContaining({ id: 'goal:continue' }),
				expect.objectContaining({ id: 'goal:satisfied' }),
			])
			expect(request.questions[0].state).toMatchObject({
				currentPage: {
					url: 'https://www.youtube.com/watch?v=first',
					title: 'Primeiro vídeo do canal',
				},
				recentSelections: [
					expect.objectContaining({
						action: 'click',
						label: 'Primeiro vídeo do canal',
					}),
				],
			})
			return {
				requestId: request.requestId,
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: 'goal:satisfied',
						confidence: 0.99,
					},
				],
			}
		})
		const provider = new JevDecisionProvider({
			model: 'jev-test',
			transport,
			thresholds: new SeedThresholdPolicy(),
			languagePolicy: 'preserve',
			maxStateBytes: 20_000,
			telemetry: 'off',
		})
		const router = new JevDecisionRouter(provider)
		const videoGoal = {
			...goal,
			description: 'coloque o primeiro vídeo publicado pelo canal',
		}
		const sourceObservation = {
			...observation,
			page: {
				url: 'https://www.youtube.com/@canal/videos?sort=oldest',
				title: 'Canal - vídeos mais antigos',
				origin: 'https://www.youtube.com',
			},
			elements: [
				{
					...observation.elements[0],
					accessibleName: 'Primeiro vídeo do canal',
					text: 'Primeiro vídeo do canal',
				},
			],
		}
		const need = {
			kind: 'select_operation' as const,
			closedWorld: true,
			computable: false,
			risk: 'R1' as const,
			requiredCapabilities: [],
		}

		await expect(
			router.decide(
				{ session, goal: videoGoal, observation: sourceObservation, need },
				new AbortController().signal
			)
		).resolves.toMatchObject({ kind: 'action', candidateId })

		await expect(
			router.decide(
				{
					session,
					goal: videoGoal,
					observation: {
						...observation,
						observationId: 'observation-2',
						page: {
							url: 'https://www.youtube.com/watch?v=first',
							title: 'Primeiro vídeo do canal',
							origin: 'https://www.youtube.com',
						},
					},
					need,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ kind: 'goal_satisfied' })
		expect(calls).toBe(2)
	})
})
