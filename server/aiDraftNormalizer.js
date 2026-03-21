const AUTHORITATIVE_CONTRACT_VERSION = "qualification-authoritative-v1";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampConfidence(value, fallback = 80) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, numericValue));
}

function stringOrPending(value, fallback = "Pending") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberStringOrPending(value) {
  return Number.isFinite(value) ? String(value) : "Pending";
}

function nullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function extractQualificationCode(text) {
  const value = String(text || "");
  const btecMatch = value.match(/\b\d{3}\/\d{4}\/\d\b/);
  if (btecMatch) {
    return btecMatch[0];
  }
  const alphaNumericMatch = value.match(/\b\d[A-Z]{3}\d\b/);
  if (alphaNumericMatch) {
    return alphaNumericMatch[0];
  }
  return null;
}

function getFallbackQualification(fallbackDraft, index) {
  if (!fallbackDraft) {
    return null;
  }
  if (Array.isArray(fallbackDraft.qualifications) && fallbackDraft.qualifications[index]) {
    return fallbackDraft.qualifications[index];
  }
  if (index === 0 && fallbackDraft.qualification) {
    return fallbackDraft.qualification;
  }
  return null;
}

function resolveQualificationCode(rawQualification, fallbackDraft, index) {
  const directMatch = extractQualificationCode(rawQualification.id)
    || extractQualificationCode(rawQualification.qualificationName);
  if (directMatch) {
    return directMatch;
  }

  const fallbackQualification = getFallbackQualification(fallbackDraft, index);
  const fallbackCode = fallbackQualification && fallbackQualification.fields
    ? fallbackQualification.fields.code
    : null;
  if (fallbackCode && fallbackCode !== "Pending") {
    return fallbackCode;
  }

  if (index === 0 && fallbackDraft && fallbackDraft.qualificationCode) {
    return fallbackDraft.qualificationCode;
  }

  return "Pending";
}

function buildRulesSummary(rules) {
  const constraints = Array.isArray(rules && rules.constraints) ? rules.constraints.filter(Boolean) : [];
  if (constraints.length) {
    return constraints.join("; ");
  }
  const totalCredits = Number.isFinite(rules && rules.totalCredits) ? `${rules.totalCredits} total credits` : null;
  return totalCredits || "Rules of combination pending review";
}

function buildGroupTitle(group, index) {
  const groupType = stringOrPending(group && group.groupType, "Other");
  if (groupType === "Mandatory") {
    return "Mandatory Units";
  }
  if (groupType === "Optional") {
    return "Optional Units";
  }
  if (groupType === "Pathway") {
    return "Pathway Units";
  }
  return `Unit Group ${index + 1}`;
}

function buildUnitId(unit) {
  const key = normalizeText(`${unit && unit.unitNumber ? unit.unitNumber : "unit"}-${unit && unit.unitTitle ? unit.unitTitle : "pending"}`);
  return key || "unit-pending";
}

function createLearningOutcomeNode(objective, unitId, index) {
  const objectiveId = stringOrPending(objective && objective.id, `${unitId}-objective-${index + 1}`);
  const description = stringOrPending(objective && objective.text);
  return {
    id: `${unitId}-outcome-${normalizeText(objectiveId) || index + 1}`,
    kind: "Learning Outcome",
    title: description,
    summary: description,
    confidence: 90,
    fields: {
      description,
      sourceOutcomeId: objectiveId
    },
    children: []
  };
}

function createUnitNode(unit, qualification, groupIndex) {
  const unitId = buildUnitId(unit);
  const unitNumber = stringOrPending(unit && unit.unitNumber);
  const unitTitle = stringOrPending(unit && unit.unitTitle);
  const assessmentType = nullableString(unit && unit.assessmentType);
  const summaryParts = [`Reference ${unitNumber}`];
  const glh = Number.isFinite(unit && unit.glh) ? unit.glh : null;
  summaryParts.push(`GLH ${glh === null ? "Pending" : glh}`);
  if (assessmentType) {
    summaryParts.push(`${assessmentType.toLowerCase()}ly assessed`);
  }

  const learningObjectives = Array.isArray(unit && unit.learningObjectives)
    ? unit.learningObjectives
    : [];

  return {
    id: unitId,
    kind: "Unit",
    title: `${unitNumber}: ${unitTitle}`,
    summary: summaryParts.join(", "),
    confidence: clampConfidence(unit && unit.confidence, 80),
    needsAttention: Boolean(unit && unit.needsAttention),
    guidance: stringOrPending(unit && unit.guidance, "Review normalized from authoritative AI contract."),
    fields: {
      unitNumber,
      reference: unitNumber,
      glh: numberStringOrPending(unit && unit.glh),
      creditValue: numberStringOrPending(unit && unit.creditValue),
      assessmentType: assessmentType || "Pending",
      gradeScheme: stringOrPending(qualification && qualification.gradingScheme),
      gradingScheme: stringOrPending(qualification && qualification.gradingScheme),
      sharedUnitKey: unitId
    },
    children: learningObjectives.map((objective, index) => createLearningOutcomeNode(objective, unitId, index))
  };
}

function createUnitGroupNode(group, qualification, index) {
  const units = Array.isArray(group && group.units) ? group.units : [];
  const selectionRule = stringOrPending(group && group.selectionRule, "Review unit selection rules.");
  return {
    id: stringOrPending(group && group.id, `group-${index + 1}`),
    kind: "Unit Group",
    title: buildGroupTitle(group, index),
    summary: selectionRule,
    confidence: 88,
    fields: {
      groupType: stringOrPending(group && group.groupType, "Other"),
      minimumUnits: "Pending",
      selectionRule,
      ruleSet: selectionRule,
      minimumCredits: numberStringOrPending(group && group.minimumCredits),
      maximumCredits: numberStringOrPending(group && group.maximumCredits)
    },
    children: units.map((unit) => createUnitNode(unit, qualification, index))
  };
}

