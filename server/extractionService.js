const fs = require("node:fs");
const path = require("node:path");

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

function createDefaultTemplate(fileName, documentText) {
  const qualificationType = detectType(`${fileName}\n${documentText}`, "Qualification");
  const qualificationTitle = detectQualificationTitle(fileName, documentText, "Qualification Draft");
  const qualificationCode = detectQualificationCode(fileName, documentText, "Pending");
  const awardingBody = detectAwardingBody(documentText, "Pending");
  const qualification = {
    id: "qualification-draft",
    kind: "Qualification",
    title: qualificationTitle,
    summary: "Qualification draft generated from uploaded content",
    confidence: 79,
    fields: {
      qualificationName: qualificationTitle,
      code: qualificationCode,
      type: qualificationType,
      qualificationType,
      level: "Pending",
      awardingBody,
      sizeGlh: "Pending",
      sizeCredits: "Pending",
      gradingScheme: "Pending",
      totalQualificationTime: "Pending"
    },
    children: []
  };

  return {
    qualificationCode,
    status: "processing",
    pages: { current: 1, total: 72 },
    documentFocus: { top: 28, height: 12, label: "Focus pending" },
    qualification,
    qualifications: [qualification]
  };
}

function detectQualificationCode(fileName, documentText, fallbackCode) {
  const content = `${fileName}\n${documentText}`;
  const btecMatch = content.match(/\b\d{3}\/\d{4}\/\d\b/);
  if (btecMatch) {
    return btecMatch[0];
  }
  const alphaNumericMatch = content.match(/\b\d[A-Z]{3}\d\b/);
  if (alphaNumericMatch) {
    return alphaNumericMatch[0];
  }
  return fallbackCode || "Pending";
}

function detectQualificationTitle(fileName, documentText, fallbackTitle) {
  const lines = String(documentText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const titleCandidate = lines.find((line) => line.length > 16 && /qualification|diploma|gcse|a level|btec/i.test(line));
  if (titleCandidate) {
    return titleCandidate;
  }
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, " ") || fallbackTitle;
}

function detectType(documentText, fallbackType) {
  const content = String(documentText || "");
  if (/btec/i.test(content)) {
    return "BTEC";
  }
  if (/gcse/i.test(content)) {
    return "GCSE";
  }
  if (/a level/i.test(content)) {
    return "A-Level";
  }
  return fallbackType;
}

function detectAwardingBody(documentText, fallbackValue) {
  const content = String(documentText || "");
  if (/pearson edexcel/i.test(content)) {
    return "Pearson Edexcel";
  }
  if (/pearson/i.test(content)) {
    return "Pearson";
  }
  return fallbackValue;
}

