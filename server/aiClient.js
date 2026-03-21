const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");
const { AzureOpenAI } = require("openai");
const { SpanStatusCode } = require("@opentelemetry/api");
const { getTracer, initializeTracing } = require("./observability");
const { AUTHORITATIVE_CONTRACT_VERSION, normalizeAuthoritativeAiPayload } = require("./aiDraftNormalizer");
const { getDocumentIntelligenceStatus } = require("./documentIntelligenceClient");

const promptPath = path.join(__dirname, "..", "prompts", "qualification-extractor.md");
const schemaPath = path.join(__dirname, "..", "templates", "qualification-extraction-authoritative-schema.json");
const tracer = getTracer();

let client;
let clientCacheKey;

const DEFAULT_AI_TIMEOUT_MS = 120000;

function containsUnresolvedKeyVaultReference(value) {
  return /^@microsoft\.keyvault\(/i.test(String(value || "").trim());
}

function trimTrailingSlashes(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveFoundryBaseURL(config) {
  if (config.baseURL) {
    return `${trimTrailingSlashes(config.baseURL)}/`;
  }

  const normalizedEndpoint = trimTrailingSlashes(config.endpoint).replace(/\/openai(?:\/v1)?$/i, "");
  if (!normalizedEndpoint) {
    return "";
  }

  return `${normalizedEndpoint}/openai/v1/`;
}

function formatAiErrorMessage(provider, model, apiVersion, error) {
  const message = error && error.message ? error.message : String(error || "Unknown AI provider error.");

  if (provider !== "foundry") {
    return message;
  }

  if (/404|resource not found/i.test(message)) {
    return `${message} Verify that QUAL_AI_MODEL matches the Azure OpenAI deployment name exactly and that the app is using the Responses API route with FOUNDRY_API_VERSION=${apiVersion || "<missing>"}.`;
  }

  return message;
}

function normalizeProviderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getAiRequestTimeoutMs() {
  const rawValue = process.env.QUAL_AI_TIMEOUT_MS;
  if (!rawValue) {
    return DEFAULT_AI_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AI_TIMEOUT_MS;
  }

  return parsed;
}

function resolveProviderName() {
  const configuredProvider = normalizeProviderName(process.env.QUAL_AI_PROVIDER);
  if (configuredProvider === "openai" || configuredProvider === "foundry") {
    return configuredProvider;
  }
  if (process.env.FOUNDRY_API_KEY || process.env.FOUNDRY_BASE_URL) {
    return "foundry";
  }
  return "openai";
}

function getProviderConfig() {
  const provider = resolveProviderName();
  if (provider === "foundry") {
    return {
      provider,
      apiKey: process.env.FOUNDRY_API_KEY || "",
      baseURL: process.env.FOUNDRY_BASE_URL || "",
      endpoint: process.env.FOUNDRY_ENDPOINT || "",
      apiVersion: process.env.FOUNDRY_API_VERSION || ""
    };
  }
  return {
    provider,
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "",
    endpoint: "",
    apiVersion: ""
  };
}

function getAiConfigurationIssues() {
  const config = getProviderConfig();
  const issues = [];
  const configuredTimeout = process.env.QUAL_AI_TIMEOUT_MS;

  if (!config.apiKey) {
    issues.push(`${config.provider.toUpperCase()} API key is missing.`);
  } else if (containsUnresolvedKeyVaultReference(config.apiKey)) {
    const settingName = config.provider === "foundry" ? "FOUNDRY_API_KEY" : "OPENAI_API_KEY";
    issues.push(`${settingName} contains an unresolved Key Vault reference. Restart the app or fix the web app identity and Key Vault permissions.`);
  }

  if (config.provider === "foundry") {
    if (config.endpoint && !config.apiVersion) {
      issues.push("FOUNDRY_API_VERSION is required when QUAL_AI_PROVIDER=foundry.");
    }
    if (!config.baseURL && !config.endpoint) {
      issues.push("Either FOUNDRY_BASE_URL or FOUNDRY_ENDPOINT is required when QUAL_AI_PROVIDER=foundry.");
    }
    if (config.baseURL && config.endpoint) {
      issues.push("FOUNDRY_BASE_URL and FOUNDRY_ENDPOINT are mutually exclusive.");
    }
    if (config.baseURL && !/^https:\/\//i.test(config.baseURL)) {
      issues.push("FOUNDRY_BASE_URL must start with https://.");
    }
    if (config.baseURL && !/\/openai\/v1\/?$/i.test(config.baseURL)) {
      issues.push("FOUNDRY_BASE_URL must be the full OpenAI-compatible base URL ending in /openai/v1.");
    }
    if (config.endpoint && !/^https:\/\//i.test(config.endpoint)) {
      issues.push("FOUNDRY_ENDPOINT must start with https://.");
    }
    if (config.endpoint && /\/openai(?:\/v1)?\/?$/i.test(config.endpoint)) {
      issues.push("FOUNDRY_ENDPOINT must be the resource endpoint only, without /openai or /v1.");
    }
  }

  if (configuredTimeout) {
    const parsedTimeout = Number.parseInt(configuredTimeout, 10);
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
      issues.push("QUAL_AI_TIMEOUT_MS must be a positive integer when provided.");
    }
  }

  return issues;
}

function getAiStatus() {
  const config = getProviderConfig();
  const issues = getAiConfigurationIssues();
  const documentIntelligence = getDocumentIntelligenceStatus();
  return {
    provider: config.provider,
    configured: issues.length === 0 && documentIntelligence.configured,
    model: getModelName(),
    issues: [...issues, ...documentIntelligence.issues],
    capabilities: {
      apiKeyConfigured: Boolean(config.apiKey),
      baseUrlConfigured: Boolean(config.baseURL),
      endpointConfigured: Boolean(config.endpoint),
      apiVersionConfigured: Boolean(config.apiVersion)
    },
    documentIntelligence
  };
}

function isAiConfigured() {
  return getAiConfigurationIssues().length === 0;
}

function getAiProviderName() {
  return getProviderConfig().provider;
}

function getModelName() {
  return process.env.QUAL_AI_MODEL || "gpt-5.1-2026-01-15";
}

function getClient() {
  const config = getProviderConfig();
  const timeout = getAiRequestTimeoutMs();
  const cacheKey = `${config.provider}|${config.apiKey}|${config.baseURL}|${config.endpoint}|${config.apiVersion}|${timeout}`;
  if (client && clientCacheKey === cacheKey) {
    return client;
  }

  initializeTracing();
  if (config.provider === "foundry") {
    if (config.endpoint) {
      client = new AzureOpenAI({
        apiKey: config.apiKey,
        apiVersion: config.apiVersion,
        endpoint: trimTrailingSlashes(config.endpoint),
        timeout,
        maxRetries: 0
      });
    } else {
      client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: resolveFoundryBaseURL(config) || undefined,
        timeout,
        maxRetries: 0
      });
    }
  } else {
    client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
      timeout,
      maxRetries: 0
    });
  }
  clientCacheKey = cacheKey;
  return client;
}

