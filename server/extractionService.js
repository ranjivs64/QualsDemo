const fs = require("node:fs");

const { getJob, hydrateJobForReview } = require("./jobStore");
const { resolveArtifactPath } = require("./uploadStore");
const { getAiConfigurationIssues, getAiProviderName, isAiConfigured, getModelName, extractQualificationWithAi } = require("./aiClient");
let pdfParseConstructor;

function getPdfParseConstructor() {
  if (pdfParseConstructor) {
    return pdfParseConstructor;
  }

  ({ PDFParse: pdfParseConstructor } = require("pdf-parse"));
  return pdfParseConstructor;
}

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

async function analyzePdfArtifact(job, artifact) {
  const defaultAnalysis = {
    pageCount: job && job.pages ? job.pages.total : 0,
    sourceTextExcerpt: null
  };

  if (!artifact) {
    return defaultAnalysis;
  }

  let PDFParse;
  try {
    PDFParse = getPdfParseConstructor();
  } catch {
    return defaultAnalysis;
  }

  const parser = new PDFParse({ data: artifact.buffer });
  try {
    const parsed = await parser.getText();
    return {
      pageCount: parsed.total || defaultAnalysis.pageCount,
      sourceTextExcerpt: String(parsed.text || "").slice(0, 1000) || null
    };
  } catch {
    return defaultAnalysis;
  } finally {
    await parser.destroy();
  }
}

function buildExtractionContext(job, analysis) {
  return {
    confidence: 80,
    pages: getDefaultPages(job, analysis.pageCount),
    documentFocus: getDefaultDocumentFocus(),
    sourceTextExcerpt: analysis.sourceTextExcerpt
  };
}

function buildPendingDraft(job, analysis, extras) {
  const context = buildExtractionContext(job, analysis);
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
      inputMode: "pdf-file",
      ...(extras || {})
    }
  };
}

function mergeAiDraft(aiDraft, job, analysis) {
  const context = buildExtractionContext(job, analysis);
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
      inputMode: "pdf-file"
    }
  };
}

async function createExtractionDraft(job) {
  const artifact = resolveArtifact(job);
  const analysis = await analyzePdfArtifact(job, artifact);
  const configurationIssues = getAiConfigurationIssues();

  if (!artifact) {
    return buildPendingDraft(job, analysis, {
      requestedProvider: getAiProviderName(),
      aiError: "An uploaded PDF artifact is required for AI extraction."
    });
  }

  if (!isAiConfigured()) {
    return buildPendingDraft(job, analysis, {
      requestedProvider: getAiProviderName(),
      aiError: configurationIssues.join(" ")
    });
  }

  try {
    const aiDraft = await extractQualificationWithAi({
      fileName: job.fileName,
      pdfBuffer: artifact.buffer,
      extractionContext: buildExtractionContext(job, analysis)
    });
    return mergeAiDraft(aiDraft, job, analysis);
  } catch (error) {
    return buildPendingDraft(job, analysis, {
      aiError: error.message
    });
  }
}

async function processExtractionJob(jobId) {
  const job = getJob(jobId);
  if (!job) {
    return null;
  }
  const draft = await createExtractionDraft(job);
  return hydrateJobForReview(jobId, draft);
}

module.exports = {
  createExtractionDraft,
  processExtractionJob
};