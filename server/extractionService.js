const fs = require("node:fs");

const { getJob, hydrateJobForReview, markExtractionJobStarted } = require("./jobStore");
const { resolveArtifactPath } = require("./uploadStore");
const {
  analyzePdfWithDocumentIntelligence,
  getDocumentIntelligenceConfigurationIssues,
  getDocumentIntelligenceStatus,
  isDocumentIntelligenceConfigured
} = require("./documentIntelligenceClient");
const {
  getAiConfigurationIssues,
  getAiProviderName,
  isAiConfigured,
  getModelName,
  getAiRequestTimeoutMs,
  extractQualificationWithAi
} = require("./aiClient");

const EXTRACTION_TIMEOUT_BUFFER_MS = 15000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultPages(job, pageCount) {
  return {
    current: 1,
    total: pageCount || (job && job.pages ? job.pages.total : 1) || 1
  };
}

function getDefaultDocumentFocus() {
  return { top: 28, height: 12, label: "Focus pending" };
}

function resolveArtifact(job) {
  if (!job || !job.artifact || !job.artifact.storedFileName) {
    return null;
  }

  const artifactPath = resolveArtifactPath(job.artifact.storedFileName);
  if (!artifactPath) {
    return null;
  }

  return {
    artifactPath,
    fileName: job.artifact.originalFileName || job.fileName,
    mimeType: job.artifact.mimeType || "application/pdf",
    buffer: fs.readFileSync(artifactPath)
  };
}

function buildAnalysisFromDocumentIntelligence(job, analysis) {
  const defaultAnalysis = {
    pageCount: job && job.pages ? job.pages.total : 0,
    sourceTextExcerpt: null,
    documentIntelligence: null
  };

  if (!analysis) {
    return defaultAnalysis;
  }

  return {
    pageCount: analysis.pageCount || defaultAnalysis.pageCount,
    sourceTextExcerpt: String(analysis.content || "").slice(0, 1000) || null,
    documentIntelligence: {
      contentFormat: analysis.contentFormat || "markdown",
      model: analysis.modelId || getDocumentIntelligenceStatus().model,
      pageCount: analysis.pageCount || defaultAnalysis.pageCount,
      paragraphCount: analysis.paragraphCount || 0,
      tableCount: analysis.tableCount || 0,
      sectionCount: analysis.sectionCount || 0,
      figureCount: analysis.figureCount || 0,
      keyValuePairCount: analysis.keyValuePairCount || 0
    }
  };
}

function buildExtractionContext(job, analysis) {
  return {
    confidence: 80,
    pages: getDefaultPages(job, analysis.pageCount),
    documentFocus: getDefaultDocumentFocus(),
    sourceTextExcerpt: analysis.sourceTextExcerpt
  };
}

function getExtractionJobTimeoutMs() {
  return getAiRequestTimeoutMs() + EXTRACTION_TIMEOUT_BUFFER_MS;
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
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

function buildTimeoutAnalysis(job) {
  return {
    pageCount: job && job.pages ? job.pages.total : 0,
    sourceTextExcerpt: job && job.sourceTextExcerpt ? job.sourceTextExcerpt : null,
    documentIntelligence: null
  };
}

function buildPendingDraft(job, analysis, extras) {
  const context = buildExtractionContext(job, analysis);
  const documentIntelligence = analysis && analysis.documentIntelligence ? analysis.documentIntelligence : null;
  return {
    qualificationCode: "Pending",
    confidence: 0,
    reviewReady: false,
    pages: context.pages,
    documentFocus: context.documentFocus,
    qualification: null,
    qualifications: [],
    sourceTextExcerpt: context.sourceTextExcerpt,
    extractionMeta: {
      provider: getAiProviderName(),
      model: getModelName(),
      pageCount: context.pages.total,
      extractedAt: new Date().toISOString(),
      inputMode: "document-intelligence-markdown",
      documentIntelligence,
      ...(extras || {})
    }
  };
}

function mergeAiDraft(aiDraft, job, analysis) {
  const context = buildExtractionContext(job, analysis);
  const documentIntelligence = analysis && analysis.documentIntelligence ? analysis.documentIntelligence : null;
  return {
    ...aiDraft,
    pages: aiDraft.pages || context.pages,
    documentFocus: aiDraft.documentFocus || context.documentFocus,
    sourceTextExcerpt: aiDraft.sourceTextExcerpt || context.sourceTextExcerpt,
    extractionMeta: {
      ...(aiDraft.extractionMeta || {}),
      provider: getAiProviderName(),
      model: getModelName(),
      pageCount: context.pages.total,
      extractedAt: new Date().toISOString(),
      inputMode: "document-intelligence-markdown",
      documentIntelligence
    }
  };
}

async function createExtractionDraft(job) {
  const artifact = resolveArtifact(job);
  const aiConfigurationIssues = getAiConfigurationIssues();
  const documentIntelligenceIssues = getDocumentIntelligenceConfigurationIssues();

  if (!artifact) {
    return buildPendingDraft(job, buildAnalysisFromDocumentIntelligence(job, null), {
      requestedProvider: getAiProviderName(),
      aiError: "An uploaded PDF artifact is required for AI extraction."
    });
  }

  if (!isAiConfigured() || !isDocumentIntelligenceConfigured()) {
    return buildPendingDraft(job, buildAnalysisFromDocumentIntelligence(job, null), {
      requestedProvider: getAiProviderName(),
      aiError: [...aiConfigurationIssues, ...documentIntelligenceIssues].join(" ")
    });
  }

  try {
    const documentAnalysis = await analyzePdfWithDocumentIntelligence({
      fileName: artifact.fileName,
      pdfBuffer: artifact.buffer
    });
    const analysis = buildAnalysisFromDocumentIntelligence(job, documentAnalysis);
    const aiDraft = await extractQualificationWithAi({
      fileName: job.fileName,
      documentAnalysis,
      extractionContext: buildExtractionContext(job, analysis)
    });
    return mergeAiDraft(aiDraft, job, analysis);
  } catch (error) {
    return buildPendingDraft(job, buildAnalysisFromDocumentIntelligence(job, null), {
      aiError: error.message
    });
  }
}

async function processExtractionJob(jobId) {
  const job = getJob(jobId);
  if (!job) {
    return null;
  }

  const startedJob = markExtractionJobStarted(jobId) || getJob(jobId) || job;
  let draft;

  try {
    const timeoutMs = getExtractionJobTimeoutMs();
    draft = await withTimeout(
      createExtractionDraft(startedJob),
      timeoutMs,
      `Background extraction worker timed out after ${timeoutMs}ms.`
    );
  } catch (error) {
    draft = buildPendingDraft(startedJob, buildTimeoutAnalysis(startedJob), {
      aiError: error.message,
      workerTimedOut: /timed out/i.test(error.message)
    });
  }

  return hydrateJobForReview(jobId, draft);
}

module.exports = {
  createExtractionDraft,
  processExtractionJob,
  getExtractionJobTimeoutMs
};