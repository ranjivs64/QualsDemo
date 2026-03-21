const test = require("node:test");
const assert = require("node:assert/strict");

function loadAiClient() {
  const modulePath = require.resolve("../server/aiClient");
  delete require.cache[modulePath];
  return require("../server/aiClient");
}

function resetAiEnv() {
  delete process.env.QUAL_AI_PROVIDER;
  delete process.env.QUAL_AI_TIMEOUT_MS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.FOUNDRY_API_KEY;
  delete process.env.FOUNDRY_BASE_URL;
  delete process.env.FOUNDRY_ENDPOINT;
  delete process.env.FOUNDRY_API_VERSION;
  delete process.env.QUAL_AI_MODEL;
  delete process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.DOCUMENT_INTELLIGENCE_API_KEY;
  delete process.env.DOCUMENT_INTELLIGENCE_API_VERSION;
  delete process.env.DOCUMENT_INTELLIGENCE_MODEL;
  delete process.env.DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT;
  delete process.env.DOCUMENT_INTELLIGENCE_TIMEOUT_MS;
}

function configureDocumentIntelligenceEnv() {
  process.env.DOCUMENT_INTELLIGENCE_ENDPOINT = "https://document-intelligence.example.test";
  process.env.DOCUMENT_INTELLIGENCE_API_KEY = "test-document-intelligence-key";
  process.env.DOCUMENT_INTELLIGENCE_API_VERSION = "2024-11-30";
  process.env.DOCUMENT_INTELLIGENCE_MODEL = "prebuilt-layout";
}

test.beforeEach(() => {
  resetAiEnv();
});

test.after(() => {
  resetAiEnv();
});

test("ai client defaults to openai when no provider is specified", { concurrency: false }, () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  configureDocumentIntelligenceEnv();
  const aiClient = loadAiClient();

  assert.equal(aiClient.getAiProviderName(), "openai");
  assert.equal(aiClient.getAiRequestTimeoutMs(), 120000);
  assert.equal(aiClient.isAiConfigured(), true);
  assert.deepEqual(aiClient.getAiStatus(), {
    provider: "openai",
    configured: true,
    model: "gpt-5.1-2026-01-15",
    issues: [],
    capabilities: {
      apiKeyConfigured: true,
      baseUrlConfigured: false,
      endpointConfigured: false,
      apiVersionConfigured: false
    },
    documentIntelligence: {
      configured: true,
      endpoint: "https://document-intelligence.example.test",
      apiVersion: "2024-11-30",
      model: "prebuilt-layout",
      outputFormat: "markdown",
      issues: [],
      capabilities: {
        endpointConfigured: true,
        apiKeyConfigured: true,
        apiVersionConfigured: true,
        markdownOutputEnabled: true
      }
    }
  });
});

test("ai client falls back to the default timeout when QUAL_AI_TIMEOUT_MS is invalid", { concurrency: false }, () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  configureDocumentIntelligenceEnv();
  process.env.QUAL_AI_TIMEOUT_MS = "invalid";
  const aiClient = loadAiClient();

  assert.equal(aiClient.getAiRequestTimeoutMs(), 120000);
  assert.ok(aiClient.getAiConfigurationIssues().includes("QUAL_AI_TIMEOUT_MS must be a positive integer when provided."));
});

test("ai client honors a configured timeout override", { concurrency: false }, () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  configureDocumentIntelligenceEnv();
  process.env.QUAL_AI_TIMEOUT_MS = "180000";
  const aiClient = loadAiClient();

  assert.equal(aiClient.getAiRequestTimeoutMs(), 180000);
  assert.equal(aiClient.getAiConfigurationIssues().includes("QUAL_AI_TIMEOUT_MS must be a positive integer when provided."), false);
});

test("ai client supports explicit foundry provider configuration", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  configureDocumentIntelligenceEnv();
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  process.env.FOUNDRY_API_VERSION = "2026-01-01-preview";
  process.env.FOUNDRY_ENDPOINT = "https://foundry.example.test";
  const aiClient = loadAiClient();

  assert.equal(aiClient.getAiProviderName(), "foundry");
  assert.equal(aiClient.isAiConfigured(), true);
  assert.deepEqual(aiClient.getAiStatus(), {
    provider: "foundry",
    configured: true,
    model: "gpt-5.1-2026-01-15",
    issues: [],
    capabilities: {
      apiKeyConfigured: true,
      baseUrlConfigured: false,
      endpointConfigured: true,
      apiVersionConfigured: true
    },
    documentIntelligence: {
      configured: true,
      endpoint: "https://document-intelligence.example.test",
      apiVersion: "2024-11-30",
      model: "prebuilt-layout",
      outputFormat: "markdown",
      issues: [],
      capabilities: {
        endpointConfigured: true,
        apiKeyConfigured: true,
        apiVersionConfigured: true,
        markdownOutputEnabled: true
      }
    }
  });
});

