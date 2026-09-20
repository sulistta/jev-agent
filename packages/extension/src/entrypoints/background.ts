import {
	handleContentDocumentHello,
	handleProtocolRpcMessage,
} from '@/agent/ProtocolRpc.background'
import {
	createOriginGrant,
	handlePublicApiMessage,
	listOriginGrants,
	registerPublicRunnerPort,
	revokeOriginGrant,
} from '@/agent/PublicApi.background'
import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleRunnerUiMessage } from '@/agent/RunnerUi.background'
import { handleTabControlMessage } from '@/agent/TabsController.background'

export default defineBackground(() => {
	console.log('[Background] Service Worker started')

	chrome.runtime.onConnect.addListener((port) => {
		if (port.name === 'page-agent-runner-v2') registerPublicRunnerPort(port)
	})

	// generate user auth token

	chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
		if (result.PageAgentExtUserAuthToken) return

		const userAuthToken = crypto.randomUUID()
		chrome.storage.local.set({ PageAgentExtUserAuthToken: userAuthToken })
	})

	// message proxy

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message?.type === 'PAGE_AGENT_V2_GRANT_LIST') {
			listOriginGrants(sender).then(sendResponse)
			return true
		}
		if (message?.type === 'PAGE_AGENT_V2_GRANT_REVOKE') {
			revokeOriginGrant(message, sender).then(sendResponse)
			return true
		}
		if (message?.type === 'PAGE_AGENT_V2_GRANT_CREATE') {
			createOriginGrant(message, sender).then(sendResponse)
			return true
		}
		if (
			message?.type === 'PAGE_AGENT_V2_UI_START' ||
			message?.type === 'PAGE_AGENT_V2_UI_CANCEL' ||
			message?.type === 'PAGE_AGENT_V2_UI_REPLY'
		) {
			handleRunnerUiMessage(message, sender).then(sendResponse)
			return true
		}
		if (message?.type === 'PAGE_AGENT_V2_RUNNER_READY') {
			sendResponse({ ok: true })
			return
		}
		if (message?.type === 'PAGE_AGENT_V2_PUBLIC') {
			handlePublicApiMessage(message, sender).then(sendResponse)
			return true
		} else if (message?.type === 'PAGE_AGENT_V2_CONTENT_HELLO') {
			sendResponse(handleContentDocumentHello(message, sender))
			return
		} else if (message?.type === 'PAGE_AGENT_V2_RPC') {
			handleProtocolRpcMessage(message, sender).then(sendResponse)
			return true
		} else if (message?.type === 'TAB_CONTROL') {
			return handleTabControlMessage(message, sender, sendResponse)
		} else if (message?.type === 'PAGE_CONTROL') {
			return handlePageControlMessage(message, sender, sendResponse)
		} else {
			sendResponse({ error: 'Unknown message type' })
			return
		}
	})

	// external messages (from localhost launcher page via externally_connectable)

	chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
		if (message.type === 'OPEN_HUB') {
			openOrFocusHubTab(message.wsPort).then(() => {
				if (sender.tab?.id) chrome.tabs.remove(sender.tab.id)
				sendResponse({ ok: true })
			})
			return true
		}
	})

	// setup

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

async function openOrFocusHubTab(wsPort: number) {
	const hubUrl = chrome.runtime.getURL('hub.html')
	const existing = await chrome.tabs.query({ url: `${hubUrl}*` })

	if (existing.length > 0 && existing[0].id) {
		await chrome.tabs.update(existing[0].id, {
			active: true,
			url: `${hubUrl}?ws=${wsPort}`,
		})
		return
	}

	await chrome.tabs.create({ url: `${hubUrl}?ws=${wsPort}`, pinned: true })
}
