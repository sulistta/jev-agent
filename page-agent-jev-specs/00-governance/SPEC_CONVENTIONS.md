---
schema_version: "1.0"
document_id: "PAJ-GOV-001"
kind: "governance-spec"
title: "Convenções das especificações"
status: "accepted-for-planning"
version: "1.0.0"
updated: "2026-09-19"
depends_on: []
---

# Convenções das especificações

## 1. Linguagem normativa

Os termos abaixo têm significado obrigatório:

- **DEVE / NÃO DEVE**: requisito obrigatório para aceite.
- **DEVERIA / NÃO DEVERIA**: recomendação forte; qualquer desvio exige justificativa em ADR.
- **PODE**: opção compatível com a arquitetura.
- **FUTURO**: deliberadamente fora do primeiro release.

## 2. Metadados semânticos

Todo documento possui front matter YAML com:

- `document_id`: identificador estável;
- `kind`: classe do documento;
- `status`: situação normativa;
- `version`: versão semântica do documento;
- `updated`: data da última revisão;
- `depends_on`: documentos necessários para interpretá-lo;
- `requirements`: quando aplicável, requisitos tratados.

Estados permitidos:

| Estado | Significado |
|---|---|
| `draft` | Conteúdo incompleto ou exploratório. |
| `proposed` | Pronto para revisão técnica. |
| `accepted-for-planning` | Pode orientar implementação, ainda sujeito a feedback real. |
| `accepted` | Decisão ratificada. |
| `superseded` | Substituído; deve apontar para o sucessor. |
| `retired` | Não aplicável ao produto atual. |

## 3. Identificadores

| Prefixo | Objeto |
|---|---|
| `FR-` | Requisito funcional. |
| `NFR-` | Requisito não funcional. |
| `SEC-` | Controle de segurança. |
| `PRIV-` | Controle de privacidade. |
| `OBS-` | Requisito de observabilidade. |
| `UX-` | Requisito de experiência. |
| `EPIC-` | Épico de implementação. |
| `TASK-` | Tarefa executável. |
| `AC-` | Critério de aceite. |
| `TEST-` | Caso/suíte de teste. |
| `RISK-` | Risco rastreado. |
| `ADR-` | Decisão arquitetural. |

IDs nunca devem ser reutilizados após remoção. Um item cancelado permanece documentado com estado `retired`.

## 4. Separação entre fatos e propostas

Cada afirmação arquitetural deve pertencer a uma das categorias:

- **Baseline verificado**: observado no commit auditado, em build/teste ou documentação oficial.
- **Decisão proposta**: desenho recomendado para o fork.
- **Hipótese a validar**: depende de CORS, comportamento do Jev, páginas reais ou restrições de distribuição.

Uma hipótese não pode ser convertida silenciosamente em requisito. Ela deve ganhar um spike, uma evidência e uma decisão registrada.

## 5. Contratos antes de classes

As SPECs definem primeiro:

1. dados de entrada e saída;
2. invariantes;
3. estados e transições;
4. erros e cancelamento;
5. observabilidade;
6. somente então, módulos/classes sugeridos.

Os nomes de arquivos TypeScript propostos não são uma obrigação quando outra organização preservar todos os contratos e limites descritos.

## 6. Compatibilidade

Compatibilidade externa deve ser explícita e testada. Compatibilidade interna com classes antigas não é objetivo.

Uma camada de compatibilidade só é aceitável quando:

- é fina e não duplica o motor;
- converte a API antiga para a API nova;
- possui data/versão de remoção;
- não obriga novos componentes a importar tipos legados;
- possui testes de contrato próprios.

## 7. Política de mudança

Uma alteração é:

- **patch** quando corrige redação sem mudar comportamento;
- **minor** quando adiciona comportamento compatível;
- **major** quando muda invariantes, protocolo, API pública ou critérios de aceite.

Mudanças major em uma SPEC aceita exigem ADR novo ou revisão explícita do ADR afetado.

## 8. Definition of Ready para uma tarefa

Uma tarefa pode entrar em implementação quando possui:

- objetivo observável;
- requisitos e dependências identificados;
- arquivos/módulos prováveis;
- riscos relevantes;
- critérios de aceite;
- estratégia de teste;
- ausência de questão aberta bloqueante.

## 9. Definition of Done documental

Antes do merge de uma mudança relevante:

- requisitos afetados devem ser atualizados;
- contratos públicos e protocolo devem refletir o código;
- ADRs devem refletir decisões irreversíveis;
- matriz de rastreabilidade deve apontar para testes reais;
- exemplos devem compilar ou ser marcados como pseudocódigo;
- números de versão e baseline devem ser coerentes.
