import type { SessionId } from './ids'
import type { JsonObject } from './json'

export type Capability =
	'dom.read' | 'dom.write' | 'navigation' | 'tabs.read' | 'tabs.write' | 'sensitive.submit'

export interface StartRunPayload {
	task: string
	capabilities: Capability[]
	maxSteps?: number
	maxElapsedMs?: number
}

export interface SessionCommandPayloads {
	'session.start': StartRunPayload
	'session.cancel': { reason?: string }
	'session.pause': Record<string, never>
	'session.resume': Record<string, never>
	'session.reply': { text: string }
	'question.answer': { questionId: string; answer: string }
	'action.confirm': { confirmationId: string; approved: boolean }
	'browser.execute': { actionId: string; action: JsonObject }
}

export type SessionCommandType = keyof SessionCommandPayloads

export interface SessionCommand<TType extends SessionCommandType = SessionCommandType> {
	type: TType
	sessionId?: SessionId
	payload: SessionCommandPayloads[TType]
}
