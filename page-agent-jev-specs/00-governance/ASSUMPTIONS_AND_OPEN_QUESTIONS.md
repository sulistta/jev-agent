---
schema_version: "1.0"
document_id: "PAJ-GOV-003"
kind: "decision-input"
title: "Premissas, hipóteses e questões abertas"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-GOV-001"
---

# Premissas, hipóteses e questões abertas

## 1. Premissas adotadas

| ID | Premissa | Consequência |
|---|---|---|
| ASM-001 | O fork parte do Page Agent 1.12.4, commit `9eb6b6646500264d9034dd466a4270cb9fc1ef1e`. | Todo desvio posterior exige rebase/auditoria incremental. |
| ASM-002 | A extensão Chrome MV3 continua sendo uma entrega de primeira classe. | Arquitetura não pode depender de APIs disponíveis apenas em página comum ou Node. |
| ASM-003 | Jev é central para decisões semânticas fechadas, mas não é gerador de texto nem planejador universal. | Runtime deve possuir roteamento e fallback opcional. |
| ASM-004 | Código legado sem função no produto novo pode ser removido. | Não haverá `PageAgentCore` antigo e `JevAgentCore` em paralelo. |
| ASM-005 | O PageController e seu pipeline DOM são ativos reutilizáveis, não contratos imutáveis. | APIs e estruturas podem ser modificadas para observações tipadas e refs estáveis. |
| ASM-006 | Segurança e autorização pertencem ao código determinístico. | Nenhum provider de IA pode conceder a si mesmo uma capacidade. |
| ASM-007 | O primeiro release deve suportar tarefas em português, mesmo com o inglês sendo o idioma principal do Jev. | Avaliação multilíngue é gate de release. |
| ASM-008 | O usuário pode usar chave própria; aplicações públicas podem usar proxy controlado. | Devem existir modos de transporte/credencial separados. |

## 2. Hipóteses que exigem spikes

| ID | Hipótese | Spike | Evidência para aprovação | Se falhar |
|---|---|---|---|---|
| HYP-001 | A API HTTP do Jev aceita chamadas do contexto privilegiado da extensão com CORS adequado. | TASK-1005 | Request real em extensão empacotada; preflight e abort testados. | Usar proxy local/remoto; SDK apenas em Node. |
| HYP-002 | O Jev seleciona ações/elementos com precisão suficiente em páginas reais após filtragem. | TASK-1412, TASK-1413 | `TEST-EVAL-001..004` e relatório estratificado atingem metas por risco e idioma. | Aumentar filtro determinístico, recuperação ou uso do generativo. |
| HYP-003 | Descrever páginas em português e perguntar em inglês melhora a precisão sem perder semântica. | TASK-1410, TASK-1413 | Comparação PT→PT, PT→EN e estado bilíngue. | Manter perguntas no idioma da página ou roteamento por idioma. |
| HYP-004 | Um runner hospedado em página de extensão (Hub/Runner) é estável o bastante para tarefas longas. | TASK-1007 | Teste com side panel fechado, SW suspenso/reiniciado e 30 min de execução. | Persistir checkpoints e exigir UI aberta; considerar host nativo/proxy. |
| HYP-005 | Fingerprint + validação de revisão reduz stale refs sem excesso de reobservações. | TASK-1204 | E2E em SPAs dinâmicas e virtualized lists. | Re-resolução por locator semântico/DOM ou ações atômicas no content script. |
| HYP-006 | Batching de perguntas Jev reduz custo/latência no loop sem prejudicar precisão. | TASK-1407 | A/B de chamadas únicas versus fan-out. | Limitar batch a perguntas estritamente independentes. |

## 3. Questões de produto não bloqueantes

| ID | Questão | Decisão padrão usada neste pacote |
|---|---|---|
| OQ-001 | O fork manterá o nome “Page Agent”? | Nome provisório “Page Agent + Jev”; renomear não altera contratos. |
| OQ-002 | Haverá suporte oficial a Firefox no primeiro release? | Não; Chrome/Chromium MV3 primeiro. Arquitetura evita dependência desnecessária, mas sem promessa. |
| OQ-003 | O Hub/MCP continuará no produto? | Sim, como cliente do Session Manager; não como motor separado. |
| OQ-004 | A API externa da página permanecerá compatível? | Haverá API v2; um adaptador v1 fino pode existir por uma janela de migração. |
| OQ-005 | Será permitido controlar todas as abas existentes? | Não por padrão. Acesso por sessão/grupo/allowlist; modo amplo é explícito e visível. |

## 4. Questões bloqueantes antes do release público

| ID | Questão | Dono | Prazo lógico |
|---|---|---|---|
| OQ-B01 | Quais domínios podem ser controlados e quais exigem confirmação? | Produto + Segurança | Antes de habilitar ações externas. |
| OQ-B02 | Qual política de retenção de traces, DOM e conteúdo? | Privacidade | Antes de telemetria em produção. |
| OQ-B03 | Quais thresholds por classe de risco foram calibrados no benchmark? | ML/Eval + Segurança | Antes do RC. |
| OQ-B04 | A chave Jev será BYOK, proxy ou ambos no canal distribuído? | Produto + Infra | Antes de publicar a extensão. |
| OQ-B05 | Quais ações irreversíveis ficam totalmente proibidas no MVP? | Produto + Segurança | Antes dos testes E2E sensíveis. |

## 5. Regra de fechamento

Uma questão é fechada somente quando:

1. existe evidência reproduzível;
2. a decisão foi registrada em ADR ou SPEC;
3. tarefas e testes afetados foram atualizados;
4. a matriz de rastreabilidade aponta para a nova evidência.
