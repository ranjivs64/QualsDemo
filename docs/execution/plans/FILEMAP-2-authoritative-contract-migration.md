# File Map: Authoritative Extractor Contract Migration

**Status**: Draft  
**Date**: 2026-03-21  
**Source PRD**: [PRD-2.md](../../artifacts/prd/PRD-2.md)  
**Source Backlog**: [BACKLOG-2-authoritative-contract-migration.md](./BACKLOG-2-authoritative-contract-migration.md)  
**Source Issue Pack**: [ISSUES-2-authoritative-contract-migration.md](./ISSUES-2-authoritative-contract-migration.md)

## Purpose

This file maps the migration backlog to the exact repository files engineering needs to touch for the phase-1 compatibility implementation. It separates the immediate implementation slice from adjacent files that are contract consumers but do not need code changes in the first pass.

## Implemented Slice

| Story | Primary files | Change intent |
|------|---------------|---------------|
| STORY-2.1.1 Create authoritative schema from the prompt contract | `prompts/qualification-extractor.md`, `templates/qualification-extraction-authoritative-schema.json` | Keep the authoritative prompt as the AI-facing contract and add an explicit structured-output schema that matches it. |
| STORY-2.1.2 Align AI client validation to the authoritative schema | `server/aiClient.js`, `tests/aiClient.test.js` | Switch the AI client from validating the legacy graph-shaped response to validating the authoritative `Qualifications` response, then hand off to normalization. |
| STORY-2.2.1 Introduce a normalizer module at the AI boundary | `server/aiDraftNormalizer.js`, `server/aiClient.js`, `server/extractionService.js`, `tests/aiDraftNormalizer.test.js` | Introduce a dedicated normalization boundary that converts authoritative AI output into the current internal review graph before merge and persistence. |
| STORY-2.2.2 Map learning objectives into current reviewable structures | `server/aiDraftNormalizer.js`, `server/databaseStore.js`, `tests/aiDraftNormalizer.test.js` | Represent authoritative learning objectives as internal review nodes compatible with current review and persistence logic. |
| STORY-2.3.1 Verify review workspace compatibility with normalized drafts | `tests/server.integration.test.js`, `tests/e2e/review-workspace.spec.js` | Confirm that the current review surface still works when fed normalized AI drafts rather than legacy AI payloads. |
| STORY-2.3.2 Keep fallback extraction on the internal graph contract | `server/extractionService.js`, `tests/jobStore.test.js` | Leave the fallback parser on the current internal graph so degraded-mode workflows remain stable. |
| STORY-2.4.1 Add golden fixtures for authoritative and normalized outputs | `tests/aiClient.test.js`, `tests/aiDraftNormalizer.test.js` | Lock the authoritative-to-internal transformation down with deterministic fixtures. |
| STORY-2.4.2 Capture prompt, schema, and normalizer versions in job metadata | `server/aiClient.js`, `server/extractionService.js`, `server/databaseStore.js` | Stamp the extraction metadata with the contract boundary artifacts used for the run. |

## Immediate Contract Consumers

| File | Why it matters in phase 1 | Expected code change now |
|------|----------------------------|--------------------------|
| `server/jobStore.js` | Rehydrates review jobs and derives reviewer-facing summaries from the internal graph | No |
| `server/databaseStore.js` | Persists jobs and approved qualification graphs from the internal graph | Minimal or none unless metadata stamping needs storage expansion |
| `app/assets/app.js` | Renders the current review graph and qualification summaries | No |
| `tests/jobStore.test.js` | Verifies current review-readiness, shared-unit behavior, and persistence | Possibly no change if the normalization preserves current graph semantics |
| `tests/server.integration.test.js` | Verifies the real HTTP review flow | Regression-only |
| `tests/e2e/review-workspace.spec.js` | Verifies browser-level hierarchy rendering and navigation | Regression-only |

## Documentation Alignment Files

| File | Change intent |
|------|---------------|
| `docs/artifacts/adr/ADR-1.md` | Record the architectural decision to use a two-contract model: authoritative AI output externally, normalized internal graph internally. |
| `docs/artifacts/specs/SPEC-1.md` | Describe the authoritative schema, the normalizer boundary, the new runtime artifact locations, and the updated migration phases. |
| `docs/artifacts/prd/PRD-2.md` | Product authority for the migration epic. |
| `docs/execution/plans/BACKLOG-2-authoritative-contract-migration.md` | Feature and story decomposition. |
| `docs/execution/plans/ISSUES-2-authoritative-contract-migration.md` | Tracker-ready issue bodies. |

## Phase-2 Adjacent Files

| File | Why not in the first implementation slice |
|------|-------------------------------------------|
| `app/assets/styles.css` | Visual system is unaffected by the contract boundary change. |
| `app/index.html` | Review shell can remain unchanged in phase 1. |
| `server.js` | API routes do not need a new surface for the compatibility-layer implementation. |
| `server/database.js` | Legacy persistence file is not the active runtime module. |

## Notes

- The goal of phase 1 is not to replace the internal graph. It is to make the current prompt contract compatible with the current app safely.
- The highest-risk files are `server/aiClient.js`, `server/extractionService.js`, and the new `server/aiDraftNormalizer.js` boundary because they control ingestion correctness.