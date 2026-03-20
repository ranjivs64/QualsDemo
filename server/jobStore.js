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
} = require("./databaseStore");

const seedPath = path.join(__dirname, "seed-data.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getQualifications(job) {
  if (!job) {
    return [];
  }
  if (Array.isArray(job.qualifications) && job.qualifications.length) {
    return job.qualifications;
  }
  return job.qualification ? [job.qualification] : [];
}

function walkNode(node, visitor, qualificationId, qualificationTitle) {
  if (!node) {
    return;
  }
  visitor(node, qualificationId, qualificationTitle);
  for (const child of node.children || []) {
    walkNode(child, visitor, qualificationId, qualificationTitle);
  }
}

function findJobNodesById(job, nodeId) {
  const matches = [];
  for (const qualification of getQualifications(job)) {
    walkNode(qualification, (node, qualificationId, qualificationTitle) => {
      if (node.id === nodeId) {
        matches.push({ node, qualificationId, qualificationTitle });
      }
    }, qualification.id, qualification.title);
  }
  return matches;
}

function getApprovalOverride(job) {
  const override = job && job.extractionMeta && job.extractionMeta.approvalOverride
    ? job.extractionMeta.approvalOverride
    : null;

  return {
    enabled: Boolean(override && override.enabled),
    rationale: override && typeof override.rationale === "string" ? override.rationale : "",
    updatedAt: override && override.updatedAt ? override.updatedAt : null
  };
}

function isOverrideReady(approvalOverride) {
  return Boolean(
    approvalOverride
    && approvalOverride.enabled
    && typeof approvalOverride.rationale === "string"
    && approvalOverride.rationale.trim().length >= 12
  );
}

function hasPendingValue(value) {
  if (typeof value !== "string") {
    return false;
  }
  return /pending/i.test(value) || value.includes("?");
}

function buildSharedUnitSummary(qualifications) {
  const unitIndex = new Map();

  for (const qualification of qualifications) {
    walkNode(qualification, (node, qualificationId, qualificationTitle) => {
      if (node.kind !== "Unit") {
        return;
      }

      const key = normalizeText(
        (node.fields && (node.fields.reference || node.fields.unitCode || node.fields.unitNumber))
        || node.title
      );

      if (!key) {
        return;
      }

      if (!unitIndex.has(key)) {
        unitIndex.set(key, {
          key,
          title: node.title,
          reference: node.fields && (node.fields.reference || node.fields.unitCode) ? (node.fields.reference || node.fields.unitCode) : null,
          nodeIds: new Set(),
          qualificationIds: new Set(),
          qualificationTitles: new Set()
        });
      }

      const entry = unitIndex.get(key);
      entry.nodeIds.add(node.id);
      entry.qualificationIds.add(qualificationId);
      entry.qualificationTitles.add(qualificationTitle);
    }, qualification.id, qualification.title);
  }

  return Array.from(unitIndex.values())
    .filter((entry) => entry.qualificationIds.size > 1)
    .map((entry) => ({
      key: entry.key,
      title: entry.title,
      reference: entry.reference,
      nodeIds: Array.from(entry.nodeIds),
      qualificationIds: Array.from(entry.qualificationIds),
      qualificationTitles: Array.from(entry.qualificationTitles),
      count: entry.qualificationIds.size
    }));
}

function deriveValidationSummary(job) {
  const qualifications = getQualifications(job);
  const counts = {
    qualifications: qualifications.length,
    units: 0,
    learningOutcomes: 0,
    assessmentCriteria: 0,
    sharedUnits: 0,
    blockers: 0,
    warnings: 0
  };

  if (!qualifications.length || job.status === "processing") {
    return {
      blockers: [],
      warnings: [],
      sharedUnits: [],
      counts
    };
  }

  const sharedUnits = buildSharedUnitSummary(qualifications);
  counts.sharedUnits = sharedUnits.length;

  for (const qualification of qualifications) {
    walkNode(qualification, (node) => {
      if (node.kind === "Unit") {
        counts.units += 1;
      }
      if (node.kind === "Learning Outcome") {
        counts.learningOutcomes += 1;
      }
      if (node.kind === "Assessment Criterion") {
        counts.assessmentCriteria += 1;
      }

      const pendingFields = Object.entries(node.fields || {})
        .filter(([, value]) => hasPendingValue(value));

      if (pendingFields.length && typeof node.confidence === "number") {
        node.confidence = Math.max(node.confidence, 75);
      }
    }, qualification.id, qualification.title);
  }

  return {
    blockers: [],
    warnings: [],
    sharedUnits,
    counts
  };
}

function synchronizeJobState(job) {
  if (!job) {
    return null;
  }

  const qualifications = getQualifications(job);
  job.qualifications = qualifications;
  job.qualification = qualifications[0] || null;

  const validationSummary = deriveValidationSummary(job);
  if (job.status === "processing") {
    job.reviewReady = false;
  } else if (job.status !== "persisted") {
    job.reviewReady = qualifications.length > 0;
  }

  if ((!job.qualificationCode || job.qualificationCode === "Pending") && job.qualification && job.qualification.fields) {
    job.qualificationCode = job.qualification.fields.code || job.qualificationCode || "Pending";
  }

  return validationSummary;
}

function enrichJob(job) {
  if (!job) {
    return null;
  }

  const enriched = clone(job);
  const validationSummary = synchronizeJobState(enriched);
  enriched.approvalOverride = getApprovalOverride(enriched);
  enriched.validationSummary = validationSummary;
  return enriched;
}

