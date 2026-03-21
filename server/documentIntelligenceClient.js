const { SpanStatusCode } = require("@opentelemetry/api");
const { getTracer, initializeTracing } = require("./observability");

const DEFAULT_DOCUMENT_INTELLIGENCE_API_VERSION = "2024-11-30";
const DEFAULT_DOCUMENT_INTELLIGENCE_MODEL = "prebuilt-layout";
const DEFAULT_DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT = "markdown";
const DEFAULT_DOCUMENT_INTELLIGENCE_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 1000;
const tracer = getTracer("qualextract.document-intelligence");

function containsUnresolvedKeyVaultReference(value) {
  return /^@microsoft\.keyvault\(/i.test(String(value || "").trim());
}

function trimTrailingSlashes(value) {
  return String(value || "").replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDocumentIntelligenceOutputFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "text" || normalized === "markdown") {
    return normalized;
  }
  return DEFAULT_DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT;
}

function getDocumentIntelligenceRequestTimeoutMs() {
  const rawValue = process.env.DOCUMENT_INTELLIGENCE_TIMEOUT_MS;
  if (!rawValue) {
    return DEFAULT_DOCUMENT_INTELLIGENCE_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DOCUMENT_INTELLIGENCE_TIMEOUT_MS;
  }

  return parsed;
}

function getDocumentIntelligenceConfig() {
  return {
    endpoint: trimTrailingSlashes(process.env.DOCUMENT_INTELLIGENCE_ENDPOINT || ""),
    apiKey: process.env.DOCUMENT_INTELLIGENCE_API_KEY || "",
    apiVersion: process.env.DOCUMENT_INTELLIGENCE_API_VERSION || DEFAULT_DOCUMENT_INTELLIGENCE_API_VERSION,
    model: process.env.DOCUMENT_INTELLIGENCE_MODEL || DEFAULT_DOCUMENT_INTELLIGENCE_MODEL,
    outputFormat: normalizeDocumentIntelligenceOutputFormat(process.env.DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT),
    timeoutMs: getDocumentIntelligenceRequestTimeoutMs()
  };
}

function getDocumentIntelligenceConfigurationIssues() {
  const config = getDocumentIntelligenceConfig();
  const issues = [];
  const configuredTimeout = process.env.DOCUMENT_INTELLIGENCE_TIMEOUT_MS;
  const configuredOutputFormat = process.env.DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT;

  if (!config.endpoint) {
    issues.push("DOCUMENT_INTELLIGENCE_ENDPOINT is required.");
  } else if (!/^https:\/\//i.test(config.endpoint)) {
    issues.push("DOCUMENT_INTELLIGENCE_ENDPOINT must start with https://.");
  }

  if (!config.apiKey) {
    issues.push("DOCUMENT_INTELLIGENCE_API_KEY is missing.");
  } else if (containsUnresolvedKeyVaultReference(config.apiKey)) {
    issues.push("DOCUMENT_INTELLIGENCE_API_KEY contains an unresolved Key Vault reference. Restart the app or fix the web app identity and Key Vault permissions.");
  }

  if (!config.apiVersion) {
    issues.push("DOCUMENT_INTELLIGENCE_API_VERSION is required.");
  }

  if (!config.model) {
    issues.push("DOCUMENT_INTELLIGENCE_MODEL is required.");
  }

  if (configuredTimeout) {
    const parsedTimeout = Number.parseInt(configuredTimeout, 10);
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
      issues.push("DOCUMENT_INTELLIGENCE_TIMEOUT_MS must be a positive integer when provided.");
    }
  }

  if (configuredOutputFormat && !["markdown", "text"].includes(String(configuredOutputFormat).trim().toLowerCase())) {
    issues.push("DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT must be either markdown or text when provided.");
  }

  return issues;
}

function isDocumentIntelligenceConfigured() {
  return getDocumentIntelligenceConfigurationIssues().length === 0;
}

function getDocumentIntelligenceStatus() {
  const config = getDocumentIntelligenceConfig();
  const issues = getDocumentIntelligenceConfigurationIssues();

  return {
    configured: issues.length === 0,
    endpoint: config.endpoint || null,
    apiVersion: config.apiVersion,
    model: config.model,
    outputFormat: config.outputFormat,
    issues,
    capabilities: {
      endpointConfigured: Boolean(config.endpoint),
      apiKeyConfigured: Boolean(config.apiKey),
      apiVersionConfigured: Boolean(config.apiVersion),
      markdownOutputEnabled: config.outputFormat === "markdown"
    }
  };
}

