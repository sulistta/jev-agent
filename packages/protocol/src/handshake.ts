import type { Capability } from './commands'
import type { ProtocolVersion } from './version'

export interface HandshakeRequest {
	type: 'handshake.request'
	requestId: string
	protocolVersion: ProtocolVersion
	actor: import('./envelope').WireActor
	capabilities: Capability[]
	nonce: string
}

export interface HandshakeResponse {
	type: 'handshake.response'
	requestId: string
	protocolVersion: ProtocolVersion
	actor: import('./envelope').WireActor
	accepted: boolean
	capabilities: Capability[]
	error?: import('./errors').WireError
}

export interface ContentDocumentHello {
	type: 'content.document.hello'
	requestId: string
	protocolVersion: ProtocolVersion
	documentId: string
	frameId: number
	capabilities: Capability[]
}

export interface ContentDocumentHelloResponse {
	type: 'content.document.hello.response'
	requestId: string
	protocolVersion: ProtocolVersion
	accepted: boolean
	serverDocumentId?: string
	error?: import('./errors').WireError
}
