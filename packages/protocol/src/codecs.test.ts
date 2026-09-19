import { describe, expect, it } from 'vitest'

import { decodeEnvelope, encodeEnvelope, isWireEnvelope } from './codecs'
import { createEnvelope } from './envelope'
import { asRequestId } from './ids'

describe('wire envelope codecs', () => {
	it('round-trips a versioned envelope', () => {
		const envelope = createEnvelope({
			messageId: 'message-1',
			requestId: asRequestId('request-1'),
			actor: 'runner',
			type: 'session.start',
			sentAt: '2026-09-19T10:00:00.000Z',
			payload: { task: 'Fill the form', capabilities: ['dom.read'] },
		})

		expect(decodeEnvelope(encodeEnvelope(envelope))).toEqual(envelope)
	})

	it('rejects an unsupported actor and malformed JSON', () => {
		expect(
			isWireEnvelope({
				protocolVersion: '2.0',
				messageId: 'message-1',
				requestId: 'request-1',
				actor: 'unknown',
				type: 'session.start',
				sentAt: '2026-09-19T10:00:00.000Z',
				payload: {},
			})
		).toBe(false)
		expect(() => decodeEnvelope('{')).toThrow('PROTOCOL_MALFORMED')
	})
})
