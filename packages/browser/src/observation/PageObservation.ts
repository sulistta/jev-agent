import type { JsonValue } from '@page-agent/protocol'

import type { ActionName } from '../elements/Candidate'
import type { ElementRef } from '../elements/ElementRef'

export interface PageDescriptor {
	url: string
	title: string
	origin: string
}

export interface ViewportDescriptor {
	width: number
	height: number
	scrollX: number
	scrollY: number
	documentWidth?: number
	documentHeight?: number
}

export type PageRegionKind = 'viewport' | 'modal' | 'form' | 'results' | 'navigation' | 'content'

export interface PageRegion {
	regionId: string
	kind: PageRegionKind
	label?: string
	elementIds: string[]
}

export type Sensitivity = 'public' | 'internal' | 'sensitive' | 'secret'

export interface ObservedElement {
	ref: ElementRef
	tagName: string
	role?: string
	accessibleName?: string
	text?: string
	value?: string
	visible: boolean
	enabled: boolean
	editable: boolean
	attributes: Record<string, string>
	sensitivity: Sensitivity
	inputType?: string
	placeholder?: string
	valueState?: 'empty' | 'present' | 'masked'
	regionId?: string
	supportedActions?: ActionName[]
	state?: {
		visible: boolean
		enabled: boolean
		editable: boolean
		checked?: boolean
		expanded?: boolean
		selected?: boolean
	}
	options?: { label: string; value: string; selected: boolean }[]
	bounds?: { x: number; y: number; width: number; height: number }
}

export type BrowserSignal =
	| { type: 'navigation.started'; at: string }
	| { type: 'navigation.completed'; at: string; url: string }
	| { type: 'document.changed'; at: string; documentId: string }
	| { type: 'route.changed'; at: string; url: string }
	| { type: 'dom.mutated'; at: string; relevant: boolean }
	| { type: 'target.appeared'; at: string; localId: string }
	| { type: 'target.disappeared'; at: string; localId: string }
	| { type: 'target.valueChanged'; at: string; localId: string }
	| { type: 'tab.created'; at: string; tabId: string }
	| { type: 'tab.closed'; at: string; tabId: string }
	| { type: 'tab.activated'; at: string; tabId: string }

export interface SanitizationSummary {
	policyId: string
	redactedFields: number
	secretFieldsRemoved: number
	contentHash?: string
}

export interface PageObservation {
	observationId: string
	sessionId: string
	tabId: string
	documentId: string
	revision: number
	capturedAt: string
	page: PageDescriptor
	viewport: ViewportDescriptor
	regions: PageRegion[]
	elements: ObservedElement[]
	content?: ObservedContentBlock[]
	signals: BrowserSignal[]
	sanitization: SanitizationSummary
	metadata?: Record<string, JsonValue>
}

export interface ObservedContentBlock {
	blockId: string
	text: string
	regionId?: string
	tagName?: string
	bounds?: { x: number; y: number; width: number; height: number }
	contentHash: string
}

export interface ObservationRequest {
	sessionId: string
	tabId?: string
	scope: 'viewport' | 'document' | 'region' | 'targets'
	regionIds?: string[]
	targetRefs?: ElementRef[]
	includeText: boolean
	includeNonInteractive: boolean
	attributes: string[]
	sensitivityPolicyId: string
}
