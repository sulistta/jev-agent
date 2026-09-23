// @vitest-environment happy-dom
import type { SecretAwareString } from '@page-agent/browser'
import { JevDecisionProvider, JevDecisionRouter, MockJevTransport } from '@page-agent/decision-jev'
import { compareObservations, type GoalContract, type Session } from '@page-agent/runtime'
import { afterEach, expect, it } from 'vitest'

import { LocalBrowserRuntime } from '../../../page-controller/src/LocalBrowserRuntime'

const sessionId = 'comment-session'
const goal: GoalContract = {
	goalId: 'publish-comment',
	description: 'Publish the written comment',
	required: true,
	outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'Draft for test' } },
	status: 'active',
	evidenceIds: [],
}

const session: Session = {
	sessionId,
	owner: { kind: 'in_page', ownerId: 'test' },
	task: {
		taskId: 'comment-task',
		request: goal.description,
		goals: [goal],
		constraints: [],
		allowedCapabilities: ['dom.read', 'dom.write'],
		completionPolicy: 'all_required',
		createdAt: '2026-09-23T00:00:00.000Z',
	},
	status: 'running',
	revision: 1,
	budgets: {
		maxSteps: 10,
		maxElapsedMs: 10_000,
		maxActions: 10,
		maxConsecutiveNoProgress: 2,
		maxProviderCalls: {},
		maxRetriesPerErrorCode: {},
		maxTabs: 1,
	},
	browserScope: { ownedTabIds: [], maxTabs: 1, allowedOrigins: [] },
	createdAt: '2026-09-23T00:00:00.000Z',
	updatedAt: '2026-09-23T00:00:00.000Z',
}

function place(element: HTMLElement, top: number): void {
	const rect = {
		x: 10,
		y: top,
		left: 10,
		top,
		right: 130,
		bottom: top + 24,
		width: 120,
		height: 24,
	}
	Object.defineProperty(element, 'getBoundingClientRect', {
		configurable: true,
		value: () => rect,
	})
	Object.defineProperty(element, 'getClientRects', {
		configurable: true,
		value: () => [rect],
	})
}

let browser: LocalBrowserRuntime | undefined
afterEach(async () => {
	await browser?.dispose()
	document.body.replaceChildren()
})

it('observes and selects a submit button just below the viewport after typing', async () => {
	document.body.innerHTML = `
		<div id="editor" contenteditable="true" aria-label="Write a comment"></div>
		<button id="publish" disabled>Comentar</button>
		<p id="posted"></p>
	`
	const editor = document.querySelector<HTMLElement>('#editor')!
	const publish = document.querySelector<HTMLButtonElement>('#publish')!
	place(editor, window.innerHeight - 30)
	place(publish, window.innerHeight + 40)
	place(document.querySelector<HTMLElement>('#posted')!, window.innerHeight + 100)
	editor.addEventListener('input', () => {
		publish.disabled = !editor.textContent?.trim()
	})
	publish.addEventListener('click', () => {
		document.querySelector<HTMLElement>('#posted')!.textContent = editor.textContent
		editor.textContent = ''
	})
	browser = new LocalBrowserRuntime({ viewportExpansion: -1 })
	const signal = new AbortController().signal
	const request = {
		sessionId,
		tabId: 'in-page',
		scope: 'viewport' as const,
		includeText: true,
		includeNonInteractive: true,
		attributes: [],
		sensitivityPolicyId: 'default',
	}
	const before = await browser.observe(request, signal)
	const editorRef = before.elements.find((element) => element.attributes.id === 'editor')!.ref
	expect(before.elements.find((element) => element.attributes.id === 'publish')?.enabled).toBe(false)
	const inputReceipt = await browser.execute(
		{
			actionId: 'type-comment',
			sessionId,
			expectedSessionRevision: before.revision,
			action: {
				type: 'input',
				target: editorRef,
				text: 'Draft for test' as SecretAwareString,
				replace: true,
			},
		},
		signal
	)
	expect(inputReceipt.status).toBe('executed')
	const after = await browser.observe(request, signal)
	const publishRef = after.elements.find((element) => element.attributes.id === 'publish')!.ref
	expect(after.elements.find((element) => element.attributes.id === 'publish')).toMatchObject({
		visible: true,
		enabled: true,
	})
	const changes = compareObservations(before, after, 'input')
	expect(changes.controls).toContainEqual(
		expect.objectContaining({ label: 'Comentar', change: 'enabled' })
	)
	const transport = new MockJevTransport((jevRequest) => {
		const question = jevRequest.questions[0]
		expect(question.questionId).toBe('transition')
		expect(question.options).toContainEqual(
			expect.objectContaining({
				id: `${after.observationId}:jev:click:${publishRef.localId}`,
				label: expect.stringContaining('Comentar'),
			})
		)
		return {
			requestId: jevRequest.requestId,
			answers: [{ questionId: 'transition', selectedOptionId: `${after.observationId}:jev:click:${publishRef.localId}` }],
		}
	})
	const router = new JevDecisionRouter(
		new JevDecisionProvider({ model: 'jev-test', transport, telemetry: 'off' })
	)
	const decision = await router.decide(
		{
			session,
			goal,
			observation: after,
			changes: { ...changes, submission: 'draft' },
			need: {
				kind: 'select_candidate',
				closedWorld: true,
				computable: false,
				risk: 'R1',
				requiredCapabilities: ['dom.write'],
			},
		},
		signal
	)
	expect(decision.action).toMatchObject({ type: 'click', target: publishRef })
	expect(transport.requests).toHaveLength(1)
	if (decision.action?.type !== 'click') throw new Error('Expected a click action')
	const receipt = await browser.execute(
		{
			actionId: 'publish-comment',
			sessionId,
			expectedSessionRevision: after.revision,
			action: decision.action,
		},
		signal
	)
	expect(receipt.status).toBe('executed')
	expect(document.querySelector('#posted')?.textContent).toBe('Draft for test')
})
