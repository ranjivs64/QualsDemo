# QualExtract MVP

QualExtract MVP is a Node.js web application for extracting qualification structure from qualification PDFs, reviewing low-confidence fields, and persisting approved qualification records.

The current implementation is optimized for local development and internal staging. It supports:

- PDF upload and transient artifact retention
- SQLite-backed job and qualification persistence
- AI-assisted extraction through either OpenAI or Azure AI Foundry
- Human-in-the-loop review before approval and persistence
- A lightweight browser UI served by the same Node.js process

## Solution Overview

The solution has four main parts:

1. Web UI in `app/`
   - Upload PDFs
   - Review extracted qualification hierarchy
   - Verify low-confidence fields
   - Approve persisted records

2. HTTP server in `server.js`
   - Serves the browser application
   - Exposes JSON API endpoints under `/api/v1/*`
   - Schedules background extraction after upload

3. Extraction pipeline in `server/`
   - `extractionService.js` parses PDF text and builds draft structures
   - `aiClient.js` routes extraction to either OpenAI or Azure AI Foundry
   - Fallback extraction remains available when AI is not configured

4. Persistence and artifacts
   - SQLite database at `QUAL_DB_PATH`
   - Uploaded PDFs retained in `QUAL_UPLOADS_DIR`
   - One-day upload retention cleanup

## Current Architecture

Current runtime characteristics:

- Runtime: Node.js
- HTTP layer: built-in `node:http`
- Database: SQLite via `node:sqlite`
- AI SDK: `openai` package with `OpenAI` and `AzureOpenAI`
- PDF parsing: `pdf-parse`
- Telemetry: OpenTelemetry API and Node tracer provider

Important implementation notes:

- The app currently uses local file storage for uploads.
- The app currently uses SQLite for persistence.
- Background extraction is scheduled in-process with `setTimeout(...)`.
- The app is suitable today for local use and internal single-instance staging.
- The app is not yet approved for public production exposure.

## Repository Layout

```text
app/                     Browser UI and local app runbook
docs/                    PRD, ADR, spec, UX, review artifacts
prompts/                 Prompt files for AI extraction
scripts/                 Utility scripts such as AI connectivity checks
server/                  Extraction, persistence, uploads, observability
templates/               JSON schema for extraction output
tests/                   Node test suite
server.js                HTTP server entry point
```

## Prerequisites

Local prerequisites:

- Node.js 24 or a runtime that supports `node:sqlite`
- npm
- Azure CLI if you want to deploy to Azure
- An OpenAI API key or Azure AI Foundry deployment if you want live AI extraction

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a local environment file

Create a `.env` file based on `.env.example`.

Example using Azure AI Foundry:

```env
QUAL_AI_PROVIDER=foundry
FOUNDRY_API_KEY=<your-foundry-key>
FOUNDRY_ENDPOINT=https://<your-project>.inference.ai.azure.com
FOUNDRY_API_VERSION=2024-12-01-preview
QUAL_AI_MODEL=gpt-5.1-2026-01-15
QUAL_DB_PATH=server/data/qualextract.sqlite
QUAL_UPLOADS_DIR=server/uploads
```

Example using OpenAI:

```env
QUAL_AI_PROVIDER=openai
OPENAI_API_KEY=<your-openai-key>
QUAL_AI_MODEL=gpt-5.1-2026-01-15
QUAL_DB_PATH=server/data/qualextract.sqlite
QUAL_UPLOADS_DIR=server/uploads
```

Notes:

- Use either `FOUNDRY_ENDPOINT` or `FOUNDRY_BASE_URL`, not both.
- If no AI provider is configured, the app falls back to deterministic extraction logic.

### 3. Validate AI connectivity

```bash
npm run ai:check
```

This performs a lightweight connectivity check against the configured model and exits non-zero if configuration or connectivity fails.

### 4. Start the app

```bash
npm start
```

Open:

```text
http://localhost:3000
```

### 5. Run tests

