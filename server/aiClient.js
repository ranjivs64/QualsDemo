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
const DEFAULT_AI_CHUNKING_ENABLED = false;
const DEFAULT_AI_MAX_CHARS_PER_REQUEST = 10000;
const DEFAULT_AI_CHUNK_OVERLAP_CHARS = 800;
const AI_REQUEST_TIMEOUT_BUFFER_MS = 5000;

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getBooleanEnv(name, fallback) {
  const rawValue = String(process.env[name] || "").trim().toLowerCase();
  if (!rawValue) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }

  return fallback;
}

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
  return getPositiveIntegerEnv("QUAL_AI_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS);
}

function getAiChunkingConfig() {
  const enabled = getBooleanEnv("QUAL_AI_CHUNKING_ENABLED", DEFAULT_AI_CHUNKING_ENABLED);
  const maxCharsPerRequest = getPositiveIntegerEnv("QUAL_AI_MAX_CHARS_PER_REQUEST", DEFAULT_AI_MAX_CHARS_PER_REQUEST);
  const overlapChars = Math.min(
    getPositiveIntegerEnv("QUAL_AI_CHUNK_OVERLAP_CHARS", DEFAULT_AI_CHUNK_OVERLAP_CHARS),
    Math.max(maxCharsPerRequest - 1, 1)
  );

  return {
    enabled,
    maxCharsPerRequest,
    overlapChars
  };
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

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function buildDocumentAnalysisInputs(fileName, documentAnalysis, chunkContext) {
  if (!documentAnalysis || typeof documentAnalysis !== "object") {
    throw new Error("Document Intelligence analysis is required for AI extraction.");
  }

  if (!documentAnalysis.content || typeof documentAnalysis.content !== "string") {
    throw new Error("Document Intelligence analysis did not provide extracted content.");
  }

  const inputs = [
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
        keyValuePairCount: documentAnalysis.keyValuePairCount || 0,
        chunkIndex: chunkContext ? chunkContext.index : 1,
        totalChunks: chunkContext ? chunkContext.total : 1,
        startOffset: chunkContext ? chunkContext.startOffset : 0,
        endOffset: chunkContext ? chunkContext.endOffset : documentAnalysis.content.length
      })
    }
  ];

  if (chunkContext && chunkContext.total > 1) {
    inputs.push({
      type: "input_text",
      text: `Chunk scope note: this request contains chunk ${chunkContext.index} of ${chunkContext.total} from the full Document Intelligence output. Return only qualification evidence present in this chunk. Partial qualification, rule, unit-group, unit, and learning-objective structures are acceptable here; do not invent missing values from unseen chunks.`
    });
  }

  inputs.push({
    type: "input_text",
    text: `Document Intelligence extracted content:\n\n${chunkContext ? chunkContext.content : documentAnalysis.content}`
  });

  return inputs;
}

function findPreferredChunkBreak(content, start, end) {
  const minimumBreak = start + Math.floor((end - start) * 0.6);
  const candidates = ["\n# ", "\n## ", "\n### ", "\n\n", "\n"];

  for (const candidate of candidates) {
    const index = content.lastIndexOf(candidate, end);
    if (index > minimumBreak) {
      return index;
    }
  }

  return end;
}

function splitDocumentAnalysisIntoChunks(documentAnalysis) {
  const content = String(documentAnalysis && documentAnalysis.content || "").trim();
  if (!content) {
    return [];
  }

  const config = getAiChunkingConfig();
  if (!config.enabled || content.length <= config.maxCharsPerRequest) {
    return [{
      index: 1,
      total: 1,
      startOffset: 0,
      endOffset: content.length,
      content
    }];
  }

  const chunks = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + config.maxCharsPerRequest, content.length);
    if (end < content.length) {
      end = findPreferredChunkBreak(content, start, end);
    }

    const chunkContent = content.slice(start, end).trim();
    if (chunkContent) {
      chunks.push({
        startOffset: start,
        endOffset: end,
        content: chunkContent
      });
    }

    if (end >= content.length) {
      break;
    }

    start = Math.max(end - config.overlapChars, start + 1);
  }

  return chunks.map((chunk, index) => ({
    ...chunk,
    index: index + 1,
    total: chunks.length
  }));
}

function isMeaningfulString(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized.toLowerCase() !== "pending";
}