function loadSeedState() {
  return clone(JSON.parse(fs.readFileSync(seedPath, "utf8")));
}

function resetState() {
  return resetFromState(loadSeedState());
}

function listJobs(status) {
  return listDbJobs(status).map(enrichJob);
}

function getJob(jobId) {
  return enrichJob(getDbJob(jobId));
}

function updateJob(jobId, updater) {
  const job = getJob(jobId);
  if (!job) {
    return null;
  }
  updater(job);
  return enrichJob(saveJob(job));
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
    qualifications: [],
    sourceTextExcerpt: null,
    extractionMeta: null
  };
  synchronizeJobState(job);
  return enrichJob(saveJob(job));
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
  const qualification = {
    id: "qualification-draft",
    kind: "Qualification",
    title: qualificationName,
    summary: "Qualification draft generated without seed fixtures",
    confidence: 79,
    fields: {
      qualificationName,
      code: "Pending",
      type: qualificationType,
      qualificationType,
      level: "Pending",
      awardingBody: "Pending",
      sizeGlh: "Pending",
      sizeCredits: "Pending",
      gradingScheme: "Pending",
      totalQualificationTime: "Pending"
    },
    children: []
  };
  return {
    qualificationCode: "Pending",
    confidence: 79,
    reviewReady: false,
    pages: clone(pages || { current: 1, total: 72 }),
    documentFocus: { top: 28, height: 12, label: "Focus pending" },
    qualification,
    qualifications: [qualification],
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
    job.qualifications = clone(Array.isArray(draft.qualifications) && draft.qualifications.length
      ? draft.qualifications
      : draft.qualification
        ? [draft.qualification]
        : []);
    job.sourceTextExcerpt = draft.sourceTextExcerpt || null;
    job.extractionMeta = draft.extractionMeta || null;
    synchronizeJobState(job);
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
    const matches = findJobNodesById(job, nodeId);
    const editableNodes = matches.filter(({ node }) => node.fields && Object.prototype.hasOwnProperty.call(node.fields, field));

    if (!editableNodes.length) {
      return;
    }

    for (const { node } of editableNodes) {
      node.fields[field] = value;
      node.needsAttention = false;
      node.guidance = "Field manually edited by reviewer.";
      if (typeof node.confidence === "number") {
        node.confidence = Math.max(node.confidence, 90);
      }

      if (node.kind === "Unit") {
        const reference = node.fields.reference || "Pending";
        const glh = node.fields.glh || "Pending";
        const assessmentType = node.fields.assessmentType
          ? `, ${String(node.fields.assessmentType).toLowerCase()}ly assessed`
          : "";
        node.summary = `Reference ${reference}, GLH ${glh}${assessmentType}`;
      }
    }

    job.updatedAt = formatTimestamp();
    synchronizeJobState(job);
  });
}

function verifyNode(jobId, nodeId) {
  return updateJob(jobId, (job) => {
    const matches = findJobNodesById(job, nodeId);
    if (!matches.length) {
      return;
    }

    for (const { node } of matches) {
      if (node.fields) {
        for (const [field, rawValue] of Object.entries(node.fields)) {
          if (typeof rawValue === "string") {
            node.fields[field] = rawValue.replace(/\?/g, "").trim() || rawValue;
          }
        }
      }

      if (node.kind === "Unit" && node.fields) {
        const reference = node.fields.reference || "Pending";
        const glh = node.fields.glh || "Pending";
        const assessmentType = node.fields.assessmentType
          ? `, ${String(node.fields.assessmentType).toLowerCase()}ly assessed`
          : "";
        node.summary = `Reference ${reference}, GLH ${glh}${assessmentType}`;
      }

      node.confidence = 96;
      node.needsAttention = false;
      node.guidance = "Node manually verified by reviewer.";
    }

    const focusNode = matches[0].node;
    job.confidence = Math.max(job.confidence, 95);
    job.documentFocus = focusNode.focus || {
      top: 31,
      height: 13,
      label: `Focus: verified ${focusNode.title}`
    };
    job.updatedAt = formatTimestamp();
    synchronizeJobState(job);
  });
}

function updateApprovalOverride(jobId, enabled, rationale) {
  return updateJob(jobId, (job) => {
    job.extractionMeta = job.extractionMeta || {};
    job.extractionMeta.approvalOverride = {
      enabled: Boolean(enabled),
      rationale: Boolean(enabled) ? String(rationale || "").trim() : "",
      updatedAt: formatTimestamp()
    };
    job.updatedAt = formatTimestamp();
    synchronizeJobState(job);
  });
}

function approveJob(jobId) {
  const current = getJob(jobId);
  if (!current || !current.reviewReady) {
    return current;
  }

  const updated = updateJob(jobId, (job) => {
    job.status = "persisted";
    job.persistedAt = formatTimestamp();
    job.updatedAt = job.persistedAt;
    job.confidence = Math.max(job.confidence, 96);
    synchronizeJobState(job);
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
    job.qualifications = [];
    job.documentFocus = { top: 28, height: 12, label: "Focus pending" };
    job.sourceTextExcerpt = null;
    job.extractionMeta = null;
    synchronizeJobState(job);
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
  updateApprovalOverride,
  approveJob,
  reprocessJob,
  findNodeById,
  listPersistedQualifications,
  getPersistedQualification
};