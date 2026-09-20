import type { ObservationRequest, SecretAwareString } from '@page-agent/browser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LocalBrowserRuntime } from './LocalBrowserRuntime'

const sessionId = 'session-test'

function request(): ObservationRequest {
	return {
		sessionId,
		tabId: 'in-page',
		scope: 'document',
		includeText: true,
		includeNonInteractive: true,
		attributes: [],
		sensitivityPolicyId: 'default',
	}
}

describe('LocalBrowserRuntime', () => {
	let runtime: LocalBrowserRuntime

	beforeEach(() => {
		document.body.innerHTML = `
			<main>
				<form>
					<label for="query">Name</label>
					<input id="query" name="query" type="text" value="initial" />
					<input id="password" name="password" type="password" value="do-not-leak" />
					<input id="hidden-upload" type="file" style="display: none" />
					<input id="hidden-check" type="checkbox" style="width: 0; height: 0" />
					<select id="color" name="color">
						<option value="red">Red</option>
						<option value="blue">Blue</option>
					</select>
					<button id="submit" type="button">Save</button>
				</form>
			</main>
		`
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: Array.from(document.querySelectorAll('input, select, button')),
		})
	})

	afterEach(async () => {
		await runtime.dispose()
	})

	it('observes interactive elements and removes secret values', async () => {
		const observation = await runtime.observe(request(), new AbortController().signal)
		const password = observation.elements.find((element) => element.attributes.id === 'password')
		const query = observation.elements.find((element) => element.attributes.id === 'query')

		expect(observation.sessionId).toBe(sessionId)
		expect(observation.revision).toBe(1)
		expect(observation.viewport).toEqual(
			expect.objectContaining({
				documentWidth: expect.any(Number),
				documentHeight: expect.any(Number),
			})
		)
		expect(observation.sanitization.secretFieldsRemoved).toBeGreaterThanOrEqual(1)
		expect(password).toMatchObject({ sensitivity: 'secret' })
		expect(password?.value).toBeUndefined()
		expect(query?.accessibleName).toBe('Name')
		expect(
			observation.elements.find((element) => element.attributes.id === 'hidden-upload')
		).toMatchObject({ visible: false, editable: false })
		expect(
			observation.elements.find((element) => element.attributes.id === 'hidden-check')
		).toMatchObject({ visible: false, editable: false })
		expect(observation.regions.some((region) => region.kind === 'form')).toBe(true)
	})

	it('uses placeholder text as the semantic name of an unlabelled search field', async () => {
		await runtime.dispose()
		document.body.innerHTML = '<input name="search_query" type="text" placeholder="Pesquisar" />'
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: Array.from(document.querySelectorAll('input')),
		})

		const observation = await runtime.observe(request(), new AbortController().signal)

		expect(observation.elements).toHaveLength(1)
		expect(observation.elements[0]).toMatchObject({
			accessibleName: 'Pesquisar',
			editable: true,
			visible: true,
			supportedActions: ['input', 'focus', 'click'],
		})
	})

	it('observes non-interactive content only when requested and honors region scope', async () => {
		document
			.querySelector('main')!
			.insertAdjacentHTML(
				'beforeend',
				'<p>Flight €120 · duration 2h 45m</p><div role="dialog"><p>Hotel Alfama</p></div>'
			)
		mockElementLayout()

		const documentObservation = await runtime.observe(request(), new AbortController().signal)
		const modalObservation = await runtime.observe(
			{ ...request(), scope: 'region', regionIds: ['region:modal'] },
			new AbortController().signal
		)
		const controlsOnly = await runtime.observe(
			{ ...request(), includeNonInteractive: false },
			new AbortController().signal
		)

		expect(documentObservation.content?.map((block) => block.text)).toContain(
			'Flight €120 · duration 2h 45m'
		)
		expect(modalObservation.content?.map((block) => block.text)).toEqual(['Hotel Alfama'])
		expect(controlsOnly.content).toEqual([])
	})

	it('exposes navigation destinations without leaking query strings or fragments', async () => {
		await runtime.dispose()
		document.body.innerHTML =
			'<a id="channel" href="https://www.youtube.com/@LucasMontano?token=secret#videos">Lucas Montano</a>'
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: Array.from(document.querySelectorAll('a')),
		})

		const observation = await runtime.observe(request(), new AbortController().signal)

		expect(observation.elements[0].attributes.href).toBe('https://www.youtube.com/@LucasMontano')
	})

	it('marks controls inside an open menu as modal context', async () => {
		await runtime.dispose()
		document.body.innerHTML = `
			<button id="outside">Unrelated page action</button>
			<div role="menu">
				<button id="oldest" role="menuitem">Oldest</button>
			</div>
		`
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: Array.from(document.querySelectorAll('button')),
		})

		const observation = await runtime.observe(request(), new AbortController().signal)

		expect(
			observation.elements.find((element) => element.attributes.id === 'oldest')
		).toMatchObject({ role: 'menuitem', regionId: 'region:modal' })
		expect(
			observation.elements.find((element) => element.attributes.id === 'outside')
		).toMatchObject({ regionId: 'region:content' })
	})

	it('revalidates a uniquely remounted control by stable semantic identity', async () => {
		const firstObservation = await runtime.observe(request(), new AbortController().signal)
		const save = firstObservation.elements.find((element) => element.attributes.id === 'submit')!
		const oldButton = document.querySelector<HTMLButtonElement>('#submit')!
		const replacement = oldButton.cloneNode(true) as HTMLButtonElement
		oldButton.replaceWith(replacement)
		mockElementLayout()

		const validation = await runtime.revalidate(save.ref, new AbortController().signal)

		expect(validation).toMatchObject({ status: 'revalidated', ref: { localId: save.ref.localId } })
		const secondReplacement = replacement.cloneNode(true) as HTMLButtonElement
		replacement.replaceWith(secondReplacement)
		mockElementLayout()
		const receipt = await runtime.execute(
			{
				actionId: 'action-after-remount',
				sessionId,
				expectedSessionRevision: firstObservation.revision,
				action: { type: 'click', target: validation.ref },
			},
			new AbortController().signal
		)
		expect(receipt.status).toBe('executed')
	})

	it('detects changed fingerprints and rejects stale action references', async () => {
		const observation = await runtime.observe(request(), new AbortController().signal)
		const query = observation.elements.find((element) => element.attributes.id === 'query')
		expect(query).toBeDefined()

		const queryElement = document.querySelector<HTMLInputElement>('#query')
		queryElement?.setAttribute('aria-label', 'Different field')
		await expect(
			runtime.revalidate(query!.ref, new AbortController().signal)
		).resolves.toMatchObject({
			status: 'stale',
		})

		const receipt = await runtime.execute(
			{
				actionId: 'action-stale',
				sessionId,
				expectedSessionRevision: observation.revision,
				action: {
					type: 'input',
					target: query!.ref,
					text: 'new' as SecretAwareString,
					replace: true,
				},
			},
			new AbortController().signal
		)
		expect(receipt.status).toBe('failed')
		expect(receipt.error?.code).toBe('STALE_REFERENCE')
	})

	it('executes input and select actions against current references', async () => {
		const queryElement = document.querySelector<HTMLInputElement>('#query')!
		Object.setPrototypeOf(queryElement, Object.create(Object.getPrototypeOf(queryElement)))
		const firstObservation = await runtime.observe(request(), new AbortController().signal)
		const query = firstObservation.elements.find((element) => element.attributes.id === 'query')!
		const inputReceipt = await runtime.execute(
			{
				actionId: 'action-input',
				sessionId,
				expectedSessionRevision: firstObservation.revision,
				action: {
					type: 'input',
					target: query.ref,
					text: 'Ada' as SecretAwareString,
					replace: true,
				},
			},
			new AbortController().signal
		)
		expect(inputReceipt.status).toBe('executed')
		expect(document.querySelector<HTMLInputElement>('#query')?.value).toBe('Ada')

		const secondObservation = await runtime.observe(request(), new AbortController().signal)
		const color = secondObservation.elements.find((element) => element.attributes.id === 'color')!
		const selectReceipt = await runtime.execute(
			{
				actionId: 'action-select',
				sessionId,
				expectedSessionRevision: secondObservation.revision,
				action: { type: 'select', target: color.ref, option: { kind: 'label', label: 'Blue' } },
			},
			new AbortController().signal
		)
		expect(selectReceipt.status).toBe('executed')
		expect(document.querySelector<HTMLSelectElement>('#color')?.value).toBe('blue')
	})

	it('waits for a relevant mutation and supports cancellation', async () => {
		const waiting = runtime.waitFor(
			{
				sessionId,
				tabId: 'in-page',
				since: new Date().toISOString(),
				expected: [{ type: 'dom' }],
				settle: { quietWindowMs: 10, maxWaitMs: 100 },
			},
			new AbortController().signal
		)
		document.body.append(document.createElement('aside'))
		await expect(waiting).resolves.toMatchObject({ status: 'satisfied' })

		const controller = new AbortController()
		const cancelled = runtime.waitFor(
			{
				sessionId,
				tabId: 'in-page',
				since: new Date().toISOString(),
				expected: [{ type: 'navigation' }],
				settle: { quietWindowMs: 10, maxWaitMs: 100 },
			},
			controller.signal
		)
		controller.abort()
		await expect(cancelled).resolves.toMatchObject({ status: 'cancelled' })
	})

	it('does not report stability before an expected change occurs', async () => {
		const waiting = runtime.waitFor(
			{
				sessionId,
				tabId: 'in-page',
				since: new Date().toISOString(),
				expected: [{ type: 'dom' }],
				settle: { quietWindowMs: 5, maxWaitMs: 25 },
			},
			new AbortController().signal
		)
		await expect(waiting).resolves.toMatchObject({ status: 'timeout' })
	})

	it('waits for a quiet window and restarts it when the page changes again', async () => {
		let settled = false
		const waiting = runtime
			.waitFor(
				{
					sessionId,
					tabId: 'in-page',
					since: new Date().toISOString(),
					expected: [{ type: 'dom' }],
					settle: { quietWindowMs: 30, maxWaitMs: 250 },
				},
				new AbortController().signal
			)
			.then((result) => {
				settled = true
				return result
			})

		document.body.append(document.createElement('aside'))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(settled).toBe(false)

		document.body.append(document.createElement('footer'))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(settled).toBe(false)
		await expect(waiting).resolves.toMatchObject({ status: 'satisfied' })
	})

	it('reports route and value signals instead of treating every mutation as equivalent', async () => {
		const observation = await runtime.observe(request(), new AbortController().signal)
		const query = observation.elements.find((element) => element.attributes.id === 'query')!
		const valueWait = runtime.waitFor(
			{
				sessionId,
				tabId: 'in-page',
				since: new Date().toISOString(),
				expected: [{ type: 'target.value', targetLocalId: query.ref.localId }],
				settle: { quietWindowMs: 10, maxWaitMs: 100 },
			},
			new AbortController().signal
		)
		document.querySelector<HTMLInputElement>('#query')!.value = 'changed'
		document.querySelector('#query')?.dispatchEvent(new Event('input', { bubbles: true }))
		await expect(valueWait).resolves.toMatchObject({ status: 'satisfied' })

		const routeWait = runtime.waitFor(
			{
				sessionId,
				tabId: 'in-page',
				since: new Date().toISOString(),
				expected: [{ type: 'navigation' }],
				settle: { quietWindowMs: 10, maxWaitMs: 100 },
			},
			new AbortController().signal
		)
		window.dispatchEvent(new Event('popstate'))
		await expect(routeWait).resolves.toMatchObject({ status: 'satisfied' })
	})
})

function mockElementLayout(): void {
	for (const element of document.querySelectorAll<HTMLElement>('*')) {
		if (element.style.display === 'none' || element.style.width === '0px') continue
		Object.defineProperty(element, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({
				x: 10,
				y: 10,
				width: 120,
				height: 24,
				top: 10,
				right: 130,
				bottom: 34,
				left: 10,
			}),
		})
		Object.defineProperty(element, 'getClientRects', {
			configurable: true,
			value: () => [{ x: 10, y: 10, width: 120, height: 24 }],
		})
	}
}
