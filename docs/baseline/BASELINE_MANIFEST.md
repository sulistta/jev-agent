---
schema_version: '1.0'
document_id: 'PAJ-BASELINE-001'
kind: 'baseline-manifest'
title: 'Page Agent 1.12.4 baseline manifest'
status: 'accepted-for-planning'
version: '1.0.0'
updated: '2026-09-19'
source_repository: 'https://github.com/alibaba/page-agent'
source_commit: '9eb6b6646500264d9034dd466a4270cb9fc1ef1e'
---

# Page Agent 1.12.4 baseline manifest

This file freezes the source and command evidence used by the Page Agent + Jev migration plan. The checkout is intentionally kept at the upstream commit until the first migration change is made.

## Source

| Field         | Value                                      |
| ------------- | ------------------------------------------ |
| Repository    | `https://github.com/alibaba/page-agent`    |
| Commit        | `9eb6b6646500264d9034dd466a4270cb9fc1ef1e` |
| Version       | `1.12.4`                                   |
| Checkout path | `page-agent/` in the migration workspace   |
| Workspaces    | 8 npm workspaces; 7 build targets          |

The commit was verified locally with:

```text
git -C page-agent log -1 --format='%H%n%cs%n%s'
9eb6b6646500264d9034dd466a4270cb9fc1ef1e
2026-09-06
chore(version): bump version to 1.12.4
```

## Environment

| Field             | Value                                 |
| ----------------- | ------------------------------------- |
| Node              | `v24.14.0`                            |
| Install           | `npm ci`                              |
| Dependency result | 786 packages added, 795 audited       |
| npm audit notice  | 6 vulnerabilities: 1 moderate, 5 high |

The vulnerabilities are recorded as baseline evidence. No automatic `npm audit fix` was applied because it could change the frozen baseline.

## Verification commands

All commands below were run from the repository root on 2026-09-19.

| Command             | Result | Evidence                                                        |
| ------------------- | ------ | --------------------------------------------------------------- |
| `npm ci`            | PASS   | Clean install completed; audit notice recorded above.           |
| `npm test`          | PASS   | 69 tests: page-controller 4, llms 43, core 17, extension 5.     |
| `npm run typecheck` | PASS   | Root and extension TypeScript projects completed.               |
| `npm run lint`      | PASS   | ESLint completed with exit code 0.                              |
| `npm run build`     | PASS   | 7 build targets completed; website and Chrome MV3 ZIP produced. |

Build artifacts observed:

- `packages/extension/.output/page-agent-ext-1.12.4-chrome.zip` — 426.13 kB;
- Chrome MV3 output — 1.85 MB unpacked;
- all library declaration bundles and website routes generated successfully.

## Baseline limitations

This manifest proves the health of the upstream build at the pinned commit. It does not claim that the Jev architecture has been implemented. The following remain migration work covered by the SPEC package:

- no extension E2E matrix;
- no local/remote Browser Runtime contract suite;
- no stale-reference or Outcome Verifier tests;
- no Jev live-provider benchmark or calibration report;
- no security, privacy, accessibility, or soak evidence for the target architecture.
