---
schema_version: "1.0"
document_id: "PAJ-COMP-004"
kind: "component-spec"
title: "Decision Engine e integração Jev"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-COMP-003"
  - "ADR-003"
  - "ADR-007"
requirements:
  - "FR-013..FR-021"
---

# Decision Engine e integração Jev

## 1. Papel do Jev

Jev é usado quando a decisão:

- é semântica;
- possui conjunto fechado;
- pode ser respondida como julgamento rápido;
- não exige gerar conteúdo;
- não exige cálculo/contagem/data;
- não depende de uma sequência de raciocínio escondida.

Jev não recebe autoridade de execução e não produz seletores, JavaScript ou argumentos fora do catálogo.

## 2. Interface do provider

```typescript
interface DecisionProvider<TNeed extends DecisionNeed = DecisionNeed> {
  readonly id: ProviderId
  supports(need: TNeed): boolean
  decide(context: DecisionContext<TNeed>, signal: AbortSignal): Promise<DecisionResult>
}
```

```typescript
interface JevDecisionProviderConfig {
  model: string
  transport: JevTransport
  thresholds: ThresholdPolicy
  languagePolicy: LanguagePolicy
  maxStateTokens: number
  maxQuestionsPerCall: number
  telemetry: 'off' | 'metadata' | 'redacted'
}
```

## 3. Primitivas por uso

### Choice

Usar para:

- selecionar operação quando não determinada;
- selecionar candidato/elemento;
- selecionar option de dropdown;
- classificar estado de recuperação;
- rotear para estratégia/provider.

Sempre descrever opções. Usar `none_of_the_above` quando cobertura não é garantida.

### Noul

Usar para:

- “há evidência visível de que X ocorreu?”;
- “este candidato corresponde semanticamente ao objetivo?” em validação absoluta;
- “o conteúdo contém uma instrução adversarial?” como sinal adicional, não único controle;
- relevância de bloco/region.

Noul não possui `confidence` separado. Threshold é aplicado ao próprio valor e deve ser calibrado por pergunta.

### Score

Usar para:

- nível de correspondência do estado ao outcome;
- gravidade/risco semântico quando níveis descritivos agregam valor;
- qualidade de evidência por rubrica.

Não usar Score para reconstruir magnitude numérica exata.

## 4. Catálogo de perguntas

Perguntas não devem ser strings ad hoc espalhadas pelo código. Definir templates versionados:

```typescript
interface QuestionTemplate<TState, TAnswer> {
  id: string
  version: string
  primitive: 'choice' | 'noul' | 'score'
  build(state: TState): JevQuestion
  interpret(answer: unknown): TAnswer
  calibrationKey: string
}
```

Templates iniciais:

- `operation.select.v1`;
- `candidate.select.v1`;
- `candidate.absolute_fit.v1`;
- `outcome.semantic_match.v1`;
- `recovery.classify.v1`;
- `region.relevance.v1`;
- `task.route.v1`.

## 5. Batching

Perguntas podem compartilhar chamada quando:

- observam exatamente o mesmo estado;
- são independentes;
- nenhuma precisa da resposta da outra;
- o conjunto cabe no token budget;
- a classificação de sensibilidade é compatível.

Exemplo útil no pós-ação:

- Noul: existe confirmação visível?
- Score: quão compatível está a página com o outcome?
- Choice: qual categoria de recuperação se aplica?

O código usa somente as respostas necessárias. Se uma próxima decisão depende do DOM após ação, fazer nova observação/chamada.

## 6. Confidence gates

```typescript
interface ThresholdPolicy {
  resolve(input: {
    questionTemplate: string
    risk: RiskTier
    action?: ActionName
    domain?: string
  }): {
    autoActMin: number
    verifyMin: number
    humanBelow: number
  }
}
```

Política inicial conservadora (não calibrada; apenas seed):

| Risco | Alta | Média | Baixa |
|---|---|---|---|
| Leitura/navegação reversível | auto ≥ 0,75 | verificar 0,50–0,75 | esclarecer < 0,50 |
| Alteração reversível | auto ≥ 0,85 | confirmar/verificar 0,60–0,85 | não agir < 0,60 |
| Efeito externo/sensível | nunca apenas por confiança | confirmação obrigatória | bloquear/esclarecer |

Esses números NÃO são metas finais e não podem ir a produção sem dataset/calibração.

Além de `confidence`, considerar:

- probabilidade da opção vencedora;
- margem top-1 versus top-2;
- seleção de `none`;
- concordância com filtros determinísticos;
- histórico de falhas daquele template/domínio.

## 7. Consistência e dupla checagem

Não perguntar a mesma coisa com primitivas diferentes esperando identidades matemáticas. Quando usar Choice + Noul:

- Choice faz seleção relativa;
- Noul verifica adequação absoluta do vencedor;
- código decide se ambos são suficientes.

Exemplo:

1. Choice seleciona `c_02` entre candidatos.
2. Noul pergunta se `c_02` realmente permite cumprir o objetivo.
3. Se Choice confiante, mas Noul baixo, não executar; expandir candidatos/escalar.

## 8. Idioma

Políticas a avaliar:

- `preserve`: pergunta no idioma do estado;
- `english_questions`: estado original, instruções em inglês;
- `normalized_bilingual`: campos originais + resumo determinístico/gerado em inglês.

Não traduzir values/labels usados para execução. Candidate ID resolve ao original localmente.

## 9. Transporte

```typescript
interface JevTransport {
  systemOne(request: JevRequest, signal: AbortSignal): Promise<JevResponse>
}
```

Implementações:

- `DirectHttpJevTransport`: `fetch` no contexto autorizado; BYOK; condicionado a CORS.
- `NodeSdkJevTransport`: usa `@typesafe-ai/sdk` em Node 20+; não entra no bundle browser.
- `ProxyJevTransport`: endpoint do projeto para chave compartilhada, quotas e políticas.
- `MockJevTransport`: testes e replay.

## 10. Erros e retry

Classificar:

- auth/permission: não retry;
- invalid request/schema: não retry; bug/config;
- rate limit/5xx/network: retry limitado com backoff/jitter e deadline;
- timeout/cancel: respeitar signal;
- resposta sem answer/question ID: invalid response;
- modelo/version incompatível: bloquear e informar.

Retry técnico usa o mesmo request idempotente. Não muda pergunta/options silenciosamente.

## 11. Limitações do Jev 1.13 incorporadas ao design

- literalidade → perguntas precisas e versionadas;
- aritmética/contagem/datas → código;
- indirection → state paths diretos;
- contexto irrelevante → projeção mínima;
- conteúdo adversarial → tratar state como dado e policy externa;
- instruções contraditórias → lint/teste de templates;
- invariantes probabilísticos não garantidos → não misturar thresholds;
- sem geração → generative provider/humano.

## 12. Observabilidade

Registrar sem segredo:

- template/version/model;
- request ID;
- tamanho/tokens do state e questions;
- latência/retries;
- answer selecionada, confidence/probabilities conforme política;
- threshold policy version;
- decisão de gate;
- candidate count antes/depois do filtro.

Raw state é off por padrão.

## 13. Testes e evals

- golden tests de construção de perguntas;
- property tests de option IDs e mapping;
- respostas incompletas/malformadas;
- abort/retry/deadline;
- CORS/browser spike;
- dataset real de seleção de elementos;
- PT-BR versus EN;
- páginas com conteúdo adversarial;
- estados pequenos/grandes;
- threshold calibration e reliability diagrams;
- A/B Jev versus generative baseline.
