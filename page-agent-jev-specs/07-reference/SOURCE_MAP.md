---
schema_version: "1.0"
document_id: "PAJ-REF-001"
kind: "source-map"
title: "Mapa de fontes e evidências"
status: "accepted-for-planning"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-001"
---

# Mapa de fontes e evidências

## 1. Finalidade

Este documento permite reproduzir a pesquisa que sustenta as SPECs. Ele separa:

- fatos verificados na base Page Agent;
- capacidades e limites documentados do Jev;
- propostas novas deste pacote;
- hipóteses que ainda precisam de spike ou validação empírica.

Nenhuma fonte externa substitui teste no ambiente real de distribuição. URLs e versões devem ser revalidadas antes do início da implementação, porque documentação, SDKs e políticas de navegador podem mudar.

## 2. Baseline do código

| Campo | Valor |
|---|---|
| Repositório | `https://github.com/alibaba/page-agent` |
| Branch auditada | `main` |
| Commit | `9eb6b6646500264d9034dd466a4270cb9fc1ef1e` |
| Versão declarada | `1.12.4` |
| Data do commit | `2026-09-06T15:44:57+08:00` |
| Gerenciador | npm workspaces |
| Ambiente da auditoria | checkout limpo, dependências instaladas com `npm ci` |

### Evidência de saúde do baseline

| Comando | Evidência observada | Uso nas SPECs |
|---|---|---|
| `npm ci` | instalação concluída | reproduzibilidade inicial |
| `npm test` | 69 testes verdes | baseline de regressão |
| `npm run typecheck` | passou | gate de tipos existente |
| `npm run lint` | passou | gate estático existente |
| `npm run build` | 7 workspaces e ZIP MV3 | prova de empacotamento atual |

Distribuição dos testes observados: `page-controller` 4, `llms` 43, `core` 17 e `extension` 5.

## 3. Arquivos do Page Agent auditados

Os caminhos são relativos à raiz do commit de baseline.

| Área | Caminhos representativos | Fato extraído | Decisões relacionadas |
|---|---|---|---|
| Core | `packages/core/src/PageAgentCore.ts`, tools e prompts adjacentes | loop ReAct, LLM instanciado no core, tool executada durante a resposta, `done` declarativo | ADR-002, ADR-003, ADR-004 |
| Configuração core | tipos/exportações de `packages/core/src/` | API mistura configuração de LLM e agente | PAJ-XCUT-001 |
| DOM | `packages/page-controller/src/` | `FlatDomTree`, `selectorMap`, ações e mask são reutilizáveis | PAJ-COMP-002, PAJ-COMP-003 |
| JavaScript | implementação de `executeJavascript()` em `page-controller` | execução baseada em `eval` | ADR-006 |
| Multipágina | `packages/extension/src/core/MultiPageAgent.ts` | herança do core, injeção `as any`, hooks de abas | ADR-001, ADR-002 |
| Controle remoto | `packages/extension/src/core/RemotePageController.ts` | mensagens sem contrato forte, retorno `null`, espera fixa após click | PAJ-COMP-002, PAJ-COMP-007 |
| Abas | `packages/extension/src/core/TabsController.ts` | base útil para abas; ownership não é session-aware | PAJ-COMP-006, PAJ-COMP-007 |
| Service worker | entrypoint background de `packages/extension/` | encaminhamento privilegiado de mensagens | ADR-001, ADR-005 |
| Content script | entrypoint content de `packages/extension/` | controlador DOM local e polling visual | PAJ-COMP-007 |
| Side panel | hook/entrypoint do painel | cria coordenador próprio | ADR-001 |
| API externa | bridge injetado/main world e content script | handshake/token e possibilidade de outro agente | PAJ-XCUT-001, SEC spec |
| Hub | componentes/cliente do Hub na extensão | protocolo e aprovação próprios sobre runner | PAJ-COMP-007 |
| Provider atual | `packages/llms/src/` | cliente OpenAI-compatible, retries, parsing e testes úteis | PAJ-COMP-008 |
| UI | `packages/ui/src/` e integração de `packages/page-agent/` | painel é ativo reaproveitável com adapter | PAJ-XCUT-005 |
| Diretrizes | `README.md`, `AGENTS.md`, package manifests | comandos, arquitetura declarada e versões | PAJ-ARCH-001 |

> O mapa registra caminhos representativos, não uma API pública garantida. A primeira tarefa de implementação deve fixar links por commit e complementar linhas/símbolos no relatório de baseline gerado pelo CI.

## 4. Fontes oficiais do Page Agent

| Fonte | URL | Uso |
|---|---|---|
| README | <https://github.com/alibaba/page-agent/blob/main/README.md> | visão do produto, uso e estrutura pública |
| AGENTS | <https://github.com/alibaba/page-agent/blob/main/AGENTS.md> | comandos e orientação do repositório |
| Repositório | <https://github.com/alibaba/page-agent> | código-fonte e histórico |

