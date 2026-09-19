import type { JsonValue } from '@page-agent/protocol'

import type { ElementRef } from './ElementRef'

export type ActionName =
	'click' | 'input' | 'select' | 'scroll' | 'focus' | 'tab.open' | 'tab.switch' | 'tab.close'

export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3'

export interface RiskAssessment {
	tier: RiskTier
	reasons: string[]
}

export interface CandidateSignal {
	type: 'role' | 'label' | 'text' | 'visibility' | 'enabled' | 'region' | 'heuristic'
	value: string | boolean | number
}

export interface Candidate<TAction extends ActionName = ActionName> {
	candidateId: string
	observationId: string
	action: TAction
	target?: ElementRef
	args: JsonValue
	semanticLabel: string
	regionId?: string
	deterministicSignals: CandidateSignal[]
	risk: RiskAssessment
}
