import { PROTOCOL_VERSION } from '@page-agent/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleContentDocumentHello, handleProtocolRpcMessage } from './ProtocolRpc.background'

const tabId = 9191

function announceDocument(documentId: string): void {
	handleContentDocumentHello(
		{
			type: 'PAGE_AGENT_V2_CONTENT_HELLO',
			payload: {
				type: 'content.document.hello',
				requestId: `hello-${documentId}`,
				protocolVersion: PROTOCOL_VERSION,
				documentId,
				frameId: 0,
				capabilities: ['dom.read', 'dom.write'],
			},
		},
		{ tab: { id: tabId } } as chrome.runtime.MessageSender
	)
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('Protocol RPC document transitions', () => {
	it('routes a viewport scroll to the explicitly selected tab', async () => {
		const sendMessage = vi.fn(async () => ({
			ok: true,
			value: { actionId: 'scroll-1', status: 'executed' },
		}))
		vi.stubGlobal('chrome', {
			runtime: { id: 'extension-id' },
			tabs: {
				get: vi.fn(async () => ({ id: tabId, url: 'https://example.test/videos' })),
				sendMessage,
			},
		})

		const response = await handleProtocolRpcMessage(
			{
				type: 'PAGE_AGENT_V2_RPC',
				payload: {
					type: 'dom.execute',
					requestId: 'execute-scroll-1',
					sessionId: 'session-1',
					actionId: 'scroll-1',
					expectedSessionRevision: 1,
					tabId: String(tabId),
					action: { type: 'scroll', axis: 'y', amount: { kind: 'pages', value: 1 } },
				},
			},
			{ id: 'extension-id' } as chrome.runtime.MessageSender
		)

		expect(response).toMatchObject({ ok: true, value: { status: 'executed' } })
		expect(sendMessage).toHaveBeenCalledWith(
			tabId,
			expect.objectContaining({
				tabId: String(tabId),
				payload: expect.objectContaining({ type: 'dom.execute', actionId: 'scroll-1' }),
			})
		)
	})

	it('settles the replacement document without reloading after a wait channel closes', async () => {
		const reload = vi.fn()
		const sendMessage = vi.fn(async (_tabId?: number, _message?: unknown) => {
			if (sendMessage.mock.calls.length === 1) {
				announceDocument('document-new')
				throw new Error(
					'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
				)
			}
			return {
				ok: true,
				value: { status: 'stabilized', signals: [], endedAt: new Date().toISOString() },
			}
		})
		vi.stubGlobal('chrome', {
			runtime: { id: 'extension-id' },
			tabs: {
				get: vi.fn(async () => ({ id: tabId, url: 'https://www.youtube.com/@channel/videos' })),
				sendMessage,
				reload,
			},
		})
		announceDocument('document-old')

		const response = await handleProtocolRpcMessage(
			{
				type: 'PAGE_AGENT_V2_RPC',
				payload: {
					type: 'dom.wait',
					requestId: 'wait-1',
					sessionId: 'session-1',
					tabId: String(tabId),
					since: new Date().toISOString(),
					expected: [{ type: 'dom' }, { type: 'navigation' }],
					quietWindowMs: 500,
					maxWaitMs: 10_000,
				},
			},
			{ id: 'extension-id' } as chrome.runtime.MessageSender
		)

		expect(response).toMatchObject({ ok: true, value: { status: 'stabilized' } })
		expect(sendMessage).toHaveBeenCalledTimes(2)
		expect(sendMessage.mock.calls[1][1]).toMatchObject({
			payload: { type: 'dom.wait', expected: [] },
		})
		expect(reload).not.toHaveBeenCalled()
	})
})
