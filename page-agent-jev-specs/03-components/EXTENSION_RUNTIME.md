---
schema_version: "1.0"
document_id: "PAJ-COMP-007"
kind: "component-spec"
title: "Runtime da extensão Chrome MV3"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-002"
  - "PAJ-COMP-006"
  - "ADR-005"
requirements:
  - "FR-031..FR-037"
---

# Runtime da extensão Chrome MV3

## 1. Distribuição por contexto

| Contexto | Responsabilidade | Não deve conter |
|---|---|---|
| Runner page (extension page) | Session Manager, Agent Runtime, providers, event stream. | DOM de sites. |
| Side panel | UI cliente, comandos e subscriptions. | Runtime próprio. |
| Service worker | Routing stateless, APIs `chrome.tabs/tabGroups`, handshake. | Estado autoritativo de sessão longa. |
| Content script | PageController por documento, mask, message endpoint. | Credenciais/provider/Agent Runtime. |
| Main world bridge | API v2 mínima e validação de origin/nonce. | Secrets e APIs Chrome. |
| Hub page | UI/conexão externa como owner/observer do Session Manager. | Runtime separado. |

## 2. Runner

Recomendação: reaproveitar/evoluir o Hub para uma `runner.html` dedicada e invisível/gerenciada, ou tornar a Hub page o host explícito. O spike HYP-004 decide o lifecycle final.

Runner deve:

- ter ID persistente;
- recuperar Session Store;
- aceitar conexões do side panel/Hub via runtime messaging/Port;
- sobreviver ao fechamento do side panel enquanto a página existir;
- não depender da memória do service worker;
- emitir presence/heartbeat namespaced;
- impedir dois runners de assumir a mesma sessão (lease/CAS).

## 3. Protocolo

Envelope:

```typescript
interface ProtocolEnvelope<T> {
  protocol: 'page-agent-ext'
  version: '2.0'
  requestId: string
  sessionId?: string
  sender: ProtocolActor
  timestamp: string
  payload: T
}
```

Unions separadas:

- `SessionCommandMessage`;
- `SessionEventMessage`;
- `DomRequestMessage` / `DomResponseMessage`;
- `TabRequestMessage` / `TabResponseMessage`;
- `HandshakeMessage`;
- `CancelMessage`.

Todo recebimento valida schema em runtime. Ação desconhecida gera `PROTOCOL_UNSUPPORTED_ACTION`; versão incompatível gera `PROTOCOL_MISMATCH`.

## 4. DOM RPC

```typescript
type DomRequest =
  | { kind: 'observe'; request: ObservationRequest }
  | { kind: 'execute'; request: BrowserActionRequest }
  | { kind: 'wait'; request: SynchronizationRequest }
  | { kind: 'revalidate'; ref: ElementRef }
  | { kind: 'dispose'; documentId: string }
```

Response:

```typescript
type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WireError }
```

Nunca retornar `null` para representar falha.

## 5. Document handshake

Quando content script inicia:

1. gera `documentInstanceId` aleatório;
2. envia `content.hello` com tab/frame/document/capabilities;
3. service worker autentica sender.tab e anexa tab ID real;
4. runner registra endpoint;
5. cada DOM request exige document ID atual;
6. navegação/reinjeção invalida endpoint anterior.

Isso impede request destinado a documento antigo de alcançar um documento novo na mesma aba.

## 6. API externa v2

Em vez de token permanente simples no `localStorage`, fluxo recomendado:

1. usuário autoriza origin no side panel;
2. extensão cria grant por origin com capabilities e expiração;
3. main-world solicita handshake;
4. isolated content script valida origin + grant;
5. sessão recebe nonce/capability token de curta duração;
6. comandos são vinculados ao client/session.

API conceitual:

```typescript
const session = await window.PAGE_AGENT_EXT_V2.start({
  task,
  capabilities: ['dom.read', 'dom.write', 'tabs.owned'],
  providerProfile: 'user-default'
})

session.onEvent(listener)
await session.result
await session.cancel()
```

Chaves de provider não são aceitas no payload main-world por padrão. O usuário escolhe perfil configurado na extensão. Modo dev explícito pode permitir override, com aviso.

## 7. Tabs e ownership

- Aba inicial pode ser claimed com consentimento/config.
- Novas abas recebem owner session.
- Tab group é representação visual, não fonte de verdade.
- `experimentalIncludeAllTabs` antigo é substituído por capability explícita e allowlist.
- pinned tabs não são claimed por padrão.
- páginas restritas retornam `CONTENT_SCRIPT_UNAVAILABLE`.
- fechar aba inicial é proibido no MVP; outras abas exigem ownership.

## 8. Service worker restart

Handlers são puros/idempotentes. Após restart:

- reconstroem routing por mensagens/handshake;
- consultam Chrome para tab operations;
- não inferem session state de flags globais;
- mensagens in-flight expiram por deadline/requestId;
- runner reenvia apenas requests tecnicamente seguros.

## 9. Mask e interação humana

Mask é comandada por sessão/documento, não polling global. Mensagens:

- `interaction.lock({sessionId, documentId})`;
- `interaction.unlock(...)`;
- `interaction.takeoverRequested`.

Se usuário solicitar takeover, runtime pausa, unlock, invalida observação e aguarda resume.

## 10. Hub/MCP

- Hub WebSocket recebe comandos e os traduz para Session Manager.
- Approval é por conexão/origin/capabilities.
- `allowAllHubConnection` genérico deve ser removido ou substituído por grant scoped.
- MCP expõe ferramentas de session start/status/cancel/answer; não DOM bruto sem policy.
- Resultado/eventos usam protocolo público, não classes internas.

## 11. Testes E2E críticos

- side panel inicia sessão e fecha sem duplicar runtime;
- API externa e side panel veem a mesma sessão;
- content script reinjetado muda document ID;
- SW reinicia durante observe/action/wait;
- tab aberta por target=_blank é claimed;
- tab fechada manualmente gera evento correto;
- dois owners concorrentes recebem conflito;
- origin não autorizado não recebe API;
- secret/profile não cruza para page/content;
- action stale não executa;
- stop cancela ponta a ponta.
