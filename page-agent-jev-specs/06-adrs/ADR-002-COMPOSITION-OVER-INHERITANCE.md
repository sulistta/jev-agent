---
schema_version: "1.0"
document_id: "ADR-002"
kind: "architecture-decision-record"
title: "Composição no lugar de herança para os runtimes"
status: "accepted"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-001"
owners:
  - "architecture"
  - "core"
requirements:
  - "NFR-001"
  - "NFR-002"
---

# ADR-002 — Composição no lugar de herança para os runtimes

## Contexto

`MultiPageAgent` herda do core e substitui o controlador por coerção de tipo. A hierarquia mistura loop de decisão, transporte, browser, estado de abas e implementação de ações. Isso enfraquece contratos e torna testes isolados difíceis.

## Decisão

O novo desenho usará composição por portas explícitas:

```ts
interface AgentRuntimeDeps {
  browser: BrowserPort;
  observe: ObservationPort;
  decide: DecisionPort;
  execute: ActionPort;
  sessions: SessionPort;
  events: EventPort;
  clock: ClockPort;
}
```

`AgentRuntime` orquestra dependências, mas não conhece DOM, Chrome APIs, SDK de modelo ou armazenamento concreto. Implementações de página única e extensão são adaptadores configurados no composition root.

## Regras

- Nenhum adaptador será injetado via `as any`.
- Portas usam tipos de domínio estáveis, sem objetos crus do Chrome ou do SDK.
- Dependências externas são traduzidas nas bordas.
- Implementações fake/in-memory são parte suportada da arquitetura de testes.

## Alternativas consideradas

### Preservar a herança e tipar melhor o campo

Melhora o sintoma, mas mantém acoplamento entre lifecycle e mecanismo de controle.

### Framework de injeção de dependência

Adiado. Factories explícitas são suficientes e preservam tamanho de bundle e transparência.

## Consequências

- Mais interfaces e mapeadores nas bordas.
- Testes determinísticos para runtime, decisões e execução.
- Migração pode ser feita com adapters sobre o comportamento legado.
- O core deixa de importar diretamente clientes de LLM ou APIs da extensão.

## Critérios de verificação

- `AgentRuntime` executa testes completos usando apenas fakes.
- Busca estática não encontra `chrome.*`, `window.*` ou SDKs externos no pacote de domínio.
- Build não contém casts `as any` nas fronteiras migradas.
