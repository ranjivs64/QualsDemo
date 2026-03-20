require("./server/loadEnv");

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const {
  listJobs,
  getJob,
  createUploadedJob,
  updateNodeField,
  verifyNode,
  updateApprovalOverride,
  approveJob,
  reprocessJob,
  resetState,
  listPersistedQualifications,
  getPersistedQualification
} = require("./server/jobStore");
const {
  saveUploadedArtifact,
  cleanupExpiredArtifacts,
  resolveArtifactPath
} = require("./server/uploadStore");
const { getAiStatus } = require("./server/aiClient");
const { processExtractionJob } = require("./server/extractionService");

const PORT = Number(process.env.PORT || 3000);
const APP_DIR = path.join(__dirname, "app");

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  res.end(body);
}

function sendProblem(res, statusCode, title, detail) {
  sendJson(res, statusCode, {
    type: "about:blank",
    title,
    status: statusCode,
    detail
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    const match = contentType.match(/boundary=(.+)$/);
    if (!match) {
      reject(new Error("Missing multipart boundary"));
      return;
    }

    const boundary = Buffer.from(`--${match[1]}`);
    const chunks = [];
    let totalLength = 0;

    req.on("data", (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 50 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const parts = [];
      let start = buffer.indexOf(boundary) + boundary.length + 2;

      while (start > boundary.length && start < buffer.length) {
        const nextBoundaryIndex = buffer.indexOf(boundary, start);
        if (nextBoundaryIndex === -1) {
          break;
        }
        const partBuffer = buffer.subarray(start, nextBoundaryIndex - 2);
        const headerEnd = partBuffer.indexOf(Buffer.from("\r\n\r\n"));
        if (headerEnd !== -1) {
          const headerText = partBuffer.subarray(0, headerEnd).toString("utf8");
          const body = partBuffer.subarray(headerEnd + 4);
          parts.push({ headerText, body });
        }
        start = nextBoundaryIndex + boundary.length + 2;
      }

      const filePart = parts.find((part) => /name="file"/.test(part.headerText));
      if (!filePart) {
        reject(new Error("Multipart upload requires a file field"));
        return;
      }

      const fileNameMatch = filePart.headerText.match(/filename="([^"]+)"/);
      const mimeTypeMatch = filePart.headerText.match(/Content-Type:\s*([^\r\n]+)/i);
      resolve({
        fileName: fileNameMatch ? fileNameMatch[1] : "upload.pdf",
        mimeType: mimeTypeMatch ? mimeTypeMatch[1].trim() : "application/octet-stream",
        buffer: filePart.body
      });
    });

    req.on("error", reject);
  });
}

function scheduleExtraction(job) {
  setTimeout(() => {
    processExtractionJob(job.id).catch((error) => {
      console.error("Extraction job failed", { jobId: job.id, message: error.message });
    });
  }, 300);
}

function serveStaticFile(res, pathname) {
  let relativePath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = path.normalize(relativePath).replace(/^([.][.][/\\])+/, "");
  const filePath = path.join(APP_DIR, normalizedPath);
  if (!filePath.startsWith(APP_DIR)) {
    sendProblem(res, 403, "Forbidden", "Path traversal is not allowed.");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendProblem(res, 404, "Not Found", "Requested asset was not found.");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(data);
  });
}

