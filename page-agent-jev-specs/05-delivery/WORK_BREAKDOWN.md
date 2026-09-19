---
schema_version: "1.0"
document_id: "PAJ-DEL-002"
kind: "work-breakdown-structure"
title: "Backlog executável — épicos e tarefas"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-DEL-001"
  - "PAJ-PROD-003"
---

# Backlog executável — épicos e tarefas

## Convenções

- Cada tarefa deve virar issue/PR rastreável.
- `Deps` aponta para tarefas que bloqueiam o início, não apenas o merge.
- “Aceite” é o mínimo; Definition of Done global também se aplica.
- Caminhos são propostos e podem mudar mantendo os package boundaries.

## EPIC-1000 — Baseline e pesquisa de risco

### Objetivo

Produzir referência mensurável e fechar decisões externas.

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1001 | Fixar commit upstream, criar branch/tag do fork e manifest de baseline. | — | raiz, `docs/baseline/` | SHA, versões e comandos reproduzíveis registrados. |
| TASK-1002 | Pipeline CI baseline: install, lint, typecheck, unit, build libs/ext. | 1001 | `.github/workflows`, `scripts/ci.js` | CI verde e artefato de extensão produzido. |
| TASK-1003 | Criar fixtures web locais para form, modal, SPA, popup, virtual list e adversarial DOM. | 1001 | `packages/e2e/fixtures/` | Fixtures determinísticas e servidas localmente. |
| TASK-1004 | Rodar Page Agent antigo nas tarefas baseline e capturar completion/latency/calls/cost. | 1003 | `packages/evals/baseline/` | Relatório versionado com falhas e vídeos/traces sanitizados. |
| TASK-1005 | Spike Jev Direct HTTP no browser e extensão empacotada. | 1001 | `spikes/jev-browser/` | CORS, abort, auth, bundle e latência documentados. |
| TASK-1006 | Spike SDK Jev Node e proxy adapter. | 1001 | `spikes/jev-node/` | Compat Node 20+, request/response e custo operacional registrados. |
| TASK-1007 | Spike runner lifecycle: side panel close, Hub tab, SW restart. | 1003 | `spikes/extension-runner/` | Decisão com evidência para ADR/EXTENSION_RUNTIME. |
| TASK-1008 | Spike ElementRef/fingerprint em SPA e virtualized list. | 1003 | `spikes/element-ref/` | Taxa de revalidação/falso match medida. |
| TASK-1009 | Ratificar credencial MVP e política de proxy/BYOK. | 1005,1006 | ADR-007 | Decisão aceita e security review. |
| TASK-1010 | Atualizar threat model com achados dos spikes. | 1005,1007,1008 | security docs | P0 threats e owners definidos. |

## EPIC-1100 — Protocol e tipos de domínio

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1101 | Scaffold `@page-agent/protocol`. | 1001 | `packages/protocol/` | build/test/package exports verdes. |
| TASK-1102 | Implementar schemas de envelope, actors, wire error e handshake. | 1101 | `protocol/src/envelopes` | parse/serialize e version mismatch testados. |
| TASK-1103 | Implementar unions DOM/Tab RPC. | 1102 | `protocol/src/dom`, `tabs` | exhaustive handlers sem `any`. |
| TASK-1104 | Scaffold `@page-agent/browser` e tipos Observation/Ref/Action/Sync. | 1101 | `packages/browser/` | API pública documentada e tsd tests. |
| TASK-1105 | Scaffold `@page-agent/runtime` e tipos Session/Goal/Decision/Evidence. | 1101,1104 | `packages/runtime/` | state unions compilam e são serializáveis quando necessário. |
| TASK-1106 | Clock, ID generator, EventSink e mocks. | 1105 | `runtime/src/ports` | testes determinísticos sem Date/random globais. |
| TASK-1107 | Runtime error taxonomy e mappers. | 1103,1105 | `runtime/src/errors` | códigos cobrem P0 e mensagens são sanitizadas. |
| TASK-1108 | Regras de import e detecção de ciclos. | 1101-1105 | ESLint, dependency graph | CI falha em import proibido/ciclo. |
| TASK-1109 | Snapshot/versioning dos schemas públicos. | 1102-1105 | contract tests | breaking change detectada no CI. |

