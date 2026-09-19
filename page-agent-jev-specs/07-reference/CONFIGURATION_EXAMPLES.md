---
schema_version: "1.0"
document_id: "PAJ-REF-003"
kind: "configuration-reference"
title: "Exemplos de configuração"
status: "proposed"
version: "1.0.0"
updated: "2026-09-19"
depends_on:
  - "PAJ-XCUT-001"
  - "PAJ-COMP-004"
  - "ADR-007"
---

# Exemplos de configuração

## 1. Avisos

Os exemplos são contratos propostos e pseudocódigo TypeScript; não existem ainda no baseline 1.12.4. Nomes finais podem mudar sem alterar as invariantes das SPECs.

Regras comuns:

- nunca embutir segredo de produção no bundle;
- não persistir chave em `localStorage` ou telemetria;
- provider indisponível deve produzir erro/fallback explícito;
- `model`, templates e thresholds devem ser versionados;
- produção deve preferir `backend_proxy` ou token efêmero.

## 2. In-page com backend proxy

```typescript
import { createPageAgent } from 'page-agent'
import { createProxyJevTransport } from '@page-agent/decision-jev'

const transport = createProxyJevTransport({
  endpoint: '/api/page-agent/jev',
  credentials: 'include',
  csrfHeader: async () => ({
    'x-csrf-token': await getCsrfToken(),
  }),
  timeoutMs: 8_000,
})

const agent = createPageAgent({
  browser: {
    mode: 'in_page',
    mask: true,
    observation: {
      maxCandidates: 40,
      includeOffscreen: false,
      redactSensitiveFields: true,
    },
  },
  decisions: {
    jev: {
      model: 'jev-1.13',
      transport,
      thresholdsProfile: 'default-conservative-v1',
      maxQuestionsPerCall: 4,
      maxStateTokens: 2_500,
      languagePolicy: 'preserve',
    },
    router: {
      allowGenerativeFallback: false,
    },
  },
  policy: {
    profile: 'consumer-safe-v1',
    requireConfirmationFor: ['external_effect', 'financial', 'credential'],
  },
  execution: {
    maxSteps: 30,
    maxDurationMs: 120_000,
    maxProviderCalls: 45,
    cycleWindow: 6,
  },
  privacy: {
    telemetry: 'metadata',
    rawDom: 'never',
    redactInputValues: true,
  },
  ui: {
    panel: true,
    language: 'pt-BR',
    showActionPreview: true,
  },
})
```

## 3. Backend proxy de referência

```typescript
import { createJevProxyHandler } from '@page-agent/decision-jev/server'

export const POST = createJevProxyHandler({
  authenticate: async (request) => requireApplicationSession(request),
  authorize: async ({ user, templateIds }) => {
    if (!user.features.includes('page-agent')) return false
    return templateIds.every((id) => ALLOWED_TEMPLATES.has(id))
  },
  credential: () => process.env.TYPESAFE_API_KEY!,
  rateLimit: {
    key: ({ user }) => user.id,
    requestsPerMinute: 30,
  },
  allowedModels: ['jev-1.13'],
  log: 'metadata_only',
  timeoutMs: 7_500,
})
```

O backend deve validar schema, autenticação, autorização, tamanho, modelo e template. Ele não deve ser um proxy aberto de requests arbitrários.

## 4. Desenvolvimento local com chave do desenvolvedor

```typescript
import { createDirectHttpJevTransport } from '@page-agent/decision-jev'

const transport = createDirectHttpJevTransport({
  apiKey: promptForSessionOnlyKey(),
  persistCredential: false,
  allowedOrigin: location.origin,
  timeoutMs: 8_000,
})
```

Condições:

- somente ambiente local/consciente do risco;
- a UI deve informar que a chave é observável pelo cliente;
- limpar a chave ao encerrar a sessão;
- não ativar automaticamente em builds distribuídas;
- confirmar CORS e endpoint em spike antes de prometer suporte.

## 5. Teste determinístico sem rede

```typescript
import { createPageAgent } from 'page-agent'
import { MockJevTransport } from '@page-agent/decision-jev/testing'

const transport = new MockJevTransport({
  strict: true,
  fixtures: {
    'candidate.select.v1:login-email': {
      answer: 'candidate:c_03',
      confidence: 0.97,
      probabilities: {
        'candidate:c_03': 0.97,
        none_of_the_above: 0.03,
      },
    },
  },
})

const agent = createPageAgent({
  browser: createFixtureBrowserRuntime('login-page-v2'),
  decisions: {
    jev: { model: 'mock', transport },
  },
  policy: { profile: 'test-auto-confirm' },
  ui: false,
  telemetry: { mode: 'off' },
})
```

`strict: true` deve falhar se surgir pergunta não prevista, garantindo que testes não façam fallback para rede.

## 6. Extensão com backend corporativo