test("foundry provider requires either endpoint or base url", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  const aiClient = loadAiClient();

  assert.equal(aiClient.getAiProviderName(), "foundry");
  assert.equal(aiClient.isAiConfigured(), false);
  const issues = aiClient.getAiConfigurationIssues();
  assert.ok(issues.includes("Either FOUNDRY_BASE_URL or FOUNDRY_ENDPOINT is required when QUAL_AI_PROVIDER=foundry."));
});

test("foundry provider rejects unresolved Key Vault references", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  configureDocumentIntelligenceEnv();
  process.env.FOUNDRY_API_KEY = "@Microsoft.KeyVault(VaultName=kv-example;SecretName=foundry-api-key)";
  process.env.FOUNDRY_ENDPOINT = "https://foundry.example.test";
  process.env.FOUNDRY_API_VERSION = "2026-01-01-preview";
  const aiClient = loadAiClient();

  assert.equal(aiClient.isAiConfigured(), false);
  assert.ok(
    aiClient.getAiConfigurationIssues().includes(
      "FOUNDRY_API_KEY contains an unresolved Key Vault reference. Restart the app or fix the web app identity and Key Vault permissions."
    )
  );
});

test("foundry provider allows a v1 base url without an api version", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  configureDocumentIntelligenceEnv();
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  process.env.FOUNDRY_BASE_URL = "https://foundry.example.test/openai/v1";
  const aiClient = loadAiClient();

  assert.equal(aiClient.isAiConfigured(), true);
  assert.deepEqual(aiClient.getAiConfigurationIssues(), []);
});

test("foundry provider rejects non-https base urls", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  process.env.FOUNDRY_BASE_URL = "http://foundry.example.test/openai/v1";
  process.env.FOUNDRY_API_VERSION = "2026-01-01-preview";
  const aiClient = loadAiClient();

  assert.equal(aiClient.isAiConfigured(), false);
  const issues = aiClient.getAiConfigurationIssues();
  assert.ok(issues.includes("FOUNDRY_BASE_URL must start with https://."));
});

test("foundry provider requires an OpenAI-compatible v1 base url", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  process.env.FOUNDRY_BASE_URL = "https://foundry.example.test";
  process.env.FOUNDRY_API_VERSION = "2026-01-01-preview";
  const aiClient = loadAiClient();

  assert.equal(aiClient.isAiConfigured(), false);
  const issues = aiClient.getAiConfigurationIssues();
  assert.ok(issues.includes("FOUNDRY_BASE_URL must be the full OpenAI-compatible base URL ending in /openai/v1."));
});

test("foundry provider rejects simultaneous base url and endpoint", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  process.env.FOUNDRY_BASE_URL = "https://foundry.example.test/openai/v1";
  process.env.FOUNDRY_ENDPOINT = "https://foundry.example.test";
  process.env.FOUNDRY_API_VERSION = "2026-01-01-preview";
  const aiClient = loadAiClient();

  assert.equal(aiClient.isAiConfigured(), false);
  assert.deepEqual(aiClient.getAiConfigurationIssues(), [
    "FOUNDRY_BASE_URL and FOUNDRY_ENDPOINT are mutually exclusive."
  ]);
});

test("connectivity check reports configuration issues without calling the provider", { concurrency: false }, async () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  const aiClient = loadAiClient();

  const result = await aiClient.runAiConnectivityCheck();

  assert.equal(result.ok, false);
  assert.equal(result.provider, "foundry");
  assert.ok(result.issues.includes("FOUNDRY API key is missing."));
});

test("connectivity check succeeds with an injected client", { concurrency: false }, async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  configureDocumentIntelligenceEnv();
  const aiClient = loadAiClient();
  let capturedRequest;
  const fakeClient = {
    responses: {
      create: async (request) => {
        capturedRequest = request;
        return {
          output_text: "OK"
        };
      }
    }
  };

  const result = await aiClient.runAiConnectivityCheck({ client: fakeClient });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.1-2026-01-15");
  assert.equal(result.message, "OK");
  assert.equal(capturedRequest.max_output_tokens, 16);
  assert.equal("temperature" in capturedRequest, false);
});