function normalizeLines(documentText) {
  return String(documentText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractReferenceCode(text) {
  const match = String(text || "").match(/\b[A-Z]\/\d{3}\/\d{4}\b/);
  return match ? match[0] : null;
}

function extractNumber(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1] : null;
}

function detectGradeSchemeName(text) {
  const value = String(text || "");
  if (/pass\s*\/\s*merit\s*\/\s*distinction/i.test(value)) {
    return "Pass / Merit / Distinction";
  }
  if (/gcse\s*9\s*[\/-]\s*1/i.test(value) || /\b9\s*,\s*8\s*,\s*7\b/.test(value)) {
    return "GCSE 9-1";
  }
  return null;
}

function detectGradesForScheme(schemeName) {
  if (schemeName === "Pass / Merit / Distinction") {
    return ["P", "M", "D"];
  }
  if (schemeName === "GCSE 9-1") {
    return ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
  }
  return [];
}

function detectMinimumPassForScheme(schemeName) {
  if (schemeName === "Pass / Merit / Distinction") {
    return "P";
  }
  if (schemeName === "GCSE 9-1") {
    return "4";
  }
  return null;
}

function detectGroupDescriptor(line) {
  const value = String(line || "");
  if (/mandatory units/i.test(value)) {
    return { title: value, groupType: "Mandatory", isMandatory: true };
  }
  if (/optional units/i.test(value)) {
    return { title: value, groupType: "Optional", isMandatory: false };
  }
  const groupMatch = value.match(/^(group\s+[A-Z0-9]+)/i);
  if (groupMatch) {
    return {
      title: value,
      groupType: /mandatory/i.test(value) ? "Mandatory" : "Optional",
      isMandatory: /mandatory/i.test(value)
    };
  }
  return null;
}

function parseUnitsFromLines(lines) {
  const groups = [];
  let currentGroup = null;
  let pendingRuleText = null;

  function ensureGroup(fallbackTitle) {
    if (currentGroup) {
      return currentGroup;
    }
    currentGroup = {
      id: `group-${groups.length + 1}`,
      kind: "Unit Group",
      title: fallbackTitle || "Mandatory Units",
      summary: fallbackTitle || "Units extracted from document text",
      confidence: 88,
      fields: {
        groupType: /optional/i.test(fallbackTitle || "") ? "Optional" : "Mandatory",
        minimumUnits: /optional/i.test(fallbackTitle || "") ? "1" : "0",
          selectionRule: /optional/i.test(fallbackTitle || "") ? "Choose at least 1 unit" : "All listed units must be completed",
        ruleSet: /optional/i.test(fallbackTitle || "") ? "Choose at least 1 unit" : "All listed units must be completed"
      },
      children: []
    };
    groups.push(currentGroup);
    return currentGroup;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const groupDescriptor = detectGroupDescriptor(line);
    if (groupDescriptor) {
      currentGroup = {
        id: `group-${groups.length + 1}`,
        kind: "Unit Group",
        title: groupDescriptor.title,
        summary: groupDescriptor.isMandatory ? "All listed units must be completed" : "Choose from the listed units",
        confidence: 90,
        fields: {
          groupType: groupDescriptor.groupType,
          minimumUnits: groupDescriptor.isMandatory ? "0" : "1",
          selectionRule: groupDescriptor.isMandatory ? "All listed units must be completed" : "Choose at least 1 unit",
          ruleSet: groupDescriptor.isMandatory ? "All listed units must be completed" : "Choose at least 1 unit"
        },
        children: []
      };
      groups.push(currentGroup);
      pendingRuleText = null;
      continue;
    }

    if (/all .*units must be completed|choose .*unit|at least \d+ unit/i.test(line)) {
      pendingRuleText = line;
      if (currentGroup) {
        currentGroup.fields.selectionRule = line;
        currentGroup.fields.ruleSet = line;
        currentGroup.summary = line;
        const minimumUnits = extractNumber(line, /at least\s+(\d+)/i) || extractNumber(line, /choose\s+(\d+)/i);
        if (minimumUnits) {
          currentGroup.fields.minimumUnits = minimumUnits;
        }
      }
      continue;
    }

    const unitMatch = line.match(/^(Unit|Component)\s+([A-Za-z0-9]+)\s*[:\-]\s*(.+)$/i);
    if (!unitMatch) {
      continue;
    }

    const group = ensureGroup(pendingRuleText && /choose/i.test(pendingRuleText) ? "Optional Units" : "Mandatory Units");
    const detailLines = [line];
    for (let detailIndex = index + 1; detailIndex < lines.length; detailIndex += 1) {
      const nextLine = lines[detailIndex];
      if (detectGroupDescriptor(nextLine) || /^(Unit|Component)\s+[A-Za-z0-9]+\s*[:\-]/i.test(nextLine)) {
        break;
      }
      detailLines.push(nextLine);
    }
    const lookahead = detailLines.join(" ");
    const reference = extractReferenceCode(lookahead);
    const glh = extractNumber(lookahead, /(?:\bGLH\b|guided learning hours)\D*(\d{1,3})/i);
    const creditValue = extractNumber(lookahead, /credit(?: value)?\D*(\d{1,3})/i);
    const assessmentType = /external/i.test(lookahead) ? "External" : /internal/i.test(lookahead) ? "Internal" : null;
    const gradeScheme = detectGradeSchemeName(lookahead) || detectGradeSchemeName(group.summary);

    let confidence = 82;
    if (reference) {
      confidence += 6;
    }
    if (glh) {
      confidence += 6;
    }
    if (assessmentType) {
      confidence += 3;
    }
    if (creditValue) {
      confidence += 3;
    }
    confidence = Math.min(confidence, 97);

    const unitId = `unit-${groups.reduce((sum, item) => sum + item.children.length, 0) + 1}`;
    const unitNode = {
      id: unitId,
      kind: "Unit",
      title: `${unitMatch[1]} ${unitMatch[2]}: ${unitMatch[3]}`,
      summary: `Reference ${reference || "Pending"}, GLH ${glh || "Pending"}${assessmentType ? `, ${assessmentType.toLowerCase()}ly assessed` : ""}`,
      confidence,
      fields: {
        unitNumber: `${unitMatch[1]} ${unitMatch[2]}`,
        reference: reference || "Pending",
        glh: glh || "Pending",
        creditValue: creditValue || "Pending",
        assessmentType: assessmentType || "Pending",
        gradeScheme: gradeScheme || "Pending",
        gradingScheme: gradeScheme || "Pending"
      },
      children: []
    };

    if (!glh) {
      unitNode.needsAttention = true;
      unitNode.guidance = "Guided learning hours could not be read confidently from the source text.";
      unitNode.focus = {
        top: 31,
        height: 13,
        label: `Focus: ${unitNode.title} GLH`
      };
      unitNode.confidence = Math.min(unitNode.confidence, 68);
    }

    if (gradeScheme) {
      unitNode.children.push({
        id: `grade-scheme-${unitId}`,
        kind: "Grade Scheme",
        title: gradeScheme,
        summary: `Minimum pass grade ${detectMinimumPassForScheme(gradeScheme) || "Pending"}`,
        confidence: Math.max(unitNode.confidence - 2, 75),
        fields: {
          schemeName: gradeScheme,
          minimumPass: detectMinimumPassForScheme(gradeScheme) || "Pending",
          grades: detectGradesForScheme(gradeScheme).join(", ")
        },
        children: []
      });
    }

    group.children.push(unitNode);
  }

  return groups.filter((group) => group.children.length > 0);
}

function findLowestConfidenceNode(nodes) {
  let selected = null;
  function walk(node) {
    if (!selected || node.confidence < selected.confidence) {
      selected = node;
    }
    (node.children || []).forEach(walk);
  }
  nodes.forEach(walk);
  return selected;
}

function buildQualificationFromText(job, parsedDocument, template) {
  const lines = normalizeLines(parsedDocument.text);
  const code = detectQualificationCode(job.fileName, parsedDocument.text, template.qualificationCode);
  const title = detectQualificationTitle(job.fileName, parsedDocument.text, template.qualification.title);
  const type = detectType(parsedDocument.text, template.qualification.fields.type);
  const awardingBody = detectAwardingBody(parsedDocument.text, template.qualification.fields.awardingBody);
  const parsedGroups = parseUnitsFromLines(lines);

  if (!parsedGroups.length) {
    return null;
  }

  const qualification = {
    id: template.qualification.id,
    kind: "Qualification",
    title,
    summary: `${type || template.qualification.fields.type || "Qualification"}, awarding body ${awardingBody || template.qualification.fields.awardingBody || "Pending"}`,
    confidence: 91,
    fields: {
      ...template.qualification.fields,
      qualificationName: title,
      code,
      type,
      qualificationType: type,
      awardingBody
    },
    children: parsedGroups
  };

  const lowestConfidenceNode = findLowestConfidenceNode(parsedGroups);
  const reviewReady = !lowestConfidenceNode || lowestConfidenceNode.confidence >= 80;

  return {
    qualificationCode: code,
    confidence: reviewReady ? 92 : Math.max(lowestConfidenceNode.confidence, 68),
    reviewReady,
    pages: {
      current: 1,
      total: parsedDocument.pageCount || template.pages.total
    },
    documentFocus: lowestConfidenceNode && lowestConfidenceNode.focus
      ? lowestConfidenceNode.focus
      : clone(template.documentFocus),
    qualification,
    qualifications: [qualification],
    sourceTextExcerpt: String(parsedDocument.text || "").slice(0, 1000),
    extractionMeta: {
      provider: "fallback",
      model: null,
      pageCount: parsedDocument.pageCount || template.pages.total,
      extractedAt: new Date().toISOString(),
      parser: "text-heuristics"
    }
  };
}

function createExtractionDraftFromText(job, parsedDocument) {
  const template = clone(createDefaultTemplate(job.fileName, parsedDocument.text));
  const parsedDraft = buildQualificationFromText(job, parsedDocument, template);
  if (parsedDraft) {
    return parsedDraft;
  }

  const qualification = clone(template.qualification);
  const code = detectQualificationCode(job.fileName, parsedDocument.text, template.qualificationCode);
  const title = detectQualificationTitle(job.fileName, parsedDocument.text, qualification.title);
  const type = detectType(parsedDocument.text, qualification.fields.type);
  const awardingBody = detectAwardingBody(parsedDocument.text, qualification.fields.awardingBody);

  qualification.title = title;
  qualification.fields.code = code;
  qualification.fields.type = type;
  qualification.fields.qualificationType = type;
  qualification.fields.awardingBody = awardingBody;

  return {
    qualificationCode: code,
    confidence: template.status === "persisted" ? 96 : 78,
    reviewReady: false,
    pages: {
      current: template.pages.current,
      total: parsedDocument.pageCount || template.pages.total
    },
    documentFocus: clone(template.documentFocus),
    qualification,
    qualifications: [qualification],
    sourceTextExcerpt: String(parsedDocument.text || "").slice(0, 1000),
    extractionMeta: {
      provider: "fallback",
      model: null,
      pageCount: parsedDocument.pageCount || template.pages.total,
      extractedAt: new Date().toISOString(),
      parser: "seed-template"
    }
  };
}

function buildFallbackDraft(job, parsedDocument) {
  return createExtractionDraftFromText(job, parsedDocument);
}

function mergeDraft(fallbackDraft, aiDraft, parsedDocument) {
  return {
    qualificationCode: aiDraft.qualificationCode || fallbackDraft.qualificationCode,
    confidence: typeof aiDraft.confidence === "number" ? aiDraft.confidence : fallbackDraft.confidence,
    reviewReady: Boolean(aiDraft.reviewReady),
    pages: aiDraft.pages || fallbackDraft.pages,
    documentFocus: aiDraft.documentFocus || fallbackDraft.documentFocus,
    qualification: aiDraft.qualification || fallbackDraft.qualification,
    qualifications: Array.isArray(aiDraft.qualifications) && aiDraft.qualifications.length
      ? aiDraft.qualifications
      : fallbackDraft.qualifications,
    sourceTextExcerpt: fallbackDraft.sourceTextExcerpt,
    extractionMeta: {
      ...fallbackDraft.extractionMeta,
      ...(aiDraft.extractionMeta || {}),
      provider: getAiProviderName(),
      model: getModelName(),
      pageCount: parsedDocument.pageCount || fallbackDraft.pages.total,
      extractedAt: new Date().toISOString()
    }
  };
}

async function readPdfDocument(job) {
  if (!job.artifact || !job.artifact.storedFileName) {
    return { text: "", pageCount: job.pages ? job.pages.total : 0 };
  }
  const artifactPath = resolveArtifactPath(job.artifact.storedFileName);
  if (!artifactPath) {
    return { text: "", pageCount: 0 };
  }

  let PDFParse;
  try {
    PDFParse = getPdfParseConstructor();
  } catch {
    return {
      text: "",
      pageCount: 0
    };
  }

  const buffer = fs.readFileSync(artifactPath);
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return {
      text: parsed.text || "",
      pageCount: parsed.total || 0
    };
  } catch {
    return {
      text: "",
      pageCount: 0
    };
  } finally {
    await parser.destroy();
  }
}

async function createExtractionDraft(job) {
  const parsedDocument = await readPdfDocument(job);
  const fallbackDraft = buildFallbackDraft(job, parsedDocument);
  const configurationIssues = getAiConfigurationIssues();

  if (!isAiConfigured()) {
    return {
      ...fallbackDraft,
      extractionMeta: {
        ...fallbackDraft.extractionMeta,
        requestedProvider: getAiProviderName(),
        aiError: configurationIssues.join(" ")
      }
    };
  }

  try {
    const aiDraft = await extractQualificationWithAi({
      fileName: job.fileName,
      documentText: parsedDocument.text,
      fallbackDraft
    });
    return mergeDraft(fallbackDraft, aiDraft, parsedDocument);
  } catch (error) {
    return {
      ...fallbackDraft,
      extractionMeta: {
        ...fallbackDraft.extractionMeta,
        aiError: error.message
      }
    };
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
  createExtractionDraftFromText,
  createExtractionDraft,
  processExtractionJob
};