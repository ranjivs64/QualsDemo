# Solution Review -- QualExtract MVP
**Date**: 2026-03-17 (v2 -- updated after re-review)
**Scope**: Full solution audit (server, infra, CI/CD, tests, config, workspace state)
**Status**: CHANGES REQUESTED
**Tests**: 16/16 PASS

---

## Auto-Applied Fixes (this review pass)

| # | File | Change | Verdict |
|---|------|--------|---------|
| 1 | `.env.example` | `QUAL_AI_MODEL` corrected from `gpt-5.1-2026-01-15` to `gpt-4o-mini` (matches Bicep) | [PASS] committed |
| 2 | `.gitignore` | Removed AgentX-generated block that contained `.github/workflows/` -- new CI files would have been silently untracked | [PASS] committed (bcbe1a9) |

---

## Findings

### [HIGH] No Authentication or Authorization on Any Endpoint

**File**: `server.js` -- all `handleApi` routes

Every API endpoint is fully public. Any reachable caller can:
- List and download all extraction jobs and persisted qualifications
- Upload PDFs and trigger AI extraction (costing Azure OpenAI quota)
- Modify node fields, verify nodes, and approve jobs (database writes)
- Trigger the destructive reset (see next finding)

**Recommendation**: At minimum, static bearer-token check (`Authorization: Bearer <env var>`) for all `/api/v1/` routes. For production, use Azure App Service Easy Auth (Entra ID) -- zero application code change, configured in Bicep on the `webApp` resource.

---

### [HIGH] Unprotected Destructive Reset Endpoint

**File**: `server.js` -- `POST /api/v1/reset`

Wipes all jobs and qualification records with no token, role check, or confirmation. In any shared environment this is a data loss risk.

**Recommendation**: Remove from production or gate behind an admin token. At minimum:
```js
if (process.env.NODE_ENV === 'production') {
  sendProblem(res, 404, 'Not Found', 'API endpoint was not found.');
  return;
}
```

---

### [HIGH] No Rate Limiting

**File**: `server.js` -- upload handler

`POST /api/v1/jobs/upload` accepts 50 MB PDFs with no per-IP or global rate limit. A caller can:
1. Exhaust disk space (uploads directory has no total-size cap)
2. Burn Azure OpenAI token quota (each upload triggers an extraction job)

**Recommendation**: Add a simple in-process token-bucket limiter on the upload endpoint. For the Azure App Service path, App Service Front Door or API Management can handle this without code changes.

---

### [HIGH -- FIXED] `.gitignore` Excluded CI/CD Workflows

**Status**: Fixed in commit `bcbe1a9`

AgentX re-initialization added a block to `.gitignore` that contained `.github/workflows/`. The two app workflows (`ci.yml`, `deploy.yml`) were already tracked and unaffected, but any new or renamed workflow file would have been silently untracked. Fixed by removing the entire AgentX block.

---

### [MEDIUM] Untracked AgentX Re-Init Files Need Resolution

**Status**: Workspace has ~20 untracked files from a partial AgentX re-initialization.

Files present but uncommitted:
- `.agentx/` -- AgentX CLI runtime
- `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/agent-delegation.md`, `.github/agentx-security.yml`
- `.github/hooks/` -- pre-commit hook (already active)
- `.github/ISSUE_TEMPLATE/`
- 11 additional AgentX workflow files in `.github/workflows/`
- `AGENTS.md`, `Skills.md` at workspace root
- `docs/GUIDE.md`, `docs/WORKFLOW.md`

**Note**: The pre-commit hook from `.github/hooks/` is already active and enforcing issue-reference validation on commits, which is affecting the current development workflow.

**Decision required**: Either commit these as an intentional AgentX setup (and update the README to document the workflow tooling), or clean them up with `Remove-Item .agentx, AGENTS.md, Skills.md, docs/GUIDE.md, docs/WORKFLOW.md, .github/CODEOWNERS, .github/PULL_REQUEST_TEMPLATE.md, .github/agent-delegation.md, .github/agentx-security.yml -Recurse -Force` and `Remove-Item .github/hooks, .github/ISSUE_TEMPLATE, .github/workflows/agent-*.yml, .github/workflows/auto-release.yml, .github/workflows/copilot-setup-steps.yml, .github/workflows/dependency-scanning.yml, .github/workflows/issue-closeout-audit.yml, .github/workflows/issue-triage.yml, .github/workflows/publish-marketplace.yml, .github/workflows/quality-gates.yml, .github/workflows/scorecard.yml, .github/workflows/skill-factory.yml, .github/workflows/weekly-status.yml -Recurse -Force` then uninstall the git hook with `Remove-Item .git/hooks/pre-commit`.

---

### [MEDIUM] `cleanupExpiredArtifacts()` Runs on Every API Request

**File**: `server.js` -- `handleApi()` first line

Synchronous directory read + file stat/unlink on every incoming request, including lightweight reads like `GET /api/v1/health`. Adds unnecessary I/O overhead at scale.

