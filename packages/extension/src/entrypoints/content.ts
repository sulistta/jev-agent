import { initProtocolDomEndpoint } from '@/agent/ProtocolDom.content'
import { initPublicApiEndpoint } from '@/agent/PublicApi.content'
import { initPageController } from '@/agent/RemotePageController.content'
import { initLegacyPageApiAdapter } from '@/compat-v1/ContentAdapter'

const DEBUG_PREFIX = '[Content]'

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',

	main() {
		console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
		initPageController()
		initProtocolDomEndpoint()
		initPublicApiEndpoint()
		void injectScript('/main-world-v2.js')

		// if auth token matches, expose agent to page
		chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
			// extension side token.
			// @note this is isolated world. it is safe to assume user script cannot access it
			const extToken = result.PageAgentExtUserAuthToken
			if (!extToken) return

			// page side token
			const pageToken = localStorage.getItem('PageAgentExtUserAuthToken')
			if (!pageToken) return

			if (pageToken !== extToken) return

			console.log('[PageAgentExt]: Auth tokens match. Exposing agent to page.')

			// Keep the old surface only as a thin edge adapter. The adapter delegates
			// to the v2 public-session flow and therefore still requires a scoped grant.
			initLegacyPageApiAdapter()
			void injectScript('/main-world.js')
		})
	},
})
