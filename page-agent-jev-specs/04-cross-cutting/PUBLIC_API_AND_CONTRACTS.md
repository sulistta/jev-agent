---
schema_version: "1.0"
document_id: "PAJ-XCUT-001"
kind: "api-spec"
title: "API pública, configuração, eventos e erros"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-003"
  - "PAJ-COMP-001"
  - "PAJ-COMP-007"
requirements:
  - "FR-037..FR-042"
  - "NFR-003"
  - "NFR-028"
---

# API pública, configuração, eventos e erros

## 1. Objetivos

- API centrada em sessões, não em um singleton implícito;
- configuração separada por runtime, providers, policies e UI;
- eventos discriminados e versionáveis;
- sem exposição de tipos internos do SDK Jev/LLM;
- compatibilidade externa explícita.

## 2. API in-page v2

```typescript
import { createPageAgent } from 'page-agent'

const agent = createPageAgent({
  browser: { mode: 'in_page', mask: true },
  decisions: {
    jev: { transport, model: 'jev-1.13' },
    generative: { provider }
  },
  policy,
  ui: { panel: true, language: 'pt-BR' }
})

const session = await agent.start({
  task: 'Preencha o formulário com estes dados e pare antes de enviar.',
  capabilities: ['dom.read', 'dom.write']
})

session.onEvent((event) => console.log(event))
const result = await session.result
```

## 3. Tipos públicos

```typescript
interface PageAgent {
  start(input: StartInput): Promise<PublicSessionHandle>
  getSession(sessionId: string): Promise<PublicSessionSnapshot | null>
  dispose(): Promise<void>
}

interface PublicSessionHandle {
  id: string
  result: Promise<PublicSessionResult>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(reason?: string): Promise<void>
  answer(answer: PublicUserAnswer): Promise<void>
  confirm(decision: PublicConfirmationDecision): Promise<void>
  onEvent(listener: (event: PublicSessionEvent) => void): () => void
}
```

## 4. Configuração

```typescript
interface PageAgentConfigV2 {
  browser: InPageBrowserConfig | ExtensionBrowserConfig
  decisions: DecisionProvidersConfig
  policy: PolicyConfig
  execution?: ExecutionConfig
  privacy?: PrivacyConfig
  telemetry?: TelemetryConfig
  ui?: UiConfig | false
}
```

`DecisionProvidersConfig` não herda de provider específico:

```typescript
interface DecisionProvidersConfig {
  jev?: JevProviderFactory | JevProviderConfig
  generative?: GenerativeProviderFactory | GenerativeProviderConfig
  router?: DecisionRouterConfig
}
```

## 5. Resultado público

```typescript
type PublicSessionResult =
  | { status: 'completed'; summary: string; evidence: PublicEvidence[] }
  | { status: 'partially_completed'; summary: string; completedGoals: string[]; remainingGoals: string[] }
  | { status: 'needs_input'; question: PublicQuestion; resumable: boolean }
  | { status: 'blocked'; code: string; summary: string }
  | { status: 'failed'; code: string; summary: string; retryable: boolean }
  | { status: 'cancelled'; summary: string }
```

Evitar boolean `success` isolado: ele não diferencia estados operacionais importantes.

## 6. Eventos públicos

```typescript
type PublicSessionEvent =
  | { type: 'session.status'; status: PublicSessionStatus }
  | { type: 'goal.status'; goal: PublicGoalSnapshot }
  | { type: 'activity'; activity: PublicActivity }
  | { type: 'confirmation.required'; request: PublicConfirmationRequest }
  | { type: 'question.required'; question: PublicQuestion }
  | { type: 'action.preview'; action: PublicActionPreview }
  | { type: 'action.result'; result: PublicActionResult }
  | { type: 'error'; error: PublicError }
  | { type: 'result'; result: PublicSessionResult }
```

Evento público não inclui:

- raw prompts/responses;
- secrets;
- DOM completo;
- chain-of-thought;
- confirmation tokens internos;
- stack traces por padrão.

## 7. Compatibilidade com v1

Adapter opcional:

```typescript
class PageAgentV1Compat {
  constructor(v1Config: AgentConfig) { /* map to v2 */ }
  execute(task: string): Promise<ExecutionResultV1> { /* start + map result */ }
  stop(): Promise<void> { /* cancel active session */ }
}
```

Regras:

- adapter está em pacote/arquivo `compat-v1`;
- não reproduz MacroTool/reflection;
- `history` v1 é projeção best-effort;
- configuração LLM antiga vira generative provider, não provider obrigatório;
- deprecation warning em desenvolvimento;
- remoção planejada no próximo major após janela documentada.

## 8. Extension API v2

```typescript
interface PageAgentExtensionV2 {
  version: string
  capabilities(): Promise<ExtensionCapabilities>
  authorize(request: AuthorizationRequest): Promise<AuthorizationGrant>
  start(request: ExtensionStartRequest): Promise<ExtensionSessionHandle>
  attach(sessionId: string): Promise<ExtensionSessionHandle>
}
```

API deve usar `postMessage` com `targetOrigin`/origin check quando possível e nonce por handshake. Wildcard `'*'` não é aceitável como único controle.

## 9. Versionamento de protocolo/API

- SemVer para packages públicos.
- `protocolVersion` independente, major.minor.
- handshake negocia major igual e minor suportado.
- campos novos opcionais em minor; mudança de significado exige major.
- schemas mantêm `additionalProperties` conforme política explícita.
- capability discovery evita feature guessing.

## 10. Erros públicos

```typescript
interface PublicError {
  code: string
  message: string
  retryable: boolean
  category: 'configuration' | 'provider' | 'browser' | 'policy' | 'transport' | 'runtime'
  details?: Record<string, JsonValue>
}
```

`details` é sanitizado. Consumers fazem branching em `code/category`, nunca em message.

## 11. Testes de contrato

- `tsd`/compilation fixtures;
- snapshots de schemas JSON;
- API v1 adapter mapeia resultados;
- eventos preservam ordem e terminal único;
- extension handshake version mismatch;
- public types não vazam SDKs internos;
- serialização wire-safe;
- mensagens não carregam secrets.