async function readResponsePayload(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatServiceError(payload, fallbackMessage) {
  if (payload && typeof payload === "object") {
    if (payload.error && payload.error.message) {
      return payload.error.message;
    }
    if (payload.message) {
      return payload.message;
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  return fallbackMessage;
}

async function fetchJson(url, options, timeoutMs, fetchImpl) {
  const response = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await readResponsePayload(response);
  return { response, payload };
}

function createAnalyzeUrl(config) {
  const url = new URL(`/documentintelligence/documentModels/${encodeURIComponent(config.model)}:analyze`, `${config.endpoint}/`);
  url.searchParams.set("api-version", config.apiVersion);
  url.searchParams.set("outputContentFormat", config.outputFormat);
  return url;
}

function normalizeDocumentAnalysis(payload, config) {
  const analyzeResult = payload && payload.analyzeResult ? payload.analyzeResult : null;
  const content = analyzeResult && typeof analyzeResult.content === "string"
    ? analyzeResult.content.trim()
    : "";

  if (!content) {
    throw new Error("Document Intelligence returned no extracted content.");
  }

  return {
    content,
    contentFormat: analyzeResult.contentFormat || config.outputFormat,
    pageCount: Array.isArray(analyzeResult.pages) ? analyzeResult.pages.length : 0,
    paragraphCount: Array.isArray(analyzeResult.paragraphs) ? analyzeResult.paragraphs.length : 0,
    tableCount: Array.isArray(analyzeResult.tables) ? analyzeResult.tables.length : 0,
    sectionCount: Array.isArray(analyzeResult.sections) ? analyzeResult.sections.length : 0,
    figureCount: Array.isArray(analyzeResult.figures) ? analyzeResult.figures.length : 0,
    keyValuePairCount: Array.isArray(analyzeResult.keyValuePairs) ? analyzeResult.keyValuePairs.length : 0,
    modelId: payload.modelId || config.model
  };
}

async function analyzePdfWithDocumentIntelligence({ fileName, pdfBuffer, fetch: injectedFetch }) {
  const config = getDocumentIntelligenceConfig();
  const issues = getDocumentIntelligenceConfigurationIssues();
  const fetchImpl = injectedFetch || globalThis.fetch;

  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
    throw new Error("PDF input is required for Document Intelligence analysis.");
  }

  if (issues.length) {
    throw new Error(issues.join(" "));
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available for Document Intelligence requests.");
  }

  initializeTracing();

  return tracer.startActiveSpan("qualextract.document_intelligence.analyze", async (span) => {
    span.setAttribute("qualextract.document_intelligence.model", config.model);
    span.setAttribute("qualextract.document_intelligence.api_version", config.apiVersion);
    span.setAttribute("qualextract.document_intelligence.output_format", config.outputFormat);
    span.setAttribute("qualextract.file_name", fileName || "qualification.pdf");
    span.setAttribute("qualextract.input_bytes", pdfBuffer.length);

    try {
      const initialUrl = createAnalyzeUrl(config).toString();
      const { response: initialResponse, payload: initialPayload } = await fetchJson(
        initialUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Ocp-Apim-Subscription-Key": config.apiKey
          },
          body: JSON.stringify({
            base64Source: pdfBuffer.toString("base64")
          })
        },
        config.timeoutMs,
        fetchImpl
      );

      if (!initialResponse.ok && initialResponse.status !== 202) {
        throw new Error(
          `Document Intelligence analyze request failed with ${initialResponse.status}: ${formatServiceError(initialPayload, "Unexpected service response.")}`
        );
      }

      const operationLocation = initialResponse.headers.get("operation-location") || initialResponse.headers.get("Operation-Location");

      if (!operationLocation) {
        if (initialPayload && typeof initialPayload === "object" && initialPayload.status === "succeeded") {
          const completed = normalizeDocumentAnalysis(initialPayload, config);
          span.setAttribute("qualextract.document_intelligence.page_count", completed.pageCount);
          span.setAttribute("qualextract.document_intelligence.table_count", completed.tableCount);
          span.setStatus({ code: SpanStatusCode.OK });
          return completed;
        }

        throw new Error("Document Intelligence analyze request did not return an operation-location header.");
      }

      const deadline = Date.now() + config.timeoutMs;
      while (Date.now() < deadline) {
        const remainingMs = Math.max(deadline - Date.now(), POLL_INTERVAL_MS);
        const { response: pollResponse, payload: pollPayload } = await fetchJson(
          operationLocation,
          {
            method: "GET",
            headers: {
              "Ocp-Apim-Subscription-Key": config.apiKey
            }
          },
          remainingMs,
          fetchImpl
        );

        if (!pollResponse.ok) {
          throw new Error(
            `Document Intelligence polling failed with ${pollResponse.status}: ${formatServiceError(pollPayload, "Unexpected polling response.")}`
          );
        }

        const status = String(pollPayload && pollPayload.status || "").trim().toLowerCase();
        if (status === "succeeded") {
          const completed = normalizeDocumentAnalysis(pollPayload, config);
          span.setAttribute("qualextract.document_intelligence.page_count", completed.pageCount);
          span.setAttribute("qualextract.document_intelligence.table_count", completed.tableCount);
          span.setAttribute("qualextract.document_intelligence.section_count", completed.sectionCount);
          span.setStatus({ code: SpanStatusCode.OK });
          return completed;
        }

        if (status === "failed" || status === "canceled") {
          throw new Error(`Document Intelligence analysis ${status}: ${formatServiceError(pollPayload, "Analysis did not succeed.")}`);
        }

        await sleep(POLL_INTERVAL_MS);
      }

      throw new Error(`Document Intelligence analysis timed out after ${config.timeoutMs}ms.`);
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

module.exports = {
  getDocumentIntelligenceConfig,
  getDocumentIntelligenceConfigurationIssues,
  getDocumentIntelligenceRequestTimeoutMs,
  getDocumentIntelligenceStatus,
  isDocumentIntelligenceConfigured,
  analyzePdfWithDocumentIntelligence
};