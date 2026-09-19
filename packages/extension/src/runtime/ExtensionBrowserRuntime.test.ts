import type { ActionReceipt, PageObservation } from '@page-agent/browser'
import type { DomRpcRequest, TabRpcRequest } from '@page-agent/protocol'
import { describe, expect, it } from 'vitest'

import { ExtensionBrowserRuntime, type ExtensionRpc } from './ExtensionBrowserRuntime'

function observation(sessionId: string): PageObservation {
	return {
		observationId: 'observation-1',
		sessionId,
		tabId: 'tab-1',
		documentId: 'document-1',
		revision: 1,
		capturedAt: new Date().toISOString(),
		page: { url: 'https://example.test', title: 'Example', origin: 'https://example.test' },
		viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0 },
		regions: [],
		elements: [],
		signals: [],
		sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
	}
}

describe('ExtensionBrowserRuntime', () => {
	it('serializes browser requests and keeps the observed session for tab RPC', async () => {
		const calls: unknown[] = []
		const runtime = new ExtensionBrowserRuntime({
			request: async <T>(payload: unknown) => {
				calls.push(payload)
				if (typeof payload === 'object' && payload !== null && 'type' in payload) {
					if (payload.type === 'dom.observe') return observation('session-1') as T
					if (payload.type === 'tabs.list') return [] as T
				}
				return undefined as T
			},
		})

		await runtime.observe(
			{
				sessionId: 'session-1',
				tabId: 'tab-1',
				scope: 'viewport',
				includeText: true,
				includeNonInteractive: false,
				attributes: [],
				sensitivityPolicyId: 'default',
			},
			new AbortController().signal
		)
		await runtime.tabs?.list('owned')

		expect(calls).toHaveLength(2)
		expect(calls[0]).toMatchObject({ type: 'dom.observe', sessionId: 'session-1' })
		expect(calls[1]).toMatchObject({ type: 'tabs.list', sessionId: 'session-1' })
	})

	it('preserves cancellation when a transport is aborted', async () => {
		const controller = new AbortController()
		const rpc: ExtensionRpc = {
			request: <T>(_payload: DomRpcRequest | TabRpcRequest, signal: AbortSignal) =>
				new Promise<T>((resolve, reject) => {
					const timer = setTimeout(() => resolve(undefined as T), 20)
					signal.addEventListener(
						'abort',
						() => {
							clearTimeout(timer)
							reject(new Error('CANCELLED'))
						},
						{ once: true }
					)
				}),
		}
		const runtime = new ExtensionBrowserRuntime(rpc)

		const pending = runtime.waitFor(
			{
				sessionId: 'session-1',
				tabId: 'tab-1',
				since: new Date(0).toISOString(),
				expected: [{ type: 'dom' }],
				settle: { quietWindowMs: 1, maxWaitMs: 50 },
			},
			controller.signal
		)
		controller.abort()

		await expect(pending).rejects.toBeDefined()
	})

	it('exposes extension capabilities and maps void tab operations', async () => {
		const receipts: ActionReceipt[] = []
		const runtime = new ExtensionBrowserRuntime({
			request: async <T>(payload: unknown) => {
				if (typeof payload === 'object' && payload !== null && 'type' in payload) {
					if (payload.type === 'dom.execute') {
						const receipt = { actionId: 'action-1' } as ActionReceipt
						receipts.push(receipt)
						return receipt as T
					}
				}
				return undefined as T
			},
		})
		await runtime.observe(
			{
				sessionId: 'session-1',
				tabId: 'tab-1',
				scope: 'viewport',
				includeText: true,
				includeNonInteractive: false,
				attributes: [],
				sensitivityPolicyId: 'default',
			},
			new AbortController().signal
		)
		await runtime.tabs?.switch('tab-2', new AbortController().signal)
		await runtime.execute(
			{
				sessionId: 'session-1',
				actionId: 'action-1',
				expectedSessionRevision: 1,
				action: { type: 'tab.switch', tabId: 'tab-2' },
			},
			new AbortController().signal
		)

		expect(runtime.capabilities.mode).toBe('extension')
		expect(receipts).toHaveLength(1)
	})

	it('turns a navigation-interrupted action response into a retryable receipt', async () => {
		const runtime = new ExtensionBrowserRuntime({
			request: async () => {
				throw Object.assign(new Error('Page changed before acknowledgement'), {
					code: 'DOCUMENT_CHANGED',
				})
			},
		})

		const receipt = await runtime.execute(
			{
				sessionId: 'session-1',
				actionId: 'action-1',
				expectedSessionRevision: 1,
				action: {
					type: 'click',
					target: {
						kind: 'element',
						sessionId: 'session-1',
						tabId: 'tab-1',
						documentId: 'document-1',
						observationId: 'observation-1',
						revision: 1,
						localId: 'index:1',
						fingerprint: 'fingerprint-1',
					},
				},
			},
			new AbortController().signal
		)

		expect(receipt).toMatchObject({
			status: 'failed',
			error: { code: 'DOCUMENT_CHANGED', retryable: true },
		})
	})
})
