import type { ObservationRequest, SecretAwareString } from '@page-agent/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

	it('does not draw legacy highlight boxes while observing the document', async () => {
		const observation = await runtime.observe(request(), new AbortController().signal)
		expect(observation.elements.length).toBeGreaterThan(0)
		expect(document.getElementById('playwright-highlight-container')).toBeNull()
	})

	it('keeps structural interaction indexing when visual highlights are disabled', async () => {
		await runtime.dispose()
		document.body.innerHTML =
			'<div role="button" id="save"><span style="cursor:pointer">Save</span></div>'
		mockElementLayout()
		runtime = new LocalBrowserRuntime({ viewportExpansion: -1 })
		const observation = await runtime.observe(request(), new AbortController().signal)
		expect(observation.elements.filter((element) => element.attributes.id === 'save')).toHaveLength(
			1
		)
		expect(observation.elements).toHaveLength(1)
		expect(document.getElementById('playwright-highlight-container')).toBeNull()
	})

	it('observes viewport controls without pulling off-screen controls into the action set', async () => {
		await runtime.dispose()
		document.body.innerHTML = '<button id="near">Near</button><button id="far">Far</button>'
		mockElementLayout()
		const far = document.querySelector<HTMLElement>('#far')!
		Object.defineProperty(far, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({
				x: 10,
				y: window.innerHeight + 500,
				width: 120,
				height: 24,
				top: window.innerHeight + 500,
				right: 130,
				bottom: window.innerHeight + 524,
				left: 10,
			}),
		})
		runtime = new LocalBrowserRuntime({ viewportExpansion: -1 })

		const viewport = await runtime.observe(
			{ ...request(), scope: 'viewport' },
			new AbortController().signal
		)
		const documentView = await runtime.observe(request(), new AbortController().signal)

		expect(viewport.elements.map((element) => element.attributes.id)).toEqual(['near'])
		expect(viewport.metadata?.offViewportControls).toMatchObject({ above: 0, below: 1 })
		expect(documentView.elements.map((element) => element.attributes.id)).toEqual(['near', 'far'])
	})

	it('summarizes the next unseen area without sending its controls as action candidates', async () => {
		await runtime.dispose()
		document.body.innerHTML = `
			<button id="near">Visible action</button>
			<button id="next">Next action</button>
			<button id="later">Later action</button>
			<button id="last">Last action</button>
		`
		mockElementLayout()
		for (const [id, offset] of [['next', 440], ['later', 490], ['last', 550]] as const) {
			const element = document.getElementById(id)!
			Object.defineProperty(element, 'getBoundingClientRect', {
				configurable: true,
				value: () => ({
					x: 10,
					y: window.innerHeight + offset,
					width: 120,
					height: 24,
					top: window.innerHeight + offset,
					right: 130,
					bottom: window.innerHeight + offset + 24,
					left: 10,
				}),
			})
		}
		runtime = new LocalBrowserRuntime({ viewportExpansion: -1 })

		const viewport = await runtime.observe(
			{ ...request(), scope: 'viewport' },
			new AbortController().signal
		)

		expect(viewport.elements.map((element) => element.attributes.id)).toEqual(['near'])
		expect(viewport.metadata?.offViewportControls).toMatchObject({
			below: 3,
			nextScrollTargets: [{ direction: 'down', label: 'Next action', distancePx: 440 }],
		})
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

	it('observes whether a contenteditable editor contains text', async () => {
		await runtime.dispose()
		document.body.innerHTML =
			'<div id="editor" contenteditable="true" aria-label="Write a message"></div>'
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: [document.querySelector<HTMLElement>('#editor')!],
		})

		const empty = await runtime.observe(request(), new AbortController().signal)
		expect(empty.elements[0]).toMatchObject({ editable: true, valueState: 'empty' })

		document.querySelector<HTMLElement>('#editor')!.textContent = 'Draft message'
		const filled = await runtime.observe(request(), new AbortController().signal)
		expect(filled.elements[0]).toMatchObject({ editable: true, valueState: 'present' })
	})

	it('fills a contenteditable editor and observes the newly enabled submit control', async () => {
		await runtime.dispose()
		document.body.innerHTML = `
			<div id="editor" contenteditable="true" aria-label="Write a message"></div>
			<button id="send" disabled>Send</button>
		`
		const editor = document.querySelector<HTMLElement>('#editor')!
		const send = document.querySelector<HTMLButtonElement>('#send')!
		editor.addEventListener('input', () => {
			send.disabled = (editor.innerText ?? editor.textContent ?? '').trim().length === 0
		})
		send.addEventListener('click', () => {
			const published = document.createElement('p')
			published.textContent = editor.innerText ?? editor.textContent ?? ''
			document.body.append(published)
			editor.textContent = ''
			send.disabled = true
		})
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: [editor, send],
		})
		const before = await runtime.observe(request(), new AbortController().signal)
		const editorRef = before.elements.find((element) => element.attributes.id === 'editor')!.ref

		const receipt = await runtime.execute(
			{
				actionId: 'write-message',
				sessionId,
				expectedSessionRevision: before.revision,
				action: {
					type: 'input',
					target: editorRef,
					text: 'Hello there' as SecretAwareString,
					replace: true,
				},
			},
			new AbortController().signal
		)
		const after = await runtime.observe(request(), new AbortController().signal)

		expect(receipt.status).toBe('executed')
		expect(receipt.observedSignals).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'target.valueChanged' })])
		)
		expect(after.elements.find((element) => element.attributes.id === 'editor')).toMatchObject({
			valueState: 'present',
		})
		expect(after.elements.find((element) => element.attributes.id === 'send')).toMatchObject({
			enabled: true,
		})
		const sendRef = after.elements.find((element) => element.attributes.id === 'send')!.ref
		const sent = await runtime.execute(
			{
				actionId: 'send-message',
				sessionId,
				expectedSessionRevision: after.revision,
				action: { type: 'click', target: sendRef },
			},
			new AbortController().signal
		)
		expect(sent.status).toBe('executed')
		expect(document.body.textContent).toContain('Hello there')
		const published = await runtime.observe(request(), new AbortController().signal)
		expect(published.elements.find((element) => element.attributes.id === 'editor')).toMatchObject({
			valueState: 'empty',
		})
	})

	it('observes published text in a custom element but not the editable draft', async () => {
		await runtime.dispose()
		document.body.innerHTML = `
			<div id="editor" contenteditable="true">A published message</div>
		`
		mockElementLayout()
		runtime = new LocalBrowserRuntime({ viewportExpansion: -1 })

		const draft = await runtime.observe(request(), new AbortController().signal)
		expect(draft.content?.some((block) => block.text === 'A published message')).toBe(false)

		document.body.insertAdjacentHTML(
			'beforeend',
			'<message-thread><message-body>A published message</message-body></message-thread>'
		)
		mockElementLayout()
		const observed = await runtime.observe(request(), new AbortController().signal)
		const published = observed.content?.filter((block) => block.text === 'A published message')
		expect(published).toHaveLength(1)
		expect(published?.[0]?.tagName).toBe('message-body')
	})

	it('observes a submit button inserted by the input event, without reusing the old tree', async () => {
		await runtime.dispose()
		document.body.innerHTML = '<div id="editor" contenteditable="true" aria-label="Write"></div>'
		const editor = document.querySelector<HTMLElement>('#editor')!
		editor.addEventListener('input', () => {
			if (!document.querySelector('#send'))
				editor.insertAdjacentHTML('afterend', '<button id="send">Publish</button>')
		})
		mockElementLayout()
		runtime = new LocalBrowserRuntime({ viewportExpansion: -1, interactiveWhitelist: [editor] })
		const before = await runtime.observe(request(), new AbortController().signal)
		expect(before.elements.some((item) => item.attributes.id === 'send')).toBe(false)
		const receipt = await runtime.execute(
			{
				actionId: 'write',
				sessionId,
				expectedSessionRevision: before.revision,
				action: {
					type: 'input',
					target: before.elements[0].ref,
					text: 'Message' as SecretAwareString,
					replace: true,
				},
			},
			new AbortController().signal
		)
		const after = await runtime.observe(request(), new AbortController().signal)
		expect(receipt.status).toBe('executed')
		const send = after.elements.find((item) => item.attributes.id === 'send')
		expect(send).toMatchObject({
			accessibleName: 'Publish',
			enabled: true,
		})
		expect(send?.supportedActions).toContain('click')
	})

	it('includes a newly created submit control near the viewport after input', async () => {
		await runtime.dispose()
		document.body.innerHTML = '<div id="editor" contenteditable="true" aria-label="Write"></div>'
		const editor = document.querySelector<HTMLElement>('#editor')!
		mockElementLayout()
		editor.addEventListener('input', () => {
			if (document.getElementById('send')) return
			const send = document.createElement('button')
			send.id = 'send'
			send.textContent = 'Publish comment'
			document.body.append(send)
			mockElementLayout()
			const top = window.innerHeight + 40
			const rect = {
				x: 10,
				y: top,
				top,
				left: 10,
				width: 120,
				height: 24,
				right: 130,
				bottom: top + 24,
			}
			Object.defineProperty(send, 'getBoundingClientRect', {
				configurable: true,
				value: () => rect,
			})
			Object.defineProperty(send, 'getClientRects', { configurable: true, value: () => [rect] })
		})
		runtime = new LocalBrowserRuntime({ viewportExpansion: -1 })
		const before = await runtime.observe(
			{ ...request(), scope: 'viewport' },
			new AbortController().signal
		)
		const receipt = await runtime.execute(
			{
				actionId: 'write',
				sessionId,
				expectedSessionRevision: before.revision,
				action: {
					type: 'input',
					target: before.elements.find((element) => element.attributes.id === 'editor')!.ref,
					text: 'Hello' as SecretAwareString,
					replace: true,
				},
			},
			new AbortController().signal
		)
		const after = await runtime.observe(
			{ ...request(), scope: 'viewport' },
			new AbortController().signal
		)
		expect(receipt.status).toBe('executed')
		expect(after.elements.find((element) => element.attributes.id === 'send')).toMatchObject({
			accessibleName: 'Publish comment',
			visible: true,
			enabled: true,
		})
		expect(after.metadata?.offViewportControls).toMatchObject({
			below: 0,
			nextScrollTargets: [],
		})
	})

	it('waits for a delayed actionable control instead of an unrelated DOM mutation', async () => {
		await runtime.dispose()
		document.body.innerHTML = '<div id="editor" contenteditable="true">Draft</div>'
		mockElementLayout()
		runtime = new LocalBrowserRuntime({ viewportExpansion: -1 })
		const wait = runtime.waitFor(
			{
				sessionId,
				tabId: 'in-page',
				since: new Date().toISOString(),
				expected: [{ type: 'control.changed' }],
				settle: { quietWindowMs: 10, maxWaitMs: 300 },
			},
			new AbortController().signal
		)
		document.body.insertAdjacentHTML('beforeend', '<p>Unrelated update</p>')
		await new Promise((resolve) => setTimeout(resolve, 30))
		const button = document.createElement('button')
		button.textContent = 'Send'
		document.body.append(button)
		mockElementLayout()
		const result = await wait
		expect(result.status).toBe('satisfied')
		if (result.status === 'error') throw new Error(result.error.message)
		expect(result.signals).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'control.changed' })])
		)
	})

	it('reports an input failure when the page discards the typed value', async () => {
		const field = document.querySelector<HTMLInputElement>('#query')!
		field.addEventListener('input', () => {
			field.value = 'initial'
		})
		const observation = await runtime.observe(request(), new AbortController().signal)
		const query = observation.elements.find((element) => element.attributes.id === 'query')!

		const receipt = await runtime.execute(
			{
				actionId: 'discarded-input',
				sessionId,
				expectedSessionRevision: observation.revision,
				action: {
					type: 'input',
					target: query.ref,
					text: 'New value' as SecretAwareString,
					replace: true,
				},
			},
			new AbortController().signal
		)

		expect(receipt).toMatchObject({
			status: 'failed',
			error: { code: 'INPUT_NOT_APPLIED' },
			observedSignals: [],
		})
		expect(field.value).toBe('initial')
	})

	it('observes a generic pressed state for toggle controls', async () => {
		await runtime.dispose()
		document.body.innerHTML = '<button aria-label="Like this video" aria-pressed="true"></button>'
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: Array.from(document.querySelectorAll('button')),
		})

		const observation = await runtime.observe(request(), new AbortController().signal)

		expect(observation.elements[0]).toMatchObject({
			accessibleName: 'Like this video',
			state: { pressed: true },
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

	it('distinguishes navigation destinations without exposing query strings or fragments', async () => {
		await runtime.dispose()
		document.body.innerHTML = `
			<a id="first" href="https://example.test/watch?v=video-a&token=secret#details">First</a>
			<a id="second" href="https://example.test/watch?v=video-b&token=secret#details">Second</a>
		`
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: Array.from(document.querySelectorAll('a')),
		})

		const observation = await runtime.observe(request(), new AbortController().signal)

		expect(observation.elements.map((element) => element.attributes.href)).toEqual([
			'https://example.test/watch',
			'https://example.test/watch',
		])
		expect(observation.elements[0].attributes.hrefIdentity).not.toBe(
			observation.elements[1].attributes.hrefIdentity
		)
		const serializedAttributes = JSON.stringify(
			observation.elements.map((element) => element.attributes)
		)
		expect(serializedAttributes).not.toContain('token')
		expect(serializedAttributes).not.toContain('video-a')
	})

	it('groups controls with their ordered collection items', async () => {
		await runtime.dispose()
		document.body.innerHTML = `
			<section aria-label="Videos">
				<article><a id="first-video" href="/watch?v=one">First video</a><button>Menu</button></article>
				<article><a id="second-video" href="/watch?v=two">Second video</a><button>Menu</button></article>
			</section>
		`
		mockElementLayout()
		runtime = new LocalBrowserRuntime({
			viewportExpansion: -1,
			interactiveWhitelist: Array.from(document.querySelectorAll('a, button')),
		})

		const observation = await runtime.observe(request(), new AbortController().signal)
		const first = observation.elements.find((element) => element.attributes.id === 'first-video')
		const second = observation.elements.find((element) => element.attributes.id === 'second-video')

		expect(first?.collectionItem).toMatchObject({ position: 1, text: 'First videoMenu' })
		expect(second?.collectionItem).toMatchObject({ position: 2, text: 'Second videoMenu' })
		expect(first?.collectionItem?.collectionId).toBe(second?.collectionItem?.collectionId)
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

	it('does not settle a new document before its load lifecycle completes', async () => {
		let readyState: DocumentReadyState = 'interactive'
		const readyStateSpy = vi
			.spyOn(document, 'readyState', 'get')
			.mockImplementation(() => readyState)
		let settled = false
		const waiting = runtime
			.waitFor(
				{
					sessionId,
					tabId: 'in-page',
					since: new Date().toISOString(),
					expected: [],
					settle: { quietWindowMs: 10, maxWaitMs: 100 },
				},
				new AbortController().signal
			)
			.then((result) => {
				settled = true
				return result
			})

		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(settled).toBe(false)
		readyState = 'complete'
		window.dispatchEvent(new Event('load'))
		await expect(waiting).resolves.toMatchObject({ status: 'stabilized' })
		readyStateSpy.mockRestore()
	})

	it('uses a bounded settle window even when the page keeps mutating', async () => {
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
		expect(settled).toBe(true)
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
