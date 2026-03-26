# QualExtract MVP

QualExtract MVP is a Node.js web application for extracting qualification structure from qualification PDFs, reviewing extracted qualification hierarchies with confidence signals, and persisting approved qualification records.

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
   - Inspect confidence and shared-structure signals
   - Approve reviewed records for persistence

2. HTTP server in `server.js`
   - Serves the browser application
   - Exposes JSON API endpoints under `/api/v1/*`
   - Schedules background extraction after upload

3. Extraction pipeline in `server/`
   - `extractionService.js` resolves the uploaded PDF artifact, derives lightweight metadata, and orchestrates extraction jobs
   - `aiClient.js` sends Document Intelligence markdown and workflow context to either OpenAI or Azure AI Foundry through the Responses API and validates the authoritative response
   - `aiDraftNormalizer.js` maps the authoritative AI contract into the internal review graph used by the UI and persistence flow

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
- Document analysis: Azure AI Document Intelligence `prebuilt-layout` with markdown output
- Telemetry: OpenTelemetry API and Node tracer provider

Important implementation notes:

- The app currently uses local file storage for uploads.
- The app currently uses SQLite for persistence.
- Background extraction is scheduled in-process with `setTimeout(...)`.
- Qualification extraction now requires both Azure AI Document Intelligence and a configured LLM provider, plus an uploaded PDF artifact.
- The uploaded PDF is first analyzed by Azure AI Document Intelligence, and the resulting structured markdown is then passed to the model; the app no longer generates heuristic qualification drafts.
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
QUAL_AI_TIMEOUT_MS=300000
DOCUMENT_INTELLIGENCE_ENDPOINT=https://<your-document-intelligence-resource>.cognitiveservices.azure.com
DOCUMENT_INTELLIGENCE_API_KEY=<your-document-intelligence-key>
DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30
DOCUMENT_INTELLIGENCE_MODEL=prebuilt-layout
DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT=markdown
DOCUMENT_INTELLIGENCE_TIMEOUT_MS=300000
FOUNDRY_API_KEY=<your-foundry-key>
FOUNDRY_ENDPOINT=https://<your-resource-name>.openai.azure.com
FOUNDRY_API_VERSION=2025-03-01-preview
QUAL_AI_MODEL=gpt-5
QUAL_DB_PATH=server/data/qualextract.sqlite
QUAL_UPLOADS_DIR=server/uploads
```

Example using OpenAI:

```env
QUAL_AI_PROVIDER=openai
QUAL_AI_TIMEOUT_MS=300000
DOCUMENT_INTELLIGENCE_ENDPOINT=https://<your-document-intelligence-resource>.cognitiveservices.azure.com
DOCUMENT_INTELLIGENCE_API_KEY=<your-document-intelligence-key>
DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30
DOCUMENT_INTELLIGENCE_MODEL=prebuilt-layout
DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT=markdown
DOCUMENT_INTELLIGENCE_TIMEOUT_MS=300000
OPENAI_API_KEY=<your-openai-key>
QUAL_AI_MODEL=gpt-5.1-2026-01-15
QUAL_DB_PATH=server/data/qualextract.sqlite
QUAL_UPLOADS_DIR=server/uploads
```

Notes:

- Azure OpenAI extraction uses the Responses API. When you configure Foundry via `FOUNDRY_ENDPOINT`, use `FOUNDRY_API_VERSION=2025-03-01-preview` or later.
- Azure AI Document Intelligence should use `DOCUMENT_INTELLIGENCE_MODEL=prebuilt-layout` with `DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT=markdown` so the LLM receives preserved headings, tables, and page boundaries.
- For Azure deployments in this repo, set both `QUAL_AI_TIMEOUT_MS` and `DOCUMENT_INTELLIGENCE_TIMEOUT_MS` to `300000`; that is the validated large-document budget currently codified in Bicep.
- The code-level fallback remains `120000` if you omit those variables outside the Azure deployment path.
- Use either `FOUNDRY_ENDPOINT` or `FOUNDRY_BASE_URL`, not both.
- If Document Intelligence or the LLM provider is not configured, the app still runs, but extraction jobs remain in review with an `aiError` until configuration is fixed.

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

After the one-time GitHub and Azure trust setup is done, the operator can either provide runtime inputs or rely on repository-level GitHub variables for the Azure subscription and resource group.

Runtime inputs:

1. Azure subscription ID
2. Azure resource group name
3. Deployment environment: `dev`, `staging`, or `prod`

If you store them as repository variables instead, the workflow also supports:

- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP` or `RESOURCE_GROUP`

