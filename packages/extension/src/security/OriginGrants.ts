import type { Capability } from '@page-agent/protocol'

export interface OriginGrant {
	grantId: string
	origin: string
	capabilities: Capability[]
	issuedAt: string
	expiresAt: string
	revokedAt?: string
}

export interface PublicSessionGrant {
	sessionToken: string
	grantId: string
	origin: string
	capabilities: Capability[]
	expiresAt: string
}

export type GrantErrorCode =
	| 'GRANT_REQUIRED'
	| 'GRANT_EXPIRED'
	| 'GRANT_REVOKED'
	| 'ORIGIN_MISMATCH'
	| 'CAPABILITY_DENIED'
	| 'NONCE_REQUIRED'
	| 'NONCE_REPLAY'
	| 'SESSION_INVALID'

export interface GrantFailure {
	ok: false
	code: GrantErrorCode
	message: string
}

export interface GrantSuccess<T> {
	ok: true
	value: T
}

export type GrantResult<T> = GrantSuccess<T> | GrantFailure

export interface GrantStore {
	get(grantId: string): Promise<OriginGrant | undefined>
	put(grant: OriginGrant): Promise<void>
	list(): Promise<OriginGrant[]>
}

export interface GrantClock {
	now(): string
}

export interface GrantIds {
	next(kind: 'grant' | 'session-token'): string
}

export interface NonceStore {
	has(key: string): Promise<boolean>
	add(key: string, expiresAt: string): Promise<void>
}

export class InMemoryGrantStore implements GrantStore {
	private readonly grants = new Map<string, OriginGrant>()

	get(grantId: string): Promise<OriginGrant | undefined> {
		return Promise.resolve(this.grants.get(grantId))
	}

	async put(grant: OriginGrant): Promise<void> {
		this.grants.set(grant.grantId, grant)
	}

	list(): Promise<OriginGrant[]> {
		return Promise.resolve([...this.grants.values()])
	}
}

export class ChromeStorageGrantStore implements GrantStore {
	private readonly key: string

	constructor(key = 'pageAgentOriginGrants') {
		this.key = key
	}

	async get(grantId: string): Promise<OriginGrant | undefined> {
		const grants = await this.list()
		return grants.find((grant) => grant.grantId === grantId)
	}

	async put(grant: OriginGrant): Promise<void> {
		const grants = await this.list()
		const next = grants.filter((candidate) => candidate.grantId !== grant.grantId)
		next.push(grant)
		await chrome.storage.local.set({ [this.key]: next })
	}

	async list(): Promise<OriginGrant[]> {
		const result = await chrome.storage.local.get(this.key)
		const value = result[this.key]
		if (!Array.isArray(value)) return []
		return value.filter(isOriginGrant)
	}
}

export class InMemoryNonceStore implements NonceStore {
	private readonly nonces = new Set<string>()

	has(key: string): Promise<boolean> {
		return Promise.resolve(this.nonces.has(key))
	}

	async add(key: string, _expiresAt: string): Promise<void> {
		this.nonces.add(key)
	}
}

export class ChromeStorageNonceStore implements NonceStore {
	private readonly key: string

	constructor(key = 'pageAgentUsedNonces') {
		this.key = key
	}

	async has(key: string): Promise<boolean> {
		const entries = await this.read()
		const active = entries.filter((entry) => Date.parse(entry.expiresAt) > Date.now())
		if (active.length !== entries.length) await chrome.storage.local.set({ [this.key]: active })
		return active.some((entry) => entry.key === key)
	}

	async add(key: string, expiresAt: string): Promise<void> {
		const entries = (await this.read()).filter((entry) => Date.parse(entry.expiresAt) > Date.now())
		entries.push({ key, expiresAt })
		await chrome.storage.local.set({ [this.key]: entries })
	}

	private async read(): Promise<{ key: string; expiresAt: string }[]> {
		const result = await chrome.storage.local.get(this.key)
		const value = result[this.key]
		if (!Array.isArray(value)) return []
		return value.filter(isNonceEntry)
	}
}

export class OriginGrantManager {
	private readonly store: GrantStore
	private readonly clock: GrantClock
	private readonly ids: GrantIds
	private readonly sessions = new Map<string, PublicSessionGrant>()
	private readonly nonces: NonceStore
	private readonly nonceLocks = new Map<string, Promise<unknown>>()

	constructor(
		store: GrantStore,
		clock: GrantClock,
		ids: GrantIds,
		nonces: NonceStore = new InMemoryNonceStore()
	) {
		this.store = store
		this.clock = clock
		this.ids = ids
		this.nonces = nonces
	}

	async create(origin: string, capabilities: Capability[], ttlMs: number): Promise<OriginGrant> {
		assertOrigin(origin)
		if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Grant TTL must be positive')
		if (capabilities.some((capability) => !isCapability(capability)))
			throw new Error('Grant contains an unsupported capability')
		const issuedAt = this.clock.now()
		const grant: OriginGrant = {
			grantId: this.ids.next('grant'),
			origin,
			capabilities: [...new Set(capabilities)],
			issuedAt,
			expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(),
		}
		await this.store.put(grant)
		return grant
	}

	list(): Promise<OriginGrant[]> {
		return this.store.list()
	}

	async revoke(grantId: string): Promise<GrantResult<void>> {
		const grant = await this.store.get(grantId)
		if (!grant) return failure('GRANT_REQUIRED', 'Origin grant was not found')
		await this.store.put({ ...grant, revokedAt: this.clock.now() })
		for (const [token, session] of this.sessions)
			if (session.grantId === grantId) this.sessions.delete(token)
		return { ok: true, value: undefined }
	}

