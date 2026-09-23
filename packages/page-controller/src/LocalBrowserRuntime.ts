import type {
	ActionReceipt,
	BrowserAction,
	BrowserActionRequest,
	BrowserCapabilities,
	BrowserRuntime,
	BrowserSignal,
	ElementRef,
	ExpectedChange,
	ObservationRequest,
	PageObservation,
	ReferenceValidation,
	SynchronizationRequest,
	SynchronizationResult,
	TabsRuntime,
} from '@page-agent/browser'
import {
	type BrowserRuntimeError,
	type BrowserRuntimeErrorCode,
	browserError,
} from '@page-agent/browser'

import {
	clickElement,
	inputTextElement,
	scrollHorizontally,
	scrollVertically,
	selectOptionElement,
} from './actions'
import { type DomConfig, getFlatTree, getSelectorMap } from './dom'
import { isEditableTextElement } from './utils'

export interface LocalBrowserRuntimeConfig extends DomConfig {
	tabId?: string
	documentId?: string
	sensitivityPolicyId?: string
}

interface ElementRecord {
	ref: ElementRef
	element: HTMLElement
	valueSnapshot: string
	relocationKey: string
}

let runtimeCounter = 0
// Match the Page Agent controller's nearby interaction range without reading the full page.
const actionViewportMarginPx = 400

function nextId(prefix: string): string {
	runtimeCounter += 1
	return `${prefix}-${runtimeCounter}`
}

function now(): string {
	return new Date().toISOString()
}

function isVisible(element: HTMLElement): boolean {
	if (!element.isConnected || element.hidden) return false
	if (element.closest('[hidden], [aria-hidden="true"]')) return false
	const style = window.getComputedStyle(element)
	if (
		style.display === 'none' ||
		style.visibility === 'hidden' ||
		style.visibility === 'collapse' ||
		(style.opacity !== '' && Number(style.opacity) === 0)
	)
		return false
	const bounds = element.getBoundingClientRect()
	return bounds.width > 0 && bounds.height > 0 && element.getClientRects().length > 0
}

function elementMatchesObservationScope(
	element: HTMLElement,
	localId: string,
	request: ObservationRequest
): boolean {
	if (request.scope === 'document') return true
	if (request.scope === 'targets')
		return (request.targetRefs ?? []).some((target) => target.localId === localId)
	if (request.scope === 'region')
		return (request.regionIds ?? []).includes(`region:${regionKind(element)}`)
	const bounds = element.getBoundingClientRect()
	return (
		bounds.bottom >= -actionViewportMarginPx &&
		bounds.right >= -actionViewportMarginPx &&
		bounds.top <= window.innerHeight + actionViewportMarginPx &&
		bounds.left <= window.innerWidth + actionViewportMarginPx
	)
}

function collectContentBlocks(
	request: ObservationRequest
): NonNullable<PageObservation['content']> {
	if (request.scope === 'targets') return []
	const seen = new Set<string>()
	const blocks: NonNullable<PageObservation['content']> = []
	const semanticSelector = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, td, th, figcaption, blockquote'
	const elements = new Set<HTMLElement>(document.querySelectorAll<HTMLElement>(semanticSelector))
	// Web components often render published text in a custom leaf element instead of
	// a paragraph. Read those leaves too, without copying whole component subtrees.
	const textNodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
	while (textNodes.nextNode()) {
		const parent = textNodes.currentNode.parentElement
		if (!parent || !textNodes.currentNode.textContent?.trim()) continue
		if (
			parent.closest(
				`${semanticSelector}, [contenteditable], button, a, input, textarea, select, script, style, noscript, template, [hidden], [aria-hidden="true"]`
			)
		)
			continue
		let custom: HTMLElement | null = parent
		while (custom && custom !== document.body && !custom.localName.includes('-'))
			custom = custom.parentElement
		if (!custom || custom === document.body || custom.querySelector(semanticSelector)) continue
		if (custom.innerText.length > 1_000) continue
		elements.add(custom)
	}
	const ordered = [...elements].sort((left, right) =>
		left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
	)
	for (const element of ordered) {
		if (blocks.length >= 200 || !isVisible(element) || sensitivity(element) === 'secret') continue
		if (element.closest('[contenteditable="true"]')) continue
		if (!elementMatchesContentScope(element, request)) continue
		const text = element.innerText.replace(/\s+/g, ' ').trim().slice(0, 1_000)
		if (text.length < 2 || seen.has(text)) continue
		seen.add(text)
		const bounds = element.getBoundingClientRect()
		blocks.push({
			blockId: `content:${blocks.length}:${shortHash(text)}`,
			text,
			regionId: `region:${regionKind(element)}`,
			tagName: element.tagName.toLowerCase(),
			bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
			contentHash: shortHash(text),
		})
	}
	return blocks
}