function pickPreferredString(currentValue, nextValue) {
  if (!isMeaningfulString(currentValue)) {
    return nextValue;
  }
  if (!isMeaningfulString(nextValue)) {
    return currentValue;
  }
  return String(nextValue).trim().length > String(currentValue).trim().length ? nextValue : currentValue;
}

function pickPreferredNullableString(currentValue, nextValue) {
  if (!isMeaningfulString(currentValue)) {
    return nextValue;
  }
  if (!isMeaningfulString(nextValue)) {
    return currentValue;
  }
  return String(nextValue).trim().length > String(currentValue).trim().length ? nextValue : currentValue;
}

function pickPreferredNumber(currentValue, nextValue) {
  if (!Number.isFinite(currentValue)) {
    return Number.isFinite(nextValue) ? nextValue : currentValue;
  }
  return currentValue;
}

function mergeUniqueStrings(...collections) {
  const values = [];
  const seen = new Set();

  for (const collection of collections) {
    const entries = Array.isArray(collection) ? collection : [collection];
    for (const entry of entries) {
      if (!isMeaningfulString(entry)) {
        continue;
      }
      const normalized = normalizeText(entry);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      values.push(String(entry).trim());
    }
  }

  return values;
}

function mergeLearningObjectives(currentObjectives, nextObjectives) {
  const merged = new Map();

  for (const objective of [...(Array.isArray(currentObjectives) ? currentObjectives : []), ...(Array.isArray(nextObjectives) ? nextObjectives : [])]) {
    if (!objective || typeof objective !== "object") {
      continue;
    }

    const key = normalizeText(objective.id || objective.text || JSON.stringify(objective));
    if (!key) {
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, {
        id: objective.id,
        text: objective.text
      });
      continue;
    }

    const current = merged.get(key);
    current.id = pickPreferredString(current.id, objective.id);
    current.text = pickPreferredString(current.text, objective.text);
  }

  return Array.from(merged.values());
}

function mergeUnits(currentUnits, nextUnits) {
  const merged = new Map();

  for (const unit of [...(Array.isArray(currentUnits) ? currentUnits : []), ...(Array.isArray(nextUnits) ? nextUnits : [])]) {
    if (!unit || typeof unit !== "object") {
      continue;
    }

    const key = normalizeText(unit.unitNumber || unit.unitTitle || JSON.stringify(unit));
    if (!key) {
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, {
        ...unit,
        learningObjectives: mergeLearningObjectives(unit.learningObjectives, [])
      });
      continue;
    }

    const current = merged.get(key);
    current.unitNumber = pickPreferredString(current.unitNumber, unit.unitNumber);
    current.unitTitle = pickPreferredString(current.unitTitle, unit.unitTitle);
    current.glh = pickPreferredNumber(current.glh, unit.glh);
    current.creditValue = pickPreferredNumber(current.creditValue, unit.creditValue);
    current.assessmentType = pickPreferredNullableString(current.assessmentType, unit.assessmentType);
    current.confidence = Math.max(Number(current.confidence) || 0, Number(unit.confidence) || 0);
    current.needsAttention = Boolean(current.needsAttention || unit.needsAttention);
    current.guidance = mergeUniqueStrings(current.guidance, unit.guidance).join(" ");
    current.learningObjectives = mergeLearningObjectives(current.learningObjectives, unit.learningObjectives);
  }

  return Array.from(merged.values());
}

function mergeUnitGroups(currentGroups, nextGroups) {
  const merged = new Map();

  for (const group of [...(Array.isArray(currentGroups) ? currentGroups : []), ...(Array.isArray(nextGroups) ? nextGroups : [])]) {
    if (!group || typeof group !== "object") {
      continue;
    }

    const key = normalizeText(group.id || `${group.groupType || "group"}-${group.selectionRule || ""}`);
    if (!key) {
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, {
        ...group,
        units: mergeUnits(group.units, [])
      });
      continue;
    }

    const current = merged.get(key);
    current.id = pickPreferredString(current.id, group.id);
    current.groupType = pickPreferredString(current.groupType, group.groupType);
    current.selectionRule = pickPreferredString(current.selectionRule, group.selectionRule);
    current.minimumCredits = pickPreferredNumber(current.minimumCredits, group.minimumCredits);
    current.maximumCredits = pickPreferredNumber(current.maximumCredits, group.maximumCredits);
    current.units = mergeUnits(current.units, group.units);
  }

  return Array.from(merged.values());
}

