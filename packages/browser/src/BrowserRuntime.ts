import type { ActionReceipt, BrowserActionRequest } from './actions/ActionIntent'
import type { BrowserCapabilities } from './capabilities'
import type { ElementRef, ReferenceValidation } from './elements/ElementRef'
import type { ObservationRequest, PageObservation } from './observation/PageObservation'
import type { SynchronizationRequest, SynchronizationResult } from './synchronization/WaitCondition'

export interface BrowserRuntime {
	readonly capabilities: BrowserCapabilities

	observe(request: ObservationRequest, signal: AbortSignal): Promise<PageObservation>
	execute(request: BrowserActionRequest, signal: AbortSignal): Promise<ActionReceipt>
	waitFor(request: SynchronizationRequest, signal: AbortSignal): Promise<SynchronizationResult>
	revalidate(ref: ElementRef, signal: AbortSignal): Promise<ReferenceValidation>

	tabs?: TabsRuntime
	dispose(): Promise<void>
}

export interface TabsRuntime {
	list(scope: 'owned' | 'available'): Promise<TabDescriptor[]>
	open(input: OpenTabInput, signal: AbortSignal): Promise<TabDescriptor>
	switch(tabId: string, signal: AbortSignal): Promise<void>
	close(tabId: string, signal: AbortSignal): Promise<void>
	claim(tabId: string, sessionId: string): Promise<void>
	release(tabId: string, sessionId: string): Promise<void>
}

export interface TabDescriptor {
	tabId: string
	windowId?: string
	url: string
	title: string
	ownedBy?: string
	active: boolean
}

export interface OpenTabInput {
	url: string
	activate?: boolean
}