Para decisões de implementação, o commit fixado prevalece sobre o conteúdo mutável de `main`.

## 5. Fontes oficiais do TypeSafe/Jev

| Tema | Fonte | Fato usado |
|---|---|---|
| Visão geral | <https://docs.typesafe.ai/introduction> | Jev é orientado a decisões estruturadas, não geração irrestrita |
| Estado | <https://docs.typesafe.ai/concepts/state> | estado deve ser estruturado, relevante e mínimo |
| Primitivas | <https://docs.typesafe.ai/primitives> | Choice, Score e Noul são as primitivas documentadas |
| Choice | <https://docs.typesafe.ai/primitives/choice> | escolha fechada, opções descritas, limite técnico documentado |
| Confiança | <https://docs.typesafe.ai/confidence> | confidence deriva da distribuição e deve informar gates calibrados |
| Intent routing | <https://docs.typesafe.ai/patterns/intent-routing> | padrão de roteamento por conjunto fechado |
| Confidence routing | <https://docs.typesafe.ai/patterns/confidence-routing> | escalonamento conforme confiança/risco |
| SDK JavaScript | <https://docs.typesafe.ai/sdk/javascript> | integração JS/TS e requisito de runtime do SDK |
| Jaggedness Jev 1.13 | <https://docs.typesafe.ai/model-jaggedness/jev-1.13> | limitações de literalidade, cálculo, datas, indireção, contexto e geração |
| Pacote npm | <https://www.npmjs.com/package/@typesafe-ai/sdk> | versão e engines devem ser travadas no spike |

## 6. Matriz fato → interpretação → resposta de projeto

| Fato ou limitação | Interpretação | Resposta arquitetural | Validação restante |
|---|---|---|---|
| Jev escolhe/classifica, mas não gera livremente | não substitui todo o agente por uma única chamada | Decision Router + provider generativo opcional | benchmark por tipo de necessidade |
| Perguntas no mesmo request devem ser independentes | decisões sequenciais exigem novas rodadas | batch apenas sobre snapshot idêntico | testes de planner de batch |
| Choice suporta muitas opções, mas contexto excessivo degrada | limite técnico não é target de UX/modelo | top-K progressivo, opção `none` | curva de precisão por K |
| Confidence não é garantia | threshold universal é inseguro | gates por template, risco e domínio | calibração/reliability diagrams |
| Jev é fraco em matemática, contagem e datas | essas operações devem ser determinísticas | utilities em código e tipos explícitos | testes property-based |
| Jev não gera conteúdo | texto/valor novo precisa de outra origem | literal do usuário, código, humano ou generativo | catálogo de necessidades |
| DOM contém instruções não confiáveis | prompt injection é risco de dados | projeção estruturada + policy externa | corpus adversarial |
| SDK JS documenta Node 20+ | SDK Node não deve vazar para browser | `NodeSdkJevTransport` isolado; HTTP/proxy no browser | spike CORS/auth/bundle |
| índices DOM atuais são reconstruídos | referência pode ficar obsoleta | `documentId` + `revision` + fingerprint | E2E em SPA/navegação |
| MV3 pode suspender o service worker | memória isolada não é durável | checkpoints, leases e reconciliação | teste de restart real |

## 7. Propostas que não vêm das fontes

Os seguintes itens são decisões originais deste pacote e devem ser avaliados como design, não como comportamento documentado de terceiros:

- taxonomia de `DecisionNeed`;
- `ElementRef` vinculada a documento/revisão;
- `ActionIntent`/`ActionResult` e outcome contracts;
- single shared runtime no service worker;
- protocolo envelope/sequence/idempotency;
- thresholds seed e tiers R0–R3;
- budgets de latência e tamanho;
- estrutura proposta de packages;
- estratégia de rollout e compatibilidade v1;
- esquema de eventos, redaction e evidência.

## 8. Itens obrigatórios de revalidação

Antes de implementar a integração real:

1. confirmar endpoint, autenticação, CORS e suporte browser do Jev vigente;
2. fixar versão exata de `@typesafe-ai/sdk` e engines;
3. testar a política de extensão/Chrome vigente para side panel, worker e mensagens;
4. medir limites reais de payload entre contextos;
5. verificar termos de retenção/telemetria do provider;
6. decidir se o backend proxy é obrigatório para distribuição pública;
7. capturar novas mudanças do Page Agent desde o commit fixado.

## 9. Regra de atualização

Quando uma fonte mudar:

- registrar data e versão consultada;
- identificar requisitos/ADRs afetados;
- repetir spikes relevantes;
- atualizar a matriz de rastreabilidade;
- nunca alterar silenciosamente uma decisão aceita.

