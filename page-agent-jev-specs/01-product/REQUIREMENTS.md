---
schema_version: "1.0"
document_id: "PAJ-PROD-003"
kind: "requirements-spec"
title: "Requisitos funcionais e não funcionais"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-PROD-001"
  - "PAJ-PROD-002"
---

# Requisitos funcionais e não funcionais

## 1. Requisitos funcionais

### Tarefas e sessões

| ID | Requisito | Prioridade |
|---|---|---|
| FR-001 | O sistema DEVE criar uma `Session` com ID único para cada execução. | P0 |
| FR-002 | A sessão DEVE registrar owner, task, capabilities, budgets, tabs e timestamps. | P0 |
| FR-003 | Um owner NÃO DEVE iniciar outra tarefa incompatível enquanto sua sessão estiver ativa. | P0 |
| FR-004 | O sistema DEVE permitir `pause`, `resume`, `cancel` e `stop` com semântica definida. | P0 |
| FR-005 | O cancelamento DEVE alcançar provider, sincronização, executor e callbacks cooperativos. | P0 |
| FR-006 | A sessão DEVE produzir um resultado terminal discriminado: `completed`, `partially_completed`, `needs_input`, `blocked`, `failed` ou `cancelled`. | P0 |

### Observação

| ID | Requisito | Prioridade |
|---|---|---|
| FR-007 | O Browser Runtime DEVE produzir observação estruturada com aba, documento, revisão, URL, título, viewport, elementos e sinais. | P0 |
| FR-008 | Cada elemento acionável DEVE possuir `ElementRef` vinculada a tab/document/revision. | P0 |
| FR-009 | Uma navegação ou substituição de documento DEVE invalidar refs anteriores. | P0 |
| FR-010 | O runtime DEVE filtrar conteúdo invisível, desabilitado ou incompatível antes do Jev. | P0 |
| FR-011 | Dados sensíveis desnecessários DEVEM ser removidos ou mascarados antes de providers. | P0 |
| FR-012 | A representação textual DEVE ser derivada da observação canônica, não mantida como estado paralelo. | P1 |

### Decisão

| ID | Requisito | Prioridade |
|---|---|---|
| FR-013 | O Decision Router DEVE escolher um único mecanismo por decisão: código, Jev, generativo ou humano. | P0 |
| FR-014 | Código determinístico DEVE executar cálculos, validações, comparação de datas, contagem e decisões completamente determinadas. | P0 |
| FR-015 | Jev DEVE receber perguntas atômicas e opções fechadas. | P0 |
| FR-016 | Toda seleção Jev DEVE incluir uma saída segura (`none`, `escalate` ou equivalente) quando o conjunto possa ser incompleto. | P0 |
| FR-017 | Perguntas independentes sobre o mesmo estado DEVERIAM ser agrupadas. | P1 |
| FR-018 | Decisões dependentes de uma ação/resultado DEVEM usar nova observação e nova chamada. | P0 |
| FR-019 | O sistema DEVE aplicar confidence gates específicos por risco. | P0 |
| FR-020 | Thresholds DEVEM ser configuráveis e versionados; NÃO DEVEM ser tratados como garantia. | P0 |
| FR-021 | O provider generativo DEVE ser opcional e acionado somente por necessidade explícita. | P0 |

### Ações e outcomes

| ID | Requisito | Prioridade |
|---|---|---|
| FR-022 | Toda ação DEVE existir no Action Registry com schema, capacidade e risk tier. | P0 |
| FR-023 | Argumentos e target refs DEVEM ser validados imediatamente antes da execução. | P0 |
| FR-024 | Ações com stale refs NÃO DEVEM ser executadas. | P0 |
| FR-025 | Após uma ação, o runtime DEVE aguardar sinais condicionais ou timeout, sem sleep fixo como mecanismo principal. | P0 |
| FR-026 | Toda etapa executável DEVE possuir Outcome Contract ou regra explícita de progresso. | P0 |
| FR-027 | O runtime DEVE coletar evidências objetivas antes de declarar conclusão. | P0 |
| FR-028 | O runtime DEVE detectar ciclos e ausência de progresso. | P0 |
| FR-029 | JavaScript arbitrário NÃO DEVE integrar o catálogo padrão. | P0 |
| FR-030 | Ações sensíveis DEVEM exigir confirmação vinculada ao estado e com expiração. | P0 |

