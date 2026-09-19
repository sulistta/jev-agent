---
schema_version: "1.0"
document_id: "PAJ-XCUT-005"
kind: "ux-spec"
title: "UI/UX para o agente e a extensão"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-PROD-001"
  - "PAJ-COMP-006"
  - "PAJ-COMP-007"
requirements:
  - "UX-001..UX-015"
  - "FR-038..FR-040"
  - "NFR-029"
---

# UI/UX para o agente e a extensão

## 1. Princípios

- mostrar ação e consequência, não raciocínio privado;
- diferenciar “pensando”, “esperando página”, “precisa de você” e “bloqueado”;
- confirmação sensível ocorre em superfície confiável da extensão;
- usuário pode parar a qualquer momento;
- a UI segue a sessão, não instancia o runtime;
- falha deve oferecer próximo passo concreto.

## 2. Estados principais

| ID | Estado | UI mínima |
|---|---|---|
| UX-001 | Idle | campo de tarefa, perfil/provider, escopo. |
| UX-002 | Starting | validação de configuração/capabilities. |
| UX-003 | Observing | site/aba e região sendo analisada. |
| UX-004 | Deciding | “Escolhendo a próxima ação”; sem chain-of-thought. |
| UX-005 | Executing | ação concreta, alvo e cancel. |
| UX-006 | Synchronizing | qual mudança está sendo aguardada e timeout visual. |
| UX-007 | Waiting user | pergunta/confirm, contexto e opções. |
| UX-008 | Paused/takeover | controle liberado ao usuário e botão retomar. |
| UX-009 | Recovering | erro observado e estratégia atual. |
| UX-010 | Completed | resumo, goals e evidências. |
| UX-011 | Partial | o que foi feito e o que falta. |
| UX-012 | Blocked/failed | código humano, causa e ação sugerida. |
| UX-013 | Confirmation | ação, destino, consequência, risco e validade. |
| UX-014 | Scope/permissions | abas, origins, grants e revogação visíveis. |
| UX-015 | Accessibility | teclado, leitor de tela, zoom e redução de movimento. |

## 3. Composição do side panel

### Cabeçalho

- status e session ID curto;
- domínio/aba atual;
- botão Stop sempre visível;
- indicador de escopo de abas.

### Linha do tempo

Cards estruturados:

- Goal;
- Observation summary;
- Decision (“selecionou botão X”, provider e confidence quando útil);
- Action;
- Verification;
- User request;
- Error/recovery.

Cards colapsados por padrão para detalhes técnicos. Raw request/response só em developer mode e sanitizado.

### Rodapé

- input contextual quando pergunta pendente;
- pause/takeover;
- configurações não destrutivas;
- export trace.

## 4. Confirmação

Modal/card confiável contém:

- “O agente quer [ação]”;
- destino (`example.com`, aba/título);
- target acessível;
- valores não secretos;
- consequências;
- motivo de risco;
- “Aprovar uma vez” e “Negar”;
- timeout/invalidated state.

Não usar confirmação genérica como “Permitir continuar?”.

## 5. Scope de abas

UI mostra chips/lista:

- owned;
- atual;
- aberta pelo agente;
- restrita/não acessível;
- aguardando carregamento.

“Controlar todas as abas” não deve ser default nem toggle escondido em avançado; precisa explicar alcance e permitir seleção.

## 6. Explicabilidade

Resposta curta e verificável:

- ação escolhida;
- evidências principais (label/URL/resultado);
- incerteza/por que pediu ajuda;
- regra que bloqueou.

Não exibir `evaluation_previous_goal/memory/next_goal` do formato antigo como se fossem garantias.

## 7. Takeover

1. Usuário clica “Assumir controle”.
2. Runtime pausa e unlock mask.
3. UI indica que alterações serão reobservadas.
4. Usuário conclui ação manual.
5. “Retomar” gera nova observação/revisão.
6. Runtime nunca reutiliza candidate/ref anterior.

## 8. Configuração

Seções:

- Jev: status, model/profile, teste de conexão;
- Generative fallback: off/provider/profile;
- Privacy: telemetry, retention, export;
- Permissions: origins/grants e revogação;
- Execution: budgets/confirmation policy (com defaults seguros);
- Developer: protocol/trace e mocks.

Nunca mostrar chave completa após salvar.

## 9. Acessibilidade

- navegação integral por teclado;
- foco vai para pergunta/confirm quando aparece;
- `aria-live` para status sem spam;
- labels e descrições completas;
- não depender só de cor;
- reduzir animação;
- mask não captura usuário após pause/error;
- contraste e zoom do side panel.

## 10. Copy de erros

Formato:

1. o que aconteceu;
2. se houve efeito possível;
3. o que o agente fez para recuperar;
4. o que o usuário pode fazer.

Exemplo para `effect_unknown`:

> O clique foi enviado, mas a extensão perdeu a conexão antes de confirmar o resultado. Não vou repetir a ação automaticamente porque isso poderia duplicá-la. Verifique a página e escolha “Retomar”.

## 11. Testes UX

- confirmação R3 compreendida sem detalhes técnicos;
- stop visível em todos os estados ativos;
- reconexão do side panel sem perder timeline;
- keyboard/screen reader;
- takeover/resume;
- partial/blocked distinguíveis;
- permissões por origin revogáveis;
- nenhum secret/raw DOM visível por default.