	async issueSession(input: {
		grantId: string
		origin: string
		nonce: string
		requestedCapabilities: Capability[]
	}): Promise<GrantResult<PublicSessionGrant>> {
		if (!input.nonce) return failure('NONCE_REQUIRED', 'A fresh nonce is required')
		const grant = await this.store.get(input.grantId)
		const grantCheck = validateGrant(grant, this.clock.now())
		if (grantCheck) return failure(grantCheck, grantCheckMessage(grantCheck))
		if (grant!.origin !== input.origin)
			return failure('ORIGIN_MISMATCH', 'Origin does not match the grant')
		const nonceKey = `${input.grantId}:${input.nonce}`
		const previous = this.nonceLocks.get(nonceKey) ?? Promise.resolve()
		const operation = previous
			.catch(() => undefined)
			.then(async () => {
				if (await this.nonces.has(nonceKey))
					return failure('NONCE_REPLAY', 'Nonce has already been used')
				if (
					input.requestedCapabilities.some(
						(capability) => !grant!.capabilities.includes(capability)
					)
				)
					return failure('CAPABILITY_DENIED', 'Requested capability is outside the grant')

				await this.nonces.add(nonceKey, grant!.expiresAt)
				const session: PublicSessionGrant = {
					sessionToken: this.ids.next('session-token'),
					grantId: grant!.grantId,
					origin: grant!.origin,
					capabilities: [...input.requestedCapabilities],
					expiresAt: grant!.expiresAt,
				}
				this.sessions.set(session.sessionToken, session)
				return { ok: true as const, value: session }
			})
		this.nonceLocks.set(nonceKey, operation)
		try {
			return await operation
		} finally {
			if (this.nonceLocks.get(nonceKey) === operation) this.nonceLocks.delete(nonceKey)
		}
	}

	async issueSessionForOrigin(input: {
		origin: string
		nonce: string
		requestedCapabilities: Capability[]
	}): Promise<GrantResult<PublicSessionGrant>> {
		const candidates = (await this.store.list())
			.filter((grant) => grant.origin === input.origin)
			.filter((grant) => !validateGrant(grant, this.clock.now()))
			.sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))
		const grant = candidates[0]
		if (!grant) return failure('GRANT_REQUIRED', 'No active grant exists for this origin')
		return this.issueSession({ ...input, grantId: grant.grantId })
	}

	async authorize(
		token: string,
		origin: string,
		capability: Capability
	): Promise<GrantResult<PublicSessionGrant>> {
		const session = this.sessions.get(token)
		if (!session) return failure('SESSION_INVALID', 'Public session token is invalid')
		if (session.origin !== origin)
			return failure('ORIGIN_MISMATCH', 'Origin does not match the session')
		if (Date.parse(session.expiresAt) <= Date.parse(this.clock.now())) {
			this.sessions.delete(token)
			return failure('GRANT_EXPIRED', 'Public session grant has expired')
		}
		if (!session.capabilities.includes(capability))
			return failure('CAPABILITY_DENIED', 'Capability is not granted')
		return { ok: true, value: session }
	}

	async validateSession(token: string, origin: string): Promise<GrantResult<PublicSessionGrant>> {
		const session = this.sessions.get(token)
		if (!session) return failure('SESSION_INVALID', 'Public session token is invalid')
		if (session.origin !== origin)
			return failure('ORIGIN_MISMATCH', 'Origin does not match the session')
		if (Date.parse(session.expiresAt) <= Date.parse(this.clock.now())) {
			this.sessions.delete(token)
			return failure('GRANT_EXPIRED', 'Public session grant has expired')
		}
		return { ok: true, value: session }
	}
}

function validateGrant(grant: OriginGrant | undefined, now: string): GrantErrorCode | undefined {
	if (!grant) return 'GRANT_REQUIRED'
	if (grant.revokedAt) return 'GRANT_REVOKED'
	if (Date.parse(grant.expiresAt) <= Date.parse(now)) return 'GRANT_EXPIRED'
	return undefined
}

function grantCheckMessage(code: GrantErrorCode): string {
	return {
		GRANT_REQUIRED: 'Origin grant was not found',
		GRANT_EXPIRED: 'Origin grant has expired',
		GRANT_REVOKED: 'Origin grant was revoked',
		ORIGIN_MISMATCH: 'Origin does not match the grant',
		CAPABILITY_DENIED: 'Requested capability is outside the grant',
		NONCE_REQUIRED: 'A fresh nonce is required',
		NONCE_REPLAY: 'Nonce has already been used',
		SESSION_INVALID: 'Public session token is invalid',
	}[code]
}

function failure(code: GrantErrorCode, message: string): GrantFailure {
	return { ok: false, code, message }
}

function assertOrigin(origin: string): void {
	if (origin === 'null') throw new Error('Opaque origins cannot receive grants')
	const parsed = new URL(origin)
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
		throw new Error('Grant origin must be a canonical HTTP(S) origin')
}

function isCapability(value: unknown): value is Capability {
	return (
		value === 'dom.read' ||
		value === 'dom.write' ||
		value === 'navigation' ||
		value === 'tabs.read' ||
		value === 'tabs.write' ||
		value === 'sensitive.submit'
	)
}

function isOriginGrant(value: unknown): value is OriginGrant {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.grantId === 'string' &&
		typeof candidate.origin === 'string' &&
		Array.isArray(candidate.capabilities) &&
		candidate.capabilities.every((capability) => typeof capability === 'string') &&
		typeof candidate.issuedAt === 'string' &&
		typeof candidate.expiresAt === 'string'
	)
}

function isNonceEntry(value: unknown): value is { key: string; expiresAt: string } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return typeof candidate.key === 'string' && typeof candidate.expiresAt === 'string'
}