### Extensão e multipágina

| ID | Requisito | Prioridade |
|---|---|---|
| FR-031 | Side panel, API externa e Hub DEVEM usar o mesmo Session Manager. | P0 |
| FR-032 | Mensagens entre contextos DEVEM ser versionadas, discriminadas e validadas. | P0 |
| FR-033 | Erros remotos DEVEM distinguir timeout, aba ausente, permissão, protocolo, stale ref, cancelamento e falha interna. | P0 |
| FR-034 | Credenciais de provider NÃO DEVEM chegar ao main world ou ao content script. | P0 |
| FR-035 | A sessão DEVE controlar somente abas explicitamente pertencentes ao seu escopo. | P0 |
| FR-036 | O service worker NÃO DEVE ser a única fonte de verdade de tarefas longas. | P0 |
| FR-037 | A API pública da extensão DEVE expor session ID, stream de eventos, stop e resultado. | P1 |

### UI e integração

| ID | Requisito | Prioridade |
|---|---|---|
| FR-038 | A UI DEVE mostrar estado atual, próxima ação, risco, confirmação e resultado. | P0 |
| FR-039 | O usuário DEVE poder inspecionar por que a ação foi escolhida sem expor raciocínio privado do modelo. | P1 |
| FR-040 | O integrador DEVE poder fornecer hooks/policies sem alterar o core. | P1 |
| FR-041 | Eventos públicos DEVEM ser estruturados, estáveis e correlacionados. | P0 |
| FR-042 | Exportação de trace DEVE aplicar sanitização e consentimento. | P1 |

## 2. Requisitos não funcionais

### Arquitetura e manutenção

| ID | Requisito | Meta |
|---|---|---|
| NFR-001 | Core independente de providers concretos. | `runtime` não importa `@page-agent/llms` nem SDK Jev. |
| NFR-002 | Paridade entre Browser Runtimes. | Mesma suíte de contrato passa em local e remote. |
| NFR-003 | Tipagem pública explícita. | Sem `any` em protocolo, API pública ou porta Browser Runtime. |
| NFR-004 | Sem arquitetura duplicada. | Um loop de execução de produção. |
| NFR-005 | Dependências acíclicas. | Verificação automatizada no CI. |
| NFR-006 | Código/comentários em inglês; docs de produto podem ser PT-BR. | Lint/review. |

### Confiabilidade

| ID | Requisito | Meta |
|---|---|---|
| NFR-007 | Stale ref executada. | 0. |
| NFR-008 | Ação sensível sem confirmação válida. | 0. |
| NFR-009 | Cancelamento terminal. | ≤ 2 s no p95, salvo API externa não cancelável já em voo. |
| NFR-010 | Recuperação de SW. | Mensagens idempotentes; sessão não corrompida após restart. |
| NFR-011 | Repetição sem progresso. | Detectada dentro do budget configurado. |
| NFR-012 | Resultado terminal único. | Exatamente um por sessão. |

### Desempenho

| ID | Requisito | Meta inicial |
|---|---|---|
| NFR-013 | Overhead local do loop (sem provider/navegação). | p95 < 50 ms por step em hardware alvo. |
| NFR-014 | Geração de candidatos. | p95 < 100 ms para 500 elementos extraídos. |
| NFR-015 | Tamanho de observação enviado. | Filtrado por pergunta; registrar tokens/bytes. |
| NFR-016 | Batch Jev. | Perguntas independentes agrupadas quando respeitar budget. |
| NFR-017 | Content script. | Nenhum polling intensivo global; consumo medido com agente ocioso. |

### Segurança e privacidade

| ID | Requisito | Meta |
|---|---|---|
| NFR-018 | Menor privilégio. | Capacidades e escopo por sessão. |
| NFR-019 | Conteúdo hostil. | Página nunca altera policy/instrução autorizada. |
| NFR-020 | Segredos em logs. | 0 ocorrência em testes de redaction. |
| NFR-021 | Retenção. | Configurável, documentada e default mínimo. |
| NFR-022 | Confirmação. | Vinculada a target/args/revision e expira. |