## EPIC-1200 — PageController e Observation Pipeline

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1201 | Mapear `FlatDomTree` para `PageObservation`. | 1104 | `page-controller/src/observation` | fixture DOM produz schema completo. |
| TASK-1202 | Document/observation/revision lifecycle. | 1201 | observation store | navegação/SPA/mutation tests. |
| TASK-1203 | ElementRef local e mapping interno para highlight index/ref. | 1202 | `page-controller/src/elements` | índice não aparece na API pública. |
| TASK-1204 | Fingerprint e `revalidate()`. | 1203,1008 | elements | stale/missing/forbidden/fresh testados. |
| TASK-1205 | ActionResult e BrowserError estruturados. | 1107,1203 | `PageController.ts`, actions | nenhuma action retorna erro apenas em string. |
| TASK-1206 | LocalBrowserRuntime adapter. | 1201-1205 | `packages/in-page` ou browser adapter | contract suite inicial passa. |
| TASK-1207 | Mutation/navigation signal collector. | 1202 | signals | quiet window e route/document change confiáveis. |
| TASK-1208 | SynchronizationCoordinator local. | 1207 | browser sync | satisfied/stabilized/timeout/cancel testados. |
| TASK-1209 | Sanitizer e sensitivity tags. | 1201 | `browser/observation/sanitize` | secret canaries ausentes. |
| TASK-1210 | Regiões (modal/form/results/nav) e summaries. | 1201 | regions | modal precedence e region tests. |
| TASK-1211 | CandidateGenerator operation compatibility. | 1210 | `runtime/candidates` | invisível/disabled/incompatível filtrados. |
| TASK-1212 | Ranking determinístico e expansão progressiva. | 1211 | candidates | listas grandes não truncadas cegamente. |
| TASK-1213 | Projeção textual compat temporária. | 1201 | `compat/BrowserStateProjection` | demos antigos continuam legíveis. |
| TASK-1214 | Performance benchmark DOM/observation. | 1201-1212 | evals/perf | p95/counters publicados. |

## EPIC-1300 — Agent Runtime e sessões

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1301 | Session state machine e invariant tests. | 1105-1107 | `runtime/src/session` | todas transições e terminal único. |
| TASK-1302 | In-memory SessionStore com CAS/revisions. | 1301 | session store | command replay/idempotency testado. |
| TASK-1303 | GoalManager e TaskContract. | 1301 | `runtime/src/task` | required/dependency/partial semantics. |
| TASK-1304 | Runtime loop skeleton. | 1206,1301-1303 | `runtime/src/loop` | fake browser/provider conclui fixture. |
| TASK-1305 | DecisionNeed/Router e deterministic provider. | 1304 | `runtime/src/decisions` | computable path sem provider externo. |
| TASK-1306 | Budgets/deadlines. | 1304 | execution | cada budget gera código correto. |
| TASK-1307 | Cancel/pause/resume/waiting user. | 1304,1306 | session/loop | cancel em todas await boundaries. |
| TASK-1308 | ProgressTracker/cycle detection. | 1304 | recovery | ciclos A→A e A↔B detectados. |
| TASK-1309 | Event log e public projection inicial. | 1302,1304 | events | ordenação, redaction, resume por event ID. |
| TASK-1310 | OutcomeVerifier determinístico mínimo. | 1303,1206 | outcomes | goal não conclui sem evidence. |
| TASK-1311 | Vertical slice local sem IA. | 1212,1305,1310 | in-page/e2e | form→click→verify executa fim a fim. |
| TASK-1312 | Takeover/resume local. | 1307,1311 | mask/UI adapter | refs antigas invalidadas após resume. |