test("connectivity check adds Foundry-specific guidance for 404 errors", { concurrency: false }, async () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  configureDocumentIntelligenceEnv();
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  process.env.FOUNDRY_API_VERSION = "2025-03-01-preview";
  process.env.FOUNDRY_ENDPOINT = "https://foundry.example.test";
  process.env.QUAL_AI_MODEL = "gpt-5";
  const aiClient = loadAiClient();
  const fakeClient = {
    responses: {
      create: async () => {
        throw new Error("404 Resource not found");
      }
    }
  };

  const result = await aiClient.runAiConnectivityCheck({ client: fakeClient });

  assert.equal(result.ok, false);
  assert.match(result.message, /QUAL_AI_MODEL matches the Azure OpenAI deployment name exactly/);
  assert.match(result.message, /FOUNDRY_API_VERSION=2025-03-01-preview/);
});

test("extractQualificationWithAi normalizes authoritative payloads into the internal review graph", { concurrency: false }, async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  configureDocumentIntelligenceEnv();
  const aiClient = loadAiClient();
  const extractionContext = {
    confidence: 78,
    pages: { current: 1, total: 92 },
    documentFocus: { top: 28, height: 12, label: "Focus pending" },
    sourceTextExcerpt: "Qualification specification excerpt"
  };
  let capturedRequest;
  const fakeClient = {
    responses: {
      create: async (request) => {
        capturedRequest = request;
        return {
          output_text: JSON.stringify({
            Qualifications: {
              confidence: 86,
              needsAttention: false,
              guidance: "",
              qualifications: [
                {
                  id: "extended-diploma",
                  qualificationCode: "603/0455/0",
                  qualificationName: "Pearson BTEC Level 3 National Extended Diploma in Business",
                  qualificationType: "Diploma",
                  level: "Level 3",
                  awardingBody: "Pearson",
                  gradingScheme: "Pass / Merit / Distinction",
                  derivedFrom: null,
                  rulesOfCombination: {
                    totalCredits: 180,
                    mandatoryCredits: 120,
                    optionalCredits: 60,
                    constraints: ["Complete all mandatory units"]
                  },
                  unitGroups: [
                    {
                      id: "group-mandatory",
                      groupType: "Mandatory",
                      selectionRule: "All listed units must be completed",
                      minimumCredits: 120,
                      maximumCredits: null,
                      units: [
                        {
                          unitNumber: "Unit 1",
                          unitTitle: "Exploring Business",
                          glh: 90,
                          creditValue: 10,
                          assessmentType: "Internal",
                          learningObjectives: [
                            {
                              id: "lo-1",
                              text: "Explore the features of business activity."
                            }
                          ],
                          confidence: 88,
                          needsAttention: false,
                          guidance: ""
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          })
        };
      }
    }
  };

  const result = await aiClient.extractQualificationWithAi({
    fileName: "business-spec.pdf",
    documentAnalysis: {
      content: "# Pearson BTEC Level 3 National Extended Diploma in Business\n\n## Mandatory Units\n\nUnit 1 Exploring Business",
      contentFormat: "markdown",
      pageCount: 92,
      paragraphCount: 12,
      tableCount: 3,
      sectionCount: 8,
      figureCount: 0,
      keyValuePairCount: 0
    },
    extractionContext,
    client: fakeClient
  });

  assert.equal(capturedRequest.instructions.includes("single authoritative grounding specification"), true);
  assert.equal(capturedRequest.input[0].content[0].type, "input_text");
  assert.match(capturedRequest.input[0].content[0].text, /Azure AI Document Intelligence layout analysis/);
  assert.equal(capturedRequest.input[0].content[1].type, "input_text");
  assert.match(capturedRequest.input[0].content[1].text, /Document Intelligence extracted content:/);
  assert.equal(capturedRequest.text.format.type, "json_schema");
  assert.equal(capturedRequest.text.format.strict, true);
  assert.equal("temperature" in capturedRequest, false);
  assert.equal(result.qualification.kind, "Qualification");
  assert.equal(result.qualifications.length, 1);
  assert.equal(result.qualification.children[0].kind, "Unit Group");
  assert.equal(result.qualification.children[0].children[0].kind, "Unit");
  assert.equal(result.qualification.children[0].children[0].children[0].kind, "Learning Outcome");
  assert.equal(result.qualificationCode, "603/0455/0");
  assert.equal(result.sourceTextExcerpt, "Qualification specification excerpt");
  assert.equal(result.extractionMeta.contractVersion, "qualification-authoritative-v1");
});