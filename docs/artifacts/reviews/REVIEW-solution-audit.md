# Solution Review -- QualExtract MVP
**Date**: 2026-03-17
**Scope**: Full solution audit (server, infra, CI/CD, tests, config)
**Status**: CHANGES REQUESTED

---

## Auto-Applied Fixes

| # | File | Change | Verified |
|---|------|--------|---------|
| 1 | `.env.example` | `QUAL_AI_MODEL` corrected from `gpt-5.1-2026-01-15` to `gpt-4o-mini` to match Bicep deployment | [PASS] |

---

## Findings

### [HIGH] No Authentication or Authorization on Any Endpoint

**File**: `server.js` -- all `handleApi` routes

Every API endpoint is fully public. Any person or bot that reaches the server URL can:
- List, read, and download all extraction jobs and persisted qualifications (`GET /api/v1/jobs`, `GET /api/v1/qualifications`)
- Upload PDFs and trigger AI extraction
- Modify node fields, verify nodes, and approve jobs (which writes to the database)
- Access the destructive reset endpoint (see below)

**Recommendation**: Add at minimum a static bearer-token check (env var) for all `/api/v1/` routes before deployment to a shared environment. For production, use Azure AD / Entra ID authentication via App Service built-in auth (`easyAuth`) -- zero code change, configured in the App Service resource.

---

### [HIGH] Unprotected Destructive Reset Endpoint

**File**: `server.js` line ~`POST /api/v1/reset`

`POST /api/v1/reset` wipes all jobs and qualification records. There is no token, role check, or confirmation required. In production this is a data loss risk.

**Recommendation**: Remove from production builds entirely, or gate it behind an admin token (`Authorization: Bearer <QUAL_ADMIN_TOKEN>`). Add `NODE_ENV !== 'production'` guard at minimum.

---

### [HIGH] No Rate Limiting

**File**: `server.js` -- upload endpoint

`POST /api/v1/jobs/upload` accepts binary PDFs up to 50 MB each with no rate limiting. A caller can flood the server to:
1. Exhaust disk space (uploads directory has no total-size cap)
2. Exhaust the Azure OpenAI token quota (each upload triggers an AI extraction job)

**Recommendation**: Add per-IP or global rate limiting. A simple token-bucket counter in-process is sufficient for single-instance MVP. npm packages `express-rate-limit` or a lightweight in-process implementation both work.

---

### [MEDIUM] `cleanupExpiredArtifacts()` Runs on Every API Request

**File**: `server.js` -- `handleApi()` first line

```js
async function handleApi(req, res, pathname, searchParams) {
  cleanupExpiredArtifacts();  // <-- runs synchronously on EVERY request
```

This performs a directory read and file stat/unlink on every request, including lightweight reads like `GET /api/v1/health`. On a busy server, this adds synchronous I/O overhead to every call.

**Recommendation**: Move to a `setInterval` scheduled every 5-10 minutes at server startup instead of per-request.

---

### [MEDIUM] App Insights Provisioned but Traces Never Reach It

**File**: `server/observability.js`

The Bicep provisions App Insights and sets `APPLICATIONINSIGHTS_CONNECTION_STRING` as an app setting. But `observability.js` creates a bare `NodeTracerProvider` with no exporter attached:

```js
const provider = new NodeTracerProvider();
provider.register();  // no exporter -- traces are dropped
```

The `@azure/monitor-opentelemetry` package (or `applicationinsights` SDK) is not a dependency. All OTel spans are silently discarded.

**Recommendation**: Add `@azure/monitor-opentelemetry` to `package.json` and call `useAzureMonitor()` in `observability.js`. This auto-connects to App Insights via the env var already set by the pipeline.

---

### [MEDIUM] No HTTP-Level Integration Tests

**File**: `tests/` directory

Current test suite covers:
- `aiClient.js`: provider config logic
- `jobStore.js` + `extractionService.js`: job lifecycle and text parsing

Not covered:
- `server.js` routing, middleware, multipart parsing, error handling
- Path traversal protection in `serveStaticFile`
- The approval/verify/reprocess API flows end-to-end
- HTTP error responses (400, 404, 409, 413, 422, 500)
- `uploadStore.js` file lifecycle

**Recommendation**: Add a test file `tests/server.test.js` that starts the HTTP server on a random port and exercises the API surface via `node:http` requests.