## EPIC-1400 — Jev Decision Provider

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1401 | Scaffold `@page-agent/decision-jev` e JevTransport. | 1005,1105 | package novo | browser build sem Node polyfills. |
| TASK-1402 | Implementar transport escolhido e mock/replay. | 1401,1009 | transports | auth/abort/error/retry tests. |
| TASK-1403 | QuestionTemplate registry/versioning/lint. | 1401 | questions | IDs/versions únicos e criteria coerentes. |
| TASK-1404 | `candidate.select.v1` Choice. | 1212,1402,1403 | questions/projections | map candidate ID seguro e `none`. |
| TASK-1405 | Noul de absolute fit/relevance. | 1403 | questions | thresholds independentes e tests. |
| TASK-1406 | Score de outcome/semantic match. | 1310,1403 | questions | rubrica descritiva; sem magnitude exata. |
| TASK-1407 | Batch planner para perguntas independentes. | 1404-1406 | provider | mesma state hash; dependências separadas. |
| TASK-1408 | Confidence gate/margins por risk tier. | 1404 | gates | decisões alta/média/baixa roteadas. |
| TASK-1409 | Retry/circuit breaker/deadline. | 1402 | transport | matrix de falhas coberta. |
| TASK-1410 | LanguagePolicy PT/EN. | 1403 | projections | nenhuma tradução altera execution values. |
| TASK-1411 | Integrar Jev no DecisionRouter. | 1305,1404,1408 | runtime composition | semantic closed-world usa Jev. |
| TASK-1412 | Dataset inicial de candidate selection. | 1003,1404 | `packages/evals/datasets` | labels duplamente revisadas e versionadas. |
| TASK-1413 | Calibration report e seed thresholds. | 1412 | eval runner | accuracy/coverage/calibration por risco/idioma. |

## EPIC-1500 — Policies, outcomes e ações seguras

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1501 | Action Registry tipado MVP. | 1104,1304 | `runtime/src/actions` | actions conhecidas e exhaustive mapping. |
| TASK-1502 | Risk classifier contextual. | 1501 | policies | submit/publicar/excluir fixtures classificadas. |
| TASK-1503 | Policy Engine/capabilities/origins. | 1502 | policies | allow/confirm/deny testados. |
| TASK-1504 | Confirmation token binding/expiry. | 1503,1307 | confirmations | replay/target change recusados. |
| TASK-1505 | Outcome Contract DSL/schemas. | 1310 | outcomes | all/any/none/deadline validam. |
| TASK-1506 | Deterministic predicates completos. | 1505,1206 | outcomes/predicates | URL/text/element/value/tab/document. |
| TASK-1507 | Semantic predicate via Jev. | 1406,1505 | outcomes | usado apenas quando configurado; evidence. |
| TASK-1508 | ExpectedChanges por action. | 1208,1501 | sync | click/input/select/tab mappings. |
| TASK-1509 | Idempotency/effect_unknown flow. | 1501,1505 | actions/recovery | side effect não repetido cegamente. |
| TASK-1510 | Remover JS action do novo registry/exports. | 1501 | page-controller facade | impossível solicitar pela API v2. |
| TASK-1511 | Threat tests de actions/policies. | 1503-1510 | security tests | todos SEC P0 relevantes verdes. |

## EPIC-1600 — Generative Provider opcional

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1601 | Interface e package `decision-generative`. | 1105 | package | runtime não importa implementação. |
| TASK-1602 | Adaptar OpenAI client atual. | 1601 | mover de `packages/llms` | abort/retry/usage preservados. |
| TASK-1603 | Structured task decomposition. | 1303,1602 | purposes | plano validado antes de aceitar. |
| TASK-1604 | Value generation. | 1602,1503 | purposes | output schema/policy/confirmation. |
| TASK-1605 | Replanning com trace resumido. | 1308,1602 | purposes | só após trigger/budget correto. |
| TASK-1606 | Result formatter. | 1309,1602 | purposes | não altera status/evidence. |
| TASK-1607 | Provider disabled/fallback flows. | 1305,1601 | router | tasks Jev-fit funcionam sem ele. |
| TASK-1608 | Prompt injection/schema/security tests. | 1603-1605 | tests | output hostil não gera ação. |

## EPIC-1700 — Extensão v2 e remote runtime

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1701 | Implementar runner host conforme spike. | 1007,1304 | extension runner entrypoint | lifecycle/lease testados. |
| TASK-1702 | IndexedDB SessionStore/migrations. | 1302,1701 | extension store | crash/reload recovery. |
| TASK-1703 | Protocol v2 routing no SW. | 1102,1103 | background | stateless, validated, idempotent. |
| TASK-1704 | Content handshake/document lifecycle. | 1202,1703 | content | reinjeção invalida endpoint antigo. |
| TASK-1705 | Typed DOM RPC endpoint. | 1206,1704 | content/page-controller | sem `any/null`, abort/deadline. |
| TASK-1706 | ExtensionBrowserRuntime client. | 1705 | extension/browser | contract suite com local. |
| TASK-1707 | Typed Tabs RPC. | 1703 | tabs controller/background | erros estruturados e sender validation. |
| TASK-1708 | Tab ownership/claim/release. | 1702,1707 | sessions/tabs | conflito entre sessões bloqueado. |
| TASK-1709 | Sync signals remotos. | 1208,1705 | remote sync | navigation/mutation/tab events. |
| TASK-1710 | Mask/takeover por mensagens de sessão. | 1312,1705 | content/mask | sem polling global 500 ms. |
| TASK-1711 | SW restart/reconnect recovery. | 1701-1709 | extension integration | requests seguras recuperam; efeitos incertos não repetem. |
| TASK-1712 | Multi-tab E2E. | 1706-1711 | e2e extension | open/switch/close/target blank. |

## EPIC-1800 — API externa, Hub/MCP e UI

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1801 | Public API v2 in-page. | 1311,1505 | `packages/in-page` | tsd/examples/E2E. |
| TASK-1802 | Public events/result projection. | 1309,1801 | runtime/public | sem raw secrets/CoT. |
| TASK-1803 | Extension API v2 handshake/grants. | 1701,1703 | main-world/content/runner | origin/capability/expiry tests. |
| TASK-1804 | Session handle/event bridge externo. | 1803 | extension API | start/attach/cancel/result. |
| TASK-1805 | Side panel conectado ao Session Manager. | 1701,1802 | React hook/UI | não instancia MultiPageAgent. |
| TASK-1806 | Timeline de goals/actions/outcomes. | 1805 | components | estados UX-001..012. |
| TASK-1807 | Confirmation UI segura. | 1504,1805 | side panel | R3 preview/aprovar/negar/invalidar. |
| TASK-1808 | Scope/permissions UI. | 1708,1803 | config panel | grants por origin e tabs visíveis. |
| TASK-1809 | Hub como Session client. | 1804 | hub | sem runtime próprio; reconnect/events. |
| TASK-1810 | MCP bridge v2. | 1804 | mcp | tools session-scoped/policy-aware. |
| TASK-1811 | Compat v1 adapter. | 1801,1804 | `packages/compat-v1` | API antiga mapeada sem core antigo. |
| TASK-1812 | Acessibilidade e localization PT-BR/EN. | 1805-1808 | UI/i18n | keyboard, aria-live, labels, contrast. |

## EPIC-1900 — Observabilidade e privacidade

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-1901 | DiagnosticEvent/EventSink estruturado. | 1106,1309 | observability | correlation IDs end-to-end. |
| TASK-1902 | Provider/decision/action/outcome metrics. | 1402,1506,1901 | metrics | counters/histograms sem PII labels. |
| TASK-1903 | Redaction pipeline central. | 1209,1901 | privacy | secret canary suite. |
| TASK-1904 | Trace levels/config. | 1901,1903 | runtime/config | off/metadata/redacted/debug-local. |
| TASK-1905 | Export diagnostic package. | 1702,1904 | extension UI/export | preview + sanitização dupla. |
| TASK-1906 | Retention/cleanup jobs. | 1702,1903 | store | TTL e clear UI. |
| TASK-1907 | Eval report/dashboard artifacts. | 1413,1902 | evals | release/model/template comparáveis. |

