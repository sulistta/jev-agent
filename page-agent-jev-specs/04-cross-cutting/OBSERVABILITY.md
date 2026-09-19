---
schema_version: "1.0"
document_id: "PAJ-XCUT-004"
kind: "observability-spec"
title: "Observabilidade, auditoria e diagnóstico"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-006"
  - "PAJ-XCUT-002"
requirements:
  - "OBS-001..OBS-014"
  - "FR-041..FR-042"
---

# Observabilidade, auditoria e diagnóstico

## 1. Objetivos

- explicar estados e decisões sem depender de logs soltos;
- medir custo/latência/qualidade por provider;
- reproduzir bugs com dados sanitizados;
- provar políticas, confirmações e outcomes;
- não expor chain-of-thought, secrets ou DOM bruto por padrão.

## 2. Correlação

Todos os eventos técnicos devem conter, conforme aplicável:

- `traceId`;
- `sessionId`;
- `taskId`;
- `stepId`;
- `goalId`;
- `observationId`;
- `decisionId`;
- `actionId`;
- `requestId`;
- `tabId/documentId/revision`;
- `timestamp` e `durationMs`.

## 3. Logs estruturados

```typescript
interface DiagnosticEvent {
  name: string
  level: 'debug' | 'info' | 'warn' | 'error'
  timestamp: string
  correlation: CorrelationIds
  attributes: Record<string, JsonValue>
  error?: SanitizedError
  privacy: PrivacyClassification
}
```

Sem interpolação de objetos arbitrários em `console.log` no código de produção.

## 4. Eventos obrigatórios

| ID | Evento | Campos principais |
|---|---|---|
| OBS-001 | `session.transition` | from, to, reason, revision |
| OBS-002 | `observation.summary` | counts, bytes, regions, sanitization |
| OBS-003 | `candidate.generated` | operation, before/after counts, filters |
| OBS-004 | `decision.request` | provider, need, template version, state size |
| OBS-005 | `decision.response` | outcome, confidence metadata, duration, usage |
| OBS-006 | `decision.gate` | threshold policy, risk, route |
| OBS-007 | `policy.decision` | allow/confirm/deny, rule IDs |
| OBS-008 | `action.execution` | action, target hash, status, duration |
| OBS-009 | `synchronization` | expected signals, result, duration |
| OBS-010 | `outcome.verification` | predicates, status, evidence IDs |
| OBS-011 | `recovery.attempt` | cause, strategy, ordinal |
| OBS-012 | `transport.health` | context, reconnect, error code |
| OBS-013 | `security.denial` | rule, origin, capability, no sensitive args |
| OBS-014 | `session.result` | terminal status, goals, metrics |

## 5. Métricas

### Counters

- sessions started/terminal by status;
- actions by type/status/risk;
- provider calls/retries/errors;
- confirmations requested/approved/denied/invalidated;
- stale refs;
- policy denials;
- recoveries and loops;
- SW restarts/reconnects.

### Histograms

- session/step/action/provider/sync latency;
- candidate counts;
- state bytes/tokens;
- steps/actions/provider calls por tarefa;
- time-to-confirmation;
- confidence/margin por template e outcome real.

### Gauges

- active sessions;
- owned tabs;
- event queue depth;
- circuit breaker state;
- storage size.

## 6. Trace levels

| Nível | Conteúdo |
|---|---|
| `off` | Apenas erros fatais locais. |
| `metadata` (default) | IDs, tipos, counts, durações, códigos. |
| `redacted` | Snippets sanitizados e candidate labels. |
| `debug-local` | Raw state local temporário, opt-in, nunca upload automático. |

## 7. Audit trail

Ações R2+ devem registrar:

- usuário/origin owner;
- policy version e rule IDs;
- decision provider/template;
- confirmation ID/status quando aplicável;
- target/args digests;
- action receipt;
- outcome/evidence IDs.

O audit trail não precisa armazenar o valor secreto para provar que uma ação ocorreu.

## 8. Export de diagnóstico

Fluxo:

1. usuário seleciona sessão;
2. UI mostra preview e privacy warnings;
3. exportador aplica redaction novamente;
4. pacote inclui manifest, events, config sem secrets e environment versions;
5. hash do pacote para integridade;
6. usuário decide compartilhar.

## 9. Dashboard de avaliação

Por release/model/template:

- verified completion;
- precision de candidate selection;
- calibration curves;
- confidence coverage versus accuracy;
- latency/cost;
- PT-BR versus EN;
- safety failures;
- regressions por site/task family.

## 10. Testes

- todos os P0 paths emitem eventos esperados;
- trace IDs permanecem estáveis;
- raw secret canaries não aparecem;
- event ordering/terminal único;
- reconnect retoma do event ID;
- export aplica redaction dupla;
- telemetria off não envia nada;
- métricas não usam labels de alta cardinalidade com PII.
