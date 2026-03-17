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

This repository now includes a GitHub Actions plus Bicep deployment path designed so the operator only supplies Azure subscription and resource group details at run time.

### What the deployment provisions

- Azure App Service plan
- Azure Web App for the Node.js API and static frontend
- Azure Key Vault for runtime secret storage
- Azure Application Insights for telemetry plumbing
- Azure OpenAI account
- Azure OpenAI model deployment used by the app

The app is still deployed as a single-instance MVP because it currently depends on:

- SQLite on a local filesystem
- local upload artifact storage
- in-process background scheduling

Do not scale this implementation out to multiple instances while it still uses SQLite and in-process job scheduling.

### Deployment files

- `.github/workflows/ci.yml` runs validation and tests
- `.github/workflows/deploy.yml` deploys infrastructure and application code
- `infra/main.bicep` defines the Azure resources
- `infra/environments/*.bicepparam` hold environment-specific parameters

### Manual inputs at deployment time

After the one-time GitHub and Azure trust setup is done, the operator only provides:

1. Azure subscription ID
2. Azure resource group name
3. Deployment environment: `dev`, `staging`, or `prod`

In workflow terms, those are the runtime values for `subscription_id` and `resource_group`, plus the environment selector.

Everything else is provisioned and wired automatically by the workflow and Bicep template.

### One-time GitHub and Azure setup

This repository now supports the simpler single-secret authentication path.

Use one GitHub secret named `AZURE_CREDENTIALS` that contains the Azure service principal JSON payload, then provide only subscription ID and resource group when you run the workflow.

Step by step:

1. Create an Azure service principal with deployment rights to the target subscription or resource group.
2. Export its credentials as the standard Azure JSON payload used by GitHub Actions.
3. In GitHub, create the deployment environments you want to use: `dev`, `staging`, and `prod`.
4. In each GitHub environment, add one secret named `AZURE_CREDENTIALS`.
5. Ensure the target Azure resource group already exists.
6. Run the workflow and provide only:
   - Azure subscription ID
   - Azure resource group name
   - deployment environment

The expected `AZURE_CREDENTIALS` JSON shape is:

```json
{
  "clientId": "<azure-client-id>",
  "clientSecret": "<azure-client-secret>",
  "tenantId": "<azure-tenant-id>",
  "subscriptionId": "<azure-subscription-id>"
}
```

The workflow uses the runtime `subscription_id` input when deploying, so the subscription ID in the JSON payload is informational for this repo's current flow.

If you want to create placeholder entries first and replace them later, run:

```powershell
pwsh ./scripts/bootstrap-github-deploy-placeholders.ps1 -Repository 'ranjivs64/QualsDemo'
```

This script creates the `dev`, `staging`, and `prod` GitHub environments if needed, then adds a placeholder `AZURE_CREDENTIALS` secret to each one.

### What you do not need to preconfigure

You do not need to preconfigure any AI-specific runtime settings in GitHub.

These values are created and populated by the deployment flow:

- `FOUNDRY_ENDPOINT`
- `FOUNDRY_API_VERSION`
- `FOUNDRY_MODEL`
- `FOUNDRY_API_KEY`

You also do not need to store `AZURE_SUBSCRIPTION_ID` as a GitHub variable because the workflow accepts the subscription ID as a runtime input.

### How to run the deployment

1. Open the GitHub repository.
2. Go to the Actions tab.
3. Select the `Deploy Azure Stack` workflow.
4. Click `Run workflow`.
5. Enter the Azure subscription ID.
6. Enter the Azure resource group name.
7. Choose the target environment.
8. Start the workflow.

### What the workflow does

1. Resolves the environment-specific parameter file.
2. Logs into Azure using the configured service principal.
3. Runs `az deployment group what-if` for a preview.
4. Deploys the App Service, Key Vault, Application Insights, and Azure OpenAI resources.
5. Reads deployment outputs including the web app name, Key Vault name, and Azure OpenAI account name.
6. Retrieves the generated Azure OpenAI key and stores it in Key Vault.
7. Packages the application.
8. Deploys the application to Azure Web App.

### Environment customization

Use the files under `infra/environments/` to adjust:

- naming suffixes
- tags
- App Service sizing
- environment-specific configuration values

If you need a different Azure OpenAI model or deployment capacity, update the defaults in `infra/main.bicep` and, if needed, override them through the environment parameter files.

### Post-deployment verification

After the workflow succeeds, verify:

1. `GET /api/v1/health` returns `ok`
2. `GET /api/v1/ai-status` reports `configured: true`
3. PDF upload enters processing and then review
4. artifact retrieval works
5. qualification approval persists correctly

### Recommended Azure staging topology

Use this topology for the current MVP:

- Azure App Service: single instance
- Azure OpenAI: one model deployment for extraction
- Application Insights: provisioned, but app observability is still partial

This topology is suitable for internal testing and controlled staging.

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

Additional Azure deployment note:

- Azure OpenAI model availability is region-dependent. If the configured model is unavailable in the chosen region, update the model defaults in `infra/main.bicep` before deploying.
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