function mergeRulesOfCombination(currentRules, nextRules) {
  return {
    totalCredits: pickPreferredNumber(currentRules && currentRules.totalCredits, nextRules && nextRules.totalCredits),
    mandatoryCredits: pickPreferredNumber(currentRules && currentRules.mandatoryCredits, nextRules && nextRules.mandatoryCredits),
    optionalCredits: pickPreferredNumber(currentRules && currentRules.optionalCredits, nextRules && nextRules.optionalCredits),
    constraints: mergeUniqueStrings(currentRules && currentRules.constraints, nextRules && nextRules.constraints)
  };
}

function mergeQualifications(qualifications) {
  const merged = new Map();

  for (const qualification of qualifications) {
    if (!qualification || typeof qualification !== "object") {
      continue;
    }

    const key = normalizeText(qualification.qualificationCode || qualification.id || qualification.qualificationName);
    if (!key) {
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, {
        ...qualification,
        rulesOfCombination: mergeRulesOfCombination(qualification.rulesOfCombination, {}),
        unitGroups: mergeUnitGroups(qualification.unitGroups, [])
      });
      continue;
    }

    const current = merged.get(key);
    current.id = pickPreferredString(current.id, qualification.id);
    current.qualificationCode = pickPreferredString(current.qualificationCode, qualification.qualificationCode);
    current.qualificationName = pickPreferredString(current.qualificationName, qualification.qualificationName);
    current.qualificationType = pickPreferredString(current.qualificationType, qualification.qualificationType);
    current.level = pickPreferredString(current.level, qualification.level);
    current.awardingBody = pickPreferredString(current.awardingBody, qualification.awardingBody);
    current.gradingScheme = pickPreferredString(current.gradingScheme, qualification.gradingScheme);
    current.derivedFrom = pickPreferredNullableString(current.derivedFrom, qualification.derivedFrom);
    current.rulesOfCombination = mergeRulesOfCombination(current.rulesOfCombination, qualification.rulesOfCombination);
    current.unitGroups = mergeUnitGroups(current.unitGroups, qualification.unitGroups);
  }

  return Array.from(merged.values());
}

