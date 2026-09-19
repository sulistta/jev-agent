import type { JsonValue } from '@page-agent/protocol'

import {
	type JevQuestion,
	type JevRequest,
	type JevResponse,
	type JevTransport,
	JevTransportError,
} from './types'

export interface HttpJevTransportConfig {
	timeoutMs?: number
	endpoint: string
	apiKey?: string
	fetchImpl?: typeof fetch
	headers?: Record<string, string>
}

export interface VercelGatewayJevTransportConfig {
	timeoutMs?: number
	/** Gateway origin or base URL. The default is the public AI Gateway. */
	endpoint?: string
	apiKey?: string
	model?: string
	fetchImpl?: typeof fetch
	headers?: Record<string, string>
}

export const DEFAULT_TYPESAFE_JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const DEFAULT_TYPESAFE_JEV_MODEL = 'jev-latest'
export const DEFAULT_VERCEL_GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/v4/ai'
export const DEFAULT_VERCEL_JEV_MODEL = 'typesafe-ai/jev'

export class DirectHttpJevTransport implements JevTransport {
	private readonly fetchImpl: typeof fetch
	private readonly config: HttpJevTransportConfig

	constructor(config: HttpJevTransportConfig) {
		this.config = config
		// Browser fetch requires the Window/globalThis receiver. Keeping the
		// function unbound breaks when the transport invokes it as a property.
		this.fetchImpl = (config.fetchImpl ?? globalThis.fetch).bind(globalThis)
	}

	async systemOne(request: JevRequest, signal: AbortSignal): Promise<JevResponse> {
		return boundedRequest(signal, this.config.timeoutMs, (bounded) =>
			this.perform(request, bounded)
		)
	}

	private async perform(request: JevRequest, signal: AbortSignal): Promise<JevResponse> {
		const endpoint = normalizeTypesafeEndpoint(this.config.endpoint)
		let response: Response
		try {
			response = await this.fetchImpl(endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
					...this.config.headers,
				},
				body: JSON.stringify(
					isTypesafeApiEndpoint(endpoint) ? toTypesafeRequest(request) : request
				),
				signal,
			})
		} catch (error) {
			if (signal.aborted) throw new JevTransportError('CANCELLED', 'Jev request cancelled', true)
			throw new JevTransportError(
				'UNAVAILABLE',
				error instanceof Error ? error.message : 'Jev request failed',
				true
			)
		}
		if (response.status === 401 || response.status === 403)
			throw new JevTransportError('AUTH', 'Jev authorization failed', false)
		if (response.status === 408 || response.status === 429 || response.status >= 500)
			throw new JevTransportError('RATE_LIMITED', `Jev HTTP ${response.status}`, true)
		if (!response.ok)
			throw new JevTransportError(
				'INVALID_REQUEST',
				formatHttpError(endpoint, response.status),
				false
			)
		let body: unknown
		try {
			body = (await response.json()) as unknown
		} catch {
			throw new JevTransportError('INVALID_RESPONSE', 'Jev response is not JSON', false)
		}
		const mapped = mapTypesafeResponse(body, request)
		if (!mapped)
			throw new JevTransportError('INVALID_RESPONSE', 'Jev response schema is invalid', false)
		return mapped
	}
}

/**
 * Adapter for the evaluation endpoint exposed by Vercel AI Gateway.
 *
 * It intentionally stays separate from DirectHttpJevTransport: TypeSafe's
 * native API uses `noul`, while Gateway's AI SDK evaluation protocol uses
 * `boolean` and a different response envelope.
 */
export class VercelGatewayJevTransport implements JevTransport {
	private readonly fetchImpl: typeof fetch
	private readonly config: Required<Pick<VercelGatewayJevTransportConfig, 'endpoint' | 'model'>> &
		Omit<VercelGatewayJevTransportConfig, 'endpoint' | 'model' | 'fetchImpl'>

	constructor(config: VercelGatewayJevTransportConfig = {}) {
		this.config = {
			endpoint: normalizeVercelGatewayEndpoint(config.endpoint),
			model: config.model?.startsWith('typesafe-ai/') ? config.model : DEFAULT_VERCEL_JEV_MODEL,
			apiKey: config.apiKey?.trim(),
			timeoutMs: config.timeoutMs,
			headers: config.headers,
		}
		this.fetchImpl = (config.fetchImpl ?? globalThis.fetch).bind(globalThis)
	}

