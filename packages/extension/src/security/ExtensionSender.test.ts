import { describe, expect, it } from 'vitest'

import { isTrustedExtensionPageSender } from './ExtensionSender'

describe('isTrustedExtensionPageSender', () => {
	const extensionId = 'extension-id'

	it('accepts a side-panel sender even when Chrome supplies tab context', () => {
		expect(
			isTrustedExtensionPageSender(
				{
					id: extensionId,
					url: `chrome-extension://${extensionId}/sidepanel/index.html`,
					tab: { id: 42 },
				} as chrome.runtime.MessageSender,
				extensionId
			)
		).toBe(true)
	})

	it('rejects content scripts and unrelated extension pages', () => {
		expect(
			isTrustedExtensionPageSender(
				{
					id: extensionId,
					url: 'https://example.test/app',
					tab: { id: 42 },
				} as chrome.runtime.MessageSender,
				extensionId
			)
		).toBe(false)
		expect(
			isTrustedExtensionPageSender(
				{
					id: 'other-extension',
					url: 'chrome-extension://other/page.html',
				} as chrome.runtime.MessageSender,
				extensionId
			)
		).toBe(false)
	})
})
