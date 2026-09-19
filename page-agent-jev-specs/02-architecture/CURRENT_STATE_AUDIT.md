---
schema_version: "1.0"
document_id: "PAJ-ARCH-001"
kind: "baseline-audit"
title: "Auditoria da base Page Agent 1.12.4"
status: "accepted-for-planning"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-GOV-001"
source_commit: "9eb6b6646500264d9034dd466a4270cb9fc1ef1e"
---

# Auditoria da base Page Agent 1.12.4

## 1. Método e baseline

A análise foi realizada sobre o repositório `alibaba/page-agent`, branch `main`, commit:

```text
9eb6b6646500264d9034dd466a4270cb9fc1ef1e
chore(version): bump version to 1.12.4
commit date: 2026-09-06T15:44:57+08:00
```

Verificações locais realizadas em ambiente limpo:

| Verificação | Resultado |
|---|---|
| `npm ci` | Concluído. |
| `npm test` | 69 testes passaram: page-controller 4, llms 43, core 17, extension 5. |
| `npm run typecheck` | Passou. |
| `npm run lint` | Passou. |
| `npm run build` | Passou para 7 workspaces, incluindo ZIP Chrome MV3. |

Observação: o `AGENTS.md` afirma que a cobertura atual está apenas em `packages/llms`, mas o commit auditado já contém testes em `core`, `page-controller` e `extension`. A documentação interna está defasada nesse ponto.

## 2. Estrutura atual relevante

```text
packages/
├── core/             PageAgentCore, ferramentas, prompts, eventos
├── llms/             cliente OpenAI-compatible e retry
├── page-controller/  extração DOM, mapa por índice e ações
├── page-agent/       facade in-page com UI
├── ui/               painel desacoplado por adapter
├── extension/        WXT + React + Chrome MV3
├── mcp/              bridge externo (beta)
└── website/          documentação e demo
```

O monorepo é source-first. O pacote `core` importa `@page-agent/llms` e `@page-agent/page-controller`; `page-agent` e `extension` compõem/herdam o core.

## 3. Fluxo atual do Core

`PageAgentCore.execute()` executa um loop ReAct:

1. valida/prepara tarefa;
2. chama `pageController.getBrowserState()`;
3. monta system prompt, task, histórico textual e conteúdo DOM;
4. cria um MacroTool com união de todos os tools;
5. chama `LLM.invoke()`;
6. o LLM fornece reflexão (`evaluation_previous_goal`, `memory`, `next_goal`) e uma ação;
7. MacroTool executa a ferramenta imediatamente;
8. registra step e repete;
9. quando o action name é `done`, aceita `success` e `text` fornecidos pelo modelo.

### Consequências

- O core não funciona sem configurar um LLM compatível.
- Seleção, argumentos e execução estão unidos na invocação do MacroTool.
- Ações são executadas dentro do callback da ferramenta antes de uma policy layer separada.
- A conclusão não possui verificador independente.
- Histórico é otimizado para prompt textual, não para replay/event sourcing.
- `AgentConfig` herda de `LLMConfig`, tornando o acoplamento parte da API pública.

## 4. PageController atual

Ativos positivos:

- não depende do pacote de LLM;
- extrai `FlatDomTree` e simplifica o DOM;
- mantém `selectorMap` de índice para referência real;
- implementa click, input, select, scroll vertical/horizontal;
- possui mask visual e eventos `beforeUpdate`/`afterUpdate`;
- métodos públicos são assíncronos, o que facilita adapter remoto;
- já possui testes básicos e ações retornam `success/message`.

Limitações verificadas:

- `BrowserState.content` é string destinada ao LLM, não estrutura canônica;
- o `selectorMap` é reconstruído em `updateTree()` e os índices não carregam revisão;
- `ActionResult` não é exportado e só contém boolean/message;
- falhas de ação são convertidas em strings, perdendo código e contexto;
- não há `documentId`, `observationId` ou validação de stale ref;
- `executeJavascript()` usa `eval` e pode executar código arbitrário;
- ações não expõem evidências estruturadas;
- código DOM ainda contém TODOs para data masking, estabilidade e parsing tabular.

## 5. Extensão atual

### MultiPageAgent

`MultiPageAgent extends PageAgentCore`. No construtor:

- cria `TabsController` e `RemotePageController`;
- injeta tools de abas;
- fornece prompt próprio;
- converte `pageController as any` porque o adapter não implementa exatamente o tipo;
- desabilita JavaScript porque `AbortSignal` não atravessa contextos;
- usa hooks do core para inicializar/sincronizar abas;
- projeta `isAgentRunning` e heartbeat em `chrome.storage.local`.

### RemotePageController

- envia `PAGE_CONTROL` ao service worker;
- service worker encaminha ao content script da aba alvo;
- content script possui um PageController local;
- payloads/retornos usam `any`;
- falha no primeiro `sendMessage` é logada e convertida em `null`;
- `clickElement()` sempre espera 1000 ms depois da ação;
- interface remota não é formalmente compartilhada com PageController;
- erros podem voltar como `{ success:false, error }` ou como `null`, enquanto callers esperam outros shapes.

