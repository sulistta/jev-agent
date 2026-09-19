import { describe, expect, it } from 'vitest'

import type { DomRpcRequest, HandshakeRequest, TabRpcRequest } from './index'

describe('protocol RPC unions', () => {
	it('keeps DOM and tab requests discriminated and wire-safe', () => {
		const dom: DomRpcRequest = {
			type: 'dom.revalidate',
			requestId: 'request-1',
			sessionId: 'session-1',
			ref: {
				kind: 'element',
				sessionId: 'session-1',
				tabId: 'tab-1',
				documentId: 'document-1',
				observationId: 'observation-1',
				revision: 1,
				localId: 'local-1',
				fingerprint: 'fingerprint-1',
			},
		}
		const tab: TabRpcRequest = {
			type: 'tabs.list',
			requestId: 'request-2',
			sessionId: 'session-1',
			scope: 'owned',
		}
		const handshake: HandshakeRequest = {
			type: 'handshake.request',
			requestId: 'request-3',
			protocolVersion: '2.0',
			actor: 'content_script',
			capabilities: ['dom.read'],
			nonce: 'nonce-1',
		}

		expect(JSON.parse(JSON.stringify({ dom, tab, handshake }))).toMatchObject({
			dom: { type: 'dom.revalidate' },
			tab: { type: 'tabs.list' },
			handshake: { type: 'handshake.request', protocolVersion: '2.0' },
		})
	})
})