In workflow terms, `subscription_id` and `resource_group` can now come from either runtime inputs or repository variables, plus the environment selector.

The workflow also accepts these same values from repository secrets if that is how they are currently stored.

Everything else is provisioned and wired automatically by the workflow and Bicep template.

### One-time GitHub and Azure setup

This repository supports both secret-based login and GitHub OIDC. OIDC is the better path when you already have a federated credential on the Azure app registration.

Use either:

- GitHub OIDC with repository-level `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`, plus either the workflow `subscription_id` input or the repository variable `AZURE_SUBSCRIPTION_ID`
- repository secret `AZURE_CLIENT_SECRET` together with `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`
- one repository secret named `AZURE_CREDENTIALS` containing the Azure service principal JSON payload

Step by step:

1. Create an Azure app registration or service principal with deployment rights to the target subscription or resource group.
2. If using OIDC, add a federated credential that trusts this GitHub repository and branch.
3. At the repository level, add either:
   - OIDC configuration `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`, or
   - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and repository secret `AZURE_CLIENT_SECRET`, or
   - one secret named `AZURE_CREDENTIALS`
4. At the repository level, add `AZURE_SUBSCRIPTION_ID` and `AZURE_RESOURCE_GROUP` as variables or secrets if you do not want to pass them as workflow inputs.
5. Ensure the target Azure resource group already exists.
6. Run the workflow and either:
   - provide Azure subscription ID and Azure resource group as workflow inputs, or
   - leave them blank and rely on repository configuration `AZURE_SUBSCRIPTION_ID` and `AZURE_RESOURCE_GROUP`
7. Choose the deployment environment

The expected `AZURE_CREDENTIALS` JSON shape is:

```json
{
  "clientId": "<azure-client-id>",
  "clientSecret": "<azure-client-secret>",
   "tenantId": "<azure-tenant-id>",
   "subscriptionId": "<azure-subscription-id>"
}
```

When `AZURE_CREDENTIALS` is present, the workflow can also use its `subscriptionId` field as the default deployment subscription if you do not pass `subscription_id` and have not set `AZURE_SUBSCRIPTION_ID` separately.

The infrastructure template defaults Azure OpenAI deployments to `GlobalStandard`, which is the supported deployment type for the current `gpt-5` configuration in the selected region.

The workflow prefers runtime inputs when provided, otherwise it falls back to repository variables or repository secrets for subscription and resource group. The subscription ID inside `AZURE_CREDENTIALS` remains informational for this repo's current flow.

If you use GitHub OIDC instead of `AZURE_CREDENTIALS`, configure these at the repository level:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`

You do not need `AZURE_CLIENT_SECRET` for OIDC.

If your federated credential is not set up yet, you can also use a repository secret named `AZURE_CLIENT_SECRET` together with `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` to authenticate without OIDC.

If you want to create placeholder entries first and replace them later, run:

```powershell
pwsh ./scripts/bootstrap-github-deploy-placeholders.ps1 -Repository 'ranjivs64/QualsDemo'
```

This script creates the `dev`, `staging`, and `prod` GitHub environments if needed, then adds a placeholder `AZURE_CREDENTIALS` secret to each one.

If you use repository-level configuration, you do not need GitHub Actions environments for deployment authentication.

### What you do not need to preconfigure

You do not need to preconfigure any AI-specific runtime settings in GitHub.

These values are created and populated by the deployment flow:

- `FOUNDRY_ENDPOINT`
- `FOUNDRY_API_VERSION`
- `FOUNDRY_MODEL`
- `FOUNDRY_API_KEY`

The default infrastructure value for `FOUNDRY_API_VERSION` is `2025-03-01-preview`, which is the minimum Azure preview API version that exposes the Responses API used by live PDF extraction.

You do not need to store `AZURE_SUBSCRIPTION_ID` or `AZURE_RESOURCE_GROUP` at the repository level if you prefer passing them at workflow runtime, but the workflow supports both approaches.

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
