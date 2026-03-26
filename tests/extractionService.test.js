const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const tempRoot = path.join(os.tmpdir(), `qualextract-extraction-tests-${process.pid}`);
const uploadsDir = path.join(tempRoot, "uploads");
const dbPath = path.join(tempRoot, "qualextract.sqlite");

function loadExtractionServiceWithMocks(aiClientMock, uploadStoreMock, documentIntelligenceMock) {
  const extractionServicePath = require.resolve("../server/extractionService");
  const aiClientPath = require.resolve("../server/aiClient");
  const uploadStorePath = require.resolve("../server/uploadStore");
  const documentIntelligencePath = require.resolve("../server/documentIntelligenceClient");

  const originalAiClient = require.cache[aiClientPath];
  const originalUploadStore = require.cache[uploadStorePath];
  const originalDocumentIntelligence = require.cache[documentIntelligencePath];
  delete require.cache[extractionServicePath];

  require.cache[aiClientPath] = {
    id: aiClientPath,
    filename: aiClientPath,
    loaded: true,
    exports: aiClientMock
  };

  require.cache[uploadStorePath] = {
    id: uploadStorePath,
    filename: uploadStorePath,
    loaded: true,
    exports: uploadStoreMock
  };

  require.cache[documentIntelligencePath] = {
    id: documentIntelligencePath,
    filename: documentIntelligencePath,
    loaded: true,
    exports: documentIntelligenceMock
  };

  const extractionService = require("../server/extractionService");

  return {
    extractionService,
    restore() {
      delete require.cache[extractionServicePath];
      if (originalAiClient) {
        require.cache[aiClientPath] = originalAiClient;
      } else {
        delete require.cache[aiClientPath];
      }
      if (originalUploadStore) {
        require.cache[uploadStorePath] = originalUploadStore;
      } else {
        delete require.cache[uploadStorePath];
      }
      if (originalDocumentIntelligence) {
        require.cache[documentIntelligencePath] = originalDocumentIntelligence;
      } else {
        delete require.cache[documentIntelligencePath];
      }
    }
  };
}

process.env.QUAL_DB_PATH = dbPath;
process.env.QUAL_UPLOADS_DIR = uploadsDir;

const { createUploadedJob, getJob, resetState } = require("../server/jobStore");
const { closeDatabaseForTests } = require("../server/databaseStore");

test.beforeEach(() => {
  closeDatabaseForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  resetState();
});