---

### [MEDIUM] AI Client Timeout is 15 Seconds

**File**: `server/aiClient.js` `getClient()`

```js
timeout: 15000
```

The extraction prompt sends up to 20,000 characters of PDF text and expects a structured JSON response. Typical Azure OpenAI response time for a dense qualification spec is 20-40 seconds. A 15-second timeout will cause false failures on complex documents.

**Recommendation**: Increase to `60000` (60s) for the extraction client. The connectivity check can keep its shorter timeout by using a separate client instance.

---

### [MEDIUM] Model/Version Availability Risk in `uksouth`

**File**: `infra/main.bicep`

```bicep
param foundryModel string = 'gpt-4o-mini'
param foundryModelVersion string = '2024-07-18'
```

Model version `2024-07-18` for `gpt-4o-mini` may not be available in `uksouth`. Azure OpenAI model availability is region-specific and version-specific. An unavailable combination will cause `az deployment group create` to fail silently on the OpenAI deployment resource.

**Recommendation**: Either pin to a version known available in `uksouth` (verify via Azure portal or `az cognitiveservices account list-models`), or set `versionUpgradeOption: 'OnceCurrentVersionExpired'` and leave the version field empty to let Azure pick the latest available.

---

### [MEDIUM] SQLite `DatabaseSync` Blocks the Event Loop

**File**: `server/database.js`

Node.js `node:sqlite` `DatabaseSync` API is fully synchronous. Every `db.prepare(...).run()` or `.get()` call blocks the event loop. For an MVP with a single user, this is fine. At higher concurrency, long-running queries (e.g., `persistApprovedQualification` with multiple inserts) will freeze the server for all other requests for the duration.

**Recommendation**: Document the single-instance constraint explicitly in the README. For a production path, migrate to `better-sqlite3` async wrappers or a proper async database (PostgreSQL).

---

### [LOW] Missing Content-Security-Policy Header

**File**: `server.js` -- `sendJson()` and `serveStaticFile()`

The server already sets `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`, but does not set `Content-Security-Policy`. Without CSP, a reflected or stored XSS vulnerability in the frontend would have no browser-level mitigation.

**Recommendation**: Add to all responses:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'
```
Verify this does not break the frontend before deploying.

---

### [LOW] `Content-Disposition` Filename Incomplete Sanitization

**File**: `server.js` artifact download handler

```js
const safeFileName = String(job.artifact.originalFileName || "").replace(/["\r\n]/g, "");
```

Semicolons and other special characters are not stripped. A crafted filename like `file.pdf; name=evil` could inject extra `Content-Disposition` parameters in some HTTP clients.

**Recommendation**: Use RFC 5987 encoding or simply use `sanitizeFileName()` from `uploadStore.js` (which already produces a safe name) instead of the raw `originalFileName` here.

---

### [LOW] `uploadStore.js` Has No Test Coverage

**File**: `server/uploadStore.js`

The artifact save, path resolution, and expiry cleanup functions are not tested. The path traversal guard in `resolveArtifactPath` is a security-relevant function that should have direct tests.

**Recommendation**: Add tests covering save + resolve round-trip, `sanitizeFileName` edge cases (path traversal attempts, null bytes), expiry cleanup.

---

### [LOW] Uncommitted `.gitignore` Change

**Status**: One modified file in working tree (`M .gitignore` -- AgentX block removal)

**Recommendation**: Commit: `git add .gitignore && git commit -m "chore: remove agentx gitignore block"`

---

## Summary Table

| Severity | Count | Items |
|----------|-------|-------|
| HIGH | 3 | No auth, unprotected reset, no rate limiting |
| MEDIUM | 5 | Cleanup on every request, no App Insights export, no HTTP tests, 15s AI timeout, model version risk |
| LOW | 4 | No CSP, Content-Disposition, uploadStore tests, uncommitted .gitignore |

---

## Decision: CHANGES REQUESTED

HIGH findings (auth, reset, rate limiting) must be resolved before production deployment. MEDIUM findings should be addressed in the next iteration. LOW findings are tracked for future cleanup.

The codebase is structurally well-organized with good separation of concerns, solid input validation on the upload path, path traversal protection, and a working fallback extraction path when AI is unavailable. The CI/CD pipeline and Bicep are sound and require no structural changes.
