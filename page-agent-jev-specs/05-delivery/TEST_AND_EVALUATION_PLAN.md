---
schema_version: "1.0"
document_id: "PAJ-DEL-004"
kind: "test-plan"
title: "Plano de testes, E2E e avaliação Jev"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-PROD-003"
  - "PAJ-DEL-002"
requirements:
  - "NFR-023..NFR-026"
---

# Plano de testes, E2E e avaliação Jev

## 1. Camadas

| Camada | Finalidade | Ferramenta sugerida |
|---|---|---|
| Unit | Regras puras, state machines, filters, gates. | Vitest |
| Schema/contract | API, protocol, serialization, exhaustive unions. | Vitest + tsd/API Extractor |
| Component | Runtime com mocks, PageController em DOM fixture. | Vitest + jsdom/browser runner |
| Integration | Local/remote adapters, IndexedDB, messaging. | Vitest + Chrome test harness |
| E2E | Extensão real e páginas fixture. | Playwright + persistent Chromium context |
| Live provider | Jev/LLM reais, isolados do CI comum. | `*.live.test.ts` + eval runner |
| Security | Abuse, injection, replay, permission. | E2E + fuzz/property tests |
| Performance/soak | budgets, leak, long tasks, storms. | benchmark scripts + browser tracing |

## 2. Unit suites obrigatórias

### Runtime

- Session transitions/invalid transitions;
- terminal exactly once;
- Goal dependencies/partial;
- budgets/deadlines;
- cancel late results;
- Decision Router matrix;
- cycle fingerprints;
- provider fallback;
- policy precedência;
- evidence freshness.

### Observation/candidates

- role/name/label extraction;
- visibility/enabled/editable;
- regions/modal;
- sanitization;
- action compatibility;
- progressive expansion;
- >255 hierarchy;
- stale refs/fingerprint collisions.

### Actions/outcomes

- each action schema;
- risk classification;
- confirmation binding;
- idempotency/effect unknown;
- each predicate;
- semantic predicate fallback;
- synchronization statuses.

### Protocol

- every message parses valid fixture;
- invalid/unknown rejected;
- major mismatch;
- optional minor fields;
- sender/session mismatch;
- error serialization.

## 3. Browser Runtime contract suite

Executar a mesma suíte contra:

1. LocalBrowserRuntime;
2. ExtensionBrowserRuntime em fixture tab.

Casos `TEST-BR-001..020`:

| ID | Caso |
|---|---|
| TEST-BR-001 | Observe retorna page/tab/document/revision. |
| TEST-BR-002 | Element refs são únicas por observação. |
| TEST-BR-003 | Click válido. |
| TEST-BR-004 | Input replace/append conforme contrato. |
| TEST-BR-005 | Select por option ref. |
| TEST-BR-006 | Scroll documento. |
| TEST-BR-007 | Scroll container. |
| TEST-BR-008 | Stale revision rejeitada. |
| TEST-BR-009 | Document change rejeita ref. |
| TEST-BR-010 | Missing target distinto de stale. |
| TEST-BR-011 | Abort observe. |
| TEST-BR-012 | Abort action. |
| TEST-BR-013 | waitFor satisfied. |
| TEST-BR-014 | waitFor stabilized. |
| TEST-BR-015 | waitFor timeout. |
| TEST-BR-016 | Mutation storm coalescida. |
| TEST-BR-017 | Secret sanitizado. |
| TEST-BR-018 | Restricted page erro explícito. |
| TEST-BR-019 | dispose idempotente. |
| TEST-BR-020 | error codes equivalentes local/remote. |

## 4. E2E funcional

### Páginas fixture

- login-like form sem credencial real;
- multi-step checkout simulado sem pagamento;
- SPA router;
- modal/dialog;
- dropdown nativo e custom acessível;
- virtualized list;
- tabela/paginação;
- popup/target blank;
- slow loading e failure states;
- prompt injection/adversarial labels.

### Cenários

