# History

This folder holds dated records: release write-ups, audits, QA reports and the phase plans of the rebuild. They are kept exactly as they were written. Each one describes the product at that time, so file paths, version numbers, feature names and third-party names inside them may no longer match the code. For how VinaX works today, start at [the docs index](../README.md).

Dates are the date stated in the document, or the date it was first committed when the document states none.

## Release write-ups

| File | What it is | Date | Status |
| --- | --- | --- | --- |
| [UPGRADE_7_0.md](UPGRADE_7_0.md) | Release notes and verification for 7.0 (audit-first release: next-song pipeline, session intent, data-safe restore, Worker security fix) | 2026-09-17 | historical — describes the product at that time |
| [vinax-flow-migration.md](vinax-flow-migration.md) | Plan for the "Flow" visual redesign (shell, navigation, tokens) | 2026-09-17 | historical — describes the product at that time |
| [UPGRADE_6_5.md](UPGRADE_6_5.md) | Release notes for 6.5 (the DJ builds every queue, Tune this queue, Home rebuilt per open) | 2026-09-16 | historical — describes the product at that time |
| [UPGRADE_6_4.md](UPGRADE_6_4.md) | Release notes for 6.4 (personalisation pipeline audit, event weights, session state) | 2026-09-16 | historical — describes the product at that time |
| [UPGRADE_6_3.md](UPGRADE_6_3.md) | Release notes for 6.3 (arc sequencing, adaptive re-planning, Queue Builder) | 2026-09-16 | historical — describes the product at that time |
| [UPGRADE_6_2.md](UPGRADE_6_2.md) | Release notes for 6.2 (AI DJ, DJ voice, AI-designed Home shelves) | 2026-09-16 | historical — describes the product at that time |
| [UPGRADE_6_1.md](UPGRADE_6_1.md) | Release notes for 6.1 (backup format, import review, lighter Home, Library tools) | 2026-09-16 | historical — describes the product at that time |
| [DISCOVERY_UPGRADE.md](DISCOVERY_UPGRADE.md) | Search redesign and the owner console's Operations Workspace | 2026-09-12 | historical — describes the product at that time |
| [ASTRA_UPGRADE.md](ASTRA_UPGRADE.md) | Changes and verification for the 6.0 "Astra" visual system | 2026-09-11 | historical — describes the product at that time |
| [releases/5.31.0.md](releases/5.31.0.md) | Release verification for 5.31.0 | 2026-09-10 | historical — describes the product at that time |

## Audits and QA reports

| File | What it is | Date | Status |
| --- | --- | --- | --- |
| [final-report-2026-08.md](final-report-2026-08.md) | Final report of the August 2026 audit and UX programme (4.1.0 to 4.2.1) | 2026-08 | historical — describes the product at that time |
| [audit-2026-08-delta.md](audit-2026-08-delta.md) | Delta audit of UX, design system, themes, navigation state, accessibility and search at 4.0.0 | 2026-08 | historical — describes the product at that time |
| [qa-report-2026-08-10.md](qa-report-2026-08-10.md) | Production QA report for 4.3.0, run against the built bundle | 2026-08-10 | historical — describes the product at that time |
| [release-audit-2026-07-11.md](release-audit-2026-07-11.md) | Pre-release audit of the whole repository at 1.2.0 | 2026-07-11 | historical — describes the product at that time |

## Rebuild phases (five-phase plan, mid-2026)

| File | What it is | Date | Status |
| --- | --- | --- | --- |
| [phases/phase1/README.md](phases/phase1/README.md) | Phase 1 index: foundation and audit deliverables | 2026-07-08 | historical — describes the product at that time |
| [phases/phase1/adr-001-architecture.md](phases/phase1/adr-001-architecture.md) | Architecture decision record for the target architecture | 2026-07-08 | historical — describes the product at that time |
| [phases/phase1/catalog-audit.md](phases/phase1/catalog-audit.md) | Content and catalogue audit | 2026-07-08 | historical — describes the product at that time |
| [phases/phase1/design-tokens.md](phases/phase1/design-tokens.md) | The earlier design-token foundation (replaced by the Flow tokens) | 2026-07-08 | historical — describes the product at that time |
| [phases/phase1/privacy-baseline.md](phases/phase1/privacy-baseline.md) | Privacy and compliance baseline of that time | 2026-07-08 | historical — describes the product at that time |
| [phases/phase1/technical-audit.md](phases/phase1/technical-audit.md) | Technical audit of the codebase | 2026-07-08 | historical — describes the product at that time |
| [phases/phase1/ux-flow-audit.md](phases/phase1/ux-flow-audit.md) | UX and flow audit, phone and desktop | 2026-07-08 | historical — describes the product at that time |
| [phases/phase2/README.md](phases/phase2/README.md) | Phase 2: core architecture and data, gap-closing pass | 2026-08-22 (first committed) | historical — describes the product at that time |
| [phases/phase3/README.md](phases/phase3/README.md) | Phase 3: experience surfaces | 2026-08-22 (first committed) | historical — describes the product at that time |
| [phases/phase4/README.md](phases/phase4/README.md) | Phase 4: discovery and personalisation | 2026-08-22 (first committed) | historical — describes the product at that time |
| [phases/phase4/charts-pipeline.md](phases/phase4/charts-pipeline.md) | Charts and trending pipeline notes | 2026-08-22 (first committed) | historical — describes the product at that time |
| [phases/phase5/README.md](phases/phase5/README.md) | Phase 5: hardening, polish and launch | 2026-08-22 (first committed) | historical — describes the product at that time |
| [phases/phase5/qa-matrix.md](phases/phase5/qa-matrix.md) | QA matrix of core flows by platform | 2026-08-22 (first committed) | historical — describes the product at that time |
| [phases/phase5/rollout.md](phases/phase5/rollout.md) | Staged rollout and rollback runbook of that time | 2026-08-22 (first committed) | historical — describes the product at that time |

## Where these files used to live

The release write-ups were at the repository root. `vinax-flow-migration.md` was in `docs/`. Everything else was under `frontend/docs/` (the phase folders as `frontend/docs/phase1` … `phase5`, the release note as `frontend/docs/releases/`). Paths quoted inside the documents still use the old locations.
