---
schema_version: "1.0"
document_id: "PAJ-GOV-002"
kind: "glossary"
title: "Glossário"
status: "accepted-for-planning"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-GOV-001"
---

# Glossário

| Termo | Definição normativa |
|---|---|
| **Ação** | Operação tipada e registrada que pode consultar ou alterar o ambiente: clicar, preencher, rolar, abrir aba, pedir confirmação etc. |
| **Action Registry** | Catálogo de ações permitidas, seus schemas, riscos, capacidades requeridas e executores. |
| **Agent Runtime** | Máquina de execução que coordena objetivo, observação, decisão, política, ação, sincronização, verificação e recuperação. |
| **Browser Runtime** | Porta abstrata pela qual o Agent Runtime observa e controla um ambiente de navegador. |
| **Candidate** | Opção fechada que o código considera executável no estado atual e que pode ser selecionada deterministicamente ou pelo Jev. |
| **Candidate ID** | Identificador opaco e efêmero de um candidato dentro de uma revisão de observação. Não é índice de DOM. |
| **Choice** | Primitiva Jev que seleciona uma opção entre alternativas definidas. |
| **Confidence gate** | Regra em código que decide executar, verificar, confirmar ou escalar com base em risco e confiança. |
| **Decision Engine** | Componente que escolhe o mecanismo apropriado: determinístico, Jev, generativo ou humano. |
| **Decision Provider** | Adaptador de um mecanismo de decisão específico. |
| **Document ID** | Identidade de um documento carregado em uma aba, renovada após navegação/substituição relevante. |
| **ElementRef** | Referência verificável a um elemento: sessão, aba, documento, revisão, índice local e fingerprint. |
| **Evidence** | Fato observado e tipado usado para provar progresso, falha ou conclusão. |
| **Generative Provider** | Provedor opcional para geração de texto, decomposição aberta ou replanejamento que o Jev não consegue realizar. |
| **In-page runtime** | Adaptador que executa PageController e Agent Runtime no contexto da página integradora. |
| **Jev** | Modelo System One da TypeSafe que responde perguntas tipadas sobre um estado. |
| **Noul** | Primitiva Jev que retorna a probabilidade de uma afirmação ser verdadeira. |
| **Observation** | Snapshot estruturado e versionado do ambiente disponível a uma decisão. |
| **Observation revision** | Número monotônico por documento/aba que invalida candidatos e referências antigos quando o estado relevante muda. |
| **Outcome Contract** | Condições verificáveis que definem sucesso, progresso, falha, espera e retry de uma ação ou etapa. |
| **Policy Engine** | Código determinístico que classifica risco, verifica permissões, exige confirmação e bloqueia ações. |
| **Provider generativo** | Sinônimo de Generative Provider. |
| **Remote Browser Runtime** | Adaptador da extensão que usa mensagens tipadas para controlar PageControllers nos content scripts. |
| **Risk tier** | Nível de consequência de uma ação: leitura, reversível, alteração externa, sensível ou proibida. |
| **Score** | Primitiva Jev que posiciona o estado em níveis ordenados e descritivos. |
| **Session** | Unidade isolada de execução com identidade, objetivo, estado, ownership de abas, orçamento e histórico. |
| **Session owner** | Interface/cliente autorizado a iniciar, acompanhar, confirmar e parar uma sessão. |
| **State** | Objeto enviado ao Jev contendo somente dados necessários para as perguntas daquela chamada. |
| **Step** | Uma iteração observável do Agent Runtime; pode conter zero ou uma ação externa. |
| **Synchronization barrier** | Espera condicionada após ação que termina com evidência de estabilidade, timeout, cancelamento ou erro. |
| **Task** | Pedido do usuário e seus limites de autorização. |
| **Trace** | Sequência correlacionada de eventos técnicos e decisões de uma sessão. |
| **User takeover** | Pausa/transferência de controle em que o usuário modifica a página e o runtime invalida o estado anterior. |

## Termos explicitamente distintos

- `choice` não significa “confiança”: é a opção vencedora; `confidence` resume a distribuição.
- `noul = 0.5` não significa nível médio; significa probabilidade equilibrada entre sim e não.
- `success` de uma chamada de ferramenta não significa que a tarefa foi concluída.
- índice de DOM não é identidade estável de elemento.
- estado da página não é instrução autorizada do usuário.
- retry técnico não é replanejamento semântico.
