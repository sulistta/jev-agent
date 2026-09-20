import type { Capability } from '@page-agent/protocol'
import {
	Copy,
	CornerUpLeft,
	ExternalLink,
	Eye,
	EyeOff,
	FoldVertical,
	HatGlasses,
	Home,
	Loader2,
	UnfoldVertical,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { siGithub } from 'simple-icons'

import type { ExtConfig, LanguagePreference } from '@/agent/config'
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from '@/agent/constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ConfigPanelProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose: () => void
}

interface JevConfig {
	endpoint: string
	model: string
	apiKey?: string
}

const SITE_GRANT_CAPABILITIES: Capability[] = [
	'dom.read',
	'dom.write',
	'navigation',
	'tabs.read',
	'tabs.write',
]

export function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
	const [baseURL, setBaseURL] = useState(config?.baseURL || DEFAULT_LLM_BASE_URL)
	const [model, setModel] = useState(config?.model || DEFAULT_LLM_MODEL)
	const [apiKey, setApiKey] = useState(config?.apiKey)
	const [language, setLanguage] = useState<LanguagePreference>(config?.language)
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [userAuthToken, setUserAuthToken] = useState('')
	const [copied, setCopied] = useState(false)
	const [showToken, setShowToken] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)
	const [jevEndpoint, setJevEndpoint] = useState('')
	const [jevModel, setJevModel] = useState('')
	const [jevApiKey, setJevApiKey] = useState('')
	const [grantOrigin, setGrantOrigin] = useState<string | null>(null)
	const [originGrant, setOriginGrant] = useState<{
		grantId: string
		origin: string
		capabilities: string[]
		expiresAt: string
	} | null>(null)
	const [grantBusy, setGrantBusy] = useState(false)

	const [prevConfig, setPrevConfig] = useState(config)
	if (prevConfig !== config) {
		setPrevConfig(config)
		setBaseURL(config?.baseURL || DEFAULT_LLM_BASE_URL)
		setModel(config?.model || DEFAULT_LLM_MODEL)
		setApiKey(config?.apiKey)
		setLanguage(config?.language)
	}

	// Poll for user auth token every second until found
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null

		const fetchToken = async () => {
			const result = await chrome.storage.local.get('PageAgentExtUserAuthToken')
			const token = result.PageAgentExtUserAuthToken
			if (typeof token === 'string' && token) {
				setUserAuthToken(token)
				if (interval) {
					clearInterval(interval)
					interval = null
				}
			}
		}

		fetchToken()
		interval = setInterval(fetchToken, 1000)

		return () => {
			if (interval) clearInterval(interval)
		}
	}, [])

	useEffect(() => {
		chrome.storage.local.get('jevConfig').then((result) => {
			const stored = result.jevConfig as Partial<JevConfig> | undefined
			if (!stored) return
			if (typeof stored.endpoint === 'string') setJevEndpoint(stored.endpoint)
			if (typeof stored.model === 'string') setJevModel(stored.model)
			if (typeof stored.apiKey === 'string') setJevApiKey(stored.apiKey)
		})
	}, [])

	useEffect(() => {
		const refreshGrant = async () => {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
			if (!tab?.url) return
			try {
				const parsed = new URL(tab.url)
				if (!['http:', 'https:'].includes(parsed.protocol)) return
				setGrantOrigin(parsed.origin)
				const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_V2_GRANT_LIST' })
				if (response?.ok) {
					setOriginGrant(
						response.grants.find((grant: { origin: string }) => grant.origin === parsed.origin) ??
							null
					)
				}
			} catch {
				setGrantOrigin(null)
			}
		}
		void refreshGrant()
	}, [])

	const createGrant = async () => {
		if (!grantOrigin) return
		setGrantBusy(true)
		try {
			const response = await chrome.runtime.sendMessage({
				type: 'PAGE_AGENT_V2_GRANT_CREATE',
				origin: grantOrigin,
				capabilities: SITE_GRANT_CAPABILITIES,
				ttlMs: 60 * 60 * 1000,
			})
			if (response?.ok) setOriginGrant(response)
		} finally {
			setGrantBusy(false)
		}
	}

	const revokeGrant = async () => {
		if (!originGrant) return
		setGrantBusy(true)
		try {
			await chrome.runtime.sendMessage({
				type: 'PAGE_AGENT_V2_GRANT_REVOKE',
				grantId: originGrant.grantId,
			})
			setOriginGrant(null)
		} finally {
			setGrantBusy(false)
		}
	}

	const handleCopyToken = async () => {
		if (userAuthToken) {
			await navigator.clipboard.writeText(userAuthToken)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}
	}

	const handleSave = async () => {
		setSaving(true)
		setSaveError(null)
		try {
			await onSave({
				apiKey,
				baseURL,
				model,
				language,
			})
			if (jevEndpoint.trim() && jevModel.trim()) {
				await chrome.storage.local.set({
					jevConfig: {
						endpoint: jevEndpoint.trim(),
						model: jevModel.trim(),
						apiKey: jevApiKey.trim() || undefined,
					} satisfies JevConfig,
				})
			} else {
				await chrome.storage.local.remove('jevConfig')
			}
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error))
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="flex flex-col gap-4 p-4 relative">
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold">Settings</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onClose}
					className="absolute top-2 right-3 cursor-pointer"
					aria-label="Back"
				>
					<CornerUpLeft className="size-3.5" />
				</Button>
			</div>

			{/* User Auth Token Section */}
			<div className="flex flex-col gap-1.5 p-3 bg-muted/50 rounded-md border">
				<label htmlFor="user-auth-token" className="text-xs font-medium text-muted-foreground">
					User Auth Token
				</label>
				<p className="text-[10px] text-muted-foreground mb-1">
					Give a website the ability to call this extension.
				</p>
				<div className="flex gap-2 items-center">
					<Input
						id="user-auth-token"
						readOnly
						value={
							userAuthToken
								? showToken
									? userAuthToken
									: `${userAuthToken.slice(0, 4)}${'•'.repeat(userAuthToken.length - 8)}${userAuthToken.slice(-4)}`
								: 'Loading...'
						}
						className="text-xs h-8 font-mono bg-background"
					/>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={() => setShowToken(!showToken)}
						disabled={!userAuthToken}
						aria-label={showToken ? 'Hide token' : 'Show token'}
						aria-pressed={showToken}
					>
						{showToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
					</Button>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={handleCopyToken}
						disabled={!userAuthToken}
						aria-label="Copy token"
					>
						{copied ? <span className="">✓</span> : <Copy className="size-3" />}
					</Button>
					<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
						{copied ? 'Token copied' : ''}
					</span>
				</div>
			</div>

			{/* Scoped v2 API grant */}
			<div className="flex flex-col gap-1.5 p-3 bg-muted/50 rounded-md border">
				<label className="text-xs font-medium text-muted-foreground">Extension API v2 access</label>
				<p className="text-[10px] text-muted-foreground">
					{grantOrigin ? `Current site: ${grantOrigin}` : 'No eligible HTTP(S) site is active.'}
				</p>
				{originGrant ? (
					<>
						<p className="text-[10px] text-muted-foreground">
							Capabilities: {originGrant.capabilities.join(', ')}
							<br />
							Expires: {new Date(originGrant.expiresAt).toLocaleString()}
						</p>
						<Button variant="outline" size="sm" disabled={grantBusy} onClick={revokeGrant}>
							Revoke site grant
						</Button>
					</>
				) : (
					<Button size="sm" disabled={!grantOrigin || grantBusy} onClick={createGrant}>
						Authorize this site for 1 hour
					</Button>
				)}
			</div>

			{/* Hub link */}
			<a
				href="/hub.html"
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center justify-between p-3 rounded-md border bg-muted/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
			>
				Manage Page Agent Hub
				<ExternalLink className="size-3" />
			</a>

			<div className="flex flex-col gap-1.5 p-3 bg-muted/50 rounded-md border">
				<div>
					<div className="text-xs font-medium text-muted-foreground">Semantic model provider</div>
					<p className="text-[10px] text-muted-foreground mt-1">
						Generates replies, input text, destination URLs, and summaries. Any OpenAI-compatible
						provider can be used; its credentials are separate from Jev and the User Auth Token.
					</p>
				</div>
				<label htmlFor="base-url" className="text-xs text-muted-foreground">
					Base URL
				</label>
				<Input
					id="base-url"
					placeholder="https://openrouter.ai/api/v1"
					value={baseURL}
					onChange={(e) => setBaseURL(e.target.value)}
					className="text-xs h-8"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="model" className="text-xs text-muted-foreground">
					Model
				</label>
				<Input
					id="model"
					placeholder="openrouter/free"
					value={model}
					onChange={(e) => setModel(e.target.value)}
					className="text-xs h-8"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="api-key" className="text-xs text-muted-foreground">
					API Key
				</label>
				<div className="flex gap-2 items-center">
					<Input
						id="api-key"
						type={showApiKey ? 'text' : 'password'}
						// placeholder="sk-..."
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						className="text-xs h-8"
					/>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={() => setShowApiKey(!showApiKey)}
						aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
					>
						{showApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<label className="text-xs text-muted-foreground">Response Language</label>
				<select
					value={language ?? ''}
					onChange={(e) => setLanguage((e.target.value || undefined) as LanguagePreference)}
					className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
				>
					<option value="">System</option>
					<option value="en-US">English</option>
					<option value="zh-CN">中文</option>
				</select>
			</div>

			{/* Advanced Config */}
			<button
				type="button"
				onClick={() => setAdvancedOpen(!advancedOpen)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer mt-1 font-bold"
			>
				Advanced
				{advancedOpen ? <FoldVertical className="size-3" /> : <UnfoldVertical className="size-3" />}
			</button>

			{advancedOpen && (
				<>
					<div className="flex flex-col gap-1.5 p-3 bg-muted/50 rounded-md border">
						<div>
							<div className="text-xs font-medium text-muted-foreground">Jev provider</div>
							<p className="text-[10px] text-muted-foreground mt-1">
								TypeSafe System One endpoint. A `/v1/` URL is normalized to `/v1/systemone`.
							</p>
						</div>
						<Input
							placeholder="https://api.typesafe.ai/v1/"
							value={jevEndpoint}
							onChange={(e) => setJevEndpoint(e.target.value)}
							className="text-xs h-8"
							aria-label="Jev endpoint"
						/>
						<Input
							placeholder="jev-latest"
							value={jevModel}
							onChange={(e) => setJevModel(e.target.value)}
							className="text-xs h-8"
							aria-label="Jev model"
						/>
						<Input
							type="password"
							placeholder="TypeSafe API key (required)"
							value={jevApiKey}
							onChange={(e) => setJevApiKey(e.target.value)}
							className="text-xs h-8"
							aria-label="Jev API key"
						/>
					</div>
				</>
			)}

			<div className="flex gap-2 mt-2">
				<Button variant="outline" onClick={onClose} className="flex-1 h-8 text-xs cursor-pointer">
					Cancel
				</Button>
				<Button
					onClick={handleSave}
					disabled={saving}
					className="flex-1 h-8 text-xs cursor-pointer"
				>
					{saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
				</Button>
			</div>
			{saveError && (
				<p role="alert" className="text-xs text-destructive">
					{saveError}
				</p>
			)}

			{/* Footer */}
			<div className="mt-4 mb-4 pt-4 border-t border-border/50 flex gap-2 justify-between text-[10px] text-muted-foreground">
				<div className="flex flex-col justify-between">
					<span>
						Version <span className="font-mono">v{__VERSION__}</span>
					</span>

					<a
						href="https://github.com/alibaba/page-agent"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<svg role="img" viewBox="0 0 24 24" className="size-3 fill-current">
							<path d={siGithub.path} />
						</svg>
						<span>Source Code</span>
					</a>
				</div>

				<div className="flex flex-col items-end">
					<a
						href="https://alibaba.github.io/page-agent/"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<Home className="size-3" />
						<span>Home Page</span>
					</a>

					<a
						href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<HatGlasses className="size-3" />
						<span>Privacy</span>
					</a>
				</div>
			</div>

			{/* attribute */}
			<div className="text-[10px] text-muted-foreground bg-background fixed bottom-0 w-full flex justify-around">
				<span className="leading-loose">
					Built with ♥️ by{' '}
					<a
						href="https://github.com/gaomeng1900"
						target="_blank"
						rel="noopener noreferrer"
						className="underline hover:text-foreground"
					>
						@Simon
					</a>
				</span>
			</div>
		</div>
	)
}