**Recommendation**:
```js
// At server startup:
setInterval(cleanupExpiredArtifacts, 10 * 60 * 1000); // every 10 min
// Remove the call from handleApi()
```

---

### [MEDIUM] App Insights Provisioned but No Exporter Wired

**File**: `server/observability.js`

Bicep provisions App Insights and injects `APPLICATIONINSIGHTS_CONNECTION_STRING`, but the tracer has no exporter:
```js
const provider = new NodeTracerProvider();
provider.register(); // no exporter -- all spans discarded silently
```

**Recommendation**: Add `@azure/monitor-opentelemetry` to `package.json` and call `useAzureMonitor()` before the provider registration. The connection string is already wired by the pipeline.

---

### [MEDIUM] No HTTP-Level Integration Tests

**File**: `tests/` directory

The 16 tests cover AI client config, job lifecycle, and text extraction. Not covered:
- `server.js` routing, multipart parsing, error handling (400/404/409/413/422/500)
- Path traversal protection (`serveStaticFile`)
- Upload -> approve workflow end-to-end via HTTP
- `uploadStore.js` file lifecycle and path traversal guard

**Recommendation**: Add `tests/server.test.js` that starts the HTTP server on a random port and exercises the API surface with native `node:http`.

---

### [MEDIUM] AI Client Timeout Too Short for Extraction

**File**: `server/aiClient.js` -- `getClient()`

```js
timeout: 15000 // 15 seconds
```

The extraction call sends up to 20,000 characters and waits for a full structured JSON response. Azure OpenAI p95 latency for this workload exceeds 15 seconds on complex documents, causing false timeout failures.

**Recommendation**: Set `timeout: 60000` for the extraction client. The connectivity check call uses `max_tokens: 8` and can keep a shorter timeout by using a separate lightweight client instance.

---

### [MEDIUM] Model Version Availability Risk in `uksouth`

**File**: `infra/main.bicep`

```bicep
param foundryModel string = 'gpt-4o-mini'
param foundryModelVersion string = '2024-07-18'
```

Model version `2024-07-18` for `gpt-4o-mini` is not guaranteed available in `uksouth`. An unavailable version causes the `openAiDeployment` resource to fail during Bicep deployment.

**Recommendation**: Verify availability with `az cognitiveservices account list-models --location uksouth --query "[?name=='gpt-4o-mini'].{version:version}" -o table`, or remove `foundryModelVersion` and let Azure select the default available version.

---

### [MEDIUM] SQLite `DatabaseSync` Blocks the Event Loop on Every DB Call

**File**: `server/database.js`

`node:sqlite` `DatabaseSync` is fully synchronous. All `prepare().run()` and `.get()` calls block the event loop. For a single-user MVP this is acceptable; at any concurrent load, multi-insert operations like `persistApprovedQualification` will stall all other requests.

**Recommendation**: Document the single-instance constraint in the README. Production path should migrate to async SQLite (`better-sqlite3` with worker threads) or PostgreSQL.

---

### [LOW] Missing Content-Security-Policy Header

**File**: `server.js` -- `sendJson()` and `serveStaticFile()`

`X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` are set, but `Content-Security-Policy` is absent. XSS in the frontend has no browser-level mitigation.

**Recommendation**: Add to all responses:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'
```

---

### [LOW] `Content-Disposition` Filename Allows Header Injection

**File**: `server.js` -- artifact download route

```js
const safeFileName = String(job.artifact.originalFileName || "").replace(/["\r\n]/g, "");
```

Semicolons are not stripped. A crafted filename like `file.pdf; filename=evil.exe` injects extra `Content-Disposition` parameters in some clients.

**Recommendation**: Reuse `sanitizeFileName()` from `uploadStore.js` instead of the raw `originalFileName`.

---

### [LOW] `uploadStore.js` Has No Test Coverage

Security-relevant functions (`resolveArtifactPath` path-traversal guard, `sanitizeFileName`, `cleanupExpiredArtifacts`) have no direct tests.

**Recommendation**: Add `tests/uploadStore.test.js` covering: save + resolve round-trip, `sanitizeFileName` with path-traversal inputs (`../../../etc/passwd`, null bytes), expiry cleanup.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| HIGH | 3 remaining (1 fixed) | Auth, reset, rate limiting -- UNRESOLVED |
| MEDIUM | 6 | Cleanup cadence, App Insights, HTTP tests, AI timeout, model version, SQLite blocking |
| LOW | 3 | CSP header, Content-Disposition, uploadStore tests |

---

## Decision: CHANGES REQUESTED

**Blockers for production deployment**: The 3 HIGH findings (authentication, unprotected reset, rate limiting) must be resolved first.

**Workspace hygiene (required before next commit)**: Decide on AgentX untracked files -- either commit them or clean them up. The active pre-commit hook will continue to require issue references on all commits until the hook is removed or the enforcement flag is toggled off.

**What is solid**: Test coverage for core logic is good (16/16). Input validation on uploads, path traversal protection, graceful AI fallback, Bicep/CI-CD pipeline structure, and security headers (minus CSP) are all well-implemented.
