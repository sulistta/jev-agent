import type { ActionReceipt, BrowserAction, PageObservation } from '@page-agent/browser'
import type {
	ContentDocumentHello,
	DomRpcRequest,
	TabRpcRequest,
	WireTabDescriptor,
} from '@page-agent/protocol'
import { PROTOCOL_VERSION, wireError } from '@page-agent/protocol'

import type {
	ExtensionRpcFailure,
	ExtensionRpcResponse,
	ExtensionRpcSuccess,
} from '@/runtime/ChromeRuntimeRpc'

import { isBootstrapTab } from './BootstrapTab'
import { isContentScriptAllowed } from './RemotePageController'

const OWNER_KEY = 'pageAgentTabOwners'
const documentEndpoints = new Map<number, { documentId: string; frameId: number }>()
const documentEndpointWaiters = new Map<number, Set<() => void>>()

interface ProtocolRpcMessage {
	type: 'PAGE_AGENT_V2_RPC'
	payload: DomRpcRequest | TabRpcRequest
}
interface ContentHelloMessage {
	type: 'PAGE_AGENT_V2_CONTENT_HELLO'
	payload: ContentDocumentHello
}
type TabOwnerMap = Record<string, string>

export async function handleProtocolRpcMessage(
	message: unknown,
	sender: chrome.runtime.MessageSender
): Promise<ExtensionRpcResponse> {
	if (!isProtocolRpcMessage(message))
		return failure('PROTOCOL_MALFORMED', 'Malformed v2 RPC message', false)
	if (sender.id && sender.id !== chrome.runtime.id) {
		return failure('PROTOCOL_UNAUTHORIZED_SENDER', 'Unauthorized extension sender', false)
	}

	try {
		if (message.payload.type.startsWith('dom.')) {
			return await handleDom(message.payload as DomRpcRequest)
		}
		return await handleTabs(message.payload as TabRpcRequest)
	} catch (error) {
		return failure('INTERNAL', error instanceof Error ? error.message : String(error), true)
	}
}

export function handleContentDocumentHello(
	message: unknown,
	sender: chrome.runtime.MessageSender
): {
	type: 'content.document.hello.response'
	requestId: string
	protocolVersion: typeof PROTOCOL_VERSION
	accepted: boolean
	serverDocumentId?: string
	error?: ReturnType<typeof wireError>
} {
	if (!isContentDocumentHello(message)) {
		return {
			type: 'content.document.hello.response',
			requestId: 'unknown',
			protocolVersion: PROTOCOL_VERSION,
			accepted: false,
			error: wireError('PROTOCOL_MALFORMED', 'Malformed content handshake', false),
		}
	}
	const hello = message.payload
	const tabId = sender.tab?.id
	if (tabId === undefined) {
		return {
			type: 'content.document.hello.response',
			requestId: hello.requestId,
			protocolVersion: PROTOCOL_VERSION,
			accepted: false,
			error: wireError(
				'PROTOCOL_UNAUTHORIZED_SENDER',
				'Content handshake has no tab sender',
				false
			),
		}
	}
	documentEndpoints.set(tabId, { documentId: hello.documentId, frameId: hello.frameId })
	for (const resolve of documentEndpointWaiters.get(tabId) ?? []) resolve()
	documentEndpointWaiters.delete(tabId)
	return {
		type: 'content.document.hello.response',
		requestId: hello.requestId,
		protocolVersion: PROTOCOL_VERSION,
		accepted: true,
		serverDocumentId: hello.documentId,
	}
}

