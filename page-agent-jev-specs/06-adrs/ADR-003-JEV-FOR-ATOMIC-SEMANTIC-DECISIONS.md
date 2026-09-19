---
schema_version: "1.0"
document_id: "ADR-003"
kind: "architecture-decision-record"
title: "Jev somente para decisões semânticas atômicas"
status: "accepted"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-ARCH-002"
owners:
  - "architecture"
  - "decision-engine"
requirements:
  - "FR-013"
  - "FR-014"
  - "FR-015"
  - "NFR-026"
---

# ADR-003 — Jev somente para decisões semânticas atômicas

## Contexto

Jev oferece primitivas estruturadas para escolha e pontuação, com confiança derivada da distribuição. Ao mesmo tempo, não é um gerador geral e apresenta limitações conhecidas para cálculo, contagem, datas, indireção e estado amplo ou irrelevante.

## Decisão

Jev será usado como classificador/ranqueador em perguntas pequenas e independentes:

- escolher um candidato entre opções previamente geradas;
- classificar a intenção de navegação;
- estimar risco ou relevância em escala discreta;
- selecionar a próxima política permitida.

Jev não receberá HTML bruto, screenshots, listas ilimitadas nem a responsabilidade de produzir texto, CSS, JavaScript, URLs ou argumentos livres. Transformações determinísticas, parsing, cálculo e validação permanecerão em código.

## Limites operacionais

- Máximo padrão de 40 opções úteis por decisão, abaixo do limite técnico da primitiva.
- Sempre incluir `none_of_the_above` quando nenhuma opção puder ser válida.
- Estado mínimo: objetivo normalizado, etapa atual, candidatos compactos e evidência recente relevante.
- Perguntas correlacionadas são feitas em rodadas separadas.
- Toda resposta passa por validação de esquema, allowlist e revisão da observação.

## Política de confiança

Confiança não é tratada como verdade. A decisão será combinada com risco da ação, margem entre alternativas, frescor da observação e resultado de regras determinísticas.

| Risco | Confiança alta | Confiança intermediária | Confiança baixa |
|---|---|---|---|
| baixo | executar | reobservar ou executar com guarda | reobservar |
| médio | executar com pós-condição | pedir confirmação ou refinar | bloquear |
| alto | pedir confirmação | bloquear | bloquear |

Os limiares numéricos serão calibrados por avaliação, não escolhidos apenas por intuição.

## Alternativas consideradas

### Substituir o loop inteiro por uma única chamada Jev

Rejeitado porque combina decisão, planejamento e geração em um contrato que Jev não pretende fornecer.

### Manter o LLM generativo como decisor universal

Rejeitado como arquitetura alvo por custo, superfície de injeção, saídas não estruturadas e dificuldade de validar completion.

## Consequências

- O sistema precisa gerar bons candidatos antes da decisão.
- Cenários sem candidato válido tornam-se um estado de primeira classe.
- Avaliação deve medir cobertura do gerador separadamente da precisão do decisor.
- Um provider generativo pode existir apenas como fallback delimitado e opcional.

## Critérios de verificação

- Telemetria registra tamanho e digest do estado, opções, confiança e rota tomada, sem conteúdo sensível bruto.
- Testes falham se Jev puder emitir ação ou argumento fora do catálogo.
- Benchmarks separam `candidate_recall` de `choice_accuracy`.
