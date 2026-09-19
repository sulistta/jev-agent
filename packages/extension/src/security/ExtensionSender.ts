/**
 * Messages used by extension-page UI must not be authorized solely by the
 * absence of sender.tab: side panels can carry tab context in Chrome.
 */
export function isTrustedExtensionPageSender(
	sender: chrome.runtime.MessageSender,
	extensionId = chrome.runtime.id
): boolean {
	if (!sender.id || sender.id !== extensionId) return false
	const expectedPrefix = `chrome-extension://${extensionId}/`
	return typeof sender.url === 'string' && sender.url.startsWith(expectedPrefix)
}
