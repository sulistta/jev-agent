---
schema_version: "1.0"
document_id: "PAJ-PROD-001"
kind: "product-spec"
title: "Product Spec — Page Agent + Jev"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-GOV-002"
  - "PAJ-GOV-003"
requirements:
  - "FR-001..FR-042"
  - "NFR-001..NFR-030"
---

# Product Spec — Page Agent + Jev

## 1. Resumo executivo

O produto transforma o Page Agent em um agente de navegador com decisões estruturadas, execução previsível e verificação explícita. O Jev deve resolver classificações e escolhas semânticas rápidas; o código deve controlar tudo que possa ser calculado, validado ou autorizado deterministicamente; o LLM generativo deve ser opcional.

O produto será entregue em dois ambientes com comportamento equivalente:

1. **In-page**: um site integra o agente diretamente e limita a atuação ao documento/ambiente exposto.
2. **Extensão multipágina**: o agente controla abas autorizadas por meio de content scripts e APIs privilegiadas.

Ambos usam o mesmo `AgentRuntime`, os mesmos tipos de observação, políticas, decisões, ações, outcomes e eventos.

## 2. Problema

O Page Agent atual é funcional, mas o núcleo assume que um LLM generativo deve:

- interpretar a tarefa;
- avaliar a etapa anterior;
- manter memória textual;
- escolher uma ferramenta;
- produzir argumentos;
- declarar a conclusão.

Isso cria custo e latência mesmo para decisões fechadas, mistura raciocínio com execução, torna `done` dependente da declaração do modelo e dificulta reforçar garantias na extensão.

Adicionar Jev como se fosse apenas outro LLM manteria o mesmo desenho inadequado. Jev não foi feito para gerar texto ou executar uma cadeia ReAct livre. Ele responde perguntas atômicas e tipadas sobre um estado. O produto precisa ser arquitetado em torno disso.

## 3. Proposta de valor

| Valor | Como será entregue |
|---|---|
| Menor dependência de LLM generativo | Decisões fechadas são resolvidas por código ou Jev. |
| Maior previsibilidade | Ações vêm de um catálogo tipado e passam por política/validação. |
| Segurança verificável | Conteúdo da página é dado não confiável; permissões ficam fora da IA. |
| Conclusão confiável | Outcome Contracts exigem evidências objetivas. |
| Extensão consistente | Um runtime compartilhado coordena sessões e usa adaptadores de navegador. |
| Melhor depuração | Cada decisão registra estado reduzido, candidatos, provider, confiança e evidência. |
| Evolução sustentável | Limites de pacote impedem o retorno do acoplamento Core→LLM. |

## 4. Usuários e atores

### 4.1 Usuário final

Quer descrever uma tarefa, acompanhar o que o agente está fazendo, confirmar ações sensíveis, intervir quando necessário e receber um resultado comprovável.

### 4.2 Desenvolvedor integrador

Quer embutir o agente em seu site ou acionar a extensão, definir capacidades, fornecer providers/credenciais, observar eventos e integrar respostas sem depender de detalhes do DOM.

### 4.3 Operador/avaliador

Quer reproduzir tarefas, comparar providers, calibrar thresholds e entender por que uma ação foi selecionada ou bloqueada.

### 4.4 Sistema externo (Hub/MCP/API)

Quer iniciar e acompanhar uma sessão por protocolo versionado, sem criar outro runtime nem contornar políticas.

## 5. Princípios de produto

1. **Código no controle.** IA propõe decisões; runtime autoriza e executa.
2. **Evidência antes de sucesso.** “Cliquei” não equivale a “concluí”.
3. **Uma arquitetura, vários ambientes.** Extensão e in-page variam na infraestrutura, não na semântica.
4. **Estado mínimo necessário.** Jev recebe contexto filtrado para a pergunta atual.
5. **Incerteza visível.** Baixa confiança gera verificação, esclarecimento ou escalação.
6. **Ações fechadas.** Providers escolhem IDs existentes; não inventam scripts ou seletores.
7. **Falhas explícitas.** Erros de transporte, stale refs e timeouts são distintos e acionáveis.
8. **Sem legado estrutural.** Compatibilidade, quando necessária, é uma borda descartável.

## 6. Jornadas principais

### Jornada A — tarefa simples in-page

1. Aplicação cria runtime com um `LocalBrowserRuntime`.
2. Usuário solicita “preencha o e-mail e avance”.
3. Runtime cria sessão e observa o documento.
4. Código reconhece que o valor é fornecido e gera candidatos de `input`.
5. Jev escolhe o campo quando houver ambiguidade.
6. Policy Engine valida risco baixo e executa.
7. Outcome Verifier confirma valor/estado do campo.
8. Runtime seleciona o botão, executa e verifica a próxima tela.
9. Resultado inclui evidências de conclusão.

### Jornada B — tarefa multipágina na extensão