	async systemOne(request: JevRequest, signal: AbortSignal): Promise<JevResponse> {
		return boundedRequest(signal, this.config.timeoutMs, (bounded) =>
			this.perform(request, bounded)
		)
	}

	private async perform(request: JevRequest, signal: AbortSignal): Promise<JevResponse> {
		if (!this.config.apiKey)
			throw new JevTransportError(
				'AUTH',
				'Vercel AI Gateway API key is missing. Set it in Settings > Jev provider. Free models also require a Gateway key.',
				false
			)
		let response: Response
		try {
			response = await this.fetchImpl(`${this.config.endpoint}/evaluation-model`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'ai-gateway-protocol-version': '0.0.1',
					'ai-gateway-auth-method': 'api-key',
					'ai-model-id': this.config.model,
					'ai-evaluation-model-specification-version': '4',
					...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
					...this.config.headers,
				},
				body: JSON.stringify({
					state: request.questions[0]?.state ?? {},
					questions: Object.fromEntries(request.questions.map(toGatewayQuestion)),
				}),
				signal,
			})
		} catch (error) {
			if (signal.aborted) throw new JevTransportError('CANCELLED', 'Jev request cancelled', true)
			throw new JevTransportError(
				'UNAVAILABLE',
				error instanceof Error ? error.message : 'Jev Gateway request failed',
				true
			)
		}
		if (response.status === 401)
			throw new JevTransportError(
				'AUTH',
				'Vercel AI Gateway HTTP 401: credential rejected. Set a valid Vercel AI Gateway API key in Settings > Jev provider; a TypeSafe key cannot authenticate to the Gateway.',
				false
			)
		if (response.status === 403)
			throw new JevTransportError(
				'AUTH',
				'Vercel AI Gateway HTTP 403: access denied. Check the key permissions and team access in the Vercel AI Gateway dashboard.',
				false
			)
		if (response.status === 408 || response.status === 429 || response.status >= 500)
			throw new JevTransportError('RATE_LIMITED', `Jev Gateway HTTP ${response.status}`, true)
		if (!response.ok)
			throw new JevTransportError(
				'INVALID_REQUEST',
				`Jev Gateway HTTP ${response.status}; use the evaluation API, not /v1/chat/completions`,
				false
			)

		let body: unknown
		try {
			body = (await response.json()) as unknown
		} catch {
			throw new JevTransportError('INVALID_RESPONSE', 'Jev Gateway response is not JSON', false)
		}
		const mapped = mapGatewayResponse(body, request)
		if (!mapped)
			throw new JevTransportError(
				'INVALID_RESPONSE',
				'Jev Gateway response schema is invalid',
				false
			)
		return mapped
	}
}

export class ProxyJevTransport extends DirectHttpJevTransport {}

async function boundedRequest<T>(
	signal: AbortSignal,
	timeoutMs = 30_000,
	run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
		throw new JevTransportError('INVALID_REQUEST', 'Invalid Jev timeout', false)
	const controller = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	let abort = () => {}
	const interrupted = new Promise<never>((_, reject) => {
		abort = () => {
			reject(new JevTransportError('CANCELLED', 'Jev request cancelled', false))
			controller.abort()
		}
		if (signal.aborted) {
			abort()
			return
		}
		signal.addEventListener('abort', abort, { once: true })
		timer = setTimeout(() => {
			reject(
				new JevTransportError(
					'TIMEOUT',
					`Jev did not finish within ${timeoutMs / 1000}s. Check provider availability and retry.`,
					false
				)
			)
			controller.abort()
		}, timeoutMs)
	})
	try {
		return await Promise.race([
			interrupted,
			Promise.resolve().then(() => {
				controller.signal.throwIfAborted()
				return run(controller.signal)
			}),
		])
	} finally {
		clearTimeout(timer)
		signal.removeEventListener('abort', abort)
	}
}

export class MockJevTransport implements JevTransport {
	readonly requests: JevRequest[] = []
	private readonly handler:
		JevResponse | ((request: JevRequest) => JevResponse | Promise<JevResponse>)

	constructor(
		handler: JevResponse | ((request: JevRequest) => JevResponse | Promise<JevResponse>)
	) {
		this.handler = handler
	}

