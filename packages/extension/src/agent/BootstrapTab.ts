/** Pages that can host a task without exposing a readable DOM. */
export function isBootstrapTab(url: string | undefined): boolean {
	return (
		!url ||
		url === 'about:blank' ||
		/^chrome:\/\/(newtab|new-tab-page)\/?$/.test(url) ||
		url.startsWith('chrome-search://local-ntp/')
	)
}
