const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");
const { AzureOpenAI } = require("openai");
const { SpanStatusCode } = require("@opentelemetry/api");
const { getTracer, initializeTracing } = require("./observability");

const promptPath = path.join(__dirname, "..", "prompts", "qualification-extractor.md");
const schemaPath = path.join(__dirname, "..", "templates", "qualification-extraction-schema.json");
const tracer = getTracer();

let client;
let clientCacheKey;

function normalizeProviderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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

  if (!config.apiKey) {
    issues.push(`${config.provider.toUpperCase()} API key is missing.`);
  }

  if (config.provider === "foundry") {
    if (!config.apiVersion) {
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
    if (config.endpoint && !/^https:\/\//i.test(config.endpoint)) {
      issues.push("FOUNDRY_ENDPOINT must start with https://.");
    }
  }

  return issues;
}

function getAiStatus() {
  const config = getProviderConfig();
  const issues = getAiConfigurationIssues();
  return {
    provider: config.provider,
    configured: issues.length === 0,
    model: getModelName(),
    issues,
    capabilities: {
      apiKeyConfigured: Boolean(config.apiKey),
      baseUrlConfigured: Boolean(config.baseURL),
      endpointConfigured: Boolean(config.endpoint),
      apiVersionConfigured: Boolean(config.apiVersion)
    }
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
  const cacheKey = `${config.provider}|${config.apiKey}|${config.baseURL}|${config.endpoint}|${config.apiVersion}`;
  if (client && clientCacheKey === cacheKey) {
    return client;
  }

  initializeTracing();
  if (config.provider === "foundry") {
    client = new AzureOpenAI({
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      baseURL: config.baseURL || undefined,
      endpoint: config.endpoint || undefined,
      timeout: 15000,
      maxRetries: 0
    });
  } else {
    client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
      timeout: 15000,
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

function validateAiPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("AI response was empty.");
  }
  if (Array.isArray(payload.qualifications) && payload.qualifications.length > 0) {
    if (!payload.qualification) {
      payload.qualification = payload.qualifications[0];
    }
  } else if (payload.qualification && payload.qualification.kind === "Qualification") {
    payload.qualifications = [payload.qualification];
  } else {
    throw new Error("AI response did not return any qualification root nodes.");
  }
  if (!payload.pages || typeof payload.pages.total !== "number") {
    throw new Error("AI response omitted page metadata.");
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
      const completion = await clientInstance.chat.completions.create({
        model: status.model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: "system", content: "Reply with OK." },
          { role: "user", content: "ping" }
        ]
      });

      const content = normalizeContent(completion.choices[0] && completion.choices[0].message
        ? completion.choices[0].message.content
        : "").trim();

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
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      return {
        ok: false,
        provider: status.provider,
        model: status.model,
        checkedAt,
        message: error.message,
        issues: [error.message]
      };
    } finally {
      span.end();
    }
  });
}

async function extractQualificationWithAi({ fileName, documentText, fallbackDraft }) {
  return tracer.startActiveSpan("qualextract.ai.extract", async (span) => {
    const prompt = readPrompt();
    const schema = readSchema();
    const model = getModelName();
    const provider = getAiProviderName();
    const clientInstance = getClient();
    const truncatedText = String(documentText || "").slice(0, 20000);

    span.setAttribute("qualextract.provider", provider);
    span.setAttribute("qualextract.model", model);
    span.setAttribute("qualextract.file_name", fileName);
    span.setAttribute("qualextract.input_chars", truncatedText.length);

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const completion = await clientInstance.chat.completions.create({
            model,
            temperature: 0.1,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "qualification_extraction",
                schema
              }
            },
            messages: [
              { role: "system", content: prompt },
              {
                role: "user",
                content: JSON.stringify({
                  fileName,
                  documentText: truncatedText,
                  fallbackQualificationCode: fallbackDraft.qualificationCode,
                  fallbackQualificationName: fallbackDraft.qualification.title
                })
              }
            ]
          });

          const content = normalizeContent(completion.choices[0] && completion.choices[0].message
            ? completion.choices[0].message.content
            : "");
          const payload = validateAiPayload(JSON.parse(content));
          span.setStatus({ code: SpanStatusCode.OK });
          return payload;
        } catch (error) {
          if (attempt === 3) {
            throw error;
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
  getAiStatus,
  getAiConfigurationIssues,
  getAiProviderName,
  isAiConfigured,
  getModelName,
  runAiConnectivityCheck,
  extractQualificationWithAi
};