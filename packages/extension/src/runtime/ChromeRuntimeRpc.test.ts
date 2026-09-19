import type { DomRpcRequest } from '@page-agent/protocol'
import { describe, expect, it, vi } from 'vitest'

import { ChromeRuntimeRpc } from './ChromeRuntimeRpc'

describe('ChromeRuntimeRpc', () => {
	it('accepts Chrome responses whose void value was omitted during serialization', async () => {
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => ({ ok: true })),
			},
		})

		const response = await new ChromeRuntimeRpc().request(
			{} as DomRpcRequest,
			new AbortController().signal
		)

		expect(response).toBeUndefined()
		vi.unstubAllGlobals()
	})
})
