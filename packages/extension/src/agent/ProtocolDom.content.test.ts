import { afterEach, describe, expect, it, vi } from 'vitest'

const { execute, showCursor, hideCursor } = vi.hoisted(() => ({
	execute: vi.fn(async () => ({ status: 'executed' })),
	showCursor: vi.fn(),
	hideCursor: vi.fn(),
}))

vi.mock('@page-agent/page-controller', () => ({
	LocalBrowserRuntime: class {
		execute = execute
	},
	SimulatorMask: class {
		show = showCursor
		hide = hideCursor
	},
}))

import { initProtocolDomEndpoint } from './ProtocolDom.content'

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe('content DOM RPC', () => {
	it('accepts a targetless scroll addressed to its tab', async () => {
		let listener:
			| ((message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) =>
					| true
					| undefined)
			| undefined
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => undefined),
				onMessage: {
					addListener: vi.fn((callback) => {
						listener = callback
					}),
				},
			},
		})
		initProtocolDomEndpoint()
		const response = await new Promise<unknown>((resolve) => {
			listener?.(
				{
					type: 'PAGE_AGENT_V2_DOM',
					tabId: '9191',
					payload: {
						type: 'dom.execute',
						requestId: 'scroll-request',
						sessionId: 'session-1',
						actionId: 'scroll-1',
						expectedSessionRevision: 1,
						tabId: '9191',
						action: { type: 'scroll', axis: 'y', amount: { kind: 'pages', value: 1 } },
					},
				},
				{} as chrome.runtime.MessageSender,
				resolve
			)
		})

		expect(response).toMatchObject({ ok: true, value: { status: 'executed' } })
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({ tabId: '9191', action: expect.objectContaining({ type: 'scroll' }) }),
			expect.any(AbortSignal)
		)
		expect(showCursor).not.toHaveBeenCalled()
	})

	it('shows the visual cursor for a click and hides it after execution', async () => {
		let listener:
			| ((message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) =>
					| true
					| undefined)
			| undefined
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => undefined),
				onMessage: { addListener: vi.fn((callback) => { listener = callback }) },
			},
		})
		initProtocolDomEndpoint()
		await new Promise<unknown>((resolve) => {
			listener?.(
				{
					type: 'PAGE_AGENT_V2_DOM',
					tabId: '9191',
					payload: {
						type: 'dom.execute',
						requestId: 'click-request',
						sessionId: 'session-1',
						actionId: 'click-1',
						expectedSessionRevision: 1,
						tabId: '9191',
						action: { type: 'click', target: { tabId: '9191' } },
					},
				},
				{} as chrome.runtime.MessageSender,
				resolve
			)
		})
		await vi.waitFor(() => expect(hideCursor).toHaveBeenCalledOnce())
		expect(showCursor).toHaveBeenCalledOnce()
		expect(showCursor.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0])
	})
})
