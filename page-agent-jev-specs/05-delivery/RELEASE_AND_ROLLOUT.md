---
schema_version: "1.0"
document_id: "PAJ-DEL-005"
kind: "release-plan"
title: "Release, rollout e rollback"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-DEL-003"
  - "PAJ-DEL-004"
---

# Release, rollout e rollback

## 1. Canais

| Canal | Público | Finalidade | Defaults |
|---|---|---|---|
| `dev` | equipe | desenvolvimento/spikes | debug-local, mocks permitidos |
| `internal-alpha` | testadores autorizados | tarefas fixture e sites allowlisted | Jev opt-in/flags |
| `public-beta` | grupo limitado | qualidade real e grants | telemetry opt-in, conservative gates |
| `stable` | geral | produção | only calibrated task families |

## 2. Versionamento

- packages públicos: SemVer;
- extensão: mesma versão do release train ou manifest de compatibilidade explícito;
- protocol: versão independente `major.minor`;
- question templates: ID + versão imutável;
- policies/thresholds: `policyVersion`;
- datasets/evals: versão/hash.

## 3. Feature rollout

Jev não precisa ser default para todas as tarefas de uma vez. Ativar por:

- task family;
- action/risk tier;
- language;
- site allowlist;
- model/template version;
- channel;
- user opt-in.

Ordem sugerida:

1. seleção de elementos R0/R1 em fixtures;
2. navegação/form sem submit;
3. extensão multipágina R0/R1;
4. semantic outcome checks;
5. R2 com verification;
6. R3 apenas com confirmação e após security gate.

## 4. Pre-release checklist

- commit/tag limpos;
- build reproduzível;
- artifacts SBOM/hash;
- schemas/API changelog;
- full test evidence;
- Jev model/template/policy versions fixados;
- manifest permissions review;
- secrets scan;
- docs de instalação/config/migração;
- support/known issues;
- rollback artifact validado.

## 5. Rollback

Rollback é para o release anterior assinado, não para um code path legado escondido.

### Package

- deprecate versão quebrada;
- restaurar latest tag anterior;
- publicar patch forward quando possível.

### Extensão

- feature flags server/local podem desabilitar Jev task families sem mudar policy para menos segura;
- publicar versão anterior/patch no canal;
- migrations de storage devem ser forward-compatible ou manter backup;
- protocolo major anterior pode ter janela de compat no runner, sem interpretar mensagens inválidas.

### Provider

- pin model conhecido;
- circuit breaker/fallback;
- não trocar automaticamente para versão “latest” em stable sem eval.

## 6. Health gates pós-release

Monitorar:

- false completion;
- policy denials/anomalias;
- crashes/session recovery;
- provider error/latency;
- stale refs;
- confirmation rate;
- completion por task family/language;
- suporte/bugs de extensão.

Stop conditions:

- qualquer ação sensível sem confirmação;
- exfiltração de segredo/PII;
- duplicate consequential action;
- false completion acima do limite;
- crash/recovery com corrupção de sessão;
- regressão estatisticamente relevante no conjunto crítico.

## 7. Changelog

Cada release documenta:

- user-facing changes;
- integrator/API/protocol changes;
- migrations;
- removed legacy;
- security/privacy changes;
- provider/model/template updates;
- known limitations;
- rollback notes.

## 8. Desativação do v1

1. v2 disponível e documentada;
2. warnings e telemetry local de uso v1 sem dados sensíveis;
3. migration guide/examples;
4. freeze de features v1;
5. removal em major;
6. extension API grant antigo revogado/migrado com ação do usuário.
