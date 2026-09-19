---
schema_version: "1.0"
document_id: "ADR-004"
kind: "architecture-decision-record"
title: "Conclusão baseada em evidência verificável"
status: "accepted"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-005"
owners:
  - "core"
  - "quality"
requirements:
  - "FR-026"
  - "FR-027"
  - "NFR-012"
---

# ADR-004 — Conclusão baseada em evidência verificável

## Contexto

Uma declaração textual de sucesso feita pelo modelo não prova que o efeito desejado ocorreu. Navegação atrasada, validação do formulário, resposta assíncrona, aba incorreta ou mutação parcial podem produzir falsos positivos.

## Decisão

`done` deixa de ser uma ação aceita por declaração. O runtime só encerra com `succeeded` quando uma `CompletionPolicy` avalia evidências observáveis contra critérios derivados da tarefa.

```ts
type CompletionEvidence =
  | { kind: 'url'; matcherId: string; actual: string }
  | { kind: 'element'; candidateId: string; predicate: string }
  | { kind: 'text'; normalizedDigest: string; matcherId: string }
  | { kind: 'download'; downloadId: string; state: 'complete' }
  | { kind: 'user_confirmation'; confirmationId: string };
```

## Regras

1. Toda tarefa recebe uma política de conclusão antes da primeira ação de risco médio ou alto.
2. A evidência precisa ser coletada após a ação causal relevante.
3. Evidência pertence ao mesmo `runId`, `tabId` e `documentId` aplicáveis.
4. Ausência de prova resulta em `needs_observation`, `needs_user` ou falha explícita; nunca em sucesso presumido.
5. Confirmação do usuário pode ser um critério válido, mas é registrada como tal.

## Alternativas consideradas

### Aceitar uma mensagem final do modelo

Rejeitado porque é autorreferente e não demonstra estado externo.

### Exigir apenas mudança de URL

Rejeitado porque SPAs, modais e ações sem navegação podem concluir tarefas legitimamente.

## Consequências

- O planejador precisa explicitar critérios de término.
- Adaptadores de browser precisam expor sinais observáveis.
- UX diferencia “ação executada” de “objetivo comprovado”.
- Métricas de sucesso tornam-se auditáveis.

## Critérios de verificação

- Cenários de submissão com erro inline não podem terminar em `succeeded`.
- Uma evidência de documento anterior é rejeitada como obsoleta.
- O evento `run.succeeded` referencia pelo menos uma evidência válida.
