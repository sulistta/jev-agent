---
schema_version: "1.0"
document_id: "ADR-005"
kind: "architecture-decision-record"
title: "Protocolo tipado e versionado na extensão"
status: "accepted"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-007"
owners:
  - "extension"
  - "architecture"
requirements:
  - "FR-032"
  - "FR-033"
  - "NFR-028"
---

# ADR-005 — Protocolo tipado e versionado na extensão

## Contexto

Mensagens informais entre service worker, content script, side panel e API permitem divergência silenciosa de payloads. Reentrega, reordenação e reinício são comportamentos normais em extensões Manifest V3.

## Decisão

Todas as mensagens usarão um envelope discriminado, validado em runtime e com versão explícita.

```ts
interface ProtocolEnvelope<TType extends string, TPayload> {
  protocolVersion: 1;
  messageId: string;
  correlationId: string;
  causationId?: string;
  source: 'service_worker' | 'content_script' | 'side_panel' | 'public_api';
  target: 'service_worker' | 'content_script' | 'side_panel' | 'public_api';
  sentAt: string;
  type: TType;
  payload: TPayload;
}
```

Comandos incluem `commandId`, escopo e revisão esperada. Eventos incluem `sequence`. Respostas distinguem sucesso, conflito, rejeição de política, indisponibilidade e erro interno.

## Compatibilidade

- Versão major incompatível é recusada com erro legível.
- Campos aditivos opcionais podem entrar na mesma versão.
- Cada consumidor ignora tipos desconhecidos apenas quando o envelope os marca como evento opcional.
- Fixtures de contrato são compartilhadas entre os pacotes.

## Alternativas consideradas

### Interfaces TypeScript sem validação em runtime

Rejeitado porque mensagens atravessam processos e podem vir de versões diferentes.

### Payload genérico com strings e `any`

Rejeitado porque transfere falhas para runtime e impede compatibilidade verificável.

## Consequências

- Requer pacote de contratos sem dependência de DOM ou Chrome.
- Adiciona custo pequeno de validação e serialização.
- Facilita replay, diagnóstico e testes de compatibilidade.

## Critérios de verificação

- Toda mensagem inválida é rejeitada antes de atingir o domínio.
- Testes de contrato rodam nos quatro contextos.
- O mesmo `commandId` duplicado não executa duas ações.