```typescript
const extensionConfig = {
  runtime: {
    host: 'service_worker',
    checkpointStore: 'chrome_storage_session',
    leaseMs: 15_000,
    heartbeatMs: 5_000,
    reconcileOnStartup: true,
  },
  browser: {
    permissions: 'active_tab_first',
    allowedOrigins: [
      'https://app.example.com/*',
      'https://admin.example.com/*',
    ],
    denyOrigins: [
      'https://payments.example.com/*',
    ],
  },
  decisions: {
    jev: {
      mode: 'backend_proxy',
      endpoint: 'https://agent-gateway.example.com/v1/jev',
      auth: 'enterprise_session',
      model: 'jev-1.13',
      thresholdsProfile: 'enterprise-v3',
    },
    generative: { enabled: false },
  },
  publicApi: {
    enabled: true,
    allowedOrigins: ['https://app.example.com'],
    capabilities: ['session.start', 'session.observe', 'session.cancel'],
    requireInteractiveAuthorization: true,
  },
  hub: {
    enabled: false,
  },
} satisfies ExtensionConfigV2
```

O manifest deve derivar permissões mínimas desta configuração sempre que o pipeline permitir variantes de build.

## 7. Provider generativo opcional

```typescript
const decisions = {
  jev: {
    model: 'jev-1.13',
    transport: jevTransport,
    thresholdsProfile: 'default-conservative-v1',
  },
  generative: {
    provider: createOpenAICompatibleProvider({
      endpoint: '/api/page-agent/generate',
      credentials: 'include',
    }),
    allowedNeeds: ['value_generation', 'open_replan', 'user_summary'],
    maxCallsPerRun: 3,
    outputValidation: 'strict',
  },
  router: {
    allowGenerativeFallback: true,
    requireUserApprovalForOpenReplan: true,
  },
}
```

O provider generativo não pode retornar `ActionIntent` diretamente. Ele retorna uma proposta estruturada que o runtime valida e converte em nova necessidade/ação permitida.

## 8. Política de thresholds

```typescript
const thresholds = {
  version: 'enterprise-v3',
  defaults: {
    R0: { autoActMin: 0.75, verifyMin: 0.50 },
    R1: { autoActMin: 0.85, verifyMin: 0.65 },
    R2: { autoActMin: 0.93, verifyMin: 0.80 },
    R3: { autoActMin: null, verifyMin: null, confirmation: 'required' },
  },
  overrides: {
    'candidate.select.v1:payments.example.com': {
      autoActMin: null,
      confirmation: 'required',
    },
  },
  rejectWhen: {
    selectedNone: true,
    staleObservation: true,
    topMarginBelow: 0.10,
  },
} satisfies ThresholdPolicyConfig
```

Valores são seeds ilustrativos. Publicar somente depois de calibração com dataset representativo.

## 9. Policy de ações

```typescript
const policy = {
  version: 'consumer-safe-v1',
  rules: [
    { when: { action: 'observe' }, effect: 'allow' },
    { when: { action: 'click', risk: 'R0' }, effect: 'allow' },
    { when: { action: 'input', dataClass: 'credential' }, effect: 'confirm' },
    { when: { action: 'submit', externalEffect: true }, effect: 'confirm' },
    { when: { action: 'download', mimeUnknown: true }, effect: 'deny' },
    { when: { action: 'execute_javascript' }, effect: 'deny' },
  ],
  confirmation: {
    tokenTtlMs: 30_000,
    bindTo: ['runId', 'actionHash', 'documentId', 'revision'],
  },
} satisfies PolicyConfig
```

As regras são avaliadas depois da validação estrutural e antes da execução.

## 10. Privacidade e observabilidade

```typescript
const telemetry = {
  mode: 'metadata',
  sampleRate: 0.10,
  include: [
    'run.status',
    'step.duration',
    'decision.template',
    'decision.confidence_bucket',
    'action.kind',
    'action.outcome',
    'error.code',
  ],
  exclude: [
    'raw_dom',
    'input_value',
    'credential',
    'provider_raw_request',
    'provider_raw_response',
  ],
  retentionDays: 14,
  sessionIdHashing: true,
} satisfies TelemetryConfig
```

Debug detalhado deve exigir opt-in explícito, expirar automaticamente e ainda aplicar redaction.

## 11. Configuração inválida e comportamento esperado

| Configuração | Resultado esperado |
|---|---|
| Jev habilitado sem transport | `CONFIG_DECISION_TRANSPORT_MISSING` antes de iniciar |
| `developer_key` em build que o proíbe | `CONFIG_CREDENTIAL_MODE_FORBIDDEN` |
| generative fallback permitido sem provider | validação falha ou fallback é desativado explicitamente |
| `maxSteps <= 0` | erro de schema |
| telemetry raw com privacy `rawDom: never` | configuração recusada, privacy vence |
| origem pública não allowlisted | handshake recusado |
| profile de threshold ausente | não usar defaults ocultos; erro acionável |
| modelo não suportado pelo transport | `PROVIDER_MODEL_UNSUPPORTED` |

## 12. Precedência de configuração

Ordem recomendada, da menor para a maior precedência:

1. defaults compilados e documentados;
2. profile de produto;
3. policy administrada pela organização;
4. configuração do integrador;
5. override permitido por sessão.

Um nível não pode relaxar controles marcados como `locked` por nível superior. A configuração efetiva deve poder ser inspecionada sem revelar segredos.