| ID | Cenário | Resultado esperado |
|---|---|---|
| TEST-E2E-001 | Form literal in-page | completed com evidence. |
| TEST-E2E-002 | Mesmo form extension | resultado equivalente. |
| TEST-E2E-003 | Submit R3 | confirmation obrigatória. |
| TEST-E2E-004 | Usuário nega | blocked/partial, sem submit. |
| TEST-E2E-005 | Target muda antes de confirmar | confirmation invalidated. |
| TEST-E2E-006 | SPA navega | revision muda, document conforme regra. |
| TEST-E2E-007 | Full reload | document ID novo. |
| TEST-E2E-008 | target=_blank | aba claimed e atualizada. |
| TEST-E2E-009 | Aba fechada manualmente | recovery/failure correto. |
| TEST-E2E-010 | SW restart | sessão preservada, sem duplicate action. |
| TEST-E2E-011 | Side panel fechado/reaberto | attach à mesma sessão. |
| TEST-E2E-012 | API externa origin não autorizado | deny. |
| TEST-E2E-013 | Dois owners mesma aba | conflict. |
| TEST-E2E-014 | Takeover/resume | nova observation; refs antigas inválidas. |
| TEST-E2E-015 | Provider timeout | fallback/erro conforme config. |
| TEST-E2E-016 | No-progress loop | detectado dentro do budget. |
| TEST-E2E-017 | False confirmation page | outcome não satisfeito. |
| TEST-E2E-018 | Prompt injection DOM | policy/instructions não alteradas. |

## 5. Dataset Jev

Cada exemplo contém:

```json
{
  "case_id": "cand-pt-0001",
  "language": "pt-BR",
  "task_family": "form_navigation",
  "risk_tier": "R1",
  "state": {},
  "question_template": "candidate.select.v1",
  "options": {},
  "expected": {
    "acceptable_choices": ["c_03"],
    "none_is_acceptable": false
  },
  "annotations": {
    "reviewers": 2,
    "adjudicated": true
  }
}
```

Famílias:

- buttons/links ambíguos;
- fields e labels;
- dropdown options;
- modals;
- results/error detection;
- recovery classification;
- `none of the above`;
- adversarial content;
- long irrelevant state;
- PT-BR, EN e misto.

## 6. Suítes de avaliação Jev

| ID | Caso | Evidência mínima |
|---|---|---|
| TEST-EVAL-001 | Candidate selection em estados filtrados. | top-1/top-k, `none` e erros por task family. |
| TEST-EVAL-002 | Rejeição de opções ambíguas ou ausentes. | precision/recall de `none` e escalonamento. |
| TEST-EVAL-003 | Calibração por template, risco e idioma. | coverage, accuracy coberta, ECE/Brier e margem. |
| TEST-EVAL-004 | Política PT-BR/EN e estado misto. | comparação PT→PT, PT→EN, EN→EN e regressões. |
| TEST-EVAL-005 | Batching versus chamadas isoladas. | equivalência de decisão, latência, custo e falhas. |
| TEST-EVAL-006 | Comparativo baseline/Jev/híbrido. | completion verificada, segurança, custo e recovery. |

## 7. Métricas Jev

- top-1 accuracy;
- top-k recall quando usado beam/hierarchy;
- `none` precision/recall;
- coverage em cada confidence threshold;
- accuracy dentro do covered set;
- Expected Calibration Error/Brier quando aplicável;
- top-1/top-2 margin;
- latency p50/p95;
- input/output tokens e custo;
- diferença PT-BR/EN;
- regressão por model/template version.

## 8. Comparativo de arquiteturas

Rodar mesmas tasks/config do navegador:

- A: Page Agent 1.12.4 original;
- B: runtime novo com deterministic + Jev;
- C: runtime novo híbrido Jev + generative fallback;
- D: runtime novo generative-only, quando útil.

Medir:

- completion verificada;
- false completion;
- ações erradas;
- intervenções;
- calls/tokens/custo;
- tempo total e decision time;
- retries/recovery;
- safety violations.

## 9. Gates de CI

### Todo PR

- lint/typecheck/unit/contract;
- package build;
- schema snapshot;
- dependency boundaries;
- secret scan;
- selected in-page E2E.

### PR de extensão/protocolo

- extension build/zip;
- extension smoke E2E;
- protocol compatibility;
- bundle content audit.

### Release candidate

- full E2E matrix;
- live provider eval versionada;
- security/privacy/a11y;
- soak/perf;
- migration/rollback.

## 10. Flakiness policy

- teste flaky não é reexecutado silenciosamente até passar;
- registrar taxa e owner;
- retries de teste somente para diagnóstico, não gate final;
- fixtures removem rede externa;
- live tests ficam fora do CI comum, mas bloqueiam release via relatório assinado;
- clocks/random IDs injetáveis.

## 11. Evidências de release

Pasta de relatório:

```text
release-evidence/<version>/
├── manifest.json
├── ci-summary.md
├── unit-contract.json
├── e2e-report/
├── jev-eval.md
├── baseline-comparison.md
├── security-review.md
├── privacy-review.md
├── accessibility.md
├── performance.md
└── rollback-test.md
```
