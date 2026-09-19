---
schema_version: "1.0"
document_id: "ADR-006"
kind: "architecture-decision-record"
title: "Proibir JavaScript arbitrário como capacidade padrão"
status: "accepted"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-XCUT-002"
owners:
  - "security"
  - "core"
requirements:
  - "FR-029"
  - "NFR-019"
---

# ADR-006 — Proibir JavaScript arbitrário como capacidade padrão

## Contexto

A execução de texto gerado via `eval` transforma conteúdo não confiável em código com acesso ao contexto da página. Allowlist posterior de comandos não reduz o risco se o próprio código puder contornar as fronteiras.

## Decisão

O produto não exporá uma ação genérica `executeJavaScript` no runtime padrão, na extensão distribuída nem na API pública. Ações serão operações tipadas e limitadas: clicar, preencher, selecionar, rolar, navegar, alternar aba e observar.

Uma build experimental pode oferecer automação programática somente quando todas as condições forem satisfeitas:

- recurso desabilitado por padrão e ausente do artefato de produção;
- código fornecido e revisado pelo desenvolvedor, nunca emitido por modelo;
- origem e permissões explicitamente configuradas;
- isolamento adequado e orçamento de tempo;
- telemetria e aviso visível de capacidade elevada.

## Alternativas consideradas

### Sanitizar o JavaScript gerado

Rejeitado: sanitização geral de uma linguagem Turing-completa não oferece a garantia necessária.

### Confirmar cada execução com o usuário

Rejeitado como controle suficiente. Confirmação frequente produz fadiga e o usuário não consegue avaliar código opaco com segurança.

### Usar apenas CSP

Rejeitado como única proteção; CSP não converte código arbitrário em capacidade segura.

## Consequências

- Alguns sites exigirão novas ações tipadas ou serão declarados não suportados.
- O catálogo de capacidades precisa evoluir com revisão de segurança.
- A superfície de prompt injection e exfiltração é substancialmente menor.

## Critérios de verificação

- Busca estática do bundle de produção não encontra `eval`, `new Function` ou ação genérica equivalente.
- Testes de política rejeitam payloads que tentem expressar código.
- A documentação pública não promete execução arbitrária.
