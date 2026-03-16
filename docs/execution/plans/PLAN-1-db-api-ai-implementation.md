# Execution Plan: Real DB, API, and AI implementation

## Purpose

Turn the current JSON-backed MVP into a durable implementation slice with:
- SQLite-backed workflow and persistence state,
- a real extraction pipeline that can parse uploaded PDFs,
- an AI-backed structured extraction path behind prompts and schemas,
- and normalized qualification persistence for approved reviews.

## Progress

- [done] Baseline MVP and local upload flow exist.
- [done] Current runtime store state reviewed before new edits.
- [in-progress] Replace JSON job state with SQLite-backed persistence.
- [pending] Add AI extraction service with prompt/schema assets.
- [pending] Persist approved qualification graphs into normalized DB tables.
- [pending] Validate tests and live API flow.

## Surprises And Discoveries

- `server/store.json` contains live runtime data and must be treated as bootstrap input, not disposable seed-only state.
- Node 24 exposes `node:sqlite`, which keeps the DB slice dependency-light.

## Decision Log

- Use SQLite for the first real DB slice so the app remains local and runnable without external infrastructure.
- Keep the current `/api/v1/jobs` contract stable so the existing browser client continues to work.
- Add an OpenAI-compatible extraction path with prompt and schema files, plus a deterministic fallback when AI credentials are absent.

## Context And Orientation

- Current server is a single-file HTTP API plus `server/jobStore.js`.
- Current artifact storage is file-based under `server/uploads/` with 1-day retention.
- UI already supports upload, review, verify, reprocess, approve, and reset.

## Plan Of Work

1. Add SQLite initialization, schema bootstrap, and current-store import.
2. Refactor job operations to read and write through the DB.
3. Add extraction service with PDF text extraction and AI provider abstraction.
4. Persist approved qualifications into normalized tables and expose read APIs.
5. Update tests and runtime documentation.

## Concrete Steps

1. Install PDF parsing, AI client, and tracing packages.
2. Add `server/database.js`, `server/observability.js`, `server/aiClient.js`, and `server/extractionService.js`.
3. Replace `server/jobStore.js` JSON I/O with DB-backed operations.
4. Update `server.js` to queue real extraction processing and expose persisted qualification endpoints.
5. Update tests for DB-backed behavior and fallback extraction.

## Validation And Acceptance

- `npm test` passes.
- Upload creates a DB-backed processing job.
- Processing hydrates a review draft.
- Approval writes normalized qualification records.
- Persisted qualification endpoints return stored data.

## Idempotence And Recovery

- Existing `server/store.json` is used as first-run bootstrap input.
- Reset remains available through the API and reseeds the DB from `server/seed-data.json`.
- AI extraction failures fall back to deterministic extraction instead of leaving jobs orphaned.

## Artifacts And Notes

- DB file target: `server/data/qualextract.sqlite`
- Prompt file target: `prompts/qualification-extractor.md`
- Schema file target: `templates/qualification-extraction-schema.json`

## Outcomes And Retrospective

- To be updated after implementation and validation.