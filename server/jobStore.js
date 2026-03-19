const fs = require("node:fs");
const path = require("node:path");

const {
  listJobs: listDbJobs,
  getJob: getDbJob,
  saveJob,
  resetFromState,
  persistApprovedQualification,
  listPersistedQualifications,
  getPersistedQualification
} = require("./database");

const seedPath = path.join(__dirname, "seed-data.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSeedState() {
  return clone(JSON.parse(fs.readFileSync(seedPath, "utf8")));
}

function resetState() {
  return resetFromState(loadSeedState());
}

function listJobs(status) {
  return listDbJobs(status);
}

function getJob(jobId) {
  return getDbJob(jobId);
}

function updateJob(jobId, updater) {
  const job = getJob(jobId);
  if (!job) {
    return null;
  }
  updater(job);
  return saveJob(job);
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function createUploadedJob(fileName, artifact = null) {
  const job = {
    id: `job-${Date.now()}`,
    fileName,
    artifact,
    qualificationCode: "Pending",
    status: "processing",
    confidence: 0,
    attempts: 1,
    updatedAt: formatTimestamp(),
    reviewReady: false,
    persistedAt: null,
    pages: { current: 1, total: 72 },
    documentFocus: { top: 28, height: 12, label: "Focus pending" },
    qualification: null,
    sourceTextExcerpt: null,
    extractionMeta: null
  };
  return saveJob(job);
}

function inferQualificationType(fileName) {
  const value = String(fileName || "");
  if (/btec/i.test(value)) {
    return "BTEC";
  }
  if (/gcse/i.test(value)) {
    return "GCSE";
  }
  if (/a[ _-]?level/i.test(value)) {
    return "A-Level";
  }
  return "Qualification";
}

function inferQualificationTitle(fileName) {
  const stem = path.basename(String(fileName || "Qualification Draft"), path.extname(String(fileName || "")));
  return stem.replace(/[_-]+/g, " ").trim() || "Qualification Draft";
}

function createDefaultDraft(fileName, pages) {
  const qualificationName = inferQualificationTitle(fileName);
  const qualificationType = inferQualificationType(fileName);
  return {
    qualificationCode: "Pending",
    confidence: 79,
    reviewReady: false,
    pages: clone(pages || { current: 1, total: 72 }),
    documentFocus: { top: 28, height: 12, label: "Focus pending" },
    qualification: {
      id: "qualification-draft",
      kind: "Qualification",
      title: qualificationName,
      summary: "Qualification draft generated without seed fixtures",
      confidence: 79,
      fields: {
        qualificationName,
        code: "Pending",
        type: qualificationType,
        level: "Pending",
        awardingBody: "Pending",
        totalQualificationTime: "Pending"
      },
      children: []
    },
    sourceTextExcerpt: null,
    extractionMeta: {
      provider: "fallback",
      extractedAt: new Date().toISOString(),
      parser: "default-template"
    }
  };
}

function normalizeDraft(job, draftOrFileName) {
  if (typeof draftOrFileName === "object" && draftOrFileName) {
    return draftOrFileName;
  }
  const fileName = typeof draftOrFileName === "string" && draftOrFileName
    ? draftOrFileName
    : job && job.fileName;
  return createDefaultDraft(fileName, job && job.pages);
}

function hydrateJobForReview(jobId, draftOrFileName) {
  const draft = normalizeDraft(getJob(jobId), draftOrFileName);
  return updateJob(jobId, (job) => {
    job.status = "review";
    job.confidence = draft.confidence;
    job.updatedAt = formatTimestamp();
    job.reviewReady = Boolean(draft.reviewReady);
    job.qualificationCode = draft.qualificationCode;
    job.pages = clone(draft.pages);
    job.documentFocus = clone(draft.documentFocus);
    job.qualification = clone(draft.qualification);
    job.sourceTextExcerpt = draft.sourceTextExcerpt || null;
    job.extractionMeta = draft.extractionMeta || null;
  });
}

function findNodeById(node, nodeId) {
  if (!node) {
    return null;
  }
  if (node.id === nodeId) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findNodeById(child, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}

function updateNodeField(jobId, nodeId, field, value) {
  return updateJob(jobId, (job) => {
    const node = findNodeById(job.qualification, nodeId);
    if (!node || !node.fields || !(field in node.fields)) {
      return;
    }
    node.fields[field] = value;
    job.updatedAt = formatTimestamp();
  });
}

function verifyNode(jobId, nodeId) {
  return updateJob(jobId, (job) => {
    const node = findNodeById(job.qualification, nodeId);
    if (!node) {
      return;
    }
    const cleanGlh = String(node.fields.glh || "120").replace("?", "").trim() || "120";
    node.fields.glh = cleanGlh;
    node.summary = `Reference T/507/5000, GLH ${cleanGlh}, externally assessed`;
    node.confidence = 96;
    node.needsAttention = false;
    node.guidance = "Field manually verified by reviewer.";
    job.reviewReady = true;
    job.confidence = 95;
    job.documentFocus = { top: 31, height: 13, label: "Focus: verified Unit 3 GLH" };
    job.updatedAt = formatTimestamp();
  });
}

function approveJob(jobId) {
  const updated = updateJob(jobId, (job) => {
    if (!job.reviewReady) {
      return;
    }
    job.status = "persisted";
    job.persistedAt = formatTimestamp();
    job.updatedAt = job.persistedAt;
    job.confidence = Math.max(job.confidence, 96);
  });
  if (updated && updated.status === "persisted") {
    persistApprovedQualification(updated);
  }
  return updated;
}

function reprocessJob(jobId) {
  return updateJob(jobId, (job) => {
    job.attempts += 1;
    job.status = "processing";
    job.reviewReady = false;
    job.confidence = 0;
    job.updatedAt = formatTimestamp();
    job.qualification = null;
    job.documentFocus = { top: 28, height: 12, label: "Focus pending" };
    job.sourceTextExcerpt = null;
    job.extractionMeta = null;
  });
}

module.exports = {
  resetState,
  listJobs,
  getJob,
  createUploadedJob,
  hydrateJobForReview,
  updateNodeField,
  verifyNode,
  approveJob,
  reprocessJob,
  findNodeById,
  listPersistedQualifications,
  getPersistedQualification
};