function createQualificationNode(rawQualification, fallbackDraft, index) {
  const fallbackQualification = getFallbackQualification(fallbackDraft, index);
  const code = resolveQualificationCode(rawQualification, fallbackDraft, index);
  const unitGroups = Array.isArray(rawQualification && rawQualification.unitGroups)
    ? rawQualification.unitGroups
    : [];
  const rules = rawQualification && rawQualification.rulesOfCombination
    ? rawQualification.rulesOfCombination
    : { totalCredits: null, mandatoryCredits: null, optionalCredits: null, constraints: [] };
  const qualificationName = stringOrPending(
    rawQualification && rawQualification.qualificationName,
    fallbackQualification ? fallbackQualification.title : "Qualification"
  );
  const qualificationType = stringOrPending(
    rawQualification && rawQualification.qualificationType,
    fallbackQualification && fallbackQualification.fields ? fallbackQualification.fields.qualificationType : "Qualification"
  );
  const awardingBody = stringOrPending(
    rawQualification && rawQualification.awardingBody,
    fallbackQualification && fallbackQualification.fields ? fallbackQualification.fields.awardingBody : "Pending"
  );
  const level = stringOrPending(
    rawQualification && rawQualification.level,
    fallbackQualification && fallbackQualification.fields ? fallbackQualification.fields.level : "Pending"
  );
  const derivedFrom = nullableString(rawQualification && rawQualification.derivedFrom);
  const ruleSummary = buildRulesSummary(rules);

  return {
    id: stringOrPending(rawQualification && rawQualification.id, `qualification-${index + 1}`),
    kind: "Qualification",
    title: qualificationName,
    summary: derivedFrom
      ? `${qualificationType}, derived from ${derivedFrom}`
      : `${qualificationType}, awarding body ${awardingBody}`,
    confidence: clampConfidence(fallbackDraft && fallbackDraft.confidence, 85),
    fields: {
      qualificationName,
      code,
      type: qualificationType,
      qualificationType,
      level,
      awardingBody,
      sizeGlh: fallbackQualification && fallbackQualification.fields ? fallbackQualification.fields.sizeGlh || "Pending" : "Pending",
      sizeCredits: numberStringOrPending(rules.totalCredits),
      gradingScheme: stringOrPending(rawQualification && rawQualification.gradingScheme),
      totalQualificationTime: fallbackQualification && fallbackQualification.fields
        ? fallbackQualification.fields.totalQualificationTime || "Pending"
        : "Pending",
      derivedFrom: derivedFrom || "",
      mandatoryCredits: numberStringOrPending(rules.mandatoryCredits),
      optionalCredits: numberStringOrPending(rules.optionalCredits),
      ruleConstraints: ruleSummary
    },
    children: unitGroups.map((group, groupIndex) => createUnitGroupNode(group, rawQualification, groupIndex))
  };
}

function findFirstAttentionNode(qualifications) {
  for (const qualification of qualifications) {
    for (const group of qualification.children || []) {
      for (const unit of group.children || []) {
        if (unit.needsAttention) {
          return unit;
        }
      }
    }
  }
  return null;
}

function normalizeAuthoritativeAiPayload(payload, fallbackDraft) {
  const envelope = payload && payload.Qualifications ? payload.Qualifications : null;
  const rawQualifications = Array.isArray(envelope && envelope.qualifications)
    ? envelope.qualifications
    : [];
  const normalizedQualifications = rawQualifications.map((qualification, index) => createQualificationNode(qualification, fallbackDraft, index));
  const firstAttentionNode = findFirstAttentionNode(normalizedQualifications);
  const fallbackFocus = fallbackDraft && fallbackDraft.documentFocus
    ? fallbackDraft.documentFocus
    : { top: 28, height: 12, label: "Focus pending" };
  const normalizedConfidence = clampConfidence(envelope && envelope.confidence, fallbackDraft && fallbackDraft.confidence ? fallbackDraft.confidence : 80);
  const loweredConfidence = envelope && envelope.needsAttention
    ? Math.min(normalizedConfidence, 79)
    : normalizedConfidence;

  return {
    qualificationCode: normalizedQualifications[0] && normalizedQualifications[0].fields
      ? normalizedQualifications[0].fields.code || (fallbackDraft ? fallbackDraft.qualificationCode : "Pending")
      : fallbackDraft ? fallbackDraft.qualificationCode : "Pending",
    confidence: loweredConfidence,
    reviewReady: normalizedQualifications.length > 0,
    pages: fallbackDraft && fallbackDraft.pages ? fallbackDraft.pages : { current: 1, total: 1 },
    documentFocus: firstAttentionNode
      ? {
        top: fallbackFocus.top,
        height: fallbackFocus.height,
        label: `Focus: ${firstAttentionNode.title}`
      }
      : fallbackFocus,
    qualification: normalizedQualifications[0] || null,
    qualifications: normalizedQualifications,
    extractionMeta: {
      contractVersion: AUTHORITATIVE_CONTRACT_VERSION,
      authoritativeQualificationCount: rawQualifications.length,
      authoritativeNeedsAttention: Boolean(envelope && envelope.needsAttention),
      authoritativeGuidance: envelope && typeof envelope.guidance === "string" ? envelope.guidance : ""
    }
  };
}

module.exports = {
  AUTHORITATIVE_CONTRACT_VERSION,
  normalizeAuthoritativeAiPayload
};