import { afterEach, describe, expect, it, vi } from 'vitest'

import { DirectHttpJevTransport } from './transports'
import type { JevRequest } from './types'

const request: JevRequest = {
	requestId: 'timeout-test',
	model: 'jev-latest',
	questions: [],
	language: 'preserve',
	stateBytes: 0,
}

afterEach(() => vi.useRealTimers())

describe('Jev request lifetime', () => {
	it('bounds a fetch that never resolves, even if it ignores abort', async () => {
		vi.useFakeTimers()
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://api.typesafe.ai/v1/',
			timeoutMs: 100,
			fetchImpl: () => new Promise<Response>(() => {}),
		})
		const result = expect(
			transport.systemOne(request, new AbortController().signal)
		).rejects.toMatchObject({ code: 'TIMEOUT', retryable: false })
		await vi.advanceTimersByTimeAsync(100)
		await result
	})
	it('bounds a response body that never finishes', async () => {
		vi.useFakeTimers()
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://api.typesafe.ai/v1/',
			timeoutMs: 100,
			fetchImpl: async () => new Response(new ReadableStream({ start() {} })),
		})
		const result = expect(
			transport.systemOne(request, new AbortController().signal)
		).rejects.toMatchObject({ code: 'TIMEOUT' })
		await vi.advanceTimersByTimeAsync(100)
		await result
	})
	it('cancels pending requests without waiting for their timeout', async () => {
		const controller = new AbortController()
		const transport = new DirectHttpJevTransport({
			endpoint: 'https://api.typesafe.ai/v1/',
			fetchImpl: () => new Promise<Response>(() => {}),
		})
		const result = expect(transport.systemOne(request, controller.signal)).rejects.toMatchObject({
			code: 'CANCELLED',
		})
		controller.abort()
		await result
	})
})