function elementMatchesContentScope(element: HTMLElement, request: ObservationRequest): boolean {
	if (request.scope === 'document') return true
	if (request.scope === 'region')
		return (request.regionIds ?? []).includes(`region:${regionKind(element)}`)
	const bounds = element.getBoundingClientRect()
	return (
		bounds.bottom >= 0 &&
		bounds.right >= 0 &&
		bounds.top <= window.innerHeight &&
		bounds.left <= window.innerWidth
	)
}

function shortHash(value: string): string {
	let hash = 2166136261
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(16).padStart(8, '0')
}

function isEnabled(element: HTMLElement): boolean {
	if (element.getAttribute('aria-disabled') === 'true') return false
	return (
		!(
			element instanceof HTMLButtonElement ||
			element instanceof HTMLInputElement ||
			element instanceof HTMLSelectElement ||
			element instanceof HTMLTextAreaElement
		) || !element.disabled
	)
}

function isEditable(element: HTMLElement): boolean {
	return isEditableTextElement(element)
}

function accessibleName(element: HTMLElement): string {
	const ariaLabel = element.getAttribute('aria-label')?.trim()
	if (ariaLabel) return ariaLabel

	if (element.id) {
		const label = Array.from(document.querySelectorAll('label')).find(
			(candidate) => candidate.htmlFor === element.id
		)
		if (label?.textContent?.trim()) return label.textContent.trim()
	}

	const fallback = [
		element.getAttribute('placeholder'),
		element.getAttribute('title'),
		element.getAttribute('name'),
	].find((value) => value?.trim())
	if (fallback) return fallback.trim()

	return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function stableAttributes(element: HTMLElement): Record<string, string> {
	const names = ['id', 'name', 'type', 'role', 'placeholder', 'aria-label', 'data-testid']
	const attributes: Record<string, string> = {}
	for (const name of names) {
		const value = element.getAttribute(name)
		if (value) attributes[name] = value.slice(0, 200)
	}
	const href = publicHref(element)
	if (href) attributes.href = href
	const hrefIdentity = privateHrefIdentity(element)
	if (hrefIdentity) attributes.hrefIdentity = hrefIdentity
	return attributes
}

function publicHref(element: HTMLElement): string | undefined {
	const rawHref = element.getAttribute('href')
	if (!rawHref) return undefined
	try {
		const url = new URL(rawHref, window.location.href)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
		return `${url.origin}${url.pathname}`.slice(0, 500)
	} catch {
		return undefined
	}
}

function privateHrefIdentity(element: HTMLElement): string | undefined {
	const rawHref = element.getAttribute('href')
	if (!rawHref) return undefined
	try {
		const url = new URL(rawHref, window.location.href)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
		return shortHash(url.href)
	} catch {
		return undefined
	}
}

function collectionItemFor(
	element: HTMLElement
): PageObservation['elements'][number]['collectionItem'] {
	let item = element.closest<HTMLElement>('li, article, [role="listitem"], [role="row"]')
	if (!item) {
		let ancestor = element.parentElement
		while (ancestor && ancestor !== document.body) {
			const siblings = Array.from(ancestor.parentElement?.children ?? [])
			if (
				ancestor.querySelector('a[href]') &&
				siblings.filter(
					(sibling) => sibling.tagName === ancestor?.tagName && sibling.querySelector('a[href]')
				).length > 1
			) {
				item = ancestor
				break
			}
			ancestor = ancestor.parentElement
		}
	}
	const parent = item?.parentElement
	if (!item || !parent) return undefined
	const items = Array.from(parent.children).filter((sibling) => sibling.tagName === item.tagName)
	const containers = Array.from(document.querySelectorAll(parent.tagName))
	const collectionId = `collection:${parent.tagName.toLowerCase()}:${containers.indexOf(parent)}`
	const position = items.indexOf(item) + 1
	return {
		collectionId,
		itemId: `${collectionId}:item:${position}`,
		position,
		text: (item.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000),
	}
}

function normalizedIdentityText(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function relocationKey(element: HTMLElement): string {
	const attributes = stableAttributes(element)
	delete attributes.id
	delete attributes['data-testid']
	return JSON.stringify({
		tagName: element.tagName.toLocaleLowerCase(),
		role: element.getAttribute('role')?.toLocaleLowerCase() ?? '',
		name: normalizedIdentityText(accessibleName(element)),
		attributes,
	})
}

function valueSnapshot(element: HTMLElement): string {
	return element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
		? element.value
		: element.isContentEditable
			? (element.innerText ?? element.textContent ?? '')
			: (element.textContent ?? '')
}

function uniqueReplacement(record: ElementRecord): HTMLElement | undefined {
	const tagName = record.element.tagName.toLocaleLowerCase()
	const matches = Array.from(document.querySelectorAll<HTMLElement>(tagName)).filter(
		(candidate) =>
			candidate !== record.element &&
			candidate.isConnected &&
			isVisible(candidate) &&
			isEnabled(candidate) &&
			relocationKey(candidate) === record.relocationKey
	)
	return matches.length === 1 ? matches[0] : undefined
}

function hash(value: string): string {
	let result = 2166136261
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index)
		result = Math.imul(result, 16777619)
	}
	return `fnv1a:${(result >>> 0).toString(16)}`
}

