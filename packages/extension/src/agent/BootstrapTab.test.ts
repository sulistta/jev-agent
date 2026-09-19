import { describe, expect, it } from 'vitest'

import { isBootstrapTab } from './BootstrapTab'

describe('bootstrap tabs', () => {
	it.each([undefined, '', 'about:blank', 'chrome://newtab/', 'chrome://new-tab-page/'])(
		'accepts %s without requiring a DOM',
		(url) => expect(isBootstrapTab(url)).toBe(true)
	)
	it.each([
		'chrome://settings/',
		'chrome://extensions/',
		'https://example.test',
		'chrome-extension://other/index.html',
	])('does not classify %s as a bootstrap page', (url) => expect(isBootstrapTab(url)).toBe(false))
})
