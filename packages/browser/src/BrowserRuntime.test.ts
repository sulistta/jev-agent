import { describe, expect, it } from 'vitest'

import type { BrowserCapabilities, ElementRef } from './index'

describe('Browser Runtime contracts', () => {
	it('exposes explicit capabilities without arbitrary JavaScript', () => {
		const capabilities: BrowserCapabilities = {
			mode: 'in_page',
			tabs: false,
			dom: true,
			mutationSignals: true,
			navigationSignals: true,
			screenshots: false,
			arbitraryJavascript: false,
			supportedActions: ['click', 'input', 'select', 'scroll', 'focus'],
		}

		expect(capabilities.arbitraryJavascript).toBe(false)
	})

	it('binds an element reference to document and revision', () => {
		const ref: ElementRef = {
			kind: 'element',
			sessionId: 'session-1',
			tabId: 'tab-1',
			documentId: 'document-1',
			observationId: 'observation-1',
			revision: 4,
			localId: 'element-1',
			fingerprint: 'sha256:example',
		}

		expect(ref.revision).toBe(4)
		expect(ref.documentId).toBe('document-1')
	})
})
