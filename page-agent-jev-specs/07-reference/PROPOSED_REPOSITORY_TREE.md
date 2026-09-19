---
schema_version: "1.0"
document_id: "PAJ-REF-002"
kind: "repository-layout-reference"
title: "Árvore proposta do repositório"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-004"
  - "PAJ-DEL-001"
---

# Árvore proposta do repositório

## 1. Visão consolidada

```text
page-agent/
├── apps/
│   ├── extension/
│   │   ├── entrypoints/
│   │   │   ├── background/
│   │   │   ├── content/
│   │   │   ├── main-world/
│   │   │   └── sidepanel/
│   │   ├── src/
│   │   │   ├── composition/
│   │   │   ├── runner/
│   │   │   ├── browser-adapter/
│   │   │   ├── storage/
│   │   │   ├── protocol/
│   │   │   ├── hub/
│   │   │   └── ui/
│   │   └── tests/
│   │       ├── contract/
│   │       └── integration/
│   ├── website/
│   └── demo/
├── packages/
│   ├── protocol/
│   ├── browser/
│   ├── runtime/
│   ├── page-controller/
│   ├── decision-jev/
│   ├── decision-generative/
│   ├── in-page/
│   ├── ui/
│   └── compat-v1/
├── tests/
│   ├── fixtures/
│   ├── contract/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── evals/
├── tooling/
│   ├── eslint/
│   ├── dependency-rules/
│   ├── protocol-codegen/
│   └── release/
├── docs/
│   ├── specs/
│   ├── adrs/
│   └── operations/
├── package.json
├── tsconfig.base.json
└── turbo.json
```

## 2. Pacote `protocol`

```text
packages/protocol/src/
├── version.ts
├── json.ts
├── ids.ts
├── envelope.ts
├── commands/
│   ├── start-run.ts
│   ├── cancel-run.ts
│   ├── pause-run.ts
│   ├── resume-run.ts
│   ├── answer-question.ts
│   ├── confirm-action.ts
│   └── execute-browser-action.ts
├── events/
│   ├── run-events.ts
│   ├── goal-events.ts
│   ├── action-events.ts
│   └── user-interaction-events.ts
├── responses/
│   ├── command-result.ts
│   └── protocol-error.ts
├── schemas/
├── codecs/
└── index.ts
```

Regras:

- somente tipos serializáveis e schemas;
- zero import de DOM, Chrome, React, provider ou storage;
- fixtures de compatibilidade fazem parte do pacote;
- qualquer mudança incompatível incrementa `protocolVersion` major.

## 3. Pacote `browser`

```text
packages/browser/src/
├── BrowserRuntime.ts
├── observation/
│   ├── PageObservation.ts
│   ├── ObservationRevision.ts
│   └── Viewport.ts
├── elements/
│   ├── ElementRef.ts
│   ├── ElementFingerprint.ts
│   └── Candidate.ts
├── actions/
│   ├── ActionIntent.ts
│   ├── ActionResult.ts
│   └── ActionCatalog.ts
├── tabs/
│   ├── TabRef.ts
│   └── TabSnapshot.ts
├── synchronization/
│   ├── WaitCondition.ts
│   └── StabilityPolicy.ts
├── errors/
└── index.ts
```

Este pacote define contratos. A manipulação DOM concreta permanece em `page-controller`; APIs Chrome permanecem em `apps/extension`.

## 4. Pacote `runtime`

```text
packages/runtime/src/
├── AgentRuntime.ts
├── composition.ts
├── session/
│   ├── Session.ts
│   ├── SessionManager.ts
│   ├── SessionStore.ts
│   └── RunLease.ts
├── goal/
│   ├── Goal.ts
│   ├── GoalGraph.ts
│   └── GoalPlanner.ts
├── loop/
│   ├── StepRunner.ts
│   ├── StepBudget.ts
│   ├── ProgressTracker.ts
│   └── CycleDetector.ts
├── decisions/
│   ├── DecisionNeed.ts
│   ├── DecisionProvider.ts
│   ├── DecisionRouter.ts
│   └── DecisionGate.ts
├── actions/
│   ├── ActionPipeline.ts
│   ├── ActionRegistry.ts
│   └── IdempotencyStore.ts
├── policies/
│   ├── PolicyEngine.ts
│   ├── RiskClassifier.ts
│   └── ConfirmationManager.ts
├── outcomes/
│   ├── OutcomeContract.ts
│   ├── OutcomeVerifier.ts
│   └── Evidence.ts
├── events/
│   ├── DomainEvent.ts
│   └── EventSink.ts
├── ports/
├── errors/
└── index.ts
```

Regra central: o runtime depende apenas de `protocol`, `browser` e abstrações internas. Providers concretos, DOM e Chrome apontam para ele, não o inverso.

## 5. Pacote `page-controller`

```text
packages/page-controller/src/
├── LocalBrowserRuntime.ts
├── observation/
│   ├── DomExtractor.ts
│   ├── AccessibilityProjector.ts
│   ├── CandidateGenerator.ts
│   ├── FingerprintBuilder.ts
│   └── SensitiveDataRedactor.ts
├── actions/
│   ├── ClickExecutor.ts
│   ├── InputExecutor.ts
│   ├── SelectExecutor.ts
│   ├── ScrollExecutor.ts
│   └── NavigateExecutor.ts
├── synchronization/
│   ├── DomConditionWaiter.ts
│   └── MutationStabilityTracker.ts
├── mask/
├── errors/
└── index.ts
```

