import type {
	ActionReceipt,
	BrowserRuntime,
	ElementRef,
	PageObservation,
	ReferenceValidation,
	SynchronizationResult,
} from '@page-agent/browser'
import { describe, expect, it, vi } from 'vitest'

import { createAgentRuntime } from './AgentRuntime'
import type { DomainEvent, EventSink, IdGenerator, RuntimeDependencies } from './ports'
import { ConfirmationTokenManager } from './security/ConfirmationTokens'
import { InMemorySessionStore } from './session/InMemorySessionStore'

const ref: ElementRef = {
	kind: 'element',
	sessionId: 'session-1',
	tabId: 'in-page',
	documentId: 'document-1',
	observationId: 'observation-1',
	revision: 1,
	localId: 'index:0',
	fingerprint: 'fnv1a:test',
}

function observation(revision: number): PageObservation {
	return {
		observationId: `observation-${revision}`,
		sessionId: 'session-1',
		tabId: 'in-page',
		documentId: 'document-1',
		revision,
		capturedAt: '2026-09-19T10:00:00.000Z',
		page: { url: 'https://example.test/', title: 'Test', origin: 'https://example.test' },
		viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
		regions: [],
		elements: [],
		signals: [],
		sanitization: { policyId: 'default', redactedFields: 0, secretFieldsRemoved: 0 },
	}
}

function dependencies(verifier: RuntimeDependencies['verifier']): RuntimeDependencies {
	let id = 0
	const ids: IdGenerator = {
		next: (kind) => `${kind}-${++id}`,
	}
	const events: DomainEvent[] = []
	const eventSink: EventSink = {
		append: async (event) => {
			const stored = { ...event, sequence: events.length + 1 }
			events.push(stored)
			return stored
		},
	}
	let observationRevision = 0
	const browser: BrowserRuntime = {
		capabilities: {
			mode: 'in_page',
			tabs: false,
			dom: true,
			mutationSignals: true,
			navigationSignals: false,
			screenshots: false,
			arbitraryJavascript: false,
			supportedActions: ['click'],
		},
		observe: vi.fn(async () => observation(++observationRevision)),
		execute: vi.fn(async (request): Promise<ActionReceipt> => ({
			actionId: request.actionId,
			sessionId: request.sessionId,
			startedAt: '2026-09-19T10:00:00.000Z',
			endedAt: '2026-09-19T10:00:00.001Z',
			status: 'executed',
			result: { ok: true, effect: { type: 'element.updated', ref }, signals: [] },
			observedSignals: [],
		})),
		waitFor: async (): Promise<SynchronizationResult> => ({
			status: 'stabilized',
			signals: [],
			endedAt: '2026-09-19T10:00:00.000Z',
		}),
		revalidate: async (elementRef): Promise<ReferenceValidation> => ({
			status: 'fresh',
			ref: elementRef,
		}),
		dispose: async () => undefined,
	}
	return {
		browser,
		decisions: {
			decide: vi.fn(async () => ({
				kind: 'action' as const,
				candidateId: 'candidate-1',
				action: { type: 'click' as const, target: ref },
			})),
		},
		policy: { authorize: vi.fn(async () => 'allow' as const) },
		sessions: new InMemorySessionStore(),
		clock: { now: () => '2026-09-19T10:00:00.000Z' },
		ids,
		events: eventSink,
		verifier,
	}
}