```bash
npm test
```

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No | HTTP port. Defaults to `3000`. |
| `QUAL_AI_PROVIDER` | No | `openai` or `foundry`. Defaults by environment detection. |
| `OPENAI_API_KEY` | For OpenAI | OpenAI API key. |
| `OPENAI_BASE_URL` | Optional | Alternate OpenAI-compatible base URL. |
| `FOUNDRY_API_KEY` | For Foundry | Azure AI Foundry API key. |
| `FOUNDRY_BASE_URL` | Optional | Full OpenAI-compatible Foundry base URL. |
| `FOUNDRY_ENDPOINT` | Optional | Foundry endpoint for `AzureOpenAI`. |
| `FOUNDRY_API_VERSION` | For Foundry | Azure API version. |
| `QUAL_AI_MODEL` | Yes for live AI | Model or deployment name. For Foundry this must match the deployment name. |
| `QUAL_DB_PATH` | No | SQLite database path. |
| `QUAL_UPLOADS_DIR` | No | Upload artifact directory. |

## API Summary

Current API surface:

- `GET /api/v1/health`
- `GET /api/v1/jobs`
- `GET /api/v1/jobs/:id`
- `POST /api/v1/jobs/upload`
- `POST /api/v1/jobs/:id/reprocess`
- `POST /api/v1/jobs/:id/approve`
- `PATCH /api/v1/jobs/:id/nodes/:nodeId`
- `POST /api/v1/jobs/:id/nodes/:nodeId/verify`
- `GET /api/v1/jobs/:id/artifact`
- `GET /api/v1/ai-status`
- `GET /api/v1/qualifications`
- `GET /api/v1/qualifications/:id`
- `POST /api/v1/reset`

## Cloud Deployment Guide

This section documents the most practical cloud setup for the current codebase.

### Recommended current cloud posture

For the current MVP, use:

- Azure App Service for hosting
- Azure AI Foundry for model hosting
- App Service persistent storage under `/home` for SQLite and uploads
- A single app instance only

This is the simplest path because the app currently depends on:

- SQLite on a local filesystem
- local upload artifact storage
- in-process background scheduling

Do not scale this implementation out to multiple instances while it still uses SQLite and in-process job scheduling.

### Before you deploy

You need:

1. An Azure subscription
2. An Azure resource group
3. An Azure AI Foundry model deployment
4. An Azure App Service plan and Web App
5. App settings for database path, uploads path, and AI configuration

### Step 1. Sign in and choose a subscription

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

### Step 2. Create a resource group

```bash
az group create --name rg-qualsdemo-dev --location uksouth
```

### Step 3. Prepare Azure AI Foundry

In Azure AI Foundry:

1. Create or open your Foundry project.
2. Deploy the model you want to use, for example GPT-5.1.
3. Record the following values:
   - deployment name
   - endpoint
   - API key
   - API version

You will use those values in the App Service application settings.

### Step 4. Create an App Service plan

```bash
az appservice plan create \
  --name asp-qualsdemo-dev \
  --resource-group rg-qualsdemo-dev \
  --sku B1 \
  --is-linux
```

### Step 5. Create the Web App

Use a Node runtime that supports `node:sqlite`. If your region does not expose a suitable managed Node runtime, deploy the app with a custom container pinned to Node 24.

Example managed runtime deployment:

```bash
az webapp create \
  --resource-group rg-qualsdemo-dev \
  --plan asp-qualsdemo-dev \
  --name qualsdemo-dev-<unique-suffix> \
  --runtime "NODE|24-lts"
```

If `NODE|24-lts` is not available in your region, create the Web App with the closest supported runtime and switch to a containerized deployment before go-live.

### Step 6. Configure application settings

Set the app settings so SQLite and uploads are stored on the persistent App Service file system under `/home`.

```bash
az webapp config appsettings set \
  --resource-group rg-qualsdemo-dev \
  --name qualsdemo-dev-<unique-suffix> \
  --settings \
    NODE_ENV=production \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
    QUAL_AI_PROVIDER=foundry \
    FOUNDRY_API_KEY="<foundry-key>" \
    FOUNDRY_ENDPOINT="https://<your-project>.inference.ai.azure.com" \
    FOUNDRY_API_VERSION=2024-12-01-preview \
    QUAL_AI_MODEL="gpt-5.1-2026-01-15" \
    QUAL_DB_PATH="/home/site/data/qualextract.sqlite" \
    QUAL_UPLOADS_DIR="/home/site/uploads"
```