### TabsController

Ativos positivos:

- service worker permanece intencionalmente stateless;
- controla janela, aba inicial, grupo e abas rastreadas;
- sincroniza metadados por pull;
- detecta abas abertas/fechadas;
- suporta cancelamento em `waitUntilTabLoaded()`;
- possui testes do wait/abort.

Limitações:

- mensagens também usam `any` e `null` em falha;
- ownership é implícito no objeto e no grupo, não em Session Store compartilhado;
- `currentTabId` é global em `chrome.storage.local`;
- o mecanismo não impede agentes independentes (side panel/API) de competir;
- tab status `complete` não prova estabilidade do DOM/SPAs;
- timeout de 4 s pode retornar sem distinguir “ainda carregando” de “estável”.

### Entrypoints e multiplicidade

- `useAgent()` no side panel instancia `MultiPageAgent`.
- `content.ts` pode instanciar outro singleton `MultiPageAgent` para a API externa.
- Hub usa o hook do side panel/runner e mantém protocolo WebSocket próprio.
- todos projetam estado global de execução.

Isso cria a possibilidade de coordenadores independentes compartilharem as mesmas chaves de storage e abas sem uma autoridade única.

## 6. Segurança atual relevante

Pontos positivos:

- JavaScript arbitrário é experimental e desabilitado na extensão;
- extensão restringe páginas de navegador/extension/file/devtools;
- API injetada só é exposta quando token do storage coincide com token em `localStorage`;
- Hub pede aprovação de sessão, salvo allow-all configurado;
- content script permanece em isolated world e service worker faz operações privilegiadas.

Riscos/limitações:

- token permanente em `localStorage` pode ser lido por scripts do mesmo origin;
- API externa aceita `baseURL`, `model` e `apiKey` da página e encaminha configuração ao agente;
- confirmação e policy por ação ainda não existem como camada independente;
- `host_permissions: <all_urls>` amplia impacto de falha;
- conteúdo DOM não é marcado/segregado como não confiável no contrato;
- traces podem incluir request/response bruto do LLM;
- globais de storage não são namespaced por sessão;
- protocolo não possui versão/nonce/capability binding.

## 7. Testes atuais

| Pacote | Cobertura observada |
|---|---|
| `llms` | request construction, success, erros HTTP/schema, tool execution, abort e retry. |
| `core` | execução normal, stop/dispose, hooks, erros e edge cases de cancelamento. |
| `page-controller` | construção e `executeJavascript`; não cobre pipeline/ações principais. |
| `extension` | apenas `TabsController.waitUntilTabLoaded`. |

Lacunas:

- sem E2E de extensão;
- sem testes de contrato local versus remote;
- sem testes do protocolo de mensagens;
- sem testes de múltiplos entrypoints/sessões;
- sem testes de stale refs;
- sem outcomes/verificação;
- sem segurança/prompt injection;
- sem benchmark de decisão semântica.

## 8. Classificação dos componentes

| Componente | Decisão | Justificativa |
|---|---|---|
| Extração DOM | Preservar e evoluir | Ativo valioso; precisa saída estruturada e revisão. |
| Ações DOM | Preservar e tipar | Implementação útil; retornos devem virar resultados estruturados. |
| SimulatorMask | Preservar | Boa UX; deve ser session-aware. |
| PageAgentCore loop | Reescrever | Acoplado obrigatoriamente ao LLM e ao MacroTool. |
| MacroTool/reflection prompt | Remover do caminho novo | Modelo mental incompatível com Jev-first. |
| `packages/llms` | Mover para provider generativo opcional | Não deve ser dependência do runtime. |
| `done` atual | Remover | Sucesso deve vir de Outcome Verifier. |
| `MultiPageAgent` por herança | Substituir | Composição preserva o mesmo runtime nos ambientes. |
| RemotePageController | Reescrever contrato | Finalidade útil; tipos/erros/sincronização frágeis. |
| TabsController | Evoluir | Boa base, falta sessão/ownership/protocolo. |
| Side panel | Adaptar | Deve ser cliente de sessão. |
| API externa | Versionar/redesenhar | Capacidade útil, fronteira de segurança crítica. |
| Hub/MCP | Manter sob o mesmo runtime | Não deve instanciar motor alternativo. |
| Execução arbitrária de JS | Remover do produto padrão | Risco desnecessário. |

## 9. Conclusão da auditoria

O projeto possui uma boa infraestrutura de DOM, ações, UI e multipágina. O problema central não é falta de funcionalidades: é o limite de responsabilidade do core. A implementação nova deve preservar ativos de interação enquanto substitui o modelo de controle por contratos explícitos, providers intercambiáveis, política independente e verificação baseada em evidências.

O baseline está saudável o suficiente para uma migração incremental por vertical slices, mas não deve ser congelado como arquitetura final.