async function handleDom(request: DomRpcRequest): Promise<ExtensionRpcResponse> {
	if (request.type === 'dom.execute' && isTabAction(request.action)) {
		return executeTabAction(request)
	}

	const tabId = domTargetTabId(request)
	if (tabId === undefined)
		return failure('CONTENT_SCRIPT_UNAVAILABLE', 'DOM request has no target tab', true)
	const endpoint = documentEndpoints.get(tabId)
	const referencedDocumentId = referencedDocument(request)
	if (endpoint && referencedDocumentId && endpoint.documentId !== referencedDocumentId) {
		return failure('DOCUMENT_CHANGED', 'Request targets a previous document instance', true)
	}
	const tab = await chrome.tabs.get(tabId)
	if (isBootstrapTab(tab.url)) {
		if (request.type === 'dom.observe') return success(bootstrapObservation(request, tabId, tab))
		if (request.type === 'dom.wait')
			return success(await waitForBootstrapNavigation(tabId, request.maxWaitMs))
	}
	if (!isContentScriptAllowed(tab.url)) {
		return failure(
			'CONTENT_SCRIPT_UNAVAILABLE',
			'Content script is unavailable on this page',
			false
		)
	}
	if (request.type === 'dom.wait' && !endpoint) {
		try {
			// A tab-created receipt is available before the newly injected content
			// script can observe page stability. Wait for its document handshake;
			// the forwarded wait then applies the normal DOM quiet window.
			await waitForDocumentEndpoint(tabId, request.maxWaitMs)
		} catch {
			return success({
				status: 'timeout',
				signals: [],
				endedAt: new Date().toISOString(),
			})
		}
	}

	try {
		return await forwardDomRequest(tabId, request)
	} catch (error) {
		if (request.type === 'dom.execute' && isClosedMessageChannelError(error)) {
			return failure(
				'DOCUMENT_CHANGED',
				'The page changed before the action acknowledgement was delivered',
				true
			)
		}
		if (!isMissingReceiverError(error))
			return failure('CONTENT_SCRIPT_UNAVAILABLE', errorMessage(error), true)

		// A tab can outlive an extension update or a service-worker restart. In
		// that state the old content endpoint is gone; reload once and wait for
		// the new document handshake before retrying the same request.
		documentEndpoints.delete(tabId)
		try {
			await chrome.tabs.reload(tabId)
			await waitForDocumentEndpoint(tabId)
			return await forwardDomRequest(tabId, request)
		} catch (retryError) {
			return failure('CONTENT_SCRIPT_UNAVAILABLE', errorMessage(retryError), true)
		}
	}
}

function bootstrapObservation(
	request: Extract<DomRpcRequest, { type: 'dom.observe' }>,
	tabId: number,
	tab: chrome.tabs.Tab
): PageObservation {
	return {
		observationId: request.requestId,
		sessionId: request.sessionId,
		tabId: String(tabId),
		documentId: `bootstrap-${tabId}`,
		revision: 0,
		capturedAt: new Date().toISOString(),
		page: { url: tab.url ?? 'about:blank', title: tab.title ?? 'New tab', origin: 'null' },
		viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0 },
		regions: [],
		elements: [],
		signals: [],
		sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
	}
}

function waitForBootstrapNavigation(
	tabId: number,
	maxWaitMs: number
): Promise<{
	status: 'satisfied' | 'timeout'
	signals: { type: 'tab.created'; at: string; tabId: string }[]
	endedAt: string
}> {
	return new Promise((resolve) => {
		let finished = false
		const timer = setTimeout(() => finish('timeout'), Math.max(0, maxWaitMs))
		const finish = (status: 'satisfied' | 'timeout') => {
			if (finished) return
			finished = true
			clearTimeout(timer)
			chrome.tabs.onUpdated.removeListener(onUpdated)
			const endedAt = new Date().toISOString()
			resolve({
				status,
				signals:
					status === 'satisfied'
						? [{ type: 'tab.created', at: endedAt, tabId: String(tabId) }]
						: [],
				endedAt,
			})
		}
		const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
			if (updatedTabId === tabId && changeInfo.url && !isBootstrapTab(changeInfo.url))
				finish('satisfied')
		}
		chrome.tabs.onUpdated.addListener(onUpdated)
		void chrome.tabs
			.get(tabId)
			.then((current) => {
				if (!isBootstrapTab(current.url)) finish('satisfied')
			})
			.catch(() => finish('timeout'))
	})
}

async function forwardDomRequest(
	tabId: number,
	request: DomRpcRequest
): Promise<ExtensionRpcResponse> {
	const response = await chrome.tabs.sendMessage(tabId, {
		type: 'PAGE_AGENT_V2_DOM',
		tabId: String(tabId),
		payload: request,
	})
	return isRpcResponse(response)
		? response
		: failure('PROTOCOL_MALFORMED', 'Malformed DOM RPC response', false)
}

function waitForDocumentEndpoint(tabId: number, timeoutMs = 10_000): Promise<void> {
	if (documentEndpoints.has(tabId)) return Promise.resolve()
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			documentEndpointWaiters.get(tabId)?.delete(onReady)
			reject(new Error('Content script handshake timed out'))
		}, timeoutMs)
		const onReady = () => {
			clearTimeout(timer)
			resolve()
		}
		const waiters = documentEndpointWaiters.get(tabId) ?? new Set<() => void>()
		waiters.add(onReady)
		documentEndpointWaiters.set(tabId, waiters)
	})
}