function fingerprint(element: HTMLElement): string {
	const ancestry: string[] = []
	let current: HTMLElement | null = element
	while (current && ancestry.length < 4) {
		ancestry.push(`${current.tagName.toLowerCase()}:${current.getAttribute('role') ?? ''}`)
		current = current.parentElement
	}
	return hash(JSON.stringify({ attributes: stableAttributes(element), ancestry }))
}

function sensitivity(element: HTMLElement): 'public' | 'internal' | 'sensitive' | 'secret' {
	if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password')
		return 'secret'
	const autocomplete = element.getAttribute('autocomplete')?.toLowerCase() ?? ''
	if (
		autocomplete.includes('cc-') ||
		autocomplete.includes('token') ||
		autocomplete.includes('one-time')
	)
		return 'secret'
	if (element instanceof HTMLInputElement && ['email', 'tel'].includes(element.type.toLowerCase()))
		return 'sensitive'
	return 'public'
}

function supportedActionsFor(element: HTMLElement): ('click' | 'input' | 'select' | 'focus')[] {
	if (element instanceof HTMLSelectElement) return ['select', 'focus', 'click']
	if (isEditable(element)) {
		return ['input', 'focus', 'click']
	}
	if (element instanceof HTMLInputElement) return ['click', 'focus']
	return ['click', 'focus']
}

function valueStateFor(
	element: HTMLElement,
	level: 'public' | 'internal' | 'sensitive' | 'secret'
): 'empty' | 'present' | 'masked' | undefined {
	if (!isEditableTextElement(element) && !(element instanceof HTMLSelectElement)) return undefined
	if (level === 'secret') return 'masked'
	return valueSnapshot(element).trim().length === 0 ? 'empty' : 'present'
}

function regionKind(
	element: HTMLElement
): 'viewport' | 'modal' | 'form' | 'results' | 'navigation' | 'content' {
	if (element.closest('dialog,[role="dialog"],[aria-modal="true"],[role="menu"],[role="listbox"]'))
		return 'modal'
	if (element.closest('form')) return 'form'
	if (element.closest('nav,[role="navigation"]')) return 'navigation'
	if (element.closest('[role="alert"],[aria-live],main')) return 'results'
	return 'content'
}

export class LocalBrowserRuntime implements BrowserRuntime {
	readonly capabilities: BrowserCapabilities = {
		mode: 'in_page',
		tabs: false,
		dom: true,
		mutationSignals: true,
		navigationSignals: true,
		screenshots: false,
		arbitraryJavascript: false,
		supportedActions: ['click', 'input', 'select', 'scroll', 'focus'],
	}

	private readonly config: LocalBrowserRuntimeConfig
	private readonly tabId: string
	private readonly documentId: string
	private readonly records = new Map<string, ElementRecord>()
	private sessionId: string | undefined
	private revision = 0
	private disposed = false
	private lastSignals: BrowserSignal[] = []

	constructor(config: LocalBrowserRuntimeConfig = {}) {
		this.config = config
		this.tabId = config.tabId ?? 'in-page'
		this.documentId = config.documentId ?? nextId('document')
	}