test.after(() => {
  closeDatabaseForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("processExtractionJob converts an unresolved extraction into a review error after the worker timeout", async () => {
  const artifactPath = path.join(uploadsDir, "pending-timeout.pdf");
  fs.writeFileSync(artifactPath, Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8"));

  const created = createUploadedJob("pending-timeout.pdf", {
    originalFileName: "pending-timeout.pdf",
    storedFileName: "pending-timeout.pdf",
    mimeType: "application/pdf",
    sizeBytes: fs.statSync(artifactPath).size,
    uploadedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });

  const { extractionService, restore } = loadExtractionServiceWithMocks(
    {
      getAiConfigurationIssues: () => [],
      getAiChunkingConfig: () => ({ enabled: false, maxCharsPerRequest: 18000, overlapChars: 1200 }),
      getAiProviderName: () => "openai",
      isAiConfigured: () => true,
      getModelName: () => "gpt-5.1-2026-01-15",
      getAiRequestTimeoutMs: () => 5,
      extractQualificationWithAi: () => new Promise(() => {})
    },
    {
      resolveArtifactPath: () => artifactPath
    },
    {
      getDocumentIntelligenceConfigurationIssues: () => [],
      getDocumentIntelligenceRequestTimeoutMs: () => 5,
      getDocumentIntelligenceStatus: () => ({ model: "prebuilt-layout" }),
      isDocumentIntelligenceConfigured: () => true,
      analyzePdfWithDocumentIntelligence: () => ({
        content: "# Pending Timeout",
        contentFormat: "markdown",
        pageCount: 1,
        paragraphCount: 1,
        tableCount: 0,
        sectionCount: 0,
        figureCount: 0,
        keyValuePairCount: 0,
        modelId: "prebuilt-layout"
      })
    }
  );

  try {
    const updated = await extractionService.processExtractionJob(created.id);

    assert.equal(updated.status, "review");
    assert.equal(updated.reviewReady, false);
    assert.match(updated.extractionMeta.aiError, /Background extraction worker timed out after 15010ms\./);
    assert.equal(updated.extractionMeta.workerTimedOut, true);

    const persisted = getJob(created.id);
    assert.equal(persisted.status, "review");
    assert.match(persisted.extractionMeta.aiError, /Background extraction worker timed out after 15010ms\./);
  } finally {
    restore();
  }
});

test("createExtractionDraft sends Document Intelligence content to the LLM extraction stage", async () => {
  const artifactPath = path.join(uploadsDir, "document-intelligence.pdf");
  fs.writeFileSync(artifactPath, Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8"));

  const created = createUploadedJob("document-intelligence.pdf", {
    originalFileName: "document-intelligence.pdf",
    storedFileName: "document-intelligence.pdf",
    mimeType: "application/pdf",
    sizeBytes: fs.statSync(artifactPath).size,
    uploadedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });

  let capturedDocumentAnalysis;
  const { extractionService, restore } = loadExtractionServiceWithMocks(
    {
      getAiConfigurationIssues: () => [],
      getAiChunkingConfig: () => ({ enabled: false, maxCharsPerRequest: 18000, overlapChars: 1200 }),
      getAiProviderName: () => "openai",
      isAiConfigured: () => true,
      getModelName: () => "gpt-5.1-2026-01-15",
      getAiRequestTimeoutMs: () => 120000,
      extractQualificationWithAi: async ({ documentAnalysis }) => {
        capturedDocumentAnalysis = documentAnalysis;
        return {
          qualificationCode: "603/0455/0",
          confidence: 90,
          reviewReady: true,
          pages: { current: 1, total: 2 },
          documentFocus: { top: 28, height: 12, label: "Focus pending" },
          qualification: {
            id: "qualification-1",
            kind: "Qualification",
            title: "Vehicle Technology",
            summary: "Qualification summary",
            confidence: 90,
            fields: {
              qualificationName: "Vehicle Technology",
              code: "603/0455/0"
            },
            children: []
          },
          qualifications: [
            {
              id: "qualification-1",
              kind: "Qualification",
              title: "Vehicle Technology",
              summary: "Qualification summary",
              confidence: 90,
              fields: {
                qualificationName: "Vehicle Technology",
                code: "603/0455/0"
              },
              children: []
            }
          ],
          sourceTextExcerpt: "Vehicle Technology extracted content",
          extractionMeta: {
            contractVersion: "qualification-authoritative-v1"
          }
        };
      }
    },
    {
      resolveArtifactPath: () => artifactPath
    },
    {
      getDocumentIntelligenceConfigurationIssues: () => [],
      getDocumentIntelligenceRequestTimeoutMs: () => 120000,
      getDocumentIntelligenceStatus: () => ({ model: "prebuilt-layout" }),
      isDocumentIntelligenceConfigured: () => true,
      analyzePdfWithDocumentIntelligence: async () => ({
        content: "# Vehicle Technology\n\n## Mandatory Units",
        contentFormat: "markdown",
        pageCount: 2,
        paragraphCount: 4,
        tableCount: 1,
        sectionCount: 2,
        figureCount: 0,
        keyValuePairCount: 0,
        modelId: "prebuilt-layout"
      })
    }
  );

  try {
    const draft = await extractionService.createExtractionDraft(created);

    assert.ok(capturedDocumentAnalysis);
    assert.equal(capturedDocumentAnalysis.contentFormat, "markdown");
    assert.match(capturedDocumentAnalysis.content, /Vehicle Technology/);
    assert.equal(draft.extractionMeta.inputMode, "document-intelligence-markdown");
    assert.equal(draft.extractionMeta.documentIntelligence.tableCount, 1);
  } finally {
    restore();
  }
});