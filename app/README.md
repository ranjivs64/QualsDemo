# QualExtract MVP

This folder contains a runnable local implementation based on the PRD, technical spec, and UX design.

## Run

From the repo root run:

```bash
npm start
```

Then open `http://localhost:3000`.

To validate AI provider connectivity before uploading a document:

```bash
npm run ai:check
```

Optional AI configuration:

```bash
set QUAL_AI_PROVIDER=openai
set OPENAI_API_KEY=your-key
set QUAL_AI_MODEL=gpt-5.1-2026-01-15
```

Azure AI Foundry configuration:

```bash
set QUAL_AI_PROVIDER=foundry
set FOUNDRY_API_KEY=your-key
set FOUNDRY_ENDPOINT=https://your-resource-name.openai.azure.com
set FOUNDRY_API_VERSION=2024-10-21
set QUAL_AI_MODEL=gpt-5
```

If you already have a full OpenAI-compatible Foundry base URL, you can use `FOUNDRY_BASE_URL` instead of `FOUNDRY_ENDPOINT`, but not both together.

If no AI credentials are configured, the app still runs locally, but extraction jobs stay in review with an `aiError` until a valid AI provider is configured.

## Implemented Flows

- Upload a PDF and create a real local extraction job through the API
- Parse uploaded PDFs and create a DB-backed extraction job
- Run an AI-backed structured extraction flow when OpenAI credentials are configured
- Review extracted qualification hierarchy
- Inspect and edit the low-confidence Unit 3 GLH field
- Verify the field and transition the job to ready-to-persist
- Approve and persist the job into history
- Read normalized persisted qualification records from the API
- Reprocess a job to simulate another extraction attempt
- Filter extraction history by status
- Reset the demo dataset from seeded PRD/spec-aligned data through the API

## Current Scope

This is a local implementation slice with a local API server, SQLite-backed workflow state, and file-backed upload artifacts.

- AI extraction supports either `OPENAI_API_KEY` or Azure AI Foundry via `QUAL_AI_PROVIDER=foundry`, `FOUNDRY_API_KEY`, `FOUNDRY_API_VERSION`, and either `FOUNDRY_ENDPOINT` or `FOUNDRY_BASE_URL`
- Uploaded PDFs are sent directly to the configured model, and local PDF parsing is used only for page count and source excerpt metadata
- If the AI path is unavailable or misconfigured, the job records the configuration error in extraction metadata instead of generating a heuristic qualification draft
- `npm run ai:check` performs a lightweight provider connectivity check against the configured model and exits non-zero if configuration or connectivity fails
- No authentication is wired yet

Runtime state is persisted in `server/data/qualextract.sqlite`.

Uploaded PDFs are retained under `server/uploads/` for one day.

Current API surface:

- `GET /api/v1/jobs`
- `GET /api/v1/ai-status`
- `POST /api/v1/jobs/upload`
- `GET /api/v1/jobs/:id`
- `POST /api/v1/jobs/:id/reprocess`
- `POST /api/v1/jobs/:id/approve`
- `PATCH /api/v1/jobs/:id/nodes/:nodeId`
- `POST /api/v1/jobs/:id/nodes/:nodeId/verify`
- `GET /api/v1/jobs/:id/artifact`
- `GET /api/v1/qualifications`
- `GET /api/v1/qualifications/:id`
- `POST /api/v1/reset`