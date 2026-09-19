---
schema_version: "1.0"
document_id: "PAJ-DEL-003"
kind: "migration-plan"
title: "Migração, compatibilidade e remoção de legado"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-001"
  - "PAJ-DEL-001"
---

# Migração, compatibilidade e remoção de legado

## 1. Estratégia de strangler sem arquitetura dupla permanente

Durante a transição, código novo pode coexistir com o antigo apenas por adapters explícitos. O estado final contém um único runtime. O antigo nunca chama o novo “por dentro” enquanto o novo também chama o antigo; evitar ciclos e ownership ambíguo.

Sequência:

1. criar contratos novos isolados;
2. adaptar PageController existente ao Browser Runtime;
3. construir vertical slice novo;
4. migrar entrypoint in-page;
5. migrar extensão/Hub/API;
6. manter compat-v1 na borda;
7. remover core/tools/prompts antigos;
8. remover adapters temporários.

## 2. Matriz detalhada

| Item atual | Estado final | Ação | Condição de remoção |
|---|---|---|---|
| `packages/core/src/PageAgentCore.ts` | `packages/runtime` | Reescrever/substituir | Facades/extension não importam; E2E v2 verde. |
| `AgentConfig extends LLMConfig` | configs compostas | Quebrar herança | Public API v2 e compat mapping prontos. |
| `AgentReflection` | eventos/goals/evidence estruturados | Remover | UI/history migrados. |
| `MacroToolInput/Result` | `DecisionResult` + ActionRequest | Remover | provider generativo não depende. |
| `#packMacroTool()` | Action Registry/Executor | Remover | runtime action pipeline pronto. |
| tool `done` | Outcome Verifier | Remover | contracts/outcomes cobrem conclusão. |
| tool `wait` | SynchronizationCoordinator | Remover como ação livre | wait signal/timeout implementado. |
| tool `ask_user` | Session waiting_user | Substituir | UI/API responde question IDs. |
| tools DOM antigos | Action Definitions | Adaptar/mover | Browser contract tests verdes. |
| `execute_javascript` | ausente | Remover | docs/API/tests/bundle sem referência. |
| system prompts ReAct | templates de provider específicos | Remover | nenhum runtime antigo. |
| `packages/llms` | `decision-generative` | Refatorar | clientes usam interface nova. |
| `autoFixer.ts` | schema validation por provider | Remover se sem consumidor | compat/provider tests verdes. |
| `BrowserState` textual | `PageObservation` + projection | Deprecar/remover | v1 compat não exige internamente. |
| `selectorMap` por índice | mapping interno de ElementRef | Preservar internamente | índice não escapa. |
| `ActionResult {success,message}` | union estruturada | Substituir | adapters traduzem temporariamente. |
| `PageAgent extends PageAgentCore` | facade por composição | Reescrever | API v2/compat. |
| `MultiPageAgent extends PageAgentCore` | runner + runtime + remote adapter | Remover | extension E2E/Hub migrados. |
| `RemotePageController` | ExtensionBrowserRuntime | Reescrever | typed RPC/contract suite. |
| `TabsController` | TabsRuntime/session ownership | Evoluir | no `any`, ownership testado. |
| `isAgentRunning` global | session status no store | Remover | UI/mask usam session events. |
| `agentHeartbeat` global | runner/session presence | Substituir | recovery tests. |
| `currentTabId` global | current tab por sessão | Remover | tabs ownership/store. |
| polling mask 500 ms | lock/unlock events | Remover | takeover/E2E. |
| API token em localStorage | grant/nonce | Substituir | API v2/security tests. |
| API v1 `PAGE_AGENT_EXT` | compat adapter | Deprecar | janela de migração definida. |
| Hub runtime/hook | Session client | Migrar | mesma sessão/event stream. |
| MCP bridge antigo | Session client tools | Migrar | policy-aware contract. |

## 3. Compatibilidade pública

### In-page

Possível manter:

```typescript
new PageAgent(v1Config).execute(task)
```

internamente:

- cria facade v2;
- mapeia LLM config para generative provider;
- configura Jev conforme default/opt-in explícito;
- converte resultado terminal para `{ success, data, history }`;
- emite warning de deprecation.

Limitação documentada: histórico/reflection v1 não terá significado idêntico.

### Extensão

- `PAGE_AGENT_EXT_V2` é API nova.
- `PAGE_AGENT_EXT` pode delegar à v2 durante uma versão major.
- `config.apiKey` no main-world v1 deve ser considerado risco e removido no v2.
- v1 recebe apenas capacidades compatíveis e não pode contornar grants.

## 4. Migração de dados/config da extensão

Versão de schema em IndexedDB/storage:

```typescript
interface StoredConfigEnvelope<T> {
  schemaVersion: number
  updatedAt: string
  value: T
}
```

Mapeamentos:

- `llmConfig` → `providerProfiles.generative.default`;
- `language` → `ui.language`;
- `maxSteps` → `execution.budgets.maxSteps`;
- `systemInstruction` → task/integration policy (não Jev state);
- `experimentalLlmsTxt` → feature removida ou capability documentada após review;
- `experimentalIncludeAllTabs` → não migrar automaticamente para permissão ampla; exigir nova escolha;
- `PageAgentExtUserAuthToken` → revogar/migrar para grant por origin após consentimento;
- `allowAllHubConnection` → não migrar como allow-all; exigir grants.

Falha de migration:

- preservar backup;
- resetar somente config afetada;
- nunca apagar histórico/credencial sem informar;
- oferecer retry/export.

## 5. Feature flags temporárias

| Flag | Finalidade | Remoção |
|---|---|---|
| `runtimeV2` | Selecionar vertical slice novo durante migração. | Após TASK-2004. |
| `extensionProtocolV2` | Ativar remote adapter novo. | Após TASK-2003. |
| `jevDecisions` | Habilitar templates Jev por task family. | Quando Jev default ou removido. |
| `outcomeVerifierV2` | Comparar conclusão nova/antiga em shadow. | Antes de remover `done`. |
| `externalApiV2` | API/grants novos. | Após janela v1. |

Cada flag precisa de owner, default por canal, métrica e data/condição de remoção.

## 6. Shadow mode

Permitido para decisões sem efeito:

- runtime antigo executa;
- novo Decision Engine avalia mesma observação/candidates;
- resposta nova é registrada, nunca executada;
- comparar seleção/confiança/outcome.

Não duplicar provider state sensível sem consentimento. Shadow mode não pode executar actions.

## 7. Remoção segura

Checklist por componente:

- `rg` confirma zero imports de produção;
- testes do substituto cobrem comportamentos válidos;
- exemplos/docs migrados;
- bundle diff confirma exclusão;
- package dependencies atualizadas;
- changelog/migration note;
- licença/atribuições preservadas;
- rollback possível pelo release anterior, não por manter código morto.

## 8. Evitar estes anti-padrões

- `JevAgentCore extends PageAgentCore`;
- `if (useJev) oldLoop else newLoop` permanente;
- converter Jev answer em tool-call textual do MacroTool;
- manter `done` como fallback silencioso;
- dois Session Managers para side panel/API;
- protocolo v2 aceitando mensagens v1 sem validação;
- reintroduzir `any` “temporariamente” em exports;
- migrar permissões amplas automaticamente.
