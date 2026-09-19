---
schema_version: "1.0"
document_id: "PAJ-COMP-006"
kind: "component-spec"
title: "Sessões, concorrência e persistência"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-003"
  - "PAJ-COMP-001"
requirements:
  - "FR-001..FR-006"
  - "FR-031"
  - "FR-035..FR-037"
---

# Sessões, concorrência e persistência

## 1. Objetivo

Eliminar estado global ambíguo e garantir que side panel, API externa, Hub e futuras integrações observem/controlam a mesma execução.

## 2. Session Manager

```typescript
interface SessionManager {
  create(input: CreateSessionInput): Promise<SessionHandle>
  command(command: SessionCommand): Promise<CommandResult>
  get(sessionId: string): Promise<SessionSnapshot | null>
  list(filter?: SessionFilter): Promise<SessionSummary[]>
  subscribe(sessionId: string, fromEventId?: string): AsyncIterable<SessionEvent>
  recover(): Promise<RecoveryReport>
}
```

## 3. Owners

```typescript
type SessionOwner =
  | { kind: 'side_panel'; instanceId: string }
  | { kind: 'external_page'; origin: string; clientId: string }
  | { kind: 'hub'; connectionId: string }
  | { kind: 'mcp'; clientId: string }
  | { kind: 'in_page'; instanceId: string }
```

Owner inicia/para/responde; observadores adicionais podem ser read-only. Transferência de ownership deve ser explícita.

## 4. Concorrência

MVP:

- uma sessão ativa por runner;
- abas exclusivas por sessão;
- uma sessão waiting/paused ainda mantém ownership por TTL;
- nova sessão conflitante recebe `SESSION_CONFLICT` e opções: observar, cancelar a anterior ou esperar;
- não usar flags globais `isAgentRunning/currentTabId` como verdade.

Futuro: sessões paralelas apenas se escopos de abas forem disjuntos e resources/providers comportarem concurrency.

## 5. Session Store

No in-page, store pode ser memória. Na extensão, usar IndexedDB (já existe dependência `idb`) para:

- snapshots de sessão;
- event log limitado;
- tab ownership;
- pending confirmations;
- checkpoints de goal/budgets;
- config reference sem secrets em claro quando possível.

`chrome.storage.local` fica para preferências/config e um ponteiro mínimo de discovery, não event log de alta frequência.

## 6. Event log

```typescript
interface SessionEventEnvelope<T extends SessionEvent = SessionEvent> {
  protocolVersion: string
  eventId: string
  sessionId: string
  sessionRevision: number
  timestamp: string
  event: T
}
```

Eventos essenciais:

- `session.created/started/paused/resumed/terminal`;
- `goal.activated/satisfied/blocked/failed`;
- `observation.captured` (metadata, não raw por padrão);
- `decision.requested/resolved/gated`;
- `policy.allowed/confirmation_required/denied`;
- `action.started/completed/failed`;
- `sync.completed`;
- `outcome.verified`;
- `user.question/answered/confirmation`;
- `transport.disconnected/recovered`;
- `error`.

## 7. Checkpoints e recuperação

Checkpoint após:

- sessão criada;
- mudança de goal;
- antes/depois de ação R2+;
- entrada em waiting_user/paused;
- mudança de tab ownership;
- resultado terminal.

Recuperação após reload/crash:

1. carregar sessões não terminais;
2. marcar ações `started` sem receipt como `effect_unknown`;
3. revalidar tabs/documents;
4. invalidar refs/observations;
5. para R0/R1, reobservar e decidir;
6. para R2+, verificar outcome antes de qualquer retry;
7. se inconclusivo, solicitar usuário;
8. nunca repetir automaticamente R3/R4.

## 8. Retenção

Defaults propostos:

- sessão terminal e metadata: 7 dias localmente;
- raw observations: não persistir por padrão;
- traces exportados: somente por ação do usuário;
- errors sanitizados: 30 dias se telemetria opt-in;
- secrets: nunca no event log.

Política final depende de OQ-B02.

## 9. Heartbeat e presence

Heartbeat pode indicar UI/runner online, mas não estado de execução. Chaves devem ser namespaced:

```text
runner:{runnerId}:heartbeat
session:{sessionId}:owner-presence
```

Ausência de UI não cancela automaticamente a sessão se runner suportar continuidade. Ausência do runner aciona recovery/blocked.

## 10. Testes

- criação concorrente e conflito;
- owner versus observer;
- command idempotency;
- reload/recovery;
- action in-flight/effect unknown;
- TTL de ownership;
- event resume por `fromEventId`;
- terminal result único;
- storage migration/versioning;
- retenção/redaction.
