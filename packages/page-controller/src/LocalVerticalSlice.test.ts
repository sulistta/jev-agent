import type { GoalContract } from '@page-agent/runtime'
import {
	DeterministicDecisionRouter,
	DeterministicOutcomeVerifier,
	InMemorySessionStore,
	createAgentRuntime,
} from '@page-agent/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LocalBrowserRuntime } from './LocalBrowserRuntime'

describe('local runtime vertical slice', () => {
	let browser: LocalBrowserRuntime

	beforeEach(() => {
		document.body.innerHTML = '<button id="save" type="button">Save</button>'
		const button = document.querySelector<HTMLButtonElement>('#save')!
		Object.defineProperty(button, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ x: 10, y: 10, width: 80, height: 24, top: 10, right: 90, bottom: 34, left: 10 }),
		})
		Object.defineProperty(button, 'getClientRects', {
			configurable: true,
			value: () => [{ x: 10, y: 10, width: 80, height: 24 }],
		})
		window.history.replaceState({}, '', '/')
	})

	afterEach(async () => {
		await browser.dispose()
	})

	it('clicks a planned control and completes only after URL evidence', async () => {
		const button = document.querySelector<HTMLButtonElement>('#save')!
		button.addEventListener('click', () => window.history.pushState({}, '', '/saved'))
		browser = new LocalBrowserRuntime({ viewportExpansion: -1, interactiveWhitelist: [button] })

		let id = 0
		const goal: GoalContract = {
			goalId: 'goal-save',
			description: 'Save the form',
			required: true,
			outcome: { kind: 'predicate', predicate: { kind: 'url.matches', pattern: '/saved$' } },
			status: 'pending',
			evidenceIds: [],
		}
		const runtime = createAgentRuntime({
			browser,
			decisions: new DeterministicDecisionRouter({ 'goal-save': { type: 'click', label: 'save' } }),
			policy: { authorize: async () => 'allow' },
			sessions: new InMemorySessionStore(),
			clock: { now: () => '2026-09-19T10:00:00.000Z' },
			ids: { next: (kind) => `${kind}-${++id}` },
			events: {
				append: async (event) => ({ ...event, sequence: 1 }),
			},
			verifier: new DeterministicOutcomeVerifier(() => '2026-09-19T10:00:00.000Z'),
		})

		const handle = await runtime.start({
			request: 'Save the form',
			owner: { kind: 'in_page', ownerId: 'test' },
			goals: [goal],
			budgets: { maxSteps: 4, maxActions: 2 },
		})

		await expect(handle.result).resolves.toMatchObject({
			status: 'completed',
			currentGoalId: 'goal-save',
		})
		expect(window.location.pathname).toBe('/saved')
	})
})
