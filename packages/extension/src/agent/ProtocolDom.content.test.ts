import { afterEach, describe, expect, it, vi } from 'vitest'

import { initProtocolDomEndpoint } from './ProtocolDom.content'

const { execute, observe, showCursor, hideCursor, updateOverlay, disposeOverlay } = vi.hoisted(
	() => ({
		execute: vi.fn(async () => ({ status: 'executed' })),
		observe: vi.fn(async () => ({ elements: [], viewport: { width: 100, height: 100 } })),
		showCursor: vi.fn(),
		hideCursor: vi.fn(),
		updateOverlay: vi.fn(),
		disposeOverlay: vi.fn(),
	})
)

vi.mock('@page-agent/page-controller', () => ({
	LocalBrowserRuntime: class {
		execute = execute
		observe = observe
	},
	SimulatorMask: class {
		show = showCursor
		hide = hideCursor
	},
}))

vi.mock('./ObservationOverlay', () => ({
	ObservationOverlay: class {
		update = updateOverlay
		dispose = disposeOverlay
	},
}))

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe('content DOM RPC', () => {
	it('accepts a targetless scroll addressed to its tab', async () => {
		let listener:
			| ((
					message: unknown,
					sender: chrome.runtime.MessageSender,
					respond: (value: unknown) => void
			  ) => true | undefined)
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
			expect.objectContaining({
				tabId: '9191',
				action: expect.objectContaining({ type: 'scroll' }),
			}),
			expect.any(AbortSignal)
		)
		expect(showCursor).toHaveBeenCalledOnce()
	})

	it('keeps the visual cursor through actions and clears it at session completion', async () => {
		let listener:
			| ((
					message: unknown,
					sender: chrome.runtime.MessageSender,
					respond: (value: unknown) => void
			  ) => true | undefined)
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
		expect(showCursor).toHaveBeenCalledOnce()
		expect(showCursor.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0])
		expect(hideCursor).not.toHaveBeenCalled()
		listener?.(
			{ type: 'PAGE_AGENT_V2_VISUAL_END', sessionId: 'session-1' },
			{} as chrome.runtime.MessageSender,
			vi.fn()
		)
		expect(hideCursor).toHaveBeenCalledOnce()
	})

	it('updates one persistent candidate overlay on observation', async () => {
		let listener:
			| ((
					message: unknown,
					sender: chrome.runtime.MessageSender,
					respond: (value: unknown) => void
			  ) => true | undefined)
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
		await new Promise<unknown>((resolve) => {
			listener?.(
				{
					type: 'PAGE_AGENT_V2_DOM',
					tabId: '9191',
					payload: {
						type: 'dom.observe',
						requestId: 'observe-1',
						sessionId: 'session-1',
						tabId: '9191',
					},
				},
				{} as chrome.runtime.MessageSender,
				resolve
			)
		})
		expect(showCursor).toHaveBeenCalledOnce()
		expect(updateOverlay).toHaveBeenCalledOnce()
		listener?.(
			{ type: 'PAGE_AGENT_V2_VISUAL_END', sessionId: 'session-1' },
			{} as chrome.runtime.MessageSender,
			vi.fn()
		)
		expect(disposeOverlay).toHaveBeenCalledOnce()
	})
})
