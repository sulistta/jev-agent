---
schema_version: "1.0"
document_id: "PAJ-INDEX"
kind: "specification-index"
title: "Page Agent + Jev — Pacote completo de especificações"
status: "proposed"
version: "1.0.0"
language: "pt-BR"
updated: "2026-09-19"
baseline:
  repository: "https://github.com/alibaba/page-agent"
  release: "1.12.4"
  commit: "9eb6b6646500264d9034dd466a4270cb9fc1ef1e"
  jev_model: "jev-1.13"
owners:
  - "produto"
  - "arquitetura"
  - "engenharia"
depends_on: []
---

# Page Agent + Jev

Este pacote descreve a reconstrução do motor do Page Agent em torno de um runtime único, orientado a evidências e com o Jev como mecanismo principal para decisões semânticas fechadas. O mesmo runtime deverá operar no agente integrado a uma página e na extensão multipágina.

O objetivo não é adicionar um `JevProvider` ao ciclo ReAct existente. O objetivo é substituir o ciclo obrigatório de LLM por uma arquitetura na qual:

- código determinístico controla estado, permissões, execução, aritmética, sincronização e verificação;
- o Jev resolve julgamentos semânticos atômicos sobre conjuntos fechados;
- um provedor generativo é opcional e só participa quando a tarefa exige geração ou replanejamento aberto;
- a conclusão depende de evidências verificadas, nunca apenas de uma declaração do modelo;
- a extensão e o modo in-page compartilham o mesmo núcleo e os mesmos contratos;
- código legado, duplicado ou sem finalidade no produto final é removido durante a migração.

## Como ler o pacote

1. Comece por [Visão e escopo](01-product/PRODUCT_SPEC.md).
2. Consulte [Auditoria da base atual](02-architecture/CURRENT_STATE_AUDIT.md) para entender as decisões de migração.
3. Leia [Arquitetura-alvo](02-architecture/TARGET_ARCHITECTURE.md) e [Modelo de domínio](02-architecture/DOMAIN_MODEL_AND_STATE_MACHINES.md).
4. Use as SPECs de componentes em `03-components/` como contratos de implementação.
5. Use o [Plano completo](05-delivery/IMPLEMENTATION_PLAN.md) e o [Backlog executável](05-delivery/WORK_BREAKDOWN.md) para executar a refatoração.
6. Use a [Matriz de rastreabilidade](05-delivery/TRACEABILITY_MATRIX.md) para confirmar que cada requisito tem implementação e teste.

## Índice de documentos

### Governança

| Documento | Finalidade |
|---|---|
| [Convenções](00-governance/SPEC_CONVENTIONS.md) | Estrutura semântica, IDs, estados normativos e política de mudanças. |
| [Glossário](00-governance/GLOSSARY.md) | Vocabulário comum do runtime, Jev, DOM e extensão. |
| [Premissas e questões abertas](00-governance/ASSUMPTIONS_AND_OPEN_QUESTIONS.md) | Premissas adotadas, validações obrigatórias e decisões ainda reversíveis. |

### Produto

| Documento | Finalidade |
|---|---|
| [Product Spec](01-product/PRODUCT_SPEC.md) | Problema, proposta de valor, personas, jornadas e métricas. |
| [Escopo e não objetivos](01-product/SCOPE_AND_NON_GOALS.md) | Fronteiras do primeiro release e exclusões explícitas. |
| [Requisitos](01-product/REQUIREMENTS.md) | Requisitos funcionais e não funcionais identificados por ID. |

### Arquitetura

| Documento | Finalidade |
|---|---|
| [Auditoria atual](02-architecture/CURRENT_STATE_AUDIT.md) | Estado real do Page Agent 1.12.4, dívidas e ativos reutilizáveis. |
| [Arquitetura-alvo](02-architecture/TARGET_ARCHITECTURE.md) | Componentes, limites, fluxos e invariantes. |
| [Modelo de domínio e máquinas de estado](02-architecture/DOMAIN_MODEL_AND_STATE_MACHINES.md) | Entidades, estados, transições e invariantes temporais. |
| [Limites de pacotes](02-architecture/PACKAGE_BOUNDARIES.md) | Dependências permitidas, árvore proposta e regras de importação. |

### Componentes

| Documento | Finalidade |
|---|---|
| [Agent Runtime](03-components/AGENT_RUNTIME.md) | Loop incremental, roteamento, cancelamento e recuperação. |
| [Browser Runtime](03-components/BROWSER_RUNTIME.md) | Contrato comum para modo in-page e extensão. |
| [Observações e candidatos](03-components/OBSERVATION_AND_CANDIDATES.md) | Estado estruturado, filtragem e referências estáveis. |
| [Decision Engine + Jev](03-components/DECISION_ENGINE_JEV.md) | Primitivas Jev, perguntas, confiança e transporte. |
| [Ações e outcomes](03-components/ACTIONS_AND_OUTCOMES.md) | Registro de ações, políticas, sincronização e verificação. |
| [Sessões e persistência](03-components/SESSIONS_AND_PERSISTENCE.md) | Concorrência, durabilidade, retomada e ownership. |
| [Runtime da extensão](03-components/EXTENSION_RUNTIME.md) | Contextos MV3, protocolo tipado, Hub e API externa. |
| [Provedor generativo](03-components/GENERATIVE_PROVIDER.md) | Limites e contrato do fallback generativo opcional. |

