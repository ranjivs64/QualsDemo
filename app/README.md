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
set QUAL_AI_TIMEOUT_MS=120000
set DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-document-intelligence-resource.cognitiveservices.azure.com
set DOCUMENT_INTELLIGENCE_API_KEY=your-document-intelligence-key
set DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30
set DOCUMENT_INTELLIGENCE_MODEL=prebuilt-layout
set DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT=markdown
set DOCUMENT_INTELLIGENCE_TIMEOUT_MS=120000
set OPENAI_API_KEY=your-key
set QUAL_AI_MODEL=gpt-5.1-2026-01-15
```

Azure AI Foundry configuration:

```bash
set QUAL_AI_PROVIDER=foundry
set QUAL_AI_TIMEOUT_MS=120000
set DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-document-intelligence-resource.cognitiveservices.azure.com
set DOCUMENT_INTELLIGENCE_API_KEY=your-document-intelligence-key
set DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30
set DOCUMENT_INTELLIGENCE_MODEL=prebuilt-layout
set DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT=markdown
set DOCUMENT_INTELLIGENCE_TIMEOUT_MS=120000
set FOUNDRY_API_KEY=your-key
set FOUNDRY_ENDPOINT=https://your-resource-name.openai.azure.com
set FOUNDRY_API_VERSION=2025-03-01-preview
set QUAL_AI_MODEL=gpt-5
```

If you already have a full OpenAI-compatible Foundry base URL, you can use `FOUNDRY_BASE_URL` instead of `FOUNDRY_ENDPOINT`, but not both together.

Use `2025-03-01-preview` or later for `FOUNDRY_API_VERSION` because the live extraction flow calls the Azure Responses API rather than the older chat-only route.
Keep `QUAL_AI_TIMEOUT_MS` at `120000` or higher for larger PDF extraction jobs.
Keep `DOCUMENT_INTELLIGENCE_TIMEOUT_MS` at `120000` or higher for larger PDF extraction jobs, and keep `DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT=markdown` so layout structure reaches the LLM.

If Document Intelligence or the LLM credentials are not configured, the app still runs locally, but extraction jobs stay in review with an `aiError` until both stages are configured.

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
- Uploaded PDFs are analyzed by Azure AI Document Intelligence first, and the resulting structured markdown is sent to the configured model
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