function mergeAuthoritativePayloads(payloads) {
  const envelopes = payloads
    .map((payload) => payload && payload.Qualifications ? payload.Qualifications : null)
    .filter(Boolean);
  const confidenceValues = envelopes
    .map((envelope) => Number(envelope.confidence))
    .filter((value) => Number.isFinite(value));

  return {
    Qualifications: {
      confidence: confidenceValues.length
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : 0,
      needsAttention: envelopes.some((envelope) => envelope.needsAttention),
      guidance: mergeUniqueStrings(envelopes.map((envelope) => envelope.guidance)).join(" "),
      qualifications: mergeQualifications(envelopes.flatMap((envelope) => envelope.qualifications || []))
    }
  };
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

async function requestAuthoritativePayload({
  chunk,
  clientInstance,
  fileName,
  documentAnalysis,
  model,
  prompt,
  provider,
  schema
}) {
  const content = buildDocumentAnalysisInputs(fileName, documentAnalysis, chunk);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await withTimeout(
        clientInstance.responses.create({
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
          }
        }),
        getAiRequestTimeoutMs() + AI_REQUEST_TIMEOUT_BUFFER_MS,
        `AI extraction request timed out after ${getAiRequestTimeoutMs() + AI_REQUEST_TIMEOUT_BUFFER_MS}ms.`
      );

      const responseText = normalizeContent(getResponseText(response));
      return validateAiPayload(JSON.parse(responseText));
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

  throw new Error("AI extraction did not return a valid authoritative payload.");
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

async function extractQualificationWithAi({ fileName, documentAnalysis, extractionContext, client: injectedClient, onProgress }) {
  return tracer.startActiveSpan("qualextract.ai.extract", async (span) => {
    const prompt = readPrompt();
    const schema = readSchema();
    const model = getModelName();
    const provider = getAiProviderName();
    const clientInstance = injectedClient || getClient();
    const chunkingConfig = getAiChunkingConfig();
    const chunks = splitDocumentAnalysisIntoChunks(documentAnalysis);
    const chunkingEnabled = chunkingConfig.enabled && chunks.length > 1;
    const authoritativePayloads = [];

    span.setAttribute("qualextract.provider", provider);
    span.setAttribute("qualextract.model", model);
    span.setAttribute("qualextract.file_name", fileName);
    span.setAttribute("qualextract.document_intelligence.page_count", documentAnalysis && documentAnalysis.pageCount ? documentAnalysis.pageCount : 0);
    span.setAttribute("qualextract.document_intelligence.table_count", documentAnalysis && documentAnalysis.tableCount ? documentAnalysis.tableCount : 0);
    span.setAttribute("qualextract.chunk_count", chunks.length || 1);

    try {
      if (typeof onProgress === "function") {
        onProgress({
          phase: chunkingEnabled ? "chunking" : "ai-extraction",
          title: chunkingEnabled ? "Extracting chunked document" : "Extracting qualification structure",
          detail: chunkingEnabled
            ? `Prepared ${chunks.length} bounded AI chunks from the extracted markdown.`
            : "Running a single authoritative AI extraction pass.",
          percent: 35,
          chunking: {
            enabled: chunkingEnabled,
            totalChunks: chunks.length,
            completedChunks: 0,
            currentChunk: chunkingEnabled ? 1 : null,
            maxCharsPerRequest: chunkingConfig.maxCharsPerRequest,
            overlapChars: chunkingConfig.overlapChars
          }
        });
      }

      for (const chunk of chunks) {
        if (typeof onProgress === "function") {
          onProgress({
            phase: "ai-extraction",
            title: chunkingEnabled
              ? `Extracting chunk ${chunk.index} of ${chunk.total}`
              : "Extracting qualification structure",
            detail: chunkingEnabled
              ? `Resolving authoritative qualification data from chunk ${chunk.index} of ${chunk.total}.`
              : "Resolving authoritative qualification data from the extracted markdown.",
            percent: Math.min(85, 35 + Math.round(((chunk.index - 1) / chunk.total) * 50)),
            chunking: {
              enabled: chunkingEnabled,
              totalChunks: chunk.total,
              completedChunks: chunk.index - 1,
              currentChunk: chunkingEnabled ? chunk.index : null,
              maxCharsPerRequest: chunkingConfig.maxCharsPerRequest,
              overlapChars: chunkingConfig.overlapChars
            }
          });
        }

        authoritativePayloads.push(await requestAuthoritativePayload({
          chunk,
          clientInstance,
          fileName,
          documentAnalysis,
          model,
          prompt,
          provider,
          schema
        }));
      }

      if (typeof onProgress === "function") {
        onProgress({
          phase: "consolidation",
          title: "Consolidating extraction",
          detail: chunkingEnabled
            ? `Merging ${chunks.length} chunk-level authoritative payloads into one review draft.`
            : "Normalizing the authoritative payload for review.",
          percent: 90,
          chunking: {
            enabled: chunkingEnabled,
            totalChunks: chunks.length,
            completedChunks: chunks.length,
            currentChunk: chunkingEnabled ? chunks.length : null,
            maxCharsPerRequest: chunkingConfig.maxCharsPerRequest,
            overlapChars: chunkingConfig.overlapChars
          }
        });
      }

      const payload = authoritativePayloads.length === 1
        ? authoritativePayloads[0]
        : mergeAuthoritativePayloads(authoritativePayloads);
      const normalizedDraft = normalizeAuthoritativeAiPayload(payload, extractionContext);
      normalizedDraft.extractionMeta = {
        ...(normalizedDraft.extractionMeta || {}),
        chunking: {
          enabled: chunkingEnabled,
          totalChunks: chunks.length,
          maxCharsPerRequest: chunkingConfig.maxCharsPerRequest,
          overlapChars: chunkingConfig.overlapChars,
          sourceChars: String(documentAnalysis && documentAnalysis.content || "").length
        }
      };
      span.setAttribute(
        "qualextract.authoritative_qualification_count",
        payload.Qualifications.qualifications.length
      );
      span.setAttribute("qualextract.contract_version", AUTHORITATIVE_CONTRACT_VERSION);
      span.setStatus({ code: SpanStatusCode.OK });
      return normalizedDraft;
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
  getAiChunkingConfig,
  getAiStatus,
  getAiConfigurationIssues,
  getAiProviderName,
  isAiConfigured,
  getModelName,
  runAiConnectivityCheck,
  extractQualificationWithAi
};