	async observe(request: ObservationRequest, signal: AbortSignal): Promise<PageObservation> {
		this.assertAvailable(signal)
		this.sessionId = request.sessionId
		this.revision += 1
		const observationId = nextId('observation')
		const timestamp = now()
		const tree = getFlatTree({
			...this.config,
			doHighlightElements: false,
			// Discover controls throughout the DOM, but return only the requested
			// scope and the nearby action margin. Distant controls are summarized below.
			viewportExpansion: -1,
		})
		const selectorMap = getSelectorMap(tree)
		const candidates: [number, HTMLElement][] =
			selectorMap.size > 0
				? Array.from(selectorMap, ([index, node]) => [index, node.ref])
				: Array.from(
						document.querySelectorAll<HTMLElement>(
							'button, input, select, textarea, a, [role="button"], [contenteditable="true"]'
						),
						(element, index) => [index, element]
					)
		this.records.clear()

		const elements = [] as PageObservation['elements']
		const regionElements = new Map<
			string,
			{ kind: ReturnType<typeof regionKind>; elementIds: string[] }
		>()
		let secretFieldsRemoved = 0
		const offViewportControls = {
			above: 0,
			below: 0,
			nextScrollTargets: [] as { direction: 'up' | 'down'; label: string; distancePx: number }[],
		}

		for (const [index, element] of candidates) {
			const localId = `index:${index}`
			if (!elementMatchesObservationScope(element, localId, request)) {
				if (request.scope === 'viewport' && isVisible(element) && isEnabled(element)) {
					const bounds = element.getBoundingClientRect()
					if (supportedActionsFor(element).includes('click')) {
						const direction =
							bounds.bottom < 0 ? 'up' : bounds.top > window.innerHeight ? 'down' : undefined
						if (direction) {
							offViewportControls[direction === 'up' ? 'above' : 'below'] += 1
							const distancePx = Math.round(
								direction === 'up' ? -bounds.bottom : bounds.top - window.innerHeight
							)
							if (distancePx <= window.innerHeight && sensitivity(element) === 'public') {
								const target: (typeof offViewportControls.nextScrollTargets)[number] = {
									direction,
									label: accessibleName(element).slice(0, 180) || element.tagName.toLowerCase(),
									distancePx,
								}
								const existing = offViewportControls.nextScrollTargets.findIndex(
									(item) => item.direction === direction
								)
								if (existing < 0) offViewportControls.nextScrollTargets.push(target)
								else if (distancePx < offViewportControls.nextScrollTargets[existing].distancePx)
									offViewportControls.nextScrollTargets[existing] = target
							}
						}
					}
				}
				continue
			}
			const ref: ElementRef = {
				kind: 'element',
				sessionId: request.sessionId,
				tabId: this.tabId,
				documentId: this.documentId,
				observationId,
				revision: this.revision,
				localId,
				fingerprint: fingerprint(element),
			}
			this.records.set(localId, {
				ref,
				element,
				valueSnapshot: valueSnapshot(element),
				relocationKey: relocationKey(element),
			})

			const level = sensitivity(element)
			const kind = regionKind(element)
			const regionId = `region:${kind}`
			const existing = regionElements.get(regionId) ?? { kind, elementIds: [] }
			existing.elementIds.push(localId)
			regionElements.set(regionId, existing)
			const safeText =
				level === 'secret' ? undefined : request.includeText ? accessibleName(element) : undefined
			if (level === 'secret') secretFieldsRemoved += 1
			const supportedActions = supportedActionsFor(element)
			const valueState = valueStateFor(element, level)
			const bounds = element.getBoundingClientRect()

			elements.push({
				ref,
				tagName: element.tagName.toLowerCase(),
				role: element.getAttribute('role') ?? undefined,
				accessibleName: safeText,
				text: safeText,
				value:
					level === 'secret'
						? undefined
						: element instanceof HTMLInputElement ||
							  element instanceof HTMLTextAreaElement ||
							  element instanceof HTMLSelectElement
							? element.value
							: undefined,
				visible: isVisible(element),
				enabled: isEnabled(element),
				editable: isEditable(element),
				attributes: stableAttributes(element),
				sensitivity: level,
				inputType: element instanceof HTMLInputElement ? element.type : undefined,
				placeholder: element.getAttribute('placeholder') ?? undefined,
				valueState,
				regionId,
				collectionItem:
					request.includeText && level === 'public' ? collectionItemFor(element) : undefined,
				supportedActions,
				state: {
					visible: isVisible(element),
					enabled: isEnabled(element),
					editable: isEditable(element),
					checked:
						element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
							? element.checked
							: undefined,
					pressed:
						element.getAttribute('aria-pressed') === null
							? undefined
							: element.getAttribute('aria-pressed') === 'true',
					expanded:
						element.getAttribute('aria-expanded') === null
							? undefined
							: element.getAttribute('aria-expanded') === 'true',
					selected:
						element.getAttribute('aria-selected') === null
							? undefined
							: element.getAttribute('aria-selected') === 'true',
				},
				bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
				options:
					element instanceof HTMLSelectElement
						? Array.from(element.options).map((option) => ({
								label: option.textContent?.trim() ?? '',
								value: option.value,
								selected: option.selected,
							}))
						: undefined,
			})
		}
		offViewportControls.nextScrollTargets.sort((left, right) => left.distancePx - right.distancePx)
		const content = request.includeNonInteractive ? collectContentBlocks(request) : []

		return {
			observationId,
			sessionId: request.sessionId,
			tabId: this.tabId,
			documentId: this.documentId,
			revision: this.revision,
			capturedAt: timestamp,
			page: { url: window.location.href, title: document.title, origin: window.location.origin },
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
				scrollX: window.scrollX,
				scrollY: window.scrollY,
				documentWidth: Math.max(
					document.documentElement.scrollWidth,
					document.body?.scrollWidth ?? 0
				),
				documentHeight: Math.max(
					document.documentElement.scrollHeight,
					document.body?.scrollHeight ?? 0
				),
			},
			regions: Array.from(regionElements, ([regionId, region]) => ({
				regionId,
				kind: region.kind,
				elementIds: region.elementIds,
			})),
			elements,
			content,
			metadata: { offViewportControls },
			signals: [],
			sanitization: {
				policyId: request.sensitivityPolicyId,
				redactedFields: secretFieldsRemoved,
				secretFieldsRemoved,
			},
		}
	}

	async execute(request: BrowserActionRequest, signal: AbortSignal): Promise<ActionReceipt> {
		this.assertAvailable(signal)
		const startedAt = now()
		const urlBeforeAction = window.location.href
		const mutations: MutationRecord[] = []
		const actionObserver =
			typeof MutationObserver === 'undefined'
				? undefined
				: new MutationObserver((records) => mutations.push(...records))
		actionObserver?.observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
		try {
			const targetRecord =
				request.action.type === 'input' || request.action.type === 'select'
					? this.records.get(request.action.target.localId)
					: undefined
			const valueBefore = targetRecord?.element.isConnected
				? valueSnapshot(targetRecord.element)
				: undefined
			const result = await this.executeAction(
				request.action,
				request.sessionId,
				request.expectedSessionRevision,
				signal
			)
			await Promise.resolve()
			mutations.push(...(actionObserver?.takeRecords() ?? []))
			this.revision += 1
			const signals: BrowserSignal[] = []
			if (mutations.length > 0) signals.push(signalEvent('dom.mutated', { relevant: true }))
			if (window.location.href !== urlBeforeAction)
				signals.push(signalEvent('route.changed', { url: window.location.href }))
			if (
				(request.action.type === 'input' || request.action.type === 'select') &&
				targetRecord?.element.isConnected &&
				valueSnapshot(targetRecord.element) !== valueBefore
			) {
				signals.push(signalEvent('target.valueChanged', { localId: request.action.target.localId }))
			}
			this.lastSignals = signals
			return {
				actionId: request.actionId,
				sessionId: request.sessionId,
				startedAt,
				endedAt: now(),
				status: 'executed',
				result: {
					ok: true,
					effect: result.effect,
					signals,
				},
				observedSignals: signals,
			}
		} catch (error) {
			const runtimeError = toRuntimeError(error)
			return {
				actionId: request.actionId,
				sessionId: request.sessionId,
				startedAt,
				endedAt: now(),
				status: 'failed',
				result: { ok: false, error: runtimeError },
				error: runtimeError,
				observedSignals: [],
			}
		} finally {
			actionObserver?.disconnect()
		}
	}

	async revalidate(ref: ElementRef, signal: AbortSignal): Promise<ReferenceValidation> {
		this.assertAvailable(signal)
		if (
			ref.sessionId !== this.sessionId ||
			ref.tabId !== this.tabId ||
			ref.documentId !== this.documentId
		) {
			return { status: 'stale', ref, reason: 'session, tab, or document changed' }
		}
		let record = this.records.get(ref.localId)
		if (!record) return { status: 'missing', ref }
		if (!record.element.isConnected) {
			const replacement = uniqueReplacement(record)
			if (!replacement) return { status: 'missing', ref }
			const replacementRef: ElementRef = {
				...record.ref,
				fingerprint: fingerprint(replacement),
			}
			record = {
				ref: replacementRef,
				element: replacement,
				valueSnapshot: valueSnapshot(replacement),
				relocationKey: relocationKey(replacement),
			}
			this.records.set(ref.localId, record)
			return { status: 'revalidated', ref: replacementRef }
		}
		if (record.ref.revision !== this.revision) {
			return { status: 'stale', ref, reason: 'observation revision changed' }
		}
		const currentFingerprint = fingerprint(record.element)
		if (currentFingerprint !== ref.fingerprint) {
			if (relocationKey(record.element) !== record.relocationKey)
				return { status: 'stale', ref, reason: 'fingerprint changed' }
			const revalidatedRef = { ...record.ref, fingerprint: currentFingerprint }
			record = { ...record, ref: revalidatedRef }
			this.records.set(ref.localId, record)
			return { status: 'revalidated', ref: revalidatedRef }
		}
		if (record.ref.revision === ref.revision && record.ref.observationId === ref.observationId) {
			return { status: 'fresh', ref: record.ref }
		}
		return { status: 'revalidated', ref: record.ref }
	}

	async waitFor(
		request: SynchronizationRequest,
		signal: AbortSignal
	): Promise<SynchronizationResult> {
		this.assertAvailable(signal)
		const recentSignals = this.lastSignals.filter(
			(candidate) =>
				Date.parse(candidate.at) >= Date.parse(request.since) &&
				request.expected.some((expected) => signalMatches(expected, candidate))
		)

		return new Promise((resolve) => {
			const signals: BrowserSignal[] = [...recentSignals]
			let actionableControls = request.expected.some((change) => change.type === 'control.changed')
				? actionableControlSnapshot()
				: undefined
			let settleTimer: ReturnType<typeof setTimeout> | undefined
			let finished = false
			let expectedObserved = recentSignals.length > 0

			const finish = (result: SynchronizationResult) => {
				if (finished) return
				finished = true
				observer?.disconnect()
				if (settleTimer) clearTimeout(settleTimer)
				if (timeoutTimer) clearTimeout(timeoutTimer)
				signal.removeEventListener('abort', onAbort)
				window.removeEventListener('beforeunload', onNavigationStart)
				window.removeEventListener('popstate', onRouteChange)
				window.removeEventListener('hashchange', onRouteChange)
				window.removeEventListener('load', onDocumentReady)
				document.removeEventListener('DOMContentLoaded', onDocumentReady)
				document.removeEventListener('input', onInputChange, true)
				document.removeEventListener('change', onInputChange, true)
				resolve(result)
			}
			const armSettleWindow = () => {
				if (
					finished ||
					settleTimer !== undefined ||
					document.readyState !== 'complete' ||
					(!expectedObserved && request.expected.length > 0)
				)
					return
				// Dynamic applications can mutate forever (timers, thumbnails, media and
				// live regions). Once the expected effect is visible, use a bounded grace
				// period before observing again instead of requiring global DOM silence.
				settleTimer = setTimeout(
					() =>
						finish({
							status: expectedObserved ? 'satisfied' : 'stabilized',
							signals,
							endedAt: now(),
						}),
					request.settle.quietWindowMs
				)
			}
			const recordSignals = (incoming: BrowserSignal[]) => {
				if (finished) return
				signals.push(...incoming)
				expectedObserved ||= incoming.some((candidate) =>
					request.expected.some((expected) => signalMatches(expected, candidate))
				)
				armSettleWindow()
			}
			const observer =
				typeof MutationObserver === 'undefined'
					? undefined
					: new MutationObserver(() => {
							const mutation = signalEvent('dom.mutated', { relevant: true })
							const mutationSignals = [mutation]
							if (actionableControls) {
								const previous = actionableControls
								const current = actionableControlSnapshot()
								if (
									[...current].some(
										([element, state]) =>
											state.enabled &&
											(!previous.has(element) ||
												!previous.get(element)?.enabled ||
												previous.get(element)?.label !== state.label)
									)
								)
									mutationSignals.push(signalEvent('control.changed', {}))
								actionableControls = current
							}
							for (const [localId, record] of this.records) {
								if (
									record.element instanceof HTMLInputElement ||
									record.element instanceof HTMLTextAreaElement ||
									record.element instanceof HTMLSelectElement
								) {
									if (record.element.value !== record.valueSnapshot) {
										mutationSignals.push(signalEvent('target.valueChanged', { localId }))
										record.valueSnapshot = record.element.value
									}
								}
							}
							recordSignals(mutationSignals)
							if (expectedSatisfied(request.expected, this.records)) expectedObserved = true
						})

			const onAbort = () => finish({ status: 'cancelled', signals, endedAt: now() })
			const onNavigationStart = () => recordSignals([signalEvent('navigation.started', {})])
			const onRouteChange = () =>
				recordSignals([
					signalEvent('route.changed', { url: window.location.href }),
					signalEvent('navigation.completed', { url: window.location.href }),
				])
			const onDocumentReady = () => armSettleWindow()
			const onInputChange = (event: Event) => {
				const target = event.target
				if (!(target instanceof HTMLElement)) return
				const localId = [...this.records.entries()].find(
					([, record]) => record.element === target
				)?.[0]
				if (localId) recordSignals([signalEvent('target.valueChanged', { localId })])
			}
			const timeoutTimer = setTimeout(() => {
				if (expectedObserved || request.expected.length === 0) {
					finish({
						status: expectedObserved ? 'satisfied' : 'stabilized',
						signals,
						endedAt: now(),
					})
					return
				}
				finish({ status: 'timeout', signals, endedAt: now() })
			}, request.settle.maxWaitMs)

			if (signal.aborted) {
				onAbort()
				return
			}
			signal.addEventListener('abort', onAbort, { once: true })
			observer?.observe(document, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true,
			})
			window.addEventListener('beforeunload', onNavigationStart)
			window.addEventListener('popstate', onRouteChange)
			window.addEventListener('hashchange', onRouteChange)
			window.addEventListener('load', onDocumentReady)
			document.addEventListener('DOMContentLoaded', onDocumentReady)
			document.addEventListener('input', onInputChange, true)
			document.addEventListener('change', onInputChange, true)
			armSettleWindow()
		})
	}

	async dispose(): Promise<void> {
		this.disposed = true
		this.records.clear()
	}

	private async executeAction(
		action: BrowserAction,
		sessionId: string,
		expectedSessionRevision: number,
		signal: AbortSignal
	) {
		if (sessionId !== this.sessionId) throw new Error('SESSION_MISMATCH')
		if (expectedSessionRevision !== this.revision) throw new Error('STALE_REFERENCE')
		if (action.type === 'tab.open' || action.type === 'tab.switch' || action.type === 'tab.close') {
			throw new Error('TAB_UNAVAILABLE')
		}

		const target =
			'target' in action && action.target ? this.requireTarget(action.target, signal) : undefined
		switch (action.type) {
			case 'click':
				await clickElement(requiredTarget(target))
				return { effect: { type: 'element.updated', ref: action.target } as const }
			case 'input':
				await inputTextElement(requiredTarget(target), action.text)
				if (!target?.isConnected || valueSnapshot(target).trim() !== action.text.trim()) {
					throw new Error('INPUT_NOT_APPLIED')
				}
				return { effect: { type: 'element.updated', ref: action.target } as const }
			case 'select': {
				if (!(target instanceof HTMLSelectElement)) throw new Error('TARGET_NOT_FOUND')
				const option = Array.from(target.options).find((candidate) =>
					action.option.kind === 'value'
						? candidate.value === action.option.value
						: action.option.kind === 'label'
							? candidate.textContent?.trim() === action.option.label.trim()
							: target.options[action.option.index] === candidate
				)
				if (!option) throw new Error('TARGET_NOT_FOUND')
				await selectOptionElement(target, option.textContent ?? '')
				return { effect: { type: 'element.updated', ref: action.target } as const }
			}
			case 'focus':
				target?.focus()
				return { effect: { type: 'element.updated', ref: action.target } as const }
			case 'scroll':
				if (action.axis === 'x') {
					await scrollHorizontally(scrollValue(action.amount), target)
				} else {
					await scrollVertically(scrollValue(action.amount), target)
				}
				return {
					effect: { type: 'viewport.scrolled', axis: action.axis, amount: action.amount } as const,
				}
		}
	}

	private requireTarget(ref: ElementRef, signal: AbortSignal): HTMLElement {
		if (signal.aborted) throw new Error('CANCELLED')
		let record = this.records.get(ref.localId)
		if (!record) throw new Error('TARGET_NOT_FOUND')
		if (record.ref.sessionId !== ref.sessionId || record.ref.documentId !== ref.documentId)
			throw new Error('STALE_REFERENCE')
		if (record.ref.revision !== ref.revision) throw new Error('STALE_REFERENCE')
		if (!record.element.isConnected) {
			const replacement = uniqueReplacement(record)
			if (!replacement) throw new Error('TARGET_NOT_FOUND')
			record = {
				...record,
				element: replacement,
				ref: { ...record.ref, fingerprint: fingerprint(replacement) },
				valueSnapshot: valueSnapshot(replacement),
				relocationKey: relocationKey(replacement),
			}
			this.records.set(ref.localId, record)
		}
		if (
			fingerprint(record.element) !== ref.fingerprint &&
			relocationKey(record.element) !== record.relocationKey
		)
			throw new Error('STALE_REFERENCE')
		return record.element
	}

	private assertAvailable(signal: AbortSignal): void {
		if (this.disposed) throw new Error('INTERNAL')
		if (signal.aborted) throw new Error('CANCELLED')
	}
}

