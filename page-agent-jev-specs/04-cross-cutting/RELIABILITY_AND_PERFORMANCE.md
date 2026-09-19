---
schema_version: "1.0"
document_id: "PAJ-XCUT-003"
kind: "quality-spec"
title: "Confiabilidade e desempenho"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-001"
  - "PAJ-COMP-004"
  - "PAJ-COMP-005"
requirements:
  - "NFR-007..NFR-017"
---

# Confiabilidade e desempenho

## 1. Budgets de latência

Metas iniciais, sujeitas a medição:

| Operação | p50 | p95 | Observação |
|---|---:|---:|---|
| Candidate generation (≤500 elementos) | 30 ms | 100 ms | Exclui DOM extraction. |
| Policy + validation | 5 ms | 20 ms | Sem confirmação humana. |
| Local RPC overhead | 2 ms | 10 ms | Mensagem/serialization. |
| Remote DOM RPC overhead | 10 ms | 50 ms | Exclui ação/navegação. |
| Cancel propagation | 250 ms | 2 s | Até todos os awaits cooperativos. |
| Session event delivery | 50 ms | 250 ms | Runner→UI conectada. |

Latência Jev/LLM é medida separadamente e não recebe meta inventada antes dos spikes.

## 2. Deadlines

Cada operação recebe deadline absoluto, não apenas timeout local:

- provider call;
- DOM RPC;
- tab load;
- synchronization;
- user confirmation (expiração longa e separada);
- session overall.

Retries consomem o mesmo deadline; não reiniciam a janela inteira.

## 3. Retry matrix

| Categoria | Retry | Regra |
|---|---|---|
| Network transient/provider 5xx | Sim | Exponencial + jitter; limite/deadline. |
| Rate limit | Sim | Respeitar retry-after; circuit breaker. |
| Auth/schema/policy | Não | Corrigir config ou bloquear. |
| Transport SW/content disconnected | Sim limitado | Re-handshake se documento/aba ainda válido. |
| Stale ref | Não repetir action | Reobservar e decidir novamente. |
| Sync timeout | Não repetir cegamente | Verificar outcome e classificar effect_unknown. |
| Tab load timeout | Reobservar status; fallback | Diferenciar ainda carregando/erro/restrito. |
| User denied | Não | Terminar/buscar alternativa não sensível. |

## 4. Circuit breakers

Por provider/origin:

- abre após falhas consecutivas configuradas;
- período de cooldown;
- half-open com request de baixo risco;
- runtime roteia para fallback/humano;
- eventos expõem estado do breaker.

## 5. Cache

Pode cachear:

- template de pergunta compilado;
- sanitização/fingerprint dentro da mesma revisão;
- resultado determinístico puro;
- capabilities/handshake;
- observação enquanto nenhuma signal relevante ocorreu.

Não cachear cegamente:

- decisão Jev após mudança de state/candidates;
- confirmation;
- policy dependente de origin/time/user;
- refs após revision/document change;
- outcome de efeito externo.

## 6. Backpressure

- uma decisão/action in-flight por sessão;
- coalescer mutation signals durante quiet window;
- event UI pode agrupar updates de alta frequência, preservando eventos críticos;
- providers respeitam max concurrency global;
- observation requests duplicados na mesma revision podem compartilhar Promise;
- queue possui limite e erro explícito, não crescimento ilimitado.

## 7. Determinismo e replay

Replay lógico usa:

- observations sanitizadas/fixtures;
- candidates;
- provider answers;
- policies/threshold versions;
- clocks/IDs mockados.

Replay não reexecuta efeitos reais. Serve para depurar transições e regressões.

## 8. Métricas de confiabilidade

- task terminal rate por status;
- false completion;
- stale refs rejeitadas;
- action effect_unknown;
- no-progress loops;
- provider retry/circuit open;
- SW reconnects;
- session recovery success;
- duplicated action prevented;
- confirmation invalidations.

## 9. Performance do DOM

- extrair somente viewport + expansão por default;
- full document somente quando necessário;
- coalescer MutationObserver;
- evitar serializar refs reais;
- limitar atributos/texto;
- evitar polling de storage a cada 500 ms no estado ocioso;
- usar events/ports quando confiáveis e fallback de heartbeat moderado;
- medir tempo e tamanho de `getFlatTree`, projection, serialization e transfer.

## 10. Soak tests

- sessão de 30 minutos em SPA dinâmica;
- 1.000 steps sintéticos sem leak;
- abrir/fechar 50 abas dentro de budget;
- side panel abre/fecha repetidamente;
- SW reinicia múltiplas vezes;
- provider rate-limited;
- página com mutation storm;
- UI desconectada/reconectada;
- cancel durante cada operação.
