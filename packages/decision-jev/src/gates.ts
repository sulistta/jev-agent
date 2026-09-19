import type { ActionName, RiskTier } from '@page-agent/browser'

export interface ThresholdPolicy {
	version: string
	resolve(input: {
		questionTemplate: string
		risk: RiskTier
		action?: ActionName
		domain?: string
	}): {
		autoActMin: number
		verifyMin: number
		humanBelow: number
	}
}

export class SeedThresholdPolicy implements ThresholdPolicy {
	readonly version = 'seed-2026-09-19'

	resolve(input: { questionTemplate: string; risk: RiskTier; action?: ActionName }): {
		autoActMin: number
		verifyMin: number
		humanBelow: number
	} {
		if (input.risk === 'R3') return { autoActMin: 1, verifyMin: 1, humanBelow: 1 }
		if (input.risk === 'R2') return { autoActMin: 1, verifyMin: 0.85, humanBelow: 0.6 }
		if (input.risk === 'R1') return { autoActMin: 0.85, verifyMin: 0.35, humanBelow: 0.2 }
		return { autoActMin: 0.75, verifyMin: 0.5, humanBelow: 0.5 }
	}
}

export type GateRoute = 'auto' | 'verify' | 'human' | 'none'

export function routeByConfidence(
	confidence: number | undefined,
	policy: ReturnType<ThresholdPolicy['resolve']>
): GateRoute {
	if (confidence === undefined || confidence < policy.humanBelow) return 'human'
	if (confidence < policy.verifyMin) return 'none'
	if (confidence < policy.autoActMin) return 'verify'
	return 'auto'
}

export type LanguagePolicy = 'preserve' | 'english_questions' | 'normalized_bilingual'
