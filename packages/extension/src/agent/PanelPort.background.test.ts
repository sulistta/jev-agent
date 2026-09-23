import { describe, expect, it, vi } from 'vitest'

import {
	registerPanelPort,
	requestPanel,
	subscribePanelEvents,
	waitForPanelPort,
} from './PanelPort.background'

const mocks = vi.hoisted(() => {
	const session = { sessionId: 'session-1', status: 'running', revision: 1 }
	return {
		session,
		list: vi.fn(async () => [session]),
		get: vi.fn(async () => session),
		update: vi.fn(async () => undefined),
		append: vi.fn(async (event: Record<string, unknown>) => ({ ...event, sequence: 1 })),
		release: vi.fn(async () => undefined),
		endVisual: vi.fn(),
	}
})

vi.mock('@/runtime/IndexedDbSessionStore', () => ({
	IndexedDbSessionStore: class {
		list = mocks.list
		get = mocks.get
		update = mocks.update
	},
}))
vi.mock('@/runtime/IndexedDbEventLog', () => ({
	IndexedDbEventLog: class {
		append = mocks.append
	},
}))
vi.mock('./ProtocolRpc.background', () => ({
	endVisualSession: mocks.endVisual,
	releaseSessionTabOwners: mocks.release,
}))

describe('side panel execution host', () => {
	it('starts only through a connected panel and cancels persisted work when it closes', async () => {
		vi.stubGlobal('chrome', {
			runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
		})
		expect(await waitForPanelPort(1)).toBe(false)
		await expect(
			requestPanel({
				type: 'session.result',
				input: { origin: 'extension', sessionId: 'session-1', sessionToken: 'token' },
			})
		).rejects.toThrow('PANEL_NOT_OPEN')
		const rejected = vi.fn()
		registerPanelPort({
			sender: { url: 'chrome-extension://test/hub.html' },
			disconnect: rejected,
		} as unknown as chrome.runtime.Port)
		expect(rejected).toHaveBeenCalledOnce()
		expect(await waitForPanelPort(1)).toBe(false)

		let onMessage: (value: unknown) => void = () => undefined
		let onDisconnect: () => void = () => undefined
		const postMessage = vi.fn((request: { requestId: string }) => {
			onMessage({
				type: 'PAGE_AGENT_V2_PANEL_RESPONSE',
				requestId: request.requestId,
				ok: true,
				value: { sessionId: 'session-1' },
			})
		})
		registerPanelPort({
			sender: { url: 'chrome-extension://test/sidepanel.html' },
			onMessage: { addListener: (listener: typeof onMessage) => (onMessage = listener) },
			onDisconnect: { addListener: (listener: typeof onDisconnect) => (onDisconnect = listener) },
			postMessage,
		} as unknown as chrome.runtime.Port)
		expect(await waitForPanelPort(1)).toBe(true)
		const events: string[] = []
		const unsubscribe = subscribePanelEvents(({ event }) => events.push(event.type))
		await requestPanel({
			type: 'session.start',
			input: { task: 'test', capabilities: [], origin: 'extension', sessionToken: 'token' },
		})
		onDisconnect()
		await vi.waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }), 1)
		)
		await vi.waitFor(() => expect(events).toContain('session.terminal'))
		expect(mocks.release).toHaveBeenCalledWith('session-1')
		unsubscribe()
	})
})