function scrollValue(amount: { kind: 'pages' | 'pixels'; value: number }): number {
	return amount.kind === 'pages' ? amount.value * window.innerHeight : amount.value
}

function requiredTarget(target: HTMLElement | undefined): HTMLElement {
	if (!target) throw new Error('TARGET_NOT_FOUND')
	return target
}

function signalEvent(
	type: BrowserSignal['type'],
	details: Record<string, string | boolean>
): BrowserSignal {
	return { type, at: now(), ...details } as BrowserSignal
}

function expectedSatisfied(
	expected: ExpectedChange[],
	records: Map<string, ElementRecord>
): boolean {
	return expected.some((change) => {
		switch (change.type) {
			case 'dom':
				return true
			case 'target.value': {
				const record = change.targetLocalId ? records.get(change.targetLocalId) : undefined
				return Boolean(
					record &&
					record.element instanceof HTMLInputElement &&
					record.element.value !== record.valueSnapshot
				)
			}
			case 'url':
				return change.urlPattern ? new RegExp(change.urlPattern).test(window.location.href) : false
			default:
				return false
		}
	})
}

function actionableControlSnapshot(): Map<HTMLElement, { enabled: boolean; label: string }> {
	const controls = document.querySelectorAll<HTMLElement>(
		'button, a, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]'
	)
	return new Map(
		Array.from(controls)
			.filter(isVisible)
			.map((element) => [element, { enabled: isEnabled(element), label: accessibleName(element) }])
	)
}

