# Production Readiness Review

**Date**: 2026-03-16
**Reviewer**: Auto-Fix Reviewer
**Scope**: Full solution - server.js, aiClient.js, extractionService.js, database.js, jobStore.js, uploadStore.js, app/, tests/
**Status**: CONDITIONALLY APPROVED for internal/staging deployment. NOT approved for external production until blocked items are resolved.

---

## Auto-Applied Fixes (5 changes, all tests pass 16/16)

### [FIX-1] HTTP Header Injection in Content-Disposition (OWASP A03 - Injection)
- **Severity**: HIGH (auto-fixed)
- **File**: server.js - artifact download route
- **Before**: `"Content-Disposition": \`inline; filename="${job.artifact.originalFileName}"\``
  User-controlled `originalFileName` was placed directly into an HTTP response header without sanitization.
  A filename containing `\r\n` could inject arbitrary response headers.
- **After**: `originalFileName` is stripped of `"`, `\r`, `\n` before use in the header.

### [FIX-2] Missing X-Frame-Options Header (OWASP A05 - Security Misconfiguration)
- **Severity**: MEDIUM (auto-fixed)
- **File**: server.js - sendJson, serveStaticFile, artifact response
- **Change**: Added `"X-Frame-Options": "DENY"` to all response paths.
  Prevents the app from being embedded in an iframe (clickjacking protection).

### [FIX-3] Missing Referrer-Policy Header (OWASP A05 - Security Misconfiguration)
- **Severity**: LOW (auto-fixed)
- **File**: server.js - all response paths
- **Change**: Added `"Referrer-Policy": "strict-origin-when-cross-origin"` to all responses.

### [FIX-4] Missing Health Check Endpoint
- **Severity**: MEDIUM (auto-fixed)
- **File**: server.js
- **Change**: Added `GET /api/v1/health` returning `{ status: "ok", uptime: <seconds> }`.
  Required for Azure App Service health probes, load balancers, and container orchestrators.

### [FIX-5] No Graceful Shutdown
- **Severity**: MEDIUM (auto-fixed)
- **File**: server.js
- **Change**: Added `SIGTERM` and `SIGINT` handlers that call `server.close()` before exit.
  Without this, deployments, container restarts, and process managers cause abrupt connection drops.

### [FIX-6] Missing .gitignore
- **Severity**: HIGH (auto-fixed)
- **File**: .gitignore (created)
- **Change**: Created `.gitignore` covering `node_modules/`, `server/data/*.sqlite`, `server/uploads/`, `server/store.json`, `.env`.
  Without this, the SQLite database (containing qualification data), uploaded PDFs, and `.env` secrets
  would be committed to version control.

---

## Suggested Changes (require Engineer - not auto-applied)

### [SUGGEST-1] Authentication and Authorization (OWASP A01 - Broken Access Control)
- **Severity**: HIGH - BLOCKS external production deployment
- **Current state**: The entire API is fully unauthenticated. Any network-reachable client can:
  - Upload arbitrary PDFs
  - Read all jobs and persisted qualifications
  - Approve or reprocess any job
  - Call `POST /api/v1/reset` which wipes all job data
- **Recommended**: Add a middleware check for a session token or API key header before any `handleApi` call.
  For internal deployment: even a single shared `QUAL_API_KEY` env var checked against `Authorization: Bearer` is better than nothing.
  For production: full OAuth2/OIDC session (Azure AD recommended given the Foundry dependency).

### [SUGGEST-2] Remove or Gate POST /api/v1/reset (Data Loss Risk)
- **Severity**: HIGH - BLOCKS external production deployment
- **Current state**: `POST /api/v1/reset` destroys all job data with a single unauthenticated request.
- **Recommended**: Gate behind `NODE_ENV !== "production"` check, or remove entirely before external deployment.
  ```js
  if (process.env.NODE_ENV === "production") {
    sendProblem(res, 403, "Forbidden", "Reset is not available in production.");
    return;
  }
  ```

### [SUGGEST-3] Rate Limiting on Upload and AI Endpoints
- **Severity**: MEDIUM
- **Current state**: No request rate limiting. A single client can flood the server with uploads,
  triggering unbounded AI API calls and database writes.
- **Recommended**: Add a simple in-memory rate limiter keyed by IP for `POST /api/v1/jobs/upload`
  and `POST /api/v1/jobs/*/reprocess`. A sliding window of e.g. 10 requests/minute per IP is sufficient for MVP.

### [SUGGEST-4] Content-Security-Policy Header
- **Severity**: MEDIUM
- **Current state**: No CSP header. XSS payloads (if injected into qualification data displayed in the UI)
  could execute scripts.
- **Recommended**: Add to `serveStaticFile` for HTML responses:
  `"Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"`
  Requires verifying the app has no inline scripts or styles first.