### Aspectos transversais

| Documento | Finalidade |
|---|---|
| [API e contratos públicos](04-cross-cutting/PUBLIC_API_AND_CONTRACTS.md) | API v2, configuração, eventos, erros e compatibilidade. |
| [Segurança e privacidade](04-cross-cutting/SECURITY_PRIVACY_THREAT_MODEL.md) | Fronteiras de confiança, permissões, credenciais e ameaças. |
| [Confiabilidade e desempenho](04-cross-cutting/RELIABILITY_AND_PERFORMANCE.md) | Budgets, retries, backpressure, caching e metas. |
| [Observabilidade](04-cross-cutting/OBSERVABILITY.md) | Eventos, logs, traces, métricas e replay seguro. |
| [UI/UX](04-cross-cutting/UI_UX.md) | Estados visuais, consentimento, explicabilidade e recuperação. |

### Entrega

| Documento | Finalidade |
|---|---|
| [Plano de implementação](05-delivery/IMPLEMENTATION_PLAN.md) | Sequenciamento técnico por fases e gates. |
| [Backlog executável](05-delivery/WORK_BREAKDOWN.md) | Épicos, tarefas, dependências, arquivos e aceite. |
| [Migração e remoção](05-delivery/MIGRATION_AND_REMOVAL.md) | Estratégia de corte, matriz preservar/refatorar/remover. |
| [Testes e avaliação](05-delivery/TEST_AND_EVALUATION_PLAN.md) | Pirâmide de testes, E2E da extensão e benchmark Jev. |
| [Release e rollout](05-delivery/RELEASE_AND_ROLLOUT.md) | Versionamento, flags, canais, rollback e pós-release. |
| [Critérios de aceite e DoD](05-delivery/ACCEPTANCE_AND_DEFINITION_OF_DONE.md) | Condições verificáveis para considerar o trabalho concluído. |
| [Riscos](05-delivery/RISK_REGISTER.md) | Riscos técnicos/produto, sinais e mitigação. |
| [Rastreabilidade](05-delivery/TRACEABILITY_MATRIX.md) | Requisito → componente → tarefa → teste → evidência. |

### Decisões arquiteturais

| ADR | Decisão |
|---|---|
| [ADR-001](06-adrs/ADR-001-SINGLE-SHARED-RUNTIME.md) | Um runtime compartilhado, sem cores paralelos. |
| [ADR-002](06-adrs/ADR-002-COMPOSITION-OVER-INHERITANCE.md) | Composição para adaptar ambientes de navegador. |
| [ADR-003](06-adrs/ADR-003-JEV-FOR-ATOMIC-SEMANTIC-DECISIONS.md) | Jev apenas para decisões semânticas atômicas. |
| [ADR-004](06-adrs/ADR-004-EVIDENCE-BASED-COMPLETION.md) | Conclusão por Outcome Contract e evidências. |
| [ADR-005](06-adrs/ADR-005-TYPED-EXTENSION-PROTOCOL.md) | Protocolo versionado e tipado na extensão. |
| [ADR-006](06-adrs/ADR-006-NO-ARBITRARY-JAVASCRIPT.md) | JavaScript arbitrário fora do runtime padrão. |
| [ADR-007](06-adrs/ADR-007-CREDENTIAL-AND-TRANSPORT-MODES.md) | Transportes Jev separados de credenciais e ambientes. |

### Referências

| Documento | Finalidade |
|---|---|
| [Mapa de fontes](07-reference/SOURCE_MAP.md) | Fontes oficiais e arquivos auditados. |
| [Árvore proposta](07-reference/PROPOSED_REPOSITORY_TREE.md) | Estrutura final recomendada do monorepo. |
| [Exemplos de configuração](07-reference/CONFIGURATION_EXAMPLES.md) | Perfis in-page, extensão, proxy e testes. |

## Resultado esperado

Ao término do plano, o produto deve oferecer:

- um único runtime de tarefas compartilhado;
- decisões Jev auditáveis e calibradas por risco;
- execução local e remota por contratos equivalentes;
- referências de elementos vinculadas a aba, documento e revisão;
- sincronização condicionada a eventos/estado, sem sleeps fixos no caminho normal;
- sessões isoladas e concorrência explicitamente governada;
- conclusão baseada em evidências;
- confirmação humana para ações sensíveis;
- API pública versionada e extensão funcional;
- suíte de testes unitários, integração, contrato, E2E e avaliação semântica.

## Nota sobre o termo “SPECs”

Este pacote interpreta “CESQs” no pedido como “SPECs”. As especificações foram decompostas em documentos pequenos, endereçáveis e rastreáveis, em vez de um único arquivo monolítico.