1. Usuário inicia tarefa no side panel.
2. Session Manager cria `sessionId`, owner e escopo de abas.
3. Extension Browser Runtime observa a aba atual pelo content script.
4. Runtime pode abrir/switch/fechar apenas abas pertencentes à sessão.
5. Cada referência de elemento contém `tabId`, `documentId` e `revision`.
6. Navegação invalida referências antigas.
7. UI acompanha decisões, pedidos de confirmação e outcomes.
8. Fechar o painel não cria um segundo agente; a sessão é hospedada/recuperada pelo runner definido.

### Jornada C — ação sensível

1. Runtime classifica a ação e o alvo.
2. Policy Engine detecta risco alto.
3. Mesmo com alta confiança do Jev, execução pausa.
4. Usuário vê ação, destino, argumentos mascarados e consequência.
5. Confirmação é vinculada a `sessionId + actionId + targetHash + expiry`.
6. Mudança do estado invalida a confirmação.
7. Execução ocorre e gera evidência/audit event.

### Jornada D — tarefa exige geração

1. Runtime detecta que o valor não existe no estado e precisa ser redigido.
2. Decision Router encaminha apenas a sub-tarefa de geração ao provider generativo.
3. Saída gerada passa por schema, políticas e confirmação quando aplicável.
4. Jev pode classificar/validar propriedades fechadas da saída; não redige o conteúdo.
5. Execução continua no mesmo runtime.

### Jornada E — ambiguidade ou falta de progresso

1. Confidence gate impede execução insegura.
2. Runtime coleta nova observação, expande região ou reduz candidatos.
3. Se continuar ambíguo, pede esclarecimento ou usa provider generativo para replanejamento.
4. Detector de ciclo encerra retries repetitivos.
5. Resultado final diferencia `needs_input`, `blocked`, `failed` e `partially_completed`.

## 7. Capacidades do primeiro release

- observar URL, título, viewport, texto relevante e elementos interativos;
- clicar, preencher texto, selecionar opção e rolar documento/container;
- abrir, alternar e fechar abas pertencentes à sessão na extensão;
- pedir informações e confirmação ao usuário;
- decisões determinísticas e Jev;
- provider generativo opcional para geração/replanejamento;
- Outcome Contracts básicos: URL, elemento, texto, valor, ausência/presença, aba e estado customizado;
- detecção de navegação, mutação relevante, stale ref, timeout e ciclo;
- sessão única por owner e política explícita para concorrência;
- stop/cancelamento cooperativo ponta a ponta;
- histórico de eventos estruturados e exportação sanitizada;
- APIs públicas in-page e extensão v2;
- testes unitários, de contrato, integração e E2E Chrome.

## 8. Métricas de sucesso

### 8.1 Métricas primárias

| Métrica | Definição | Meta inicial |
|---|---|---|
| Verified task completion | Tarefas concluídas com contrato satisfeito / total elegível. | ≥ 85% no conjunto MVP e não inferior ao baseline LLM. |
| Unsafe action rate | Ações proibidas ou sensíveis executadas sem confirmação válida. | 0. |
| Stale-ref execution | Ações executadas com referência de revisão/documento inválida. | 0. |
| False completion | Runtime declara sucesso sem evidência suficiente. | < 1% no benchmark; 0 em operações sensíveis. |
| Median decision latency | Tempo do Decision Engine excluindo navegação. | Medido por provider; Jev deve superar o generativo no cenário fechado. |
| Generative-call avoidance | Etapas fechadas resolvidas sem LLM generativo. | ≥ 70% no conjunto Jev-fit após calibração. |

### 8.2 Métricas secundárias

- custo por tarefa concluída;
- perguntas Jev por tarefa e por lote;
- taxa de confiança baixa por classe de ação;
- retries por causa;
- tempo de sincronização pós-ação;
- intervenções humanas por tarefa;
- bytes/tokens de estado enviados;
- taxa de recuperação após navegação e erro de transporte;
- diferença de desempenho entre páginas PT-BR e EN.

## 9. Restrições

- Jev aceita texto/JSON textual; imagens não fazem parte do caminho principal.
- Jev 1.13 é menos confiável em aritmética, contagem, datas, indirection e estado irrelevante; essas partes ficam em código.
- SDK JavaScript oficial é documentado para Node 20+, portanto compatibilidade de bundling/browser não será presumida.
- Content scripts não devem receber credenciais Jev/LLM.
- Chrome MV3 service worker pode ser suspenso; ele não será a única fonte de verdade de uma tarefa longa.
- A extensão atual exige permissões amplas; a nova UI deve tornar escopo e controle visíveis.

## 10. Critério de sucesso do produto

O produto está pronto quando um mesmo conjunto de tarefas pode ser executado pelo modo in-page e pela extensão usando o mesmo runtime, com diferenças apenas no adaptador de navegador; toda conclusão possui evidências; toda ação sensível possui política e confirmação; e o benchmark demonstra quando Jev melhora custo/latência sem degradar a taxa de conclusão verificada.
