import { describe, expect, it, vi } from 'vitest'

import { JevDecisionProvider } from './JevDecisionProvider'
import { SeedThresholdPolicy, routeByConfidence } from './gates'
import { QuestionTemplateRegistry, candidateSelectTemplate } from './questions'
import { DirectHttpJevTransport, MockJevTransport, RetryingJevTransport } from './transports'
import { JevTransportError } from './types'

const requestContext = {
	requestId: 'request-1',
	need: 'candidate.select',
	risk: 'R1' as const,
	state: { goal: 'click save' as const },
	options: [
		{ id: 'candidate-1', label: 'Save' },
		{ id: 'none_of_the_above', label: 'None of the above' },
	],
}

describe('@page-agent/decision-jev', () => {
	it('registers versioned templates and keeps candidate IDs opaque', () => {
		const registry = new QuestionTemplateRegistry()
		registry.register(candidateSelectTemplate)
		const question = registry
			.get('candidate.select', 'v1')
			.build({ goal: 'save' }, requestContext.options)
		expect(question).toMatchObject({ allowNone: true })
		expect(question.options?.[0]).toMatchObject({ id: 'candidate-1' })
		expect(() => registry.register(candidateSelectTemplate)).toThrow('Duplicate')
	})

	it('routes Jev selection through confidence gates and safe none option', async () => {
		const transport = new MockJevTransport({
			requestId: 'request-1',
			answers: [
				{ questionId: 'candidate.select', selectedOptionId: 'candidate-1', confidence: 0.9 },
			],
		})
		const provider = new JevDecisionProvider({
			model: 'jev-test',
			transport,
			thresholds: new SeedThresholdPolicy(),
			telemetry: 'metadata',
		})
		expect(await provider.decide(requestContext, new AbortController().signal)).toMatchObject({
			status: 'selected',
			selectedOptionId: 'candidate-1',
		})

		const low = await new JevDecisionProvider({
			model: 'jev-test',
			transport: new MockJevTransport({
				requestId: 'request-1',
				answers: [
					{
						questionId: 'candidate.select',
						selectedOptionId: 'none_of_the_above',
						confidence: 0.2,
					},
				],
			}),
			thresholds: new SeedThresholdPolicy(),
			telemetry: 'off',
		}).decide(requestContext, new AbortController().signal)
		expect(low.status).toBe('none')
		expect(
			routeByConfidence(
				0.8,
				new SeedThresholdPolicy().resolve({ questionTemplate: 'candidate.select', risk: 'R1' })
			)
		).toBe('verify')
	})

	it('batches independent judgments into one System One request', async () => {
		const transport = new MockJevTransport((request) => ({
			requestId: request.requestId,
			answers: request.questions.map((question, index) => ({
				questionId: question.questionId,
				selectedOptionId: index === 0 ? 'click' : 'candidate-1',
				confidence: 0.95,
			})),
		}))
		const provider = new JevDecisionProvider({
			model: 'jev-test',
			transport,
			thresholds: new SeedThresholdPolicy(),
			telemetry: 'off',
		})

		const result = await provider.decideMany(
			{
				requestId: 'batch-1',
				state: { goal: 'save the form' },
				judgments: [
					{
						questionId: 'operation',
						need: 'select_operation',
						risk: 'R1',
						options: [{ id: 'click', label: 'Click a control' }],
					},
					{
						questionId: 'click_target',
						need: 'select_candidate',
						risk: 'R1',
						options: [{ id: 'candidate-1', label: 'Save' }],
					},
				],
			},
			new AbortController().signal
		)

		expect(transport.requests).toHaveLength(1)
		expect(transport.requests[0].questions.map((question) => question.questionId)).toEqual([
			'operation',
			'click_target',
		])
		expect(result.operation.selectedOptionId).toBe('click')
		expect(result.click_target.selectedOptionId).toBe('candidate-1')
	})

	it('retries only retryable transport errors with the same request', async () => {
		let attempts = 0
		const inner = new MockJevTransport({ requestId: 'request-1', answers: [] })
		const retryable = {
			systemOne: vi.fn(
				async (request: Parameters<typeof inner.systemOne>[0], signal: AbortSignal) => {
					attempts += 1
					if (attempts < 3) throw new JevTransportError('UNAVAILABLE', 'temporary', true)
					return inner.systemOne(request, signal)
				}
			),
		}
		const transport = new RetryingJevTransport(retryable, 2)
		await expect(
			transport.systemOne(
				{
					requestId: 'request-1',
					model: 'test',
					questions: [],
					language: 'preserve',
					stateBytes: 0,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ requestId: 'request-1' })
		expect(attempts).toBe(3)
	})

	it('maps HTTP transport errors without leaking the API key', async () => {
		const fetchImpl = vi.fn(async () => new Response('', { status: 401 }))
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://jev.test/system-one',
			apiKey: 'secret-key',
			fetchImpl,
		})
		await expect(
			transport.systemOne(
				{
					requestId: 'request-1',
					model: 'test',
					questions: [],
					language: 'preserve',
					stateBytes: 0,
				},
				new AbortController().signal
			)
		).rejects.toMatchObject({ code: 'AUTH' })
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://jev.test/system-one',
			expect.objectContaining({ method: 'POST' })
		)
	})

	it('reports provider context rejection without hiding candidate loss', async () => {
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://api.typesafe.ai/v1/systemone',
			fetchImpl: vi.fn(
				async () =>
					new Response(JSON.stringify({ detail: 'context exceeds 64k tokens' }), {
						status: 422,
					})
			),
		})
		await expect(
			transport.systemOne(
				{
					requestId: 'request-context',
					model: 'test',
					questions: [],
					language: 'preserve',
					stateBytes: 70_000,
				},
				new AbortController().signal
			)
		).rejects.toThrow(
			'Jev HTTP 422. The provider rejected the complete candidate context; no candidates were truncated. Provider response: {"detail":"context exceeds 64k tokens"}'
		)
	})

	it('binds the HTTP fetch implementation to globalThis', async () => {
		const fetchImpl = function (this: unknown): Promise<Response> {
			if (this !== globalThis) throw new TypeError("Failed to execute 'fetch': Illegal invocation")
			return Promise.resolve(
				new Response(JSON.stringify({ requestId: 'request-1', answers: [] }), { status: 200 })
			)
		} as typeof fetch
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://jev.test/system-one',
			fetchImpl,
		})

		await expect(
			transport.systemOne(
				{
					requestId: 'request-1',
					model: 'test',
					questions: [],
					language: 'preserve',
					stateBytes: 0,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({ requestId: 'request-1' })
	})

	it('maps the native TypeSafe API contract and normalizes its base URL', async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(input).toBe('https://api.typesafe.ai/v1/systemone')
			const body = JSON.parse(init?.body as string) as Record<string, any>
			expect(body).toMatchObject({
				model: 'jev-latest',
				questions: {
					'candidate.select': {
						type: 'choice',
						criteria: { 'candidate-1': 'Save', none_of_the_above: expect.any(String) },
					},
				},
			})
			return new Response(
				JSON.stringify({
					model: 'jev-1.13.0',
					answers: {
						'candidate.select': {
							type: 'choice',
							choice: 'candidate-1',
							confidence: 0.93,
							probabilities: { 'candidate-1': 0.93, none_of_the_above: 0.07 },
						},
					},
					usage: { input_tokens: 12, output_tokens: 1 },
				}),
				{ status: 200 }
			)
		})
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://api.typesafe.ai/v1/',
			fetchImpl,
		})

		await expect(
			transport.systemOne(
				{
					requestId: 'request-1',
					model: 'jev-latest',
					questions: [
						{
							questionId: 'candidate.select',
							templateId: 'candidate.select',
							templateVersion: 'v1',
							primitive: 'choice',
							prompt: 'Which candidate?',
							state: { goal: 'click save' },
							options: requestContext.options,
							allowNone: true,
						},
					],
					language: 'preserve',
					stateBytes: 20,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({
			requestId: 'request-1',
			answers: [{ selectedOptionId: 'candidate-1', confidence: 0.93 }],
			usage: { inputTokens: 12, outputTokens: 1 },
		})
	})

	it('maps parallel Noul questions through one native TypeSafe request', async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(init?.body as string) as Record<string, any>
			expect(body.state).toEqual({ candidates: ['first', 'last'] })
			expect(body.questions).toEqual({
				'candidate:0': { type: 'noul', instructions: 'Is candidate 0 suitable?' },
				'candidate:1': { type: 'noul', instructions: 'Is candidate 1 suitable?' },
			})
			return new Response(
				JSON.stringify({
					answers: {
						'candidate:0': { type: 'noul', noul: 0.1 },
						'candidate:1': { type: 'noul', noul: 0.91 },
					},
				}),
				{ status: 200 }
			)
		})
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://api.typesafe.ai/v1/',
			fetchImpl,
		})
		await expect(
			transport.systemOne(
				{
					requestId: 'noul-batch',
					model: 'jev-latest',
					questions: [0, 1].map((index) => ({
						questionId: `candidate:${index}`,
						templateId: 'candidate.select',
						templateVersion: 'v1',
						primitive: 'noul' as const,
						prompt: `Is candidate ${index} suitable?`,
						state: { candidates: ['first', 'last'] },
					})),
					language: 'preserve',
					stateBytes: 31,
				},
				new AbortController().signal
			)
		).resolves.toMatchObject({
			answers: [
				{ questionId: 'candidate:0', value: 0.1 },
				{ questionId: 'candidate:1', value: 0.91 },
			],
		})
		expect(fetchImpl).toHaveBeenCalledOnce()
	})
})