function readPrompt() {
  return fs.readFileSync(promptPath, "utf8");
}

function readSchema() {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => item.text || "").join("\n");
  }
  return "";
}

function getResponseText(response) {
  if (response && typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const outputs = Array.isArray(response && response.output) ? response.output : [];
  for (const output of outputs) {
    const contentItems = Array.isArray(output && output.content) ? output.content : [];
    for (const item of contentItems) {
      if (item && item.type === "refusal") {
        throw new Error(item.refusal || "AI refused to extract qualification data from the PDF.");
      }
      if (item && item.type === "output_text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }

  if (response && response.error && response.error.message) {
    throw new Error(response.error.message);
  }

  return "";
}

function buildDocumentAnalysisInputs(fileName, documentAnalysis) {
  if (!documentAnalysis || typeof documentAnalysis !== "object") {
    throw new Error("Document Intelligence analysis is required for AI extraction.");
  }

  if (!documentAnalysis.content || typeof documentAnalysis.content !== "string") {
    throw new Error("Document Intelligence analysis did not provide extracted content.");
  }

  return [
    {
      type: "input_text",
      text: JSON.stringify({
        fileName,
        sourceDocument: "Azure AI Document Intelligence layout analysis",
        contentFormat: documentAnalysis.contentFormat || "markdown",
        pageCount: documentAnalysis.pageCount || 0,
        paragraphCount: documentAnalysis.paragraphCount || 0,
        tableCount: documentAnalysis.tableCount || 0,
        sectionCount: documentAnalysis.sectionCount || 0,
        figureCount: documentAnalysis.figureCount || 0,
        keyValuePairCount: documentAnalysis.keyValuePairCount || 0
      })
    },
    {
      type: "input_text",
      text: `Document Intelligence extracted content:\n\n${documentAnalysis.content}`
    }
  ];
}

function validateAiPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("AI response was empty.");
  }
  if (!payload.Qualifications || typeof payload.Qualifications !== "object") {
    throw new Error("AI response omitted the authoritative Qualifications envelope.");
  }
  if (!Array.isArray(payload.Qualifications.qualifications) || !payload.Qualifications.qualifications.length) {
    throw new Error("AI response did not return any authoritative qualification nodes.");
  }
  return payload;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAiConnectivityCheck(options = {}) {
  const status = getAiStatus();
  const checkedAt = new Date().toISOString();

  if (!status.configured) {
    return {
      ok: false,
      provider: status.provider,
      model: status.model,
      checkedAt,
      issues: status.issues,
      message: "AI provider is not configured."
    };
  }

  const clientInstance = options.client || getClient();

  return tracer.startActiveSpan("qualextract.ai.connectivity_check", async (span) => {
    span.setAttribute("qualextract.provider", status.provider);
    span.setAttribute("qualextract.model", status.model);

    try {
      const response = await clientInstance.responses.create({
        model: status.model,
        max_output_tokens: 16,
        input: "Reply with OK."
      });

      const content = normalizeContent(getResponseText(response)).trim();

      span.setStatus({ code: SpanStatusCode.OK });
      return {
        ok: true,
        provider: status.provider,
        model: status.model,
        checkedAt,
        message: content || "Connectivity check succeeded.",
        issues: []
      };
    } catch (error) {
      span.recordException(error);
      const message = formatAiErrorMessage(status.provider, status.model, getProviderConfig().apiVersion, error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      return {
        ok: false,
        provider: status.provider,
        model: status.model,
        checkedAt,
        message,
        issues: [message]
      };
    } finally {
      span.end();
    }
  });
}

async function extractQualificationWithAi({ fileName, documentAnalysis, extractionContext, client: injectedClient }) {
  return tracer.startActiveSpan("qualextract.ai.extract", async (span) => {
    const prompt = readPrompt();
    const schema = readSchema();
    const model = getModelName();
    const provider = getAiProviderName();
    const clientInstance = injectedClient || getClient();
    const content = buildDocumentAnalysisInputs(fileName, documentAnalysis);

    span.setAttribute("qualextract.provider", provider);
    span.setAttribute("qualextract.model", model);
    span.setAttribute("qualextract.file_name", fileName);
    span.setAttribute("qualextract.document_intelligence.page_count", documentAnalysis && documentAnalysis.pageCount ? documentAnalysis.pageCount : 0);
    span.setAttribute("qualextract.document_intelligence.table_count", documentAnalysis && documentAnalysis.tableCount ? documentAnalysis.tableCount : 0);

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await clientInstance.responses.create({
            model,
            instructions: prompt,
            input: [
              {
                role: "user",
                content
              }
            ],
            text: {
              format: {
                type: "json_schema",
                name: "qualification_extraction",
                strict: true,
                schema
              }
            },
          });

          const responseText = normalizeContent(getResponseText(response));
          const payload = validateAiPayload(JSON.parse(responseText));
          const normalizedDraft = normalizeAuthoritativeAiPayload(payload, extractionContext);
          span.setAttribute(
            "qualextract.authoritative_qualification_count",
            payload.Qualifications.qualifications.length
          );
          span.setAttribute("qualextract.contract_version", AUTHORITATIVE_CONTRACT_VERSION);
          span.setStatus({ code: SpanStatusCode.OK });
          return normalizedDraft;
        } catch (error) {
          if (attempt === 3) {
            throw new Error(
              formatAiErrorMessage(provider, model, getProviderConfig().apiVersion, error),
              { cause: error }
            );
          }
          await sleep(250 * attempt);
        }
      }
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
  getAiRequestTimeoutMs,
  getAiStatus,
  getAiConfigurationIssues,
  getAiProviderName,
  isAiConfigured,
  getModelName,
  runAiConnectivityCheck,
  extractQualificationWithAi
};