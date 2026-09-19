---
schema_version: "1.0"
document_id: "PAJ-DEL-008"
kind: "traceability-matrix"
title: "Matriz de rastreabilidade"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-PROD-003"
  - "PAJ-DEL-002"
  - "PAJ-DEL-004"
---

# Matriz de rastreabilidade

## 1. Requisitos funcionais

| Requisitos | SPEC principal | Épicos/tarefas | Testes/evidência |
|---|---|---|---|
| FR-001..006 | Sessions, Agent Runtime | EPIC-1300, TASK-1301..TASK-1310 | state tests, TEST-E2E-004/009/011/014/016 |
| FR-007..012 | Browser Runtime, Observation | EPIC-1200, TASK-1201..TASK-1209 | TEST-BR-001..TEST-BR-020, sanitizer canaries |
| FR-013..021 | Decision Engine Jev, Generative | EPIC-1400, EPIC-1600, TASK-1401..TASK-1413, TASK-1601..TASK-1608 | router tests, TEST-EVAL-001..TEST-EVAL-005 |
| FR-022..030 | Actions/Outcomes/Security | EPIC-1500, TASK-1501..TASK-1511 | policy/outcome/threat tests, TEST-E2E-003..TEST-E2E-007/017/018 |
| FR-031..037 | Extension Runtime/Sessions | EPIC-1700, EPIC-1800, TASK-1701..TASK-1712, TASK-1801..TASK-1804 | extension contract, TEST-E2E-008..TEST-E2E-013 |
| FR-038..042 | UI/API/Observability | EPIC-1800, EPIC-1900, TASK-1805..TASK-1812, TASK-1901..TASK-1907 | UI a11y, public contract, redaction/export |

| Controles de observabilidade | SPEC principal | Épicos/tarefas | Testes/evidência |
|---|---|---|---|
| OBS-001..014 | Observability | EPIC-1900, TASK-1901..1907 | event contract, metrics, redaction/export tests |

| Controles de UX | SPEC principal | Épicos/tarefas | Testes/evidência |
|---|---|---|---|
| UX-001..015 | UI/UX | EPIC-1800, TASK-1805..1812 | UI state, keyboard/screen-reader, confirmation and takeover E2E |

## 2. Requisitos não funcionais

| Requisitos | Implementação | Verificação |
|---|---|---|
| NFR-001..006 | PACKAGE_BOUNDARIES, TASK-1108, TASK-2001..TASK-2010 | import graph, typecheck, bundle/rg |
| NFR-007..012 | TASK-1204, TASK-1301..TASK-1312, TASK-1509, TASK-1701..TASK-1711 | invariant/property/chaos tests |
| NFR-013..017 | Performance plan, TASK-1214, TASK-1902, TASK-2105 | perf/soak report |
| NFR-018..022 | Security/Privacy, TASK-1502..TASK-1511, TASK-1703..TASK-1708, TASK-1903..TASK-1906 | security/privacy review |
| NFR-023..030 | TASK-1109, TASK-1801..TASK-1812, TASK-1904..TASK-1907, TASK-2101..TASK-2112 | CI, eval, docs, a11y, protocol tests |

## 3. Security controls

| Controls | Tarefas | Testes |
|---|---|---|
| SEC-001..006 | TASK-1204, TASK-1403..TASK-1408, TASK-1503..TASK-1504, TASK-1803 | adversarial DOM, stale ref, grant/replay |
| SEC-007..013 | TASK-1509..TASK-1511, TASK-1703..TASK-1711 | effect unknown, protocol/sender/ownership |
| SEC-014..020 | TASK-1409, TASK-1608, TASK-1903, TASK-2106 | breaker, schema, bundle, false completion |
| PRIV-001..010 | TASK-1209, TASK-1903..TASK-1906, TASK-2107 | canary, telemetry off, export/TTL |

## 4. ADRs para implementação

| ADR | Tarefas que o materializam |
|---|---|
| ADR-001 Single Runtime | TASK-1304, TASK-1701, TASK-1805, TASK-2002..TASK-2005 |
| ADR-002 Composition | TASK-1206, TASK-1706, TASK-1801, TASK-2003 |
| ADR-003 Jev Atomic | TASK-1403..TASK-1411 |
| ADR-004 Evidence Completion | TASK-1310, TASK-1505..TASK-1507, TASK-2005 |
| ADR-005 Typed Protocol | TASK-1101..TASK-1103, TASK-1703..TASK-1707 |
| ADR-006 No Arbitrary JS | TASK-1510, TASK-2007 |
| ADR-007 Credential/Transport | TASK-1005, TASK-1006, TASK-1009, TASK-1401..TASK-1402, TASK-1803 |

## 5. Exit gates por fase

| Fase | Critérios de aceite |
|---|---|
| F0 | OQs de transport/runner/refs resolvidas. |
| F1 | AC-ARCH-002/005 parcialmente comprovados. |
| F2 | AC-SEC-001 em local + Browser contract base. |
| F3 | AC-REL-001/002/005/006/007 em mocks/local. |
| F4 | AC-FUNC-001. |
| F5 | AC-JEV-001..006. |
| F6 | AC-SEC-002/003/006/007, AC-REL-003. |
| F7 | AC-ARCH-004, AC-FUNC-002/003, AC-REL-004. |
| F8 | AC-FUNC-004..006, AC-SEC-004/005. |
| F9 | AC-ARCH-001/003 e legado removido. |
| F10 | Todos ACs e NFRs com evidence. |
| F11 | release/rollback/monitoring. |

## 6. Como manter esta matriz

- PR que adiciona requisito adiciona tarefa e teste correspondente.
- PR que remove tarefa precisa provar requisito substituído/retirado.
- IDs de testes devem aparecer em nome/metadata do relatório.
- release evidence referencia ACs, não apenas “todos os testes passaram”.
