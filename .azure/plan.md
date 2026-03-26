# Azure Deployment Plan

## 1. Summary

- Workload: QualExtract MVP
- Goal: provision and deploy a separate `staging` environment that can run alongside the existing `dev` environment
- Scope: Bicep infrastructure deployment plus zip-package App Service deployment
- Status: Deployed

## 2. Azure Context

- Subscription: operator-provided at deploy time
- Resource group: `rg-QualsDemo`
- Location: `centralus`
- Environment: `staging`

## 3. Recipe

- Type: Bicep + Azure CLI App Service package deploy
- Infrastructure entrypoint: `infra/main.bicep`
- Environment parameter file: `infra/environments/staging.bicepparam`
- Application package flow: install production dependencies, zip workspace, `az webapp deploy`

## 4. Architecture Decisions

- `staging` must be a separate App Service deployment with its own App Service plan, Key Vault, Application Insights instance, Azure OpenAI account, and Document Intelligence account.
- `staging` must remain isolated from `dev` for uploads, SQLite data, and extraction job state.
- The current MVP remains single-instance per environment because it uses local filesystem uploads, SQLite, and in-process background jobs.
- `staging` is intended for internal validation and side-by-side comparison, not shared persistence with `dev`.

## 5. Planned Changes

- Update PRD to define side-by-side environment support and environment isolation requirements.
- Update ADR to describe the deployment topology and environment isolation consequences.
- Update technical spec to document the current multi-environment Azure shape and staging operating model.
- Set `nodeEnvironment = 'staging'` in `infra/environments/staging.bicepparam`.
- Validate Bicep and application tests.
- Deploy infrastructure and application package to the `staging` environment.

## 6. Execution Checklist

- [x] Analyze existing deployment workflow and Bicep parameters
- [x] Confirm `staging` parameter file exists
- [x] Apply documentation and infrastructure updates
- [x] Run local validation
- [x] Run Azure infrastructure validation
- [x] Deploy staging infrastructure
- [x] Deploy staging application package
- [x] Smoke test staging endpoints

## 7. Validation Proof

- `npm test` in a clean process-scoped environment: 36/36 tests passed.
- `az bicep build --file infra/main.bicep`: passed.
- `az deployment group what-if --resource-group rg-QualsDemo --template-file infra/main.bicep --parameters infra/environments/staging.bicepparam`: passed with staging-only creates.
- `az deployment group create --resource-group rg-QualsDemo --template-file infra/main.bicep --parameters infra/environments/staging.bicepparam`: passed.

## 8. Deployment Proof

- Infrastructure outputs:
	- Web app: `app-qualsdemo-staging-52r22h`
	- Hostname: `app-qualsdemo-staging-52r22h.azurewebsites.net`
	- App Service plan: `asp-qualsdemo-staging`
	- App Insights: `appi-qualsdemo-staging`
	- Key Vault: `kvqualsdemostaging52r22h`
	- Azure OpenAI: `aoaiqualsdemostaging52r2`
	- Document Intelligence: `diqualsdemostaging52r22h`
- `az webapp deploy --resource-group rg-QualsDemo --name app-qualsdemo-staging-52r22h --src-path <zip> --track-status false --type zip`: passed.
- `GET /api/v1/health`: `200`, body `{"status":"ok","uptime":97}`.
- `GET /api/v1/ai-status`: `200`, `configured: true` for both Foundry and Document Intelligence.
- `GET /`: `200`, app shell served successfully.
- Smoke upload `job-1774216039744`: progressed to `review` with `reviewReady=true` in staging.