async function handleTabs(request: TabRpcRequest): Promise<ExtensionRpcResponse> {
	const owners = await readOwners()
	const sessionId = request.sessionId

	switch (request.type) {
		case 'tabs.list': {
			const tabs = await chrome.tabs.query({})
			const descriptors = tabs
				.filter((tab) => tab.id !== undefined)
				.filter((tab) =>
					request.scope === 'owned'
						? owners[String(tab.id)] === sessionId
						: owners[String(tab.id)] === undefined
				)
				.filter(
					(tab) => request.scope === 'owned' || (!tab.pinned && isContentScriptAllowed(tab.url))
				)
				.map((tab) => toDescriptor(tab, owners[String(tab.id!)]))
			return success(descriptors)
		}
		case 'tabs.open': {
			if (!isSafeNavigationUrl(request.url))
				return failure('PERMISSION_DENIED', 'Only HTTP(S) tabs may be opened', false)
			const tab = await chrome.tabs.create({ url: request.url, active: request.activate ?? false })
			if (tab.id === undefined) return failure('INTERNAL', 'Chrome did not return a tab id', true)
			owners[String(tab.id)] = sessionId
			await writeOwners(owners)
			return success(toDescriptor(tab, sessionId))
		}
		case 'tabs.switch': {
			assertOwner(owners, request.tabId, sessionId)
			await chrome.tabs.update(requiredTabId(request.tabId), { active: true })
			return success(undefined)
		}
		case 'tabs.close': {
			assertOwner(owners, request.tabId, sessionId)
			await chrome.tabs.remove(requiredTabId(request.tabId))
			delete owners[request.tabId]
			await writeOwners(owners)
			return success(undefined)
		}
		case 'tabs.claim': {
			const tabId = requiredTabId(request.tabId)
			const tab = await chrome.tabs.get(tabId)
			if (tab.pinned || (!isContentScriptAllowed(tab.url) && !isBootstrapTab(tab.url))) {
				return failure('CONTENT_SCRIPT_UNAVAILABLE', 'This tab cannot be claimed', false)
			}
			const existing = owners[request.tabId]
			if (existing && existing !== sessionId)
				return failure('TAB_OWNERSHIP_CONFLICT', 'Tab is owned by another session', false)
			owners[request.tabId] = sessionId
			await writeOwners(owners)
			return success(undefined)
		}
		case 'tabs.release': {
			assertOwner(owners, request.tabId, sessionId)
			delete owners[request.tabId]
			await writeOwners(owners)
			return success(undefined)
		}
	}
}

async function executeTabAction(
	request: Extract<DomRpcRequest, { type: 'dom.execute' }>
): Promise<ExtensionRpcResponse> {
	const action = request.action as unknown as BrowserAction
	const startedAt = new Date().toISOString()
	try {
		if (!isTabAction(action))
			return failure('PROTOCOL_UNSUPPORTED_ACTION', 'Unsupported tab action', false)
		const tabRequest: TabRpcRequest =
			action.type === 'tab.open'
				? {
						type: 'tabs.open',
						requestId: request.requestId,
						sessionId: request.sessionId,
						url: action.url,
						activate: true,
					}
				: action.type === 'tab.switch'
					? {
							type: 'tabs.switch',
							requestId: request.requestId,
							sessionId: request.sessionId,
							tabId: action.tabId,
						}
					: {
							type: 'tabs.close',
							requestId: request.requestId,
							sessionId: request.sessionId,
							tabId: action.tabId,
						}
		const result = await handleTabs(tabRequest)
		if (!result.ok) return result
		const endedAt = new Date().toISOString()
		const receipt: ActionReceipt = {
			actionId: request.actionId,
			sessionId: request.sessionId,
			startedAt,
			endedAt,
			status: 'executed',
			result: {
				ok: true,
				effect:
					action.type === 'tab.open'
						? { type: 'tab.opened', tabId: (result.value as WireTabDescriptor).tabId }
						: action.type === 'tab.switch'
							? { type: 'tab.switched', tabId: action.tabId }
							: { type: 'tab.closed', tabId: action.tabId },
				signals: [],
			},
			observedSignals: [],
		}
		return success(receipt)
	} catch (error) {
		return failure('INTERNAL', errorMessage(error), false)
	}
}

function domTargetTabId(request: DomRpcRequest): number | undefined {
	if (request.type === 'dom.observe' || request.type === 'dom.wait')
		return numberTabId(request.tabId)
	if (request.type === 'dom.revalidate') return numberTabId(request.ref.tabId)
	const action = request.action as unknown as BrowserAction
	if ('target' in action && action.target) return numberTabId(action.target.tabId)
	return undefined
}

