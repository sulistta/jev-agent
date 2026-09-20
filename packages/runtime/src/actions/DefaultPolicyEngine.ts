import type { BrowserAction } from '@page-agent/browser'

import type { PolicyEngine } from '../ports'
import { ActionRegistry } from './ActionRegistry'

export class DefaultPolicyEngine implements PolicyEngine {
	private readonly registry: ActionRegistry

	constructor(registry = new ActionRegistry()) {
		this.registry = registry
	}

	async authorize(
		input: Parameters<PolicyEngine['authorize']>[0],
		_signal: AbortSignal
	): Promise<'allow' | 'confirm' | 'deny'> {
		const action = input.decision.action
		if (!action) return 'deny'
		const definition = this.registry.get(action.type)
		if (!input.session.task.allowedCapabilities.includes(definition.requiredCapability))
			return 'deny'
		if (this.registry.validate(action)) return 'deny'
		if (
			action.type === 'tab.open' &&
			!this.isOriginAllowed(input.session.browserScope.allowedOrigins, action)
		) {
			return 'deny'
		}
		if (
			action.type === 'tab.open' &&
			input.session.browserScope.ownedTabIds.length >= input.session.browserScope.maxTabs
		)
			return 'deny'
		// The task's explicit capability grant is the authorization boundary. The runtime does not
		// introduce a second action-class confirmation after the user has requested the operation.
		return 'allow'
	}

	private isOriginAllowed(origins: string[], action: BrowserAction): boolean {
		if (action.type !== 'tab.open' || origins.length === 0) return true
		try {
			return origins.includes(new URL(action.url).origin)
		} catch {
			return false
		}
	}
}