Optional telemetry setting for future observability work:

```bash
az webapp config appsettings set \
  --resource-group rg-qualsdemo-dev \
  --name qualsdemo-dev-<unique-suffix> \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING="<app-insights-connection-string>"
```

### Step 7. Enforce HTTPS

```bash
az webapp update \
  --resource-group rg-qualsdemo-dev \
  --name qualsdemo-dev-<unique-suffix> \
  --https-only true
```

### Step 8. Package and deploy the code

From the repo root:

PowerShell:

```powershell
Compress-Archive -Path app,docs,prompts,scripts,server,templates,tests,package.json,package-lock.json,server.js -DestinationPath .\qualsdemo.zip -Force
```

Deploy the package:

```bash
az webapp deploy \
  --resource-group rg-qualsdemo-dev \
  --name qualsdemo-dev-<unique-suffix> \
  --src-path qualsdemo.zip \
  --type zip
```

### Step 9. Verify the app after deployment

Check the health endpoint:

```bash
curl https://qualsdemo-dev-<unique-suffix>.azurewebsites.net/api/v1/health
```

Check AI status:

```bash
curl https://qualsdemo-dev-<unique-suffix>.azurewebsites.net/api/v1/ai-status
```

You should see:

- health status `ok`
- AI provider `foundry`
- `configured: true` in AI status

### Step 10. Validate runtime behavior

After the app is live:

1. Open the site in a browser.
2. Upload a PDF.
3. Confirm the job enters `processing` and then `review`.
4. Confirm uploaded artifacts open correctly.
5. Confirm approval persists a qualification record.

## Recommended Azure Staging Topology

Use this topology for the current MVP:

- Azure App Service: single instance
- Azure AI Foundry: model deployment for extraction
- Azure Monitor / Application Insights: optional, not fully wired in code yet

This topology is valid for internal testing and controlled staging.

## Production Constraints and Upgrade Path

The current codebase is not yet ready for public production deployment.

Known blockers:

- no authentication or authorization on API routes
- `POST /api/v1/reset` remains available
- no request rate limiting
- SQLite plus in-process scheduling only supports a single instance safely
- upload artifacts remain on local app storage
- OpenTelemetry is initialized but no exporter is wired

Recommended production upgrade path:

1. Add authentication and authorization
2. Remove or gate `POST /api/v1/reset`
3. Add request rate limiting
4. Replace SQLite with a managed relational database
5. Replace local upload storage with cloud object storage
6. Replace in-process scheduling with a real queue or worker pattern
7. Wire telemetry to Application Insights

## Suggested Production Target on Azure

When you are ready to harden the solution, move toward:

- Azure App Service or Azure Container Apps for the app
- Azure Database for PostgreSQL or Azure SQL for persistence
- Azure Blob Storage for uploaded PDFs
- Azure AI Foundry for model hosting and evaluation
- Microsoft Entra ID for authentication
- Azure Monitor / Application Insights for telemetry

## Troubleshooting

### `npm run ai:check` fails

Check:

- `QUAL_AI_PROVIDER`
- model or deployment name in `QUAL_AI_MODEL`
- Foundry endpoint or base URL
- API key
- API version

### App starts locally but not in Azure

Check:

- App Service runtime supports `node:sqlite`
- `QUAL_DB_PATH` points to a writable path
- `QUAL_UPLOADS_DIR` points to a writable path
- App settings were actually applied
- deployment logs show `npm install` and startup success

### Uploads disappear after restart

This usually means the app is writing to a non-persistent location. Ensure:

- `QUAL_DB_PATH` is under `/home/site/...`
- `QUAL_UPLOADS_DIR` is under `/home/site/...`

### Multiple users or multiple instances cause inconsistent behavior

That is expected with the current MVP architecture. Move persistence and job processing to managed services before scaling out.

## Related Documents

- `app/README.md` - local app notes and API summary
- `docs/artifacts/prd/PRD-1.md` - product requirements
- `docs/artifacts/adr/ADR-1.md` - architectural rationale
- `docs/artifacts/specs/SPEC-1.md` - technical specification
- `docs/artifacts/reviews/REVIEW-prod-readiness.md` - production readiness review
