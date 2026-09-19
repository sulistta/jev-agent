---
schema_version: "1.0"
document_id: "PAJ-COMP-002"
kind: "component-spec"
title: "Browser Runtime"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-001"
  - "PAJ-ARCH-004"
requirements:
  - "FR-007..FR-012"
  - "FR-022..FR-026"
  - "FR-031..FR-036"
---

# Browser Runtime

## 1. Objetivo

Fornecer a mesma semântica de observação e ação em dois ambientes:

- `LocalBrowserRuntime`: PageController no documento atual;
- `ExtensionBrowserRuntime`: proxy para PageController por aba, com Tabs Runtime.

## 2. Contrato

```typescript
interface BrowserRuntime {
  readonly capabilities: BrowserCapabilities

  observe(request: ObservationRequest, signal: AbortSignal): Promise<PageObservation>
  execute(request: BrowserActionRequest, signal: AbortSignal): Promise<ActionReceipt>
  waitFor(request: SynchronizationRequest, signal: AbortSignal): Promise<SynchronizationResult>
  revalidate(ref: ElementRef, signal: AbortSignal): Promise<ReferenceValidation>

  tabs?: TabsRuntime
  dispose(): Promise<void>
}
```

### Capabilities

```typescript
interface BrowserCapabilities {
  mode: 'in_page' | 'extension'
  tabs: boolean
  dom: boolean
  mutationSignals: boolean
  navigationSignals: boolean
  screenshots: false
  arbitraryJavascript: false
  supportedActions: ActionName[]
  protocolVersion?: string
}
```

## 3. Observe

`ObservationRequest` define escopo e minimização:

```typescript
interface ObservationRequest {
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
```

O adapter deve:

1. resolver tab/document;
2. gerar/atualizar árvore;
3. atribuir revisão monotônica;
4. construir elementos estruturados;
5. sanitizar antes de retornar ao runtime;
6. não retornar referências DOM reais fora do PageController local.

## 4. Execute

```typescript
interface BrowserActionRequest {
  sessionId: string
  actionId: string
  expectedSessionRevision: number
  action: BrowserAction
}

type BrowserAction =
  | { type: 'click'; target: ElementRef; button?: 'primary' }
  | { type: 'input'; target: ElementRef; text: SecretAwareString; replace: boolean }
  | { type: 'select'; target: ElementRef; option: SelectOptionRef }
  | { type: 'scroll'; target?: ElementRef; axis: 'x' | 'y'; amount: ScrollAmount }
  | { type: 'focus'; target: ElementRef }
  | { type: 'tab.open'; url: string }
  | { type: 'tab.switch'; tabId: string }
  | { type: 'tab.close'; tabId: string }
```

Browser Runtime valida apenas integridade técnica/ownership. Policy de negócio é responsabilidade do runtime, mas defesa em profundidade deve recusar sessão/aba/ref incompatível.

## 5. Resultados estruturados

```typescript
type ActionResult =
  | { ok: true; effect: ActionEffect; signals: BrowserSignal[] }
  | { ok: false; error: BrowserRuntimeError }
```

`message` humana pode ser incluída como projeção, mas não substitui códigos.

## 6. Sincronização

`waitFor()` combina sinais:

- `navigation.started/completed`;
- `document.changed`;
- `dom.mutated`;
- `target.valueChanged`;
- `target.appeared/disappeared`;
- `url.matches`;
- `tab.created/closed/activated`;
- `network.idle` apenas quando disponível/confiável;
- `quietWindowMs` sem mutação relevante.

```typescript
interface SynchronizationRequest {
  sessionId: string
  tabId: string
  since: string
  expected: ExpectedChange[]
  settle: { quietWindowMs: number; maxWaitMs: number }
}
```

Resultado diferencia:

```typescript
type SynchronizationResult =
  | { status: 'satisfied'; signals: BrowserSignal[]; endedAt: string }
  | { status: 'stabilized'; signals: BrowserSignal[]; endedAt: string }
  | { status: 'timeout'; signals: BrowserSignal[]; endedAt: string }
  | { status: 'cancelled'; signals: BrowserSignal[]; endedAt: string }
  | { status: 'error'; error: BrowserRuntimeError; endedAt: string }
```

## 7. Identidade do documento

`documentId` muda em:

- navegação full document;
- reload;
- troca de tab target;
- content script reinjetado após documento novo.

SPA route change normalmente mantém `documentId`, mas incrementa `revision`. O detector pode emitir `route.changed`.

## 8. Revalidação

Revalidation usa:

- sessão/ownership;
- tab/document;
- revisão;
- existência/visibilidade/disabled;
- fingerprint semântico (tag, role, accessible name, atributos estáveis, ancestry limitada);
- action compatibility.

XPath ou índice isolado não são suficientes. CSS selectors dinâmicos não devem ser gerados por IA.

## 9. TabsRuntime

```typescript
interface TabsRuntime {
  list(scope: 'owned' | 'available'): Promise<TabDescriptor[]>
  open(input: OpenTabInput, signal: AbortSignal): Promise<TabDescriptor>
  switch(tabId: string, signal: AbortSignal): Promise<void>
  close(tabId: string, signal: AbortSignal): Promise<void>
  claim(tabId: string, sessionId: string): Promise<void>
  release(tabId: string, sessionId: string): Promise<void>
}
```

Somente `owned` deve aparecer como candidatos por padrão. `available` requer capability e UX explícita.

## 10. Contract test suite

Uma suíte compartilhada deve testar ambos os adapters:

- observe gera IDs/revisão coerentes;
- click/input/select/scroll têm results equivalentes;
- stale ref é rejeitada;
- abort funciona;
- navegação muda documentId;
- mutação incrementa revisão;
- waitFor diferencia timeout e satisfied;
- cleanup é idempotente;
- erros usam códigos equivalentes.