### [SUGGEST-5] HTTPS Enforcement
- **Severity**: MEDIUM
- **Current state**: Server always starts on plain HTTP. Credentials (if added via SUGGEST-1),
  session tokens, and uploaded PDF contents travel in plaintext.
- **Recommended**: For Azure App Service, this is handled by the platform (TLS termination at the load balancer).
  Add `HTTPS-only` enforcement in the App Service settings. For self-hosted, add an HTTPS redirect middleware.

### [SUGGEST-6] Application Insights / OTel Exporter
- **Severity**: MEDIUM
- **Current state**: `server/observability.js` initializes an OTel `NodeTracerProvider` but registers no exporter.
  All AI extraction spans (including Foundry calls) are emitted to the void.
- **Recommended**: Add the OTLP/HTTP exporter or `@azure/monitor-opentelemetry` exporter wired to
  `APPLICATIONINSIGHTS_CONNECTION_STRING`. Then AI extraction latency, retry counts, and provider errors
  become visible in Azure Monitor.

### [SUGGEST-7] Structured JSON Logging
- **Severity**: LOW
- **Current state**: `console.log` and `console.error` emit plain text strings. No correlation IDs,
  no machine-parseable format for cloud log ingestion.
- **Recommended**: Replace with a minimal structured logger that emits JSON with `{ level, message, timestamp, ...context }`.
  At minimum, add the job ID to extraction error logs.

### [SUGGEST-8] Extraction Job Queue Reliability
- **Severity**: LOW
- **Current state**: `scheduleExtraction()` uses `setTimeout(fn, 300)`. If the server restarts between
  the upload HTTP response (202) and the 300ms timeout, the job is silently stranded in `processing` status forever.
- **Recommended**: On server startup, query for jobs with `status = "processing"` and re-queue them.
  Add a `processOrphanedJobs()` call in server startup.

---

## Categorized Findings Summary

| # | Finding | Severity | Category | Action |
|---|---------|----------|----------|--------|
| FIX-1 | Content-Disposition header injection | HIGH | OWASP A03 | Auto-fixed |
| FIX-6 | Missing .gitignore (DB + secrets exposed) | HIGH | Cryptographic | Auto-fixed |
| FIX-4 | No health check endpoint | MEDIUM | Operations | Auto-fixed |
| FIX-5 | No graceful shutdown | MEDIUM | Operations | Auto-fixed |
| FIX-2 | Missing X-Frame-Options | MEDIUM | OWASP A05 | Auto-fixed |
| FIX-3 | Missing Referrer-Policy | LOW | OWASP A05 | Auto-fixed |
| SUGGEST-1 | No authentication | HIGH | OWASP A01 | Engineer required |
| SUGGEST-2 | POST /api/v1/reset unprotected | HIGH | OWASP A01 | Engineer required |
| SUGGEST-3 | No rate limiting | MEDIUM | OWASP A05 | Engineer required |
| SUGGEST-4 | No Content-Security-Policy | MEDIUM | OWASP A05 | Engineer required |
| SUGGEST-5 | No HTTPS enforcement | MEDIUM | OWASP A02 | Platform / Engineer |
| SUGGEST-6 | OTel has no exporter | MEDIUM | Observability | Engineer required |
| SUGGEST-7 | Unstructured logging | LOW | Observability | Engineer required |
| SUGGEST-8 | Orphaned jobs on restart | LOW | Reliability | Engineer required |

---

## Checklist Verdict

| Gate | Status | Notes |
|------|--------|-------|
| Unit tests 16/16 pass | PASS | All pass before and after fixes |
| Integration tests | PARTIAL | jobStore.test.js covers job lifecycle; no HTTP-level API tests |
| E2E tests | NOT PRESENT | Manual testing only |
| Security headers | PASS (after fixes) | X-Frame-Options, Referrer-Policy, X-Content-Type-Options on all responses |
| Injection prevention | PASS (after fixes) | Content-Disposition sanitized; SQL uses parameterized queries throughout |
| Secrets in code | PASS | All secrets via env vars; .gitignore now excludes .env |
| Path traversal | PASS | uploadStore resolveArtifactPath uses startsWith guard; serveStaticFile uses normalize + startsWith guard |
| Authentication | FAIL | No auth - blocks external production deployment |
| Rate limiting | FAIL | No limits - blocks external production deployment |
| Health endpoint | PASS (after fix) | GET /api/v1/health added |
| Graceful shutdown | PASS (after fix) | SIGTERM/SIGINT handlers added |
| Observability | PARTIAL | OTel tracing code in place; no exporter wired |
| .gitignore | PASS (after fix) | Created - covers node_modules, DB, uploads, .env |

---

## Decision

**CONDITIONALLY APPROVED** for internal / staging deployment with the auto-applied fixes.

**NOT APPROVED** for external or public production deployment until SUGGEST-1 (authentication) and SUGGEST-2 (reset endpoint gate) are resolved by the Engineer.

All auto-applied fixes pass the full test suite (16/16). No business logic was modified.
