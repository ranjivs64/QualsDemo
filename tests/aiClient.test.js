const test = require("node:test");
const assert = require("node:assert/strict");

function loadAiClient() {
  const modulePath = require.resolve("../server/aiClient");
  delete require.cache[modulePath];
  return require("../server/aiClient");
}

function resetAiEnv() {
  delete process.env.QUAL_AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.FOUNDRY_API_KEY;
  delete process.env.FOUNDRY_BASE_URL;
  delete process.env.FOUNDRY_API_VERSION;
}

test.beforeEach(() => {
  resetAiEnv();
});

test.after(() => {
  resetAiEnv();
});

test("ai client defaults to openai when no provider is specified", { concurrency: false }, () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  const aiClient = loadAiClient();

  assert.equal(aiClient.getAiProviderName(), "openai");
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
    }
  });
});

test("ai client supports explicit foundry provider configuration", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
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
    }
  });
});

test("foundry provider requires both api key and base url", { concurrency: false }, () => {
  process.env.QUAL_AI_PROVIDER = "foundry";
  process.env.FOUNDRY_API_KEY = "test-foundry-key";
  const aiClient = loadAiClient();

  assert.equal(aiClient.getAiProviderName(), "foundry");
  assert.equal(aiClient.isAiConfigured(), false);
  const issues = aiClient.getAiConfigurationIssues();
  assert.ok(issues.includes("FOUNDRY_API_VERSION is required when QUAL_AI_PROVIDER=foundry."));
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
  const aiClient = loadAiClient();
  const fakeClient = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: "OK"
              }
            }
          ]
        })
      }
    }
  };

  const result = await aiClient.runAiConnectivityCheck({ client: fakeClient });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.1-2026-01-15");
  assert.equal(result.message, "OK");
});