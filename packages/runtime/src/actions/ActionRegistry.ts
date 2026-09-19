import type { ActionName, BrowserAction, RiskTier } from '@page-agent/browser'

import type { Capability } from '../domain'
import { type RuntimeError, runtimeError } from '../errors/RuntimeError'

export interface ActionDefinition {
	type: ActionName
	requiredCapability: Capability
	risk: RiskTier
	confirmationRequired: boolean
}

const definitions: Record<ActionName, ActionDefinition> = {
	click: {
		type: 'click',
		requiredCapability: 'dom.write',
		risk: 'R1',
		confirmationRequired: false,
	},
	input: {
		type: 'input',
		requiredCapability: 'dom.write',
		risk: 'R1',
		confirmationRequired: false,
	},
	select: {
		type: 'select',
		requiredCapability: 'dom.write',
		risk: 'R1',
		confirmationRequired: false,
	},
	focus: {
		type: 'focus',
		requiredCapability: 'dom.write',
		risk: 'R0',
		confirmationRequired: false,
	},
	scroll: {
		type: 'scroll',
		requiredCapability: 'dom.read',
		risk: 'R0',
		confirmationRequired: false,
	},
	'tab.open': {
		type: 'tab.open',
		requiredCapability: 'tabs.write',
		risk: 'R1',
		confirmationRequired: false,
	},
	'tab.switch': {
		type: 'tab.switch',
		requiredCapability: 'tabs.write',
		risk: 'R1',
		confirmationRequired: false,
	},
	'tab.close': {
		type: 'tab.close',
		requiredCapability: 'tabs.write',
		risk: 'R2',
		confirmationRequired: true,
	},
}

export class ActionRegistry {
	get(type: ActionName): ActionDefinition {
		return definitions[type]
	}

	validate(action: BrowserAction): RuntimeError | undefined {
		if (action.type === 'tab.open') {
			try {
				const url = new URL(action.url)
				if (!['http:', 'https:'].includes(url.protocol)) {
					return runtimeError('POLICY_BLOCKED', 'Only HTTP(S) destinations are supported', false)
				}
			} catch {
				return runtimeError('POLICY_BLOCKED', 'Invalid tab destination', false)
			}
		}
		return undefined
	}
}
