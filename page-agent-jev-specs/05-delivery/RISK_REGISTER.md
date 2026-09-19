---
schema_version: "1.0"
document_id: "PAJ-DEL-007"
kind: "risk-register"
title: "Registro de riscos"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-GOV-003"
  - "PAJ-XCUT-002"
---

# Registro de riscos

Escalas: probabilidade e impacto de 1 (baixo) a 5 (crítico). Score = P×I.

| ID | Risco | P | I | Score | Sinal precoce | Mitigação | Contingência | Owner |
|---|---|---:|---:|---:|---|---|---|---|
| RISK-001 | Jev seleciona elementos incorretos em DOM complexo. | 4 | 4 | 16 | baixa accuracy por região/site | filtragem, templates, none, gates | generative/humano; limitar task family | ML/Eval |
| RISK-002 | PT-BR degrada precisão. | 4 | 3 | 12 | gap > meta vs EN | language policy e dataset PT | pergunta bilíngue/fallback | ML/Eval |
| RISK-003 | CORS/SDK inviabiliza chamada Jev na extensão. | 3 | 4 | 12 | spike falha | transport abstraction | proxy obrigatório | Infra |
| RISK-004 | Runner MV3 não permanece vivo. | 4 | 5 | 20 | sessões morrem ao fechar UI | runner spike, checkpoint/recovery | exigir host visível ou serviço local | Extension |
| RISK-005 | Stale ref aciona elemento errado. | 3 | 5 | 15 | revalidation mismatch | doc/revision/fingerprint | reobservar sempre em mutações críticas | Browser |
| RISK-006 | Outcome sem evidência gera falso sucesso. | 3 | 5 | 15 | completed sem predicates fortes | contracts/evidence invariant | reduzir task families; human review | Runtime |
| RISK-007 | Retry duplica efeito externo. | 3 | 5 | 15 | timeouts pós-submit | idempotency/effect_unknown | parar e pedir usuário | Runtime/Sec |
| RISK-008 | Dois entrypoints controlam mesmas abas. | 4 | 4 | 16 | flags/storage conflitantes | Session Manager/lease | single-runner lock | Extension |
| RISK-009 | Prompt injection influencia Jev/generative. | 4 | 5 | 20 | selection enviesada por page text | state/instruction separation, closed set | bloquear/confirmar/restringir site | Security |
| RISK-010 | Secrets vazam em state/log/trace. | 3 | 5 | 15 | canary encontrado | sanitizer central e metadata-only | disable telemetry, incident response | Privacy |
| RISK-011 | Refatoração quebra ergonomia pública. | 3 | 3 | 9 | integradores falham | facade/compat/docs | extensão de janela v1 | API |
| RISK-012 | Arquitetura dupla permanece por prazo indefinido. | 4 | 4 | 16 | flags/adapters sem remoção | exit gates e TASK-200x | bloquear release major | Architecture |
| RISK-013 | Protocol `any` retorna durante pressão de entrega. | 3 | 4 | 12 | casts/unknown handlers | schemas/restricted lint | quarantine adapter temporário | Extension |
| RISK-014 | DOM observation custa muito em páginas grandes. | 4 | 3 | 12 | p95/bytes altos | regions, viewport, coalescing | reduce scope/limit site support | Browser |
| RISK-015 | Thresholds de confiança mal calibrados. | 4 | 4 | 16 | high confidence errors | per-template eval | conservative gates/human | ML/Eval |
| RISK-016 | Conteúdo gerado é enviado sem revisão. | 3 | 5 | 15 | action pipeline bypass | policy/confirmation | disable R3 action | Security |
| RISK-017 | Extension permission review/store rejeita mudanças. | 2 | 4 | 8 | policy warnings | least privilege/docs | staged/manual distribution | Product |
| RISK-018 | Upstream muda durante refactor. | 4 | 2 | 8 | diverging commits | pin/rebase cadence | cherry-pick only critical fixes | Maintainer |
| RISK-019 | Testes E2E flaky ocultam regressões. | 4 | 3 | 12 | retries frequentes | deterministic fixtures/no blind retry | quarantine with deadline | QA |
| RISK-020 | Provider cost/latency real não compensa. | 3 | 4 | 12 | hybrid metrics worse | batch/filter/route | use deterministic/generative selectively | Product |
| RISK-021 | Hub/MCP amplia superfície de ataque. | 3 | 5 | 15 | external control without clear grant | scoped grants/session APIs | disable channel by default | Security |
| RISK-022 | IndexedDB migration perde config/session. | 2 | 4 | 8 | migration errors | backup/version/idempotent migration | rollback/export/reset targeted | Extension |
| RISK-023 | Fingerprint causa falso match em listas repetidas. | 4 | 4 | 16 | collision tests | ancestry/position/semantic features | require fresh revision; reselect | Browser |
| RISK-024 | Acessibilidade da UI/mask é degradada. | 3 | 3 | 9 | keyboard/screen reader fail | a11y requirements/tests | disable mask/release blocker | UI |

## Riscos aceitos provisoriamente

- Chrome/Chromium only no MVP.
- Canvas/custom UI sem acessibilidade pode ser unsupported.
- Provider outage pode resultar em `blocked`, não conclusão automática.
- Alguns tasks exigirão generative provider ou usuário.

## Cadência de revisão

- semanal durante F0–F7;
- por release candidate em F8–F11;
- imediatamente após incidente, model upgrade ou protocol major;
- risco score ≥15 exige owner e evidência em cada gate.
