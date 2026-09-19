---
schema_version: "1.0"
document_id: "PAJ-PROD-002"
kind: "scope-spec"
title: "Escopo, não objetivos e fronteiras"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-PROD-001"
---

# Escopo, não objetivos e fronteiras

## 1. Escopo obrigatório

### Núcleo

- substituir o loop obrigatório LLM/ReAct por `AgentRuntime` provider-agnostic;
- implementar `DecisionRouter`, `DeterministicProvider`, `JevProvider` e interface de `GenerativeProvider`;
- modelar tarefas, sessões, steps, decisões, ações, outcomes e evidências;
- implementar cancelamento, budgets, retries e ciclo de recuperação;
- concluir somente por Outcome Contract ou decisão humana explícita autorizada.

### Navegador

- evoluir PageController para produzir `PageObservation` estruturada;
- manter apresentação textual apenas como projeção, não fonte canônica;
- emitir refs de elemento verificáveis e revisionadas;
- suportar ações atuais úteis: click, input, select e scroll;
- remover JavaScript arbitrário do catálogo padrão;
- adicionar sincronização baseada em sinais e timeout.

### Extensão

- substituir herança de `MultiPageAgent` por composição;
- centralizar sessões;
- definir protocolo de mensagens discriminado, versionado e validado em runtime;
- separar runner, side panel, service worker e content scripts;
- manter controle de abas, API externa e Hub como clientes do mesmo Session Manager;
- impedir duas sessões incompatíveis controlando as mesmas abas.

### Qualidade

- testes em cada novo pacote;
- testes de contrato entre local e remote Browser Runtime;
- E2E da extensão com Chrome;
- conjunto de avaliação Jev em PT-BR e EN;
- observabilidade correlacionada e sanitizada;
- migração sem arquitetura dupla permanente.

## 2. Compatibilidade deliberada

### Deve ser preservado conceitualmente

- integração simples do pacote `page-agent`;
- painel/side panel para iniciar, acompanhar e parar tarefas;
- PageController como camada independente de provider;
- gerenciamento multipágina e agrupamento de abas;
- API externa da extensão como capacidade do produto;
- eventos equivalentes a status, history e activity;
- suporte a providers OpenAI-compatíveis por meio do provider generativo opcional, se configurado.

### Pode mudar

- nomes e shapes internos;
- estrutura de pacotes;
- formato do histórico;
- prompts antigos;
- MacroTool e reflexão obrigatória;
- `AgentConfig extends LLMConfig`;
- herança `MultiPageAgent extends PageAgentCore`;
- índices numéricos como argumento público;
- globals de status sem `sessionId`;
- semântica do `done` antigo.

## 3. Não objetivos do primeiro release

| ID | Não objetivo | Motivo |
|---|---|---|
| NG-001 | Agente visual baseado em screenshots/VLM. | O ativo principal é o DOM textual/estruturado; visão requer produto e benchmark próprios. |
| NG-002 | Automação headless/server-side universal. | Page Agent é client-side; Browser Runtime permite evolução futura sem ampliar o MVP. |
| NG-003 | Suporte oficial a Firefox/Safari. | Primeiro estabilizar Chrome MV3; contratos devem permanecer portáveis. |
| NG-004 | Execução arbitrária de JavaScript gerado por IA. | Aumenta risco e contorna políticas/observação. |
| NG-005 | Compras, transferências financeiras ou exclusões irreversíveis totalmente autônomas. | Exigem confirmação ou podem ser proibidas por política. |
| NG-006 | Memória de longo prazo entre usuários/sessões. | Amplia riscos de privacidade; primeiro entregar memória da tarefa. |
| NG-007 | Treinar/fine-tunar Jev. | O projeto integra e avalia o modelo disponível. |
| NG-008 | Garantir que toda tarefa funcione sem LLM generativo. | Jev não gera texto nem resolve planejamento aberto. |
| NG-009 | Preservar classes internas antigas. | Produto prioriza arquitetura limpa. |
| NG-010 | Criar backend obrigatório para usuários BYOK. | Proxy é um modo, não requisito universal. |
| NG-011 | Controlar abas privadas/restritas ou páginas do navegador. | Content scripts não são permitidos e o risco é alto. |
| NG-012 | Upload/download genérico no MVP. | Requer permissões e UX específicas; manter como extensão futura. |

## 4. Itens futuros compatíveis

- `upload_file` com consentimento e file picker;
- extração tabular estruturada;
- `send_keys` limitado e tipado;
- Firefox via WebExtensions;
- adapter Playwright/Puppeteer;
- visão opcional para canvas/remote desktops;
- memória reutilizável com consentimento;
- workflows gravados/reproduzíveis;
- políticas administradas por organização;
- múltiplas sessões em abas totalmente disjuntas;
- marketplace de actions e verifiers assinados.

## 5. Fronteira de autorização

O pedido da tarefa autoriza apenas ações necessárias ao objetivo descrito. O runtime não deve inferir autorização para:

- ampliar o conjunto de domínios;
- enviar/publicar conteúdo externo;
- concluir compras;
- aceitar termos;
- excluir dados;
- compartilhar credenciais ou dados pessoais;
- habilitar controle de todas as abas;
- persistir conteúdo sensível.

Essas ações exigem capacidade concedida pela configuração e, quando aplicável, confirmação contextual do usuário.

## 6. Regra de corte de legado

Um componente antigo é removido quando:

1. a capacidade equivalente existe no runtime novo;
2. testes de contrato cobrem a capacidade;
3. nenhum entrypoint de produção importa o componente;
4. documentação e exemplos foram migrados;
5. o adaptador de compatibilidade, se existente, não depende dele.

Não se manterá implementação antiga “por segurança” sem owner, teste, usuário e data de remoção.