function referencedDocument(request: DomRpcRequest): string | undefined {
	if (request.type === 'dom.revalidate') return request.ref.documentId
	if (request.type !== 'dom.execute') return undefined
	const action = request.action as unknown as BrowserAction
	return 'target' in action && action.target ? action.target.documentId : undefined
}

type TabBrowserAction = Extract<BrowserAction, { type: 'tab.open' | 'tab.switch' | 'tab.close' }>

function isTabAction(action: unknown): action is TabBrowserAction {
	return (
		typeof action === 'object' &&
		action !== null &&
		'type' in action &&
		typeof action.type === 'string' &&
		['tab.open', 'tab.switch', 'tab.close'].includes(action.type)
	)
}

function isProtocolRpcMessage(value: unknown): value is ProtocolRpcMessage {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (
		candidate.type !== 'PAGE_AGENT_V2_RPC' ||
		typeof candidate.payload !== 'object' ||
		candidate.payload === null
	)
		return false
	const payload = candidate.payload as Record<string, unknown>
	return (
		typeof payload.type === 'string' &&
		typeof payload.requestId === 'string' &&
		typeof payload.sessionId === 'string'
	)
}

function isContentDocumentHello(value: unknown): value is ContentHelloMessage {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	const payload = candidate.payload
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
	const hello = payload as Record<string, unknown>
	return (
		candidate.type === 'PAGE_AGENT_V2_CONTENT_HELLO' &&
		hello.type === 'content.document.hello' &&
		hello.protocolVersion === PROTOCOL_VERSION &&
		typeof hello.requestId === 'string' &&
		typeof hello.documentId === 'string' &&
		typeof hello.frameId === 'number' &&
		Array.isArray(hello.capabilities)
	)
}

function isRpcResponse(value: unknown): value is ExtensionRpcResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	if (candidate.ok === true) return 'value' in candidate
	if (candidate.ok !== false || typeof candidate.error !== 'object' || candidate.error === null)
		return false
	const error = candidate.error as Record<string, unknown>
	return (
		typeof error.code === 'string' &&
		typeof error.message === 'string' &&
		typeof error.retryable === 'boolean'
	)
}

function numberTabId(value: string | undefined): number | undefined {
	if (value === undefined || !/^\d+$/.test(value)) return undefined
	const parsed = Number(value)
	return Number.isSafeInteger(parsed) ? parsed : undefined
}

function requiredTabId(value: string): number {
	const tabId = numberTabId(value)
	if (tabId === undefined) throw new Error('INVALID_TAB_ID')
	return tabId
}

function assertOwner(owners: TabOwnerMap, tabId: string, sessionId: string): void {
	if (owners[tabId] !== sessionId) throw new Error('TAB_OWNERSHIP_REQUIRED')
	requiredTabId(tabId)
}

function toDescriptor(tab: chrome.tabs.Tab, ownedBy?: string): WireTabDescriptor {
	return {
		tabId: String(tab.id),
		windowId: tab.windowId === undefined ? undefined : String(tab.windowId),
		url: tab.url ?? '',
		title: tab.title ?? '',
		ownedBy,
		active: tab.active ?? false,
	}
}

function isSafeNavigationUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
	} catch {
		return false
	}
}

async function readOwners(): Promise<TabOwnerMap> {
	const result = await chrome.storage.session.get(OWNER_KEY)
	const value = result[OWNER_KEY]
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
	return Object.fromEntries(
		Object.entries(value).filter(
			([tabId, owner]) => /^\d+$/.test(tabId) && typeof owner === 'string'
		)
	) as TabOwnerMap
}

async function writeOwners(owners: TabOwnerMap): Promise<void> {
	await chrome.storage.session.set({ [OWNER_KEY]: owners })
}

function success(value: unknown): ExtensionRpcSuccess {
	// Chrome's message serialization drops properties whose value is
	// `undefined` (tabs.claim/switch/close/release have no result). Keep the
	// response envelope stable across the runtime boundary.
	return { ok: true, value: value === undefined ? null : value }
}

function failure(code: string, message: string, retryable: boolean): ExtensionRpcFailure {
	return { ok: false, error: { code, message, retryable } }
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function isMissingReceiverError(error: unknown): boolean {
	const message = errorMessage(error)
	return (
		message.includes('Receiving end does not exist') ||
		message.includes('Could not establish connection')
	)
}

function isClosedMessageChannelError(error: unknown): boolean {
	const message = errorMessage(error)
	return (
		isMissingReceiverError(error) ||
		message.includes('message channel closed') ||
		message.includes('asynchronous response by returning true')
	)
}
