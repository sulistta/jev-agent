---
schema_version: "1.0"
document_id: "PAJ-DEL-006"
kind: "acceptance-spec"
title: "Critérios de aceite e Definition of Done"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-PROD-003"
  - "PAJ-DEL-004"
---

# Critérios de aceite e Definition of Done

## 1. Aceite arquitetural

| ID | Critério | Evidência |
|---|---|---|
| AC-ARCH-001 | Existe um único Agent Runtime em produção. | dependency graph + rg + bundle. |
| AC-ARCH-002 | Runtime não importa LLM/Jev/DOM/Chrome concretos. | import rule CI. |
| AC-ARCH-003 | Extensão usa composição, não herança do core antigo. | source review/test. |
| AC-ARCH-004 | Local e remote passam mesma contract suite. | TEST-BR report. |
| AC-ARCH-005 | APIs e protocol são tipados sem `any` exportado. | type/API check. |

## 2. Aceite funcional

| ID | Critério | Evidência |
|---|---|---|
| AC-FUNC-001 | In-page executa form→navigate→verify. | TEST-E2E-001. |
| AC-FUNC-002 | Extensão executa cenário equivalente. | TEST-E2E-002. |
| AC-FUNC-003 | Multipágina abre/switch/fecha abas owned. | extension E2E. |
| AC-FUNC-004 | Side panel/API/Hub usam mesma sessão. | integration E2E. |
| AC-FUNC-005 | Pause/takeover/resume e stop funcionam. | E2E + unit. |
| AC-FUNC-006 | Generative provider pode estar desligado. | tests Jev-fit. |

## 3. Aceite de decisão Jev

| ID | Critério | Evidência |
|---|---|---|
| AC-JEV-001 | Perguntas são templates versionados e atômicos. | registry/lint. |
| AC-JEV-002 | Candidate mapping permanece local. | tests/security review. |
| AC-JEV-003 | `none/escalate` existe onde opções podem ser incompletas. | template tests. |
| AC-JEV-004 | Thresholds são calibrados por template/risco. | eval report. |
| AC-JEV-005 | PT-BR e EN possuem métricas separadas. | eval report. |
| AC-JEV-006 | Falha/baixa confiança não executa ação insegura. | gate tests. |

## 4. Aceite de segurança

| ID | Critério | Evidência |
|---|---|---|
| AC-SEC-001 | Stale ref executada = 0. | contract/E2E. |
| AC-SEC-002 | R3 sem confirmação = 0. | policy/E2E. |
| AC-SEC-003 | JS arbitrário indisponível na API/runtime padrão. | API/bundle/rg. |
| AC-SEC-004 | Secrets não chegam a content/main-world/logs. | canary tests/bundle. |
| AC-SEC-005 | Origin não autorizado não inicia sessão. | TEST-E2E-012. |
| AC-SEC-006 | Confirmation replay/state change falha. | tests. |
| AC-SEC-007 | DOM adversarial não altera policy/instructions. | security suite. |
| AC-SEC-008 | Nenhum finding P0/High aberto. | review report. |

## 5. Aceite de outcomes/confiabilidade

| ID | Critério | Evidência |
|---|---|---|
| AC-REL-001 | Provider não conclui tarefa sozinho. | unit tests. |
| AC-REL-002 | Todo completed possui evidence por goal required. | invariant test. |
| AC-REL-003 | Effect unknown não é repetido automaticamente. | chaos/E2E. |
| AC-REL-004 | SW restart não duplica ação. | TEST-E2E-010. |
| AC-REL-005 | Cancel p95 dentro da meta. | perf report. |
| AC-REL-006 | Ciclos param dentro do budget. | E2E/unit. |
| AC-REL-007 | Exatamente um resultado terminal. | property/integration tests. |

## 6. Aceite de qualidade

- install limpo;
- lint, typecheck, unit, contract, integration e E2E verdes;
- build de todos os packages e ZIP da extensão;
- dependency/license/SBOM review;
- docs/API/migration/known limitations;
- accessibility audit sem P0;
- performance budgets medidos;
- trace/export redaction testado;
- release/rollback testados.

## 7. Definition of Done por tarefa

Uma TASK só é concluída quando:

1. código implementado dentro dos limites de pacote;
2. testes positivos, negativos, cancelamento e erro relevantes;
3. nenhum novo `any`/sleep fixo/estado global sem justificativa;
4. eventos/erros estruturados;
5. security/privacy review proporcional;
6. documentação e schemas atualizados;
7. requirement/task/test ligados na matriz;
8. comandos de verificação registrados no PR;
9. feature flag temporária tem plano de remoção;
10. reviewer confirma que não reintroduz arquitetura antiga.

## 8. Definition of Done do projeto

Além de todas as TASKs P0:

- metas de produto publicadas com resultados reais;
- riscos residuais aceitos explicitamente;
- lista de legado removido comprovada;
- pacote/extension RC validado por usuários de teste;
- runbooks de incident/rollback;
- ownership pós-release.
