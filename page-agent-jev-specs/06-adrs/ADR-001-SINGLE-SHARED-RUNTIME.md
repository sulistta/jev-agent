---
schema_version: "1.0"
document_id: "ADR-001"
kind: "architecture-decision-record"
title: "Um único runtime compartilhado por execução"
status: "accepted"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-001"
owners:
  - "architecture"
  - "extension"
requirements:
  - "FR-001"
  - "FR-003"
  - "FR-031"
  - "NFR-004"
  - "NFR-010"
---

# ADR-001 — Um único runtime compartilhado por execução

## Contexto

O estado atual permite que pontos de entrada distintos da extensão criem instâncias independentes do agente. Isso torna possível haver mais de um loop atuando sobre a mesma aba, além de fragmentar cancelamento, heartbeat, histórico e ownership.

## Decisão

Cada `runId` será controlado por exatamente uma instância de `AgentRuntime`, criada e mantida pelo service worker. Side panel, API pública e content script serão clientes do runtime, nunca proprietários concorrentes.

O registro de execução será indexado por `runId` e terá vínculo explícito com `tabId`, `sessionId`, `ownerClientId`, `status`, `leaseExpiresAt` e `revision`. Comandos mutáveis exigirão `runId` e `expectedRevision`.

## Invariantes

1. No máximo um run ativo pode possuir uma aba no mesmo instante.
2. Apenas o runtime proprietário pode emitir ações para a aba.
3. Reinício do service worker não implica retomada silenciosa de ações.
4. Um comando duplicado com o mesmo `commandId` produz o mesmo resultado lógico.
5. Cancelamento é monotônico: um run cancelado não retorna ao estado ativo.

## Alternativas consideradas

### Runtime por superfície de UI

Rejeitado porque não há exclusão mútua confiável entre side panel, API e content script.

### Lock baseado somente em `chrome.storage.local`

Rejeitado como mecanismo primário. O storage é útil para checkpoints, mas não oferece, sozinho, as garantias transacionais e de ordenação necessárias.

### Runtime no content script

Rejeitado porque a navegação destrói o contexto, a coordenação entre abas fica difícil e o acesso a APIs privilegiadas é limitado.

## Consequências

- O service worker passa a concentrar coordenação, não lógica visual.
- O protocolo de mensagens precisa ser tipado, versionado e idempotente.
- A UI deve tolerar reconexão e reidratar estado por snapshot.
- Testes devem cobrir colisão de ownership, reinício e mensagens duplicadas.

## Critérios de verificação

- Teste concorrente prova que duas solicitações para a mesma aba resultam em um único owner.
- Após reiniciar o worker, nenhuma ação é emitida sem reconciliação explícita.
- Side panel e API exibem o mesmo `runId`, status e sequência de eventos.