### Qualidade e compatibilidade

| ID | Requisito | Meta |
|---|---|---|
| NFR-023 | Build/typecheck/lint. | 100% verde em cada PR. |
| NFR-024 | Cobertura de contratos críticos. | 100% dos estados/transições e códigos de erro P0. |
| NFR-025 | E2E Chrome MV3. | Caminhos principais e recuperação. |
| NFR-026 | Benchmark semântico. | Dataset versionado PT-BR/EN com regressão bloqueante. |
| NFR-027 | Compat adapter. | Sem import reverso do runtime para legado. |
| NFR-028 | Protocol versioning. | Handshake e erro incompatível explícito. |
| NFR-029 | Acessibilidade. | UI navegável por teclado, labels e anúncios de status. |
| NFR-030 | Documentação. | API, riscos, configuração e migração publicados junto ao release. |

## 3. Controles transversais

### Segurança

| ID | Controle | Prioridade |
|---|---|---|
| SEC-001 | Conteúdo da página NÃO DEVE alterar instruções autorizadas ou policy. | P0 |
| SEC-002 | A API da extensão DEVE exigir grant por origin, capability, expiração e nonce. | P0 |
| SEC-003 | Um token persistente NÃO DEVE ser o único controle de autorização. | P0 |
| SEC-004 | Providers NÃO DEVEM inventar action ou target fora das unions e candidates locais. | P0 |
| SEC-005 | Refs obsoletas DEVEM ser rejeitadas antes de atingir um elemento. | P0 |
| SEC-006 | Confirmações DEVEM ser vinculadas ao estado, ser single-use e expirar. | P0 |
| SEC-007 | Retentativas NÃO DEVEM duplicar side effects quando o efeito for desconhecido. | P0 |
| SEC-008 | Credenciais de providers NÃO DEVEM chegar ao content script ou main world. | P0 |
| SEC-009 | Logs e traces DEVEM passar por redaction central e testes canary. | P0 |
| SEC-010 | Mensagens DEVEM validar sender, contexto, schema, sessão e request ID. | P0 |
| SEC-011 | Ownership e lease DEVEM impedir conflito de abas entre sessões. | P0 |
| SEC-012 | JavaScript arbitrário NÃO DEVE contornar safeguards do runtime padrão. | P0 |
| SEC-013 | Domain policy DEVE ser verificada antes de observe/write e ser visível na UI. | P0 |
| SEC-014 | Falhas de provider DEVEM respeitar timeout, estado mínimo, fallback e circuit breaker. | P0 |
| SEC-015 | Confirmações DEVEM ocorrer na UI confiável da extensão, com consequência explícita. | P0 |
| SEC-016 | Custom actions DEVEM possuir registro, schema, capability e allowlist explícitos. | P0 |
| SEC-017 | Policies locais DEVEM prevalecer sobre configuração remota. | P0 |
| SEC-018 | URLs e argumentos DEVEM ser validados contra a destination policy. | P0 |
| SEC-019 | Bundle e imports DEVEM ser auditados para impedir SDK ou segredo indevido. | P0 |
| SEC-020 | Resultado sem evidência válida NÃO DEVE habilitar ação posterior. | P0 |

### Privacidade

| ID | Controle | Prioridade |
|---|---|---|
| PRIV-001 | Cada pergunta/provider DEVE receber somente o estado mínimo necessário. | P0 |
| PRIV-002 | Passwords, tokens e campos secret NÃO DEVEM sair do browser. | P0 |
| PRIV-003 | PII DEVE ser classificada e mascarada quando não necessária. | P0 |
| PRIV-004 | DOM bruto NÃO DEVE ser persistido por padrão. | P0 |
| PRIV-005 | Telemetria DEVE ser opt-in e metadata-only por padrão. | P0 |
| PRIV-006 | Exportação de trace DEVE exigir ação do usuário e preview do conteúdo. | P0 |
| PRIV-007 | Retenção local DEVE ter TTL configurável e ação explícita de limpeza. | P0 |
| PRIV-008 | Proxy DEVE documentar processamento/retention e aplicar isolamento por tenant. | P0 |
| PRIV-009 | Evidence pública DEVE usar resumo, hashes ou tags em valores sensíveis. | P0 |
| PRIV-010 | Configuração de redaction NÃO DEVE ser desabilitada pelo conteúdo da página. | P0 |

