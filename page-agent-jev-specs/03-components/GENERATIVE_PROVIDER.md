---
schema_version: "1.0"
document_id: "PAJ-COMP-008"
kind: "component-spec"
title: "Provedor generativo opcional"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-001"
  - "PAJ-COMP-004"
requirements:
  - "FR-013"
  - "FR-021"
---

# Provedor generativo opcional

## 1. Finalidade

O provider generativo cobre somente necessidades fora do espaço do Jev/código:

- redigir conteúdo novo;
- decompor pedido aberto em goals/subgoals;
- replanejar após falhas não previstas;
- resumir resultados para o usuário;
- extrair candidatos quando não há parser/regex adequado, seguido de validação.

Ele não é o loop principal e não executa ferramenta durante a chamada.

## 2. Contrato

```typescript
interface GenerativeProvider {
  readonly id: ProviderId
  generate<T>(request: GenerativeRequest<T>, signal: AbortSignal): Promise<Generated<T>>
}
```

Requests possuem `purpose` e schema:

```typescript
type GenerativePurpose =
  | 'task_decomposition'
  | 'value_generation'
  | 'replanning'
  | 'result_formatting'
  | 'candidate_extraction'
```

Saída livre nunca entra diretamente no executor. Para ações, output deve ser convertido em candidates/values e passar por schema, policy e outcome.

## 3. Migração de `packages/llms`

Reutilizável:

- cliente OpenAI-compatible;
- retry/error mapping;
- abort;
- transform request body;
- usage accounting.

Remover/reescrever:

- MacroTool obrigatório;
- reflection-before-action como contrato global;
- normalização que tenta corrigir action tool calls do loop antigo;
- dependência inversa do runtime.

O pacote final deve expor adapter que implementa `GenerativeProvider`, não classe `LLM` assumida pelo core.

## 4. Task decomposition

O provider pode propor:

```typescript
interface ProposedTaskPlan {
  goals: ProposedGoal[]
  assumptions: string[]
  questions: string[]
}
```

O código valida:

- goals relacionados ao pedido;
- capabilities disponíveis;
- ausência de ação proibida;
- outcomes definíveis;
- assumptions que exigem usuário;
- limite de goals.

Planos são incrementais e revisáveis; não uma sequência rígida de selectors/actions.

## 5. Geração de valores

Input deve conter somente:

- instrução do usuário;
- constraints relevantes;
- contexto mínimo;
- schema/tom/tamanho.

Output passa por:

- schema/limite;
- data policy;
- Jev checks opcionais de propriedades fechadas;
- confirmação se conteúdo será enviado/publicado.

## 6. Replanning

Acionado apenas quando:

- estratégias determinísticas/Jev esgotaram budget;
- estado novo é inesperado;
- task decomposition inicial se tornou inválida;
- runtime tem evidência da falha.

Request inclui trace resumido estruturado, não todo histórico bruto. O provider retorna proposta, nunca execução.

## 7. Segurança

- conteúdo de página é delimitado como untrusted data;
- system/developer policy vem fora do state;
- tool calling do provider é desabilitado ou restrito a funções puras de proposta;
- raw model text não é renderizado como HTML;
- secrets seguem mesma sanitização;
- provider não recebe grants/confirmation tokens.

## 8. Configuração

Provider pode estar:

- `disabled` — tarefa que exige geração retorna `needs_input/blocked`;
- `user_byok` — credencial local/configurada;
- `proxy` — credencial no serviço;
- `local_openai_compatible` — endpoint do usuário.

## 9. Testes

- runtime completo sem provider generativo para tasks Jev-fit;
- necessidade de geração com provider disabled;
- output inválido/schema retry limitado;
- plano com capability proibida é rejeitado;
- prompt injection no page state não altera policy;
- stop/abort;
- usage/latency events;
- nenhum tool call gera efeito direto.
