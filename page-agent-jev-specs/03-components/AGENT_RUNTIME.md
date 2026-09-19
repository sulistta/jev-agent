---
schema_version: "1.0"
document_id: "PAJ-COMP-001"
kind: "component-spec"
title: "Agent Runtime"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-002"
  - "PAJ-ARCH-003"
requirements:
  - "FR-001..FR-006"
  - "FR-013..FR-030"
---

# Agent Runtime

## 1. Responsabilidade

O Agent Runtime é a única implementação do ciclo de execução. Ele coordena componentes por ports; não acessa DOM, Chrome, SDK Jev ou endpoint generativo diretamente.

## 2. API proposta

```typescript
interface AgentRuntime {
  start(input: StartTaskInput, signal?: AbortSignal): Promise<SessionHandle>
  pause(sessionId: string): Promise<void>
  resume(sessionId: string): Promise<void>
  cancel(sessionId: string, reason?: string): Promise<void>
  answer(sessionId: string, answer: UserAnswer): Promise<void>
  confirm(sessionId: string, decision: ConfirmationDecision): Promise<void>
  getSession(sessionId: string): Promise<SessionSnapshot>
  subscribe(sessionId: string, listener: SessionEventListener): Unsubscribe
}
```

`SessionHandle.result` é uma Promise terminal; eventos podem ser consumidos independentemente.

## 3. Algoritmo de execução

Pseudocódigo normativo:

```typescript
while (!session.isTerminal()) {
  budgets.assertAvailable()
  signal.throwIfAborted()

  const observation = await browser.observe(scope, signal)
  const goal = goalManager.selectCurrent(session, observation)
  const outcomeBefore = await verifier.verify(goal.outcome, observation)

  if (outcomeBefore.status === 'satisfied') {
    goalManager.satisfy(goal, outcomeBefore.evidence)
    continue
  }

  const candidates = candidateGenerator.generate(goal, observation)
  const decision = await decisionRouter.decide({ session, goal, observation, candidates }, signal)

  const transition = await applyDecision(decision)
  if (transition.didExecuteAction) {
    const sync = await browser.waitFor(transition.expectedChanges, signal)
    const next = await browser.observe(transition.verificationScope, signal)
    const outcome = await verifier.verify(goal.outcome, next, transition.receipt)
    progressTracker.record(outcome, transition)
  }
}
```

Implementação pode otimizar observações redundantes, desde que preserve as revisões e evidências.

## 4. Goal Manager

Responsabilidades:

- ordenar goals por dependência, não apenas pela ordem textual;
- ativar somente goals cujos pré-requisitos foram satisfeitos;
- permitir subgoals efêmeros (localizar, preencher, navegar);
- não marcar goal obrigatório como `skipped` sem policy;
- manter reason/evidence para cada transição;
- detectar contradição entre outcome e constraint.

Subgoals não alteram o significado da tarefa. Um provider generativo pode propor subgoals, mas o Goal Manager valida capacidade, risco e relação com o task contract.

## 5. Progress Tracker e detector de ciclo

Fingerprint de progresso deve considerar:

- goal atual;
- URL normalizada;
- document/revision;
- elementos/outcomes relevantes;
- última ação e target fingerprint;
- conjunto de abas;
- erros recentes.

Sinais de ciclo:

- mesma ação/target repetida sem mudança relevante;
- alternância A↔B de páginas/abas;
- scroll repetido sem novos candidatos;
- waits repetidos sem sinal;
- provider seleciona `none` repetidamente para o mesmo estado;
- outcome permanece idêntico após N tentativas.

Política padrão:

1. primeira ausência de progresso: reobservar com escopo ajustado;
2. segunda: escolher estratégia alternativa determinística/Jev;
3. terceira: replanejar com provider generativo, se disponível;
4. depois: `needs_input` ou `failed(NO_PROGRESS)`.

Valores reais são configuráveis e devem respeitar risk tier.

## 6. Cancelamento

- `cancel()` aborta o controller da sessão.
- Providers recebem o mesmo `AbortSignal` derivado.
- Remote calls enviam `CANCEL_REQUEST` best-effort e rejeitam localmente.
- Resultados que chegam após abort são descartados por `sessionRevision`.
- Hooks não podem transformar uma sessão cancelada em sucesso.
- Cleanup possui timeout próprio e não bloqueia indefinidamente o resultado terminal.

## 7. Roteamento de decisão

O runtime descreve a necessidade, não escolhe provider por nome hardcoded:

```typescript
interface DecisionNeed {
  kind: 'select_operation' | 'select_candidate' | 'judge_outcome' | 'generate_value' | 'replan'
  closedWorld: boolean
  computable: boolean
  risk: RiskTier
  requiredCapabilities: DecisionCapability[]
}
```

O router aplica:

1. computável → deterministic;
2. closed-world semantic → Jev;
3. generation/system-two → generative;
4. provider ausente/uncertain/high-risk → human;
5. nenhuma rota → blocked com motivo explícito.

## 8. Aplicação de DecisionResult

| Resultado | Efeito permitido |
|---|---|
| `action` | Revalidar candidate/revision, policy, confirmação, executar. |
| `observe` | Ampliar/reduzir scope, sem efeito externo. |
| `clarify` | Suspender em `waiting_user`. |
| `confirm` | Criar token contextual e suspender. |
| `replan` | Validar novo plano/subgoals; não executar diretamente. |
| `goal_satisfied` | Encaminhar ao Outcome Verifier; não marcar diretamente. |
| `blocked` | Tentar fallback permitido ou terminar. |
| `failed` | Classificar retryable/non-retryable. |

## 9. Hooks permitidos

Hooks são observadores/interceptadores tipados:

- `beforeObserve` / `afterObserve`;
- `beforeDecision` / `afterDecision`;
- `beforeAuthorize` / `afterAuthorize`;
- `beforeAction` / `afterAction`;
- `beforeVerify` / `afterVerify`;
- `onTransition`.

Hooks não recebem acesso mutável ao estado interno. Interceptadores retornam comandos limitados: `continue`, `deny`, `requireConfirmation`, `augmentObservation`, `addEvidence`.

## 10. Testes obrigatórios

- todas as transições da Session State Machine;
- resultado terminal único;
- cancelamento em cada await boundary;
- resposta tardia descartada;
- no-progress e budgets;
- provider não consegue concluir sem verifier;
- action candidate de revisão errada é recusada;
- confirmação expirada/inválida;
- fallback provider controlado;
- hooks não violam invariantes.