### Observabilidade

| ID | Requisito | Prioridade |
|---|---|---|
| OBS-001 | Transições de sessão DEVEM emitir evento estruturado com correlação. | P0 |
| OBS-002 | Observações DEVEM registrar resumo, contagens, tamanho e sanitização. | P0 |
| OBS-003 | Geração de candidates DEVE registrar operação, filtros e contagens antes/depois. | P0 |
| OBS-004 | Requests de decisão DEVEM registrar provider, need, template e tamanho do estado. | P0 |
| OBS-005 | Responses de decisão DEVEM registrar outcome, metadata de confiança, duração e usage. | P0 |
| OBS-006 | Gates DEVEM registrar policy de threshold, risco e rota escolhida. | P0 |
| OBS-007 | Decisions de policy DEVEM registrar allow/confirm/deny e rule IDs. | P0 |
| OBS-008 | Execuções DEVEM registrar action, target digest, status e duração. | P0 |
| OBS-009 | Sincronização DEVE registrar sinais esperados, resultado e duração. | P0 |
| OBS-010 | Verificações DEVEM registrar predicates, status e IDs de evidência. | P0 |
| OBS-011 | Recuperações DEVEM registrar causa, estratégia e ordinal. | P0 |
| OBS-012 | Saúde de transporte DEVE registrar reconnects e códigos de erro. | P0 |
| OBS-013 | Negações de segurança DEVEM registrar rule, origin e capability sem argumentos sensíveis. | P0 |
| OBS-014 | Resultado terminal DEVE registrar status, goals e métricas. | P0 |

### Experiência do usuário

| ID | Requisito | Prioridade |
|---|---|---|
| UX-001 | A UI DEVE representar o estado idle com tarefa, provider e escopo. | P0 |
| UX-002 | Starting DEVE mostrar validação de configuração e capabilities. | P0 |
| UX-003 | Observing DEVE mostrar site/aba e região em análise. | P0 |
| UX-004 | Deciding DEVE comunicar escolha sem expor chain-of-thought. | P0 |
| UX-005 | Executing DEVE mostrar ação, alvo e cancelamento. | P0 |
| UX-006 | Synchronizing DEVE mostrar mudança aguardada e timeout. | P0 |
| UX-007 | Waiting user DEVE mostrar pergunta, contexto e opções. | P0 |
| UX-008 | Paused/takeover DEVE indicar controle manual e retomada. | P0 |
| UX-009 | Recovering DEVE mostrar falha observada e estratégia. | P0 |
| UX-010 | Completed DEVE mostrar resumo, goals e evidências. | P0 |
| UX-011 | Partial DEVE distinguir o que foi feito do que falta. | P0 |
| UX-012 | Blocked/failed DEVE mostrar código humano, causa e ação sugerida. | P0 |
| UX-013 | Confirmações DEVEM mostrar ação, destino, consequência, risco e validade. | P0 |
| UX-014 | Escopo de abas e permissões DEVEM ser visíveis, selecionáveis e revogáveis. | P0 |
| UX-015 | A UI DEVE ser acessível por teclado, leitor de tela, zoom e redução de movimento. | P0 |

## 4. Prioridades

- **P0**: necessário para uma versão correta e segura.
- **P1**: necessário para uma versão pública madura; pode entrar após vertical slice se não comprometer segurança.
- **P2**: melhoria futura compatível.

## 5. Regra de aceite

Um requisito só pode ser marcado como entregue quando houver:

1. implementação revisada;
2. teste automatizado ou procedimento reproduzível;
3. evidência vinculada na matriz de rastreabilidade;
4. documentação pública quando afetar integradores/usuários.
