export type SessionId = string & { readonly __brand: 'SessionId' }
export type TaskId = string & { readonly __brand: 'TaskId' }
export type GoalId = string & { readonly __brand: 'GoalId' }
export type StepId = string & { readonly __brand: 'StepId' }
export type ActionId = string & { readonly __brand: 'ActionId' }
export type EventId = string & { readonly __brand: 'EventId' }
export type RequestId = string & { readonly __brand: 'RequestId' }

export function asSessionId(value: string): SessionId {
	return value as SessionId
}

export function asTaskId(value: string): TaskId {
	return value as TaskId
}

export function asGoalId(value: string): GoalId {
	return value as GoalId
}

export function asStepId(value: string): StepId {
	return value as StepId
}

export function asActionId(value: string): ActionId {
	return value as ActionId
}

export function asEventId(value: string): EventId {
	return value as EventId
}

export function asRequestId(value: string): RequestId {
	return value as RequestId
}