describe('AgentRuntime', () => {
	it('observes and synchronizes the opened tab instead of the original page', async () => {
		let checks = 0
		const deps = dependencies({
			verify: async () => ({ status: ++checks === 1 ? 'inconclusive' : 'satisfied', evidence: [] }),
		})
		deps.decisions.decide = async () => ({
			kind: 'action',
			action: { type: 'tab.open', url: 'https://www.youtube.com/' },
		})
		deps.browser.execute = async (request) => ({
			actionId: request.actionId,
			sessionId: request.sessionId,
			startedAt: '2026-09-19T10:00:00.000Z',
			endedAt: '2026-09-19T10:00:00.001Z',
			status: 'executed',
			result: { ok: true, effect: { type: 'tab.opened', tabId: 'new-tab' }, signals: [] },
			observedSignals: [],
		})
		deps.browser.waitFor = vi.fn(deps.browser.waitFor.bind(deps.browser))
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'open youtube',
			owner: { kind: 'in_page', ownerId: 'test' },
			goals: [
				{
					goalId: 'goal',
					description: 'open youtube',
					required: true,
					status: 'pending',
					evidenceIds: [],
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'YouTube' } },
				},
			],
		})
		await handle.result
		expect(Reflect.get(deps.browser, 'waitFor')).toHaveBeenCalledWith(
			expect.objectContaining({ tabId: 'new-tab' }),
			expect.any(AbortSignal)
		)
		expect(Reflect.get(deps.browser, 'observe')).toHaveBeenLastCalledWith(
			expect.objectContaining({ tabId: 'new-tab' }),
			expect.any(AbortSignal)
		)
	})
	it('runs observe, decide, authorize, execute, and verify as one session flow', async () => {
		let verificationCount = 0
		const deps = dependencies({
			verify: vi.fn(async () => {
				verificationCount += 1
				return verificationCount === 1
					? { status: 'inconclusive' as const, evidence: [] }
					: {
							status: 'satisfied' as const,
							evidence: [
								{
									evidenceId: 'evidence-1',
									type: 'verified' as const,
									source: 'deterministic' as const,
									value: true,
									capturedAt: '2026-09-19T10:00:00.000Z',
									sensitivity: 'public' as const,
								},
							],
						}
			}),
		})
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'Click save',
			owner: { kind: 'in_page', ownerId: 'owner-1' },
			goals: [
				{
					goalId: 'goal-1',
					description: 'Save the form',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'saved' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})

		await expect(handle.result).resolves.toMatchObject({
			status: 'completed',
			currentGoalId: 'goal-1',
		})
		expect(Reflect.get(deps.browser, 'observe')).toHaveBeenCalledTimes(2)
		expect(Reflect.get(deps.browser, 'execute')).toHaveBeenCalledTimes(1)
		await expect(runtime.getSession(handle.id)).resolves.toMatchObject({ status: 'completed' })
	})

	it('re-observes instead of executing an element reference replaced by a dynamic page', async () => {
		let verificationCount = 0
		const deps = dependencies({
			verify: vi.fn(async () => ({
				status: ++verificationCount === 1 ? ('inconclusive' as const) : ('satisfied' as const),
				evidence: [],
			})),
		})
		deps.browser.revalidate = vi.fn(async (elementRef) => ({
			status: 'missing' as const,
			ref: elementRef,
			reason: 'target was replaced',
		}))
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'Fill the search field',
			owner: { kind: 'in_page', ownerId: 'owner-1' },
			goals: [
				{
					goalId: 'goal-1',
					description: 'Fill the search field',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'done' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})

		await expect(handle.result).resolves.toMatchObject({ status: 'completed' })
		expect(Reflect.get(deps.browser, 'execute')).not.toHaveBeenCalled()
		expect(Reflect.get(deps.browser, 'observe')).toHaveBeenCalledTimes(2)
	})

	it('does not spend the no-progress allowance when a dynamic target is replaced', async () => {
		let verificationCount = 0
		let validationCount = 0
		const deps = dependencies({
			verify: vi.fn(async () => ({
				status: ++verificationCount >= 3 ? ('satisfied' as const) : ('inconclusive' as const),
				evidence: [],
			})),
		})
		deps.browser.revalidate = vi.fn(async (elementRef) => ({
			status: ++validationCount === 1 ? ('missing' as const) : ('fresh' as const),
			ref: elementRef,
			reason: validationCount === 1 ? 'target was remounted' : undefined,
		}))
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'Click the dynamic result',
			owner: { kind: 'in_page', ownerId: 'owner-1' },
			budgets: { maxConsecutiveNoProgress: 1 },
			goals: [
				{
					goalId: 'goal-1',
					description: 'Click the dynamic result',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'done' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})

		await expect(handle.result).resolves.toMatchObject({ status: 'completed' })
		expect(Reflect.get(deps.browser, 'execute')).toHaveBeenCalledTimes(1)
		expect(Reflect.get(deps.browser, 'observe')).toHaveBeenCalledTimes(3)
	})

	it('starts an extension session on its explicit initial tab', async () => {
		const deps = dependencies({
			verify: vi.fn(async () => ({ status: 'satisfied' as const, evidence: [] })),
		})
		const claim = vi.fn(async () => undefined)
		const release = vi.fn(async () => undefined)
		Object.assign(deps.browser, {
			tabs: {
				list: vi.fn(),
				open: vi.fn(),
				switch: vi.fn(),
				close: vi.fn(),
				claim,
				release,
			},
		})
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'Inspect the page',
			owner: { kind: 'external_client', ownerId: 'extension' },
			initialTabId: '42',
			goals: [
				{
					goalId: 'goal-1',
					description: 'Inspect the page',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'done' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})

		await expect(handle.result).resolves.toMatchObject({ status: 'completed' })
		expect(claim).toHaveBeenCalledWith('42', handle.id)
		expect(Reflect.get(deps.browser, 'observe')).toHaveBeenCalledWith(
			expect.objectContaining({ tabId: '42' }),
			expect.anything()
		)
		expect(release).toHaveBeenCalledWith('42', handle.id)
		await expect(deps.sessions.get(handle.id)).resolves.toMatchObject({
			browserScope: { activeTabId: '42', ownedTabIds: ['42'] },
		})
	})

	it('returns waiting_user when policy requires confirmation', async () => {
		const deps = dependencies({
			verify: vi.fn(async () => ({ status: 'inconclusive' as const, evidence: [] })),
		})
		let confirmations = 0
		deps.policy.authorize = vi.fn(async (): Promise<'allow' | 'confirm'> =>
			confirmations++ === 0 ? 'confirm' : 'allow'
		)
		deps.confirmations = new ConfirmationTokenManager(
			() => '2026-09-19T10:00:00.000Z',
			() => 'confirmation-1'
		)
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'Click save',
			owner: { kind: 'in_page', ownerId: 'owner-1' },
			goals: [
				{
					goalId: 'goal-1',
					description: 'Save the form',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'saved' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})

		await new Promise((resolve) => setTimeout(resolve, 0))
		const pending = await runtime.getSession(handle.id)
		expect(pending).toMatchObject({
			status: 'waiting_user',
			pendingConfirmationId: 'confirmation-1',
		})
		expect(Reflect.get(deps.browser, 'execute')).not.toHaveBeenCalled()
		await runtime.approveConfirmation(handle.id, 'confirmation-1')
		await expect(handle.result).resolves.toMatchObject({ status: 'blocked' })
	})

	it('pauses and resumes a running session without creating a second execution', async () => {
		const deps = dependencies({
			verify: vi.fn(async () => ({ status: 'satisfied' as const, evidence: [] })),
		})
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'Verify',
			owner: { kind: 'in_page', ownerId: 'owner-1' },
			goals: [
				{
					goalId: 'goal-1',
					description: 'Verify',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'done' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})
		await expect(handle.result).resolves.toMatchObject({ status: 'completed' })
	})

	it('answers a conversation through the semantic model without an active tab or DOM observation', async () => {
		const deps = dependencies({
			verify: vi.fn(async () => ({ status: 'inconclusive' as const, evidence: [] })),
		})
		deps.taskRouter = { route: vi.fn(async () => 'conversation' as const) }
		const generate = vi.fn(async () => ({ text: 'Olá! Como posso ajudar?' }))
		deps.semanticText = { generate }
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'oi',
			owner: { kind: 'extension', ownerId: 'sidepanel' },
			goals: [
				{
					goalId: 'goal-1',
					description: 'oi',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'oi' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})
		await expect(handle.result).resolves.toMatchObject({
			status: 'completed',
			finalResponse: 'Olá! Como posso ajudar?',
		})
		expect(Reflect.get(deps.browser, 'observe')).not.toHaveBeenCalled()
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({ purpose: 'response' }),
			expect.anything()
		)
	})

	it('keeps clarification and the reply in the same session', async () => {
		const deps = dependencies({
			verify: vi.fn(async () => ({ status: 'inconclusive' as const, evidence: [] })),
		})
		let decisions = 0
		deps.decisions.decide = vi.fn(async () =>
			decisions++ === 0
				? { kind: 'clarify' as const, reason: 'Need a destination' }
				: { kind: 'goal_satisfied' as const }
		)
		deps.semanticText = {
			generate: vi.fn(async ({ purpose }) => ({
				text: purpose === 'clarification' ? 'Qual destino você quer abrir?' : 'Concluído.',
			})),
		}
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'abra um site',
			owner: { kind: 'in_page', ownerId: 'test' },
			goals: [
				{
					goalId: 'goal-1',
					description: 'abra um site',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'done' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})
		await new Promise((resolve) => setTimeout(resolve, 0))
		await expect(runtime.getSession(handle.id)).resolves.toMatchObject({ status: 'waiting_user' })
		await runtime.reply(handle.id, 'https://example.test')
		await expect(handle.result).resolves.toMatchObject({
			status: 'completed',
			finalResponse: 'Concluído.',
		})
		await expect(deps.sessions.get(handle.id)).resolves.toMatchObject({
			conversation: expect.arrayContaining([
				expect.objectContaining({ role: 'user', text: 'https://example.test' }),
				expect.objectContaining({ role: 'assistant', purpose: 'clarification' }),
			]),
		})
	})

	it('fails explicitly when the semantic model is unavailable and performs no browser action', async () => {
		const deps = dependencies({
			verify: vi.fn(async () => ({ status: 'inconclusive' as const, evidence: [] })),
		})
		deps.taskRouter = { route: async () => 'conversation' }
		deps.semanticText = {
			generate: async () => {
				throw new Error('Semantic model unavailable')
			},
		}
		const runtime = createAgentRuntime(deps)
		const handle = await runtime.start({
			request: 'oi',
			owner: { kind: 'extension', ownerId: 'sidepanel' },
			goals: [
				{
					goalId: 'goal-1',
					description: 'oi',
					required: true,
					outcome: { kind: 'predicate', predicate: { kind: 'text.contains', text: 'oi' } },
					status: 'pending',
					evidenceIds: [],
				},
			],
		})
		await expect(handle.result).resolves.toMatchObject({ status: 'failed' })
		expect(Reflect.get(deps.browser, 'observe')).not.toHaveBeenCalled()
		expect(Reflect.get(deps.browser, 'execute')).not.toHaveBeenCalled()
	})
})