async function handleApi(req, res, pathname, searchParams) {
  cleanupExpiredArtifacts();

  if (req.method === "GET" && pathname === "/api/v1/health") {
    sendJson(res, 200, { status: "ok", uptime: Math.floor(process.uptime()) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/jobs") {
    sendJson(res, 200, { items: listJobs(searchParams.get("status")) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/ai-status") {
    sendJson(res, 200, { item: getAiStatus() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/jobs/upload") {
    const contentType = req.headers["content-type"] || "";
    let fileName;
    let artifact = null;

    if (contentType.startsWith("multipart/form-data")) {
      const upload = await parseMultipartFormData(req);
      fileName = String(upload.fileName || "").trim();
      if (!fileName || !fileName.toLowerCase().endsWith(".pdf") || fileName.length > 255) {
        sendProblem(res, 422, "Validation failed", "Uploaded file must be a PDF with a file name up to 255 characters.");
        return;
      }
      if (upload.mimeType !== "application/pdf") {
        sendProblem(res, 422, "Validation failed", "Uploaded file must use the application/pdf content type.");
        return;
      }
      artifact = saveUploadedArtifact(fileName, upload.buffer, upload.mimeType);
    } else {
      const payload = await parseBody(req);
      fileName = String(payload.fileName || "").trim();
      if (!fileName || !fileName.toLowerCase().endsWith(".pdf") || fileName.length > 255) {
        sendProblem(res, 422, "Validation failed", "fileName must be a non-empty PDF file name up to 255 characters.");
        return;
      }
    }

    const job = createUploadedJob(fileName, artifact);
    scheduleExtraction(job);
    sendJson(res, 202, { item: job });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/qualifications") {
    sendJson(res, 200, { items: listPersistedQualifications() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/reset") {
    sendJson(res, 200, { items: resetState().jobs });
    return;
  }

  const artifactMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/artifact$/);
  if (req.method === "GET" && artifactMatch) {
    const job = getJob(artifactMatch[1]);
    if (!job || !job.artifact || !job.artifact.storedFileName) {
      sendProblem(res, 404, "Not Found", "Artifact was not found for this job.");
      return;
    }
    const filePath = resolveArtifactPath(job.artifact.storedFileName);
    if (!filePath) {
      sendProblem(res, 404, "Not Found", "Artifact file is no longer available.");
      return;
    }
    const safeFileName = String(job.artifact.originalFileName || "").replace(/["\r\n]/g, "");
    res.writeHead(200, {
      "Content-Type": job.artifact.mimeType || "application/pdf",
      "Content-Disposition": `inline; filename="${safeFileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const jobDetailMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
  if (req.method === "GET" && jobDetailMatch) {
    const job = getJob(jobDetailMatch[1]);
    if (!job) {
      sendProblem(res, 404, "Not Found", "Job was not found.");
      return;
    }
    sendJson(res, 200, { item: job });
    return;
  }

  const reprocessMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/reprocess$/);
  if (req.method === "POST" && reprocessMatch) {
    const job = reprocessJob(reprocessMatch[1]);
    if (!job) {
      sendProblem(res, 404, "Not Found", "Job was not found.");
      return;
    }
    scheduleExtraction(job);
    sendJson(res, 202, { item: job });
    return;
  }

  const qualificationDetailMatch = pathname.match(/^\/api\/v1\/qualifications\/([^/]+)$/);
  if (req.method === "GET" && qualificationDetailMatch) {
    const qualification = getPersistedQualification(qualificationDetailMatch[1]);
    if (!qualification) {
      sendProblem(res, 404, "Not Found", "Persisted qualification was not found.");
      return;
    }
    sendJson(res, 200, { item: qualification });
    return;
  }

  const approveMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const job = getJob(approveMatch[1]);
    if (!job) {
      sendProblem(res, 404, "Not Found", "Job was not found.");
      return;
    }
    if (!job.reviewReady) {
      const blockerCount = job.validationSummary && job.validationSummary.counts ? job.validationSummary.counts.blockers : 0;
      sendProblem(
        res,
        409,
        "Conflict",
        blockerCount > 0
          ? `Job cannot be approved while ${blockerCount} validation blocker${blockerCount === 1 ? " remains" : "s remain"}.`
          : "Job cannot be approved until review requirements are satisfied."
      );
      return;
    }
    sendJson(res, 200, { item: approveJob(approveMatch[1]) });
    return;
  }

  const overrideMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/approval-override$/);
  if (req.method === "PATCH" && overrideMatch) {
    const payload = await parseBody(req);
    const enabled = Boolean(payload.enabled);
    const rationale = String(payload.rationale || "").trim();

    if (rationale.length > 1000) {
      sendProblem(res, 422, "Validation failed", "Override rationale must be 1000 characters or fewer.");
      return;
    }

    const job = updateApprovalOverride(overrideMatch[1], enabled, rationale);
    if (!job) {
      sendProblem(res, 404, "Not Found", "Job was not found.");
      return;
    }

    sendJson(res, 200, { item: job });
    return;
  }

  const verifyMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/nodes\/([^/]+)\/verify$/);
  if (req.method === "POST" && verifyMatch) {
    const job = verifyNode(verifyMatch[1], verifyMatch[2]);
    if (!job) {
      sendProblem(res, 404, "Not Found", "Job or node was not found.");
      return;
    }
    sendJson(res, 200, { item: job });
    return;
  }

  const nodeUpdateMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/nodes\/([^/]+)$/);
  if (req.method === "PATCH" && nodeUpdateMatch) {
    const payload = await parseBody(req);
    const field = String(payload.field || "").trim();
    const value = String(payload.value || "").trim();
    if (!field || value.length > 255) {
      sendProblem(res, 422, "Validation failed", "field is required and value must be 255 characters or fewer.");
      return;
    }
    const job = updateNodeField(nodeUpdateMatch[1], nodeUpdateMatch[2], field, value);
    if (!job) {
      sendProblem(res, 404, "Not Found", "Job or node was not found.");
      return;
    }
    sendJson(res, 200, { item: job });
    return;
  }

  sendProblem(res, 404, "Not Found", "API endpoint was not found.");
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, requestUrl.pathname, requestUrl.searchParams);
      return;
    }
    serveStaticFile(res, requestUrl.pathname);
  } catch (error) {
    const message = error.message === "Payload too large" || error.message === "Invalid JSON payload"
      ? error.message
      : "Unexpected server error";
    const status = error.message === "Payload too large" ? 413 : error.message === "Invalid JSON payload" ? 400 : 500;
    sendProblem(res, status, status === 500 ? "Internal Server Error" : "Bad Request", message);
  }
});

server.listen(PORT, () => {
  console.log(`QualExtract MVP server running on http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);