	async systemOne(request: JevRequest, signal: AbortSignal): Promise<JevResponse> {
		if (signal.aborted) throw new JevTransportError('CANCELLED', 'Jev request cancelled', true)
		this.requests.push(request)
		return typeof this.handler === 'function' ? this.handler(request) : this.handler
	}
}

export class ReplayJevTransport implements JevTransport {
	private readonly responses: ReadonlyMap<string, JevResponse>

	constructor(responses: ReadonlyMap<string, JevResponse>) {
		this.responses = responses
	}

	async systemOne(request: JevRequest, signal: AbortSignal): Promise<JevResponse> {
		if (signal.aborted) throw new JevTransportError('CANCELLED', 'Jev request cancelled', true)
		const response = this.responses.get(request.requestId)
		if (!response)
			throw new JevTransportError('INVALID_RESPONSE', 'No replay response for request', false)
		return response
	}
}

export class RetryingJevTransport implements JevTransport {
	private readonly inner: JevTransport
	private readonly maxRetries: number

	constructor(inner: JevTransport, maxRetries = 2) {
		this.inner = inner
		this.maxRetries = maxRetries
	}

	async systemOne(request: JevRequest, signal: AbortSignal): Promise<JevResponse> {
		let attempt = 0
		while (true) {
			try {
				return await this.inner.systemOne(request, signal)
			} catch (error) {
				if (
					!(error instanceof JevTransportError) ||
					!error.retryable ||
					attempt >= this.maxRetries ||
					signal.aborted
				)
					throw error
				attempt += 1
				await abortableDelay(25 * 2 ** (attempt - 1), signal)
			}
		}
	}
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms)
		const abort = () => {
			clearTimeout(timer)
			reject(new JevTransportError('CANCELLED', 'Jev request cancelled', true))
		}
		if (signal.aborted) abort()
		else signal.addEventListener('abort', abort, { once: true })
	})
}

function mapTypesafeResponse(value: unknown, request: JevRequest): JevResponse | undefined {
	if (isResponse(value)) return value
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const candidate = value as Record<string, unknown>
	if (!isRecord(candidate.answers)) return undefined
	const answers = Object.entries(candidate.answers).map(([questionId, answer]) =>
		mapWireAnswer(questionId, answer)
	)
	if (answers.some((answer) => !answer)) return undefined
	return {
		requestId: request.requestId,
		answers: answers as JevResponse['answers'],
		model: typeof candidate.model === 'string' ? candidate.model : undefined,
		usage: mapUsage(candidate.usage),
	}
}

function mapGatewayResponse(value: unknown, request: JevRequest): JevResponse | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const candidate = value as Record<string, unknown>
	if (!isRecord(candidate.answers)) return undefined
	const answers = Object.entries(candidate.answers).map(([questionId, answer]) =>
		mapWireAnswer(questionId, answer, candidate.providerMetadata)
	)
	if (answers.some((answer) => !answer)) return undefined
	return {
		requestId: request.requestId,
		answers: answers as JevResponse['answers'],
		model: request.model,
		usage: mapUsage(candidate.usage),
	}
}

function toTypesafeRequest(request: JevRequest): Record<string, unknown> {
	return {
		model: request.model,
		state: request.questions[0]?.state ?? {},
		questions: Object.fromEntries(request.questions.map(toTypesafeQuestion)),
	}
}

function toTypesafeQuestion(question: JevQuestion): [string, Record<string, unknown>] {
	if (question.primitive === 'choice') {
		const criteria: Record<string, string> = Object.fromEntries(
			(question.options ?? []).map((option) => [option.id, option.label])
		)
		if (question.allowNone && !criteria.none_of_the_above)
			criteria.none_of_the_above = 'No listed candidate is suitable.'
		return [question.questionId, { type: 'choice', instructions: question.prompt, criteria }]
	}
	if (question.primitive === 'score')
		return [
			question.questionId,
			{
				type: 'score',
				instructions: question.prompt,
				criteria: (question.options ?? []).map((option) => option.label),
			},
		]
	return [question.questionId, { type: 'noul', instructions: question.prompt }]
}

