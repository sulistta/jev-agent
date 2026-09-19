---
schema_version: "1.0"
document_id: "ADR-007"
kind: "architecture-decision-record"
title: "Modos explícitos de credencial e transporte"
status: "accepted"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-XCUT-002"
owners:
  - "security"
  - "platform"
requirements:
  - "FR-034"
  - "NFR-018"
  - "NFR-020"
---

# ADR-007 — Modos explícitos de credencial e transporte

## Contexto

Um SDK ou extensão no navegador não consegue manter um segredo de serviço. Aceitar uma chave de longa duração no cliente cria risco de extração, abuso e custos inesperados. Ao mesmo tempo, desenvolvimento local e implantação corporativa possuem necessidades diferentes.

## Decisão

Serão suportados modos nomeados, sem fallback silencioso:

| Modo | Credencial | Transporte | Uso pretendido |
|---|---|---|---|
| `backend_proxy` | sessão/token curto | navegador → backend do integrador → provider | produção recomendada |
| `ephemeral_token` | token curto e escopado | navegador → provider | produção quando oficialmente suportado |
| `developer_key` | chave informada localmente | navegador → provider | desenvolvimento consciente do risco |
| `mock` | nenhuma | in-memory | testes e demonstrações determinísticas |

O modo `developer_key` será marcado como inseguro para distribuição, nunca persistirá a chave por padrão e será bloqueável por policy. O runtime registrará somente o identificador do modo e do provider, nunca o segredo.

## Regras de configuração

- Falha de configuração encerra cedo com erro acionável.
- Credenciais não entram em URL, logs, eventos ou estado serializado.
- Backend proxy valida origem, autenticação, rate limit e escopo.
- Rotação ou expiração deve produzir `AUTH_EXPIRED`, sem repetição ilimitada.
- A extensão solicitará apenas permissões necessárias ao modo habilitado.

## Alternativas consideradas

### Uma única chave persistida em storage da extensão

Rejeitado para produção devido à extração e ao escopo excessivo.

### Backend obrigatório em todos os ambientes

Rejeitado por prejudicar testes locais e exemplos; o modo de desenvolvimento continua explícito e restrito.

## Consequências

- O setup fica um pouco mais detalhado, porém audita intenção e risco.
- Integrações corporativas podem centralizar política e custos.
- Testes cobrem expiração, indisponibilidade e redaction.

## Critérios de verificação

- Nenhum segredo aparece em snapshots, logs ou crash reports.
- Build de produção pode desabilitar `developer_key` completamente.
- Cada modo possui teste end-to-end de autenticação e falha.
