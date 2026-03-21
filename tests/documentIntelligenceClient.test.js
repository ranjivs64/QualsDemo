const test = require("node:test");
const assert = require("node:assert/strict");

function loadDocumentIntelligenceClient() {
  const modulePath = require.resolve("../server/documentIntelligenceClient");
  delete require.cache[modulePath];
  return require("../server/documentIntelligenceClient");
}

function resetDocumentIntelligenceEnv() {
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
  resetDocumentIntelligenceEnv();
});

test.after(() => {
  resetDocumentIntelligenceEnv();
});

test("document intelligence status reports missing configuration", { concurrency: false }, () => {
  const client = loadDocumentIntelligenceClient();

  assert.equal(client.isDocumentIntelligenceConfigured(), false);
  assert.deepEqual(client.getDocumentIntelligenceConfigurationIssues(), [
    "DOCUMENT_INTELLIGENCE_ENDPOINT is required.",
    "DOCUMENT_INTELLIGENCE_API_KEY is missing."
  ]);
});

test("document intelligence configuration rejects unresolved Key Vault references", { concurrency: false }, () => {
  process.env.DOCUMENT_INTELLIGENCE_ENDPOINT = "https://document-intelligence.example.test";
  process.env.DOCUMENT_INTELLIGENCE_API_KEY = "@Microsoft.KeyVault(VaultName=kv-example;SecretName=document-intelligence-api-key)";
  const client = loadDocumentIntelligenceClient();

  assert.equal(client.isDocumentIntelligenceConfigured(), false);
  assert.ok(
    client.getDocumentIntelligenceConfigurationIssues().includes(
      "DOCUMENT_INTELLIGENCE_API_KEY contains an unresolved Key Vault reference. Restart the app or fix the web app identity and Key Vault permissions."
    )
  );
});

test("document intelligence analyze request polls until the operation succeeds", { concurrency: false }, async () => {
  configureDocumentIntelligenceEnv();
  const client = loadDocumentIntelligenceClient();
  const requests = [];
  let callCount = 0;

  const result = await client.analyzePdfWithDocumentIntelligence({
    fileName: "vehicle.pdf",
    pdfBuffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8"),
    fetch: async (url, options) => {
      requests.push({ url, options });
      callCount += 1;

      if (callCount === 1) {
        return new Response(JSON.stringify({ status: "running" }), {
          status: 202,
          headers: {
            "operation-location": "https://document-intelligence.example.test/documentintelligence/documentModels/prebuilt-layout/analyzeResults/123?api-version=2024-11-30"
          }
        });
      }

      return new Response(JSON.stringify({
        status: "succeeded",
        analyzeResult: {
          content: "# Vehicle Technology\n\n<table><tr><th>Unit</th></tr><tr><td>Engine Systems</td></tr></table>",
          contentFormat: "markdown",
          pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
          paragraphs: [{}, {}],
          tables: [{}],
          sections: [{}],
          figures: [],
          keyValuePairs: []
        }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /outputContentFormat=markdown/);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[1].options.method, "GET");
  assert.equal(result.pageCount, 2);
  assert.equal(result.tableCount, 1);
  assert.equal(result.sectionCount, 1);
  assert.equal(result.contentFormat, "markdown");
  assert.match(result.content, /Vehicle Technology/);
});