## EPIC-2000 — Migração e remoção do legado

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-2001 | Migrar facade `page-agent` para v2. | 1801,1811 | page-agent | demos/docs usam runtime novo. |
| TASK-2002 | Migrar extension entrypoints. | 1805,1809 | extension | nenhum `new MultiPageAgent`. |
| TASK-2003 | Remover `MultiPageAgent`/RemotePageController antigos. | 2002,1706 | extension/agent | nenhum import/referência. |
| TASK-2004 | Remover PageAgentCore loop antigo. | 2001,2002 | core | pacote reestruturado/removido. |
| TASK-2005 | Remover MacroTool/reflection/done/prompts. | 2004 | core/llms/prompts | rg e bundle confirmam ausência. |
| TASK-2006 | Remover storage globals/polling antigos. | 1702,1710,2002 | extension | session store é autoridade. |
| TASK-2007 | Remover JS execution API/tool/docs. | 1510,2001 | core/page-controller/docs | sem caminho público. |
| TASK-2008 | Limpar configs/flags/demo endpoints obsoletos. | 2001-2007 | UI/docs/config | migration matrix concluída. |
| TASK-2009 | Atualizar AGENTS.md e developer guide. | 2004-2008 | root docs | arquitetura/testes atuais corretos. |
| TASK-2010 | Bundle/dependency/license audit. | 2008 | build | sem código/deps mortas; avisos preservados. |

## EPIC-2100 — Testes, avaliação e release

| Tarefa | Entrega | Deps | Arquivos/áreas | Aceite |
|---|---|---|---|---|
| TASK-2101 | Contract suite local/extension completa. | 1706 | tests | todas operações/erros P0. |
| TASK-2102 | E2E matrix in-page/extension/API/Hub. | 1809,2002 | e2e | cenários funcionais e recuperação. |
| TASK-2103 | Jev benchmark ampliado PT-BR/EN. | 1413,2002 | evals | metas por risk tier. |
| TASK-2104 | Comparativo baseline vs Jev vs híbrido. | 1004,2103 | reports | completion, latency, calls, cost, safety. |
| TASK-2105 | Chaos/soak/performance. | 1711,1902 | tests | SW/network/mutation/30min sem corrupção/leak. |
| TASK-2106 | Security review/pentest. | 1511,1803,1903 | security | nenhum P0/high aberto. |
| TASK-2107 | Privacy review. | 1903-1906 | privacy | retention/telemetry/export aprovados. |
| TASK-2108 | Accessibility audit. | 1812 | UI | WCAG-aligned issues P0/P1 resolvidos. |
| TASK-2109 | Release docs/migration guide/changelog. | 2009,2102 | docs | instalação, config, riscos, exemplos. |
| TASK-2110 | Alpha package/extension channel. | 2102-2109 | release | signed artifacts + rollback. |
| TASK-2111 | Beta gate review. | 2110 | release/evals | metrics e thresholds aprovados. |
| TASK-2112 | Stable rollout gradual. | 2111 | release | health checks e rollback testado. |

## Ordem crítica resumida

```text
1005/1007/1008
→ 1101–1109
→ 1201–1212 + 1301–1310
→ 1311
→ 1401–1413 + 1501–1511
→ 1701–1712
→ 1801–1812
→ 2001–2010
→ 2101–2112
```

## Regras de PR

Todo PR deve incluir:

- TASK e requisitos afetados;
- decisão/ADR relevante;
- testes novos/alterados;
- impacto em protocol/API/bundle/security;
- evidência do comando executado;
- migration note se remover/renomear comportamento;
- screenshots somente quando UI muda.