function signalMatches(expected: ExpectedChange, signal: BrowserSignal): boolean {
	switch (expected.type) {
		case 'control.changed':
			return signal.type === 'control.changed'
		case 'dom':
			return signal.type === 'dom.mutated'
		case 'target.value':
			return (
				signal.type === 'target.valueChanged' &&
				(expected.targetLocalId === undefined || signal.localId === expected.targetLocalId)
			)
		case 'navigation':
			return (
				signal.type === 'navigation.started' ||
				signal.type === 'navigation.completed' ||
				signal.type === 'route.changed'
			)
		case 'document':
			return signal.type === 'document.changed'
		case 'target.appeared':
			return signal.type === 'target.appeared'
		case 'target.disappeared':
			return signal.type === 'target.disappeared'
		case 'tab.created':
			return signal.type === 'tab.created'
		case 'tab.closed':
			return signal.type === 'tab.closed'
		case 'tab.activated':
			return signal.type === 'tab.activated'
		case 'url':
			return signal.type === 'route.changed' || signal.type === 'navigation.completed'
	}
}

function toRuntimeError(error: unknown): BrowserRuntimeError {
	const message = error instanceof Error ? error.message : String(error)
	const codes: Record<string, BrowserRuntimeErrorCode> = {
		CANCELLED: 'CANCELLED',
		DOCUMENT_CHANGED: 'DOCUMENT_CHANGED',
		PERMISSION_DENIED: 'PERMISSION_DENIED',
		SESSION_MISMATCH: 'STALE_REFERENCE',
		STALE_REFERENCE: 'STALE_REFERENCE',
		TAB_UNAVAILABLE: 'TAB_UNAVAILABLE',
		TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
		INPUT_NOT_APPLIED: 'INPUT_NOT_APPLIED',
	}
	const code = codes[message] ?? 'INTERNAL'
	return browserError(code, message, code === 'STALE_REFERENCE' || code === 'CANCELLED')
}

export type { TabsRuntime }
