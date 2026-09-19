---
schema_version: "1.0"
document_id: "PAJ-COMP-005"
kind: "component-spec"
title: "Ações, políticas, sincronização e Outcome Contracts"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-001"
  - "PAJ-COMP-002"
  - "ADR-004"
  - "ADR-006"
requirements:
  - "FR-022..FR-030"
---

# Ações, políticas, sincronização e Outcome Contracts

## 1. Action Registry

Cada ação é uma definição estática e tipada:

```typescript
interface ActionDefinition<TArgs, TResult> {
  name: ActionName
  version: string
  description: string
  inputSchema: Schema<TArgs>
  requiredCapabilities: Capability[]
  allowedTargetKinds: TargetKind[]
  risk(input: TArgs, context: PolicyContext): RiskAssessment
  expectedChanges(input: TArgs, observation: PageObservation): ExpectedChange[]
  execute(input: TArgs, context: ActionContext): Promise<TResult>
}
```

Providers veem apenas ações/candidates habilitados. Eles não escolhem nomes arbitrários.

## 2. Catálogo MVP

| Ação | Target | Risco padrão | Outcome típico |
|---|---|---|---|
| `element.click` | ElementRef | baixo/reversível; escalável por contexto | navegação, modal, value/state change |
| `element.input` | ElementRef + texto | reversível; sensível se PII/secret | valueState/value hash esperado |
| `element.select` | ElementRef + option | reversível | option selecionada |
| `page.scroll` | documento/ElementRef | baixo | viewport/novos elementos |
| `tab.open` | URL | baixo a moderado | aba owned criada e carregada |
| `tab.switch` | owned tab | baixo | currentTabId alterado |
| `tab.close` | owned non-initial tab | reversível limitado | aba ausente |
| `user.ask` | usuário | nenhum efeito externo | resposta tipada |
| `user.confirm` | usuário | gate | approval/denial contextual |

`execute_javascript` não faz parte do registry de produção.

## 3. Policy Engine

Ordem de avaliação:

1. sessão e owner válidos;
2. capability disponível;
3. aba/documento pertencem à sessão;
4. candidate/ref/revision válidos;
5. domínio/origin permitido;
6. classificação de dados/argumentos;
7. risk tier;
8. confirmação contextual quando necessária;
9. rate/volume/budget;
10. regras customizadas do integrador.

Resultado:

```typescript
type PolicyDecision =
  | { kind: 'allow'; policyVersion: string }
  | { kind: 'require_confirmation'; request: ConfirmationRequest }
  | { kind: 'deny'; code: PolicyDenyCode; message: string }
```

## 4. Risk tiers

| Tier | Exemplo | Política padrão |
|---|---|---|
| R0 — read-only | observar, rolar | automático. |
| R1 — reversible-local | preencher campo sem submit, trocar aba | automático se decisão confiável. |
| R2 — reversible-external | salvar rascunho, alterar filtro persistido | confiança alta + outcome; confirmação configurável. |
| R3 — consequential | enviar formulário, publicar mensagem, aceitar termo | confirmação obrigatória imediatamente antes. |
| R4 — destructive/financial | compra, transferência, exclusão definitiva | bloqueado no MVP ou confirmação reforçada se habilitado explicitamente. |
| R5 — forbidden | exfiltrar segredo, contornar permissão, JS arbitrário | sempre negar. |

Risco é contextual: um botão “Enviar” pode ser R1 em pesquisa local e R3 em e-mail/pagamento.

## 5. Outcome Contract

```typescript
interface OutcomeContract {
  contractId: string
  version: string
  all?: OutcomePredicate[]
  any?: OutcomePredicate[]
  none?: OutcomePredicate[]
  semantic?: SemanticPredicate[]
  deadlineMs: number
  evidencePolicy: EvidencePolicy
}
```

Predicados determinísticos iniciais:

- `url.equals/matches/changed`;
- `title.matches`;
- `element.present/absent`;
- `element.visible/enabled`;
- `element.valueState/valueHash`;
- `element.attribute`;
- `text.present/absent` em região;
- `tab.present/absent/current`;
- `document.changed`;
- `action.result`;
- `custom` do integrador, sandboxed por contrato.

Predicado semântico pode usar Jev, mas somente após sinais determinísticos insuficientes e com evidência explicitada.

## 6. Verificação

```typescript
type OutcomeResult =
  | { status: 'satisfied'; evidence: Evidence[] }
  | { status: 'unsatisfied'; evidence: Evidence[]; missing: string[] }
  | { status: 'inconclusive'; evidence: Evidence[]; reason: string }
  | { status: 'violated'; evidence: Evidence[]; reason: string }
```

Regras:

- `ActionResult.ok` não satisfaz o goal sozinho;
- evidence deve apontar para observation/action/user event;
- semantic evidence sozinha não basta para R3/R4 quando há predicado objetivo disponível;
- conclusão requer evidence freshness configurada;
- predicados customizados não podem ler segredos fora do escopo.

## 7. Expected changes e sincronização

Exemplos:

- click em link: `navigation.started OR tab.created OR dom.mutated`;
- input: `target.valueChanged` e quiet window curto;
- select: `target.selectionChanged` possivelmente seguido de DOM mutation;
- submit: `navigation OR confirmation element OR error element`;
- scroll: `scrollPositionChanged` e novos elementos ou end-of-scroll.

O Sync Coordinator encerra cedo quando evidência suficiente aparece. O timeout não transforma a ação em falha automaticamente; leva a verificação, que pode encontrar resultado válido.

## 8. Confirmação contextual

UI de confirmação deve mostrar:

- ação em linguagem humana;
- site/origin e aba;
- target label;
- argumentos relevantes, com secrets mascarados;
- efeito/consequência;
- razão da confirmação;
- opções aprovar uma vez / negar (sem “sempre permitir” no MVP para R3/R4).

Uma aprovação nunca vale para “qualquer ação semelhante”.

## 9. Idempotência e efeitos externos

- para actions com side effect, gerar `actionId` antes de enviar;
- não repetir automaticamente após timeout se não for possível provar que o efeito não ocorreu;
- em estado incerto, verificar outcome antes de retry;
- actions customizadas devem declarar `idempotency: safe | key_supported | unsafe`;
- `unsafe` exige recuperação/humano, não retry cego.

## 10. Testes

- registry recusa action/args desconhecidos;
- risk tier contextual;
- confirmação vinculada e expirada;
- stale ref antes/depois da policy;
- waits terminam por cada status;
- ação executada + outcome ausente não conclui;
- efeito externo incerto não é duplicado;
- JS arbitrário ausente de exports/UI;
- policy custom não amplia capability além do limite global.