O extrator atual deve ser migrado incrementalmente. `executeJavascript` não entra na árvore final de produção.

## 6. Pacote `decision-jev`

```text
packages/decision-jev/src/
├── JevDecisionProvider.ts
├── config.ts
├── questions/
│   ├── catalog.ts
│   ├── operation-select.v1.ts
│   ├── candidate-select.v1.ts
│   ├── candidate-absolute-fit.v1.ts
│   ├── outcome-semantic-match.v1.ts
│   ├── recovery-classify.v1.ts
│   └── task-route.v1.ts
├── projections/
│   ├── DecisionStateProjector.ts
│   └── CandidateOptionProjector.ts
├── gates/
│   ├── ThresholdPolicy.ts
│   └── CalibrationTable.ts
├── transports/
│   ├── JevTransport.ts
│   ├── DirectHttpJevTransport.ts
│   ├── NodeSdkJevTransport.ts
│   ├── ProxyJevTransport.ts
│   └── MockJevTransport.ts
├── validation/
├── telemetry/
└── index.ts
```

Templates são versão de produto: alteração semântica cria nova versão. Transportes não podem alterar perguntas ou opções.

## 7. Pacote `decision-generative`

```text
packages/decision-generative/src/
├── GenerativeProvider.ts
├── OpenAICompatibleAdapter.ts
├── needs/
│   ├── value-generation.ts
│   ├── open-replan.ts
│   └── summary.ts
├── validation/
├── redaction/
└── index.ts
```

O código reaproveitável de `packages/llms` deve migrar para cá. O provider é opcional e não implementa execução de ações.

## 8. App de extensão

```text
apps/extension/src/
├── composition/
│   ├── create-extension-runtime.ts
│   └── config.ts
├── runner/
│   ├── RunRegistry.ts
│   ├── RunCoordinator.ts
│   ├── LeaseManager.ts
│   └── Reconciler.ts
├── browser-adapter/
│   ├── RemoteBrowserRuntime.ts
│   ├── ChromeTabsAdapter.ts
│   └── ContentScriptBridge.ts
├── storage/
│   ├── ChromeSessionStore.ts
│   └── MigrationStore.ts
├── protocol/
│   ├── MessageRouter.ts
│   ├── RuntimeValidator.ts
│   └── IdempotencyCache.ts
├── public-api/
│   ├── Handshake.ts
│   ├── Authorization.ts
│   └── MainWorldBridge.ts
├── hub/
└── ui/
```

O service worker hospeda a coordenação. Content script hospeda somente observação/execução DOM. Side panel e API pública são clientes.

## 9. Estrutura de testes

```text
tests/
├── fixtures/
│   ├── pages/
│   ├── observations/
│   ├── jev-responses/
│   └── protocol/
├── contract/
│   ├── browser-runtime.contract.ts
│   ├── decision-provider.contract.ts
│   └── session-store.contract.ts
├── integration/
│   ├── runtime-local.test.ts
│   ├── runtime-remote.test.ts
│   └── outcomes.test.ts
├── e2e/
│   ├── in-page/
│   └── extension/
├── security/
│   ├── prompt-injection.test.ts
│   ├── protocol-auth.test.ts
│   └── secret-redaction.test.ts
└── evals/
    ├── datasets/
    ├── runners/
    ├── reports/
    └── calibration/
```

Fixtures que contenham dados pessoais devem ser sintéticas. Respostas reais de provider só podem ser persistidas após redaction.

## 10. Mapeamento do legado

| Origem atual | Destino | Estratégia |
|---|---|---|
| `packages/core` | `runtime` + `compat-v1` | reescrever contratos; remover loop ReAct antigo |
| `packages/llms` | `decision-generative` | mover parsing/retry úteis; retirar dependência do core |
| `packages/page-controller` | mesmo nome + `browser` | separar contrato de implementação |
| `packages/page-agent` | `in-page` | nova composition root e facade v2 |
| `packages/ui` | mesmo nome | trocar adapter de eventos |
| `packages/extension` | `apps/extension` | migrar por slices; não copiar coordenadores |
| `packages/mcp`/Hub | clients do runtime | reutilizar sessão/protocolo, sem motor paralelo |

## 11. Ordem recomendada de criação

1. `protocol` e fixtures de schema;
2. `browser` contracts;
3. `runtime` com fakes;
4. adapter local em `page-controller`;
5. vertical slice `in-page`;
6. `decision-jev` e evals;
7. policies/outcomes;
8. runner e adapter remoto da extensão;
9. UI/API/Hub;
10. provider generativo e compatibilidade;
11. remoção do legado.

## 12. Regras para evitar decomposição excessiva

- Um pacote novo precisa de uma fronteira de dependência ou distribuição real.
- Submódulo interno é preferível quando lifecycle e release são inseparáveis.
- Não criar pacotes por entidade individual.
- Interfaces com uma única implementação ainda são justificadas quando cruzam ambiente/processo ou habilitam teste determinístico.
- Composition roots podem depender de muitos módulos; módulos de domínio não.