function mapWireAnswer(
	questionId: string,
	value: unknown,
	providerMetadata?: unknown
): JevResponse['answers'][number] | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') return undefined
	const probabilities = isNumberMap(value.probabilities) ? value.probabilities : undefined
	const confidence = answerConfidence(questionId, value, probabilities, providerMetadata)
	if (value.type === 'choice' && typeof value.choice === 'string')
		return { questionId, selectedOptionId: value.choice, confidence, probabilities }
	if (value.type === 'score' && typeof value.score === 'number')
		return { questionId, value: value.score, confidence, probabilities }
	if (value.type === 'noul' && typeof value.noul === 'number')
		return { questionId, value: value.noul, confidence: Math.max(value.noul, 1 - value.noul) }
	if (value.type === 'boolean' && typeof value.probability === 'number')
		return {
			questionId,
			value: value.probability >= 0.5,
			confidence: Math.max(value.probability, 1 - value.probability),
		}
	return undefined
}

function answerConfidence(
	questionId: string,
	answer: Record<string, unknown>,
	probabilities: Record<string, number> | undefined,
	providerMetadata: unknown
): number | undefined {
	if (typeof answer.confidence === 'number') return answer.confidence
	if (isRecord(providerMetadata) && isRecord(providerMetadata.typesafe)) {
		const value = providerMetadata.typesafe.confidence
		if (typeof value === 'number') return value
		if (isRecord(value)) {
			const questionConfidence = value[questionId]
			if (typeof questionConfidence === 'number') return questionConfidence
			if (isRecord(questionConfidence) && typeof questionConfidence.value === 'number')
				return questionConfidence.value
		}
	}
	return probabilities ? Math.max(...Object.values(probabilities)) : undefined
}

function mapUsage(value: unknown): JevResponse['usage'] {
	if (!isRecord(value)) return undefined
	const inputTokens = value.inputTokens ?? value.input_tokens
	const outputTokens = value.outputTokens ?? value.output_tokens
	return {
		...(typeof inputTokens === 'number' ? { inputTokens } : {}),
		...(typeof outputTokens === 'number' ? { outputTokens } : {}),
	}
}

function toGatewayQuestion(question: JevQuestion): [string, Record<string, unknown>] {
	if (question.primitive === 'choice') {
		const criteria: Record<string, string> = Object.fromEntries(
			(question.options ?? []).map((option) => [option.id, option.label])
		)
		if (question.allowNone && !criteria.none_of_the_above)
			criteria.none_of_the_above = 'No listed candidate is suitable.'
		return [question.questionId, { type: 'choice', instructions: question.prompt, criteria }]
	}
	if (question.primitive === 'score')
		return [
			question.questionId,
			{
				type: 'score',
				instructions: question.prompt,
				criteria: (question.options ?? []).map((option) => option.label),
			},
		]
	return [question.questionId, { type: 'boolean', instructions: question.prompt }]
}

function normalizeTypesafeEndpoint(endpoint: string): string {
	try {
		const parsed = new URL(endpoint)
		if (parsed.hostname !== 'api.typesafe.ai') return endpoint.replace(/\/+$/, '')
		const path = parsed.pathname.replace(/\/+$/, '')
		if (path === '' || path === '/v1' || path === '/v1/system-one')
			parsed.pathname = '/v1/systemone'
		return parsed.toString().replace(/\/+$/, '')
	} catch {
		return endpoint.replace(/\/+$/, '')
	}
}

function isTypesafeApiEndpoint(endpoint: string): boolean {
	try {
		return new URL(endpoint).hostname === 'api.typesafe.ai'
	} catch {
		return false
	}
}

function normalizeVercelGatewayEndpoint(endpoint = DEFAULT_VERCEL_GATEWAY_ENDPOINT): string {
	try {
		const parsed = new URL(endpoint)
		if (parsed.hostname === 'ai-gateway.vercel.sh') parsed.pathname = '/v4/ai'
		return parsed.toString().replace(/\/+$/, '')
	} catch {
		return endpoint.replace(/\/+$/, '')
	}
}

function formatHttpError(endpoint: string, status: number): string {
	if (status === 404 && endpoint.includes('api.typesafe.ai'))
		return 'Jev HTTP 404: TypeSafe uses POST /v1/systemone (not /v1/ or /v1/system-one)'
	return `Jev HTTP ${status}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumberMap(value: unknown): value is Record<string, number> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === 'number')
}

function isResponse(value: unknown): value is JevResponse {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	if (typeof candidate.requestId !== 'string' || !Array.isArray(candidate.answers)) return false
	return candidate.answers.every((answer) => {
		if (typeof answer !== 'object' || answer === null) return false
		return typeof (answer as Record<string, unknown>).questionId === 'string'
	})
}

export function jsonStateBytes(value: JsonValue): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
