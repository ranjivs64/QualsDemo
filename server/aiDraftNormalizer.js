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

function getNormalizationContext(context) {
  return {
    confidence: Number.isFinite(context && context.confidence) ? context.confidence : 80,
    pages: context && context.pages ? context.pages : { current: 1, total: 1 },
    documentFocus: context && context.documentFocus
      ? context.documentFocus
      : { top: 28, height: 12, label: "Focus pending" },
    sourceTextExcerpt: typeof (context && context.sourceTextExcerpt) === "string"
      ? context.sourceTextExcerpt
      : null
  };
}

function resolveQualificationCode(rawQualification) {
  const explicitCode = nullableString(rawQualification && rawQualification.qualificationCode);
  if (explicitCode) {
    return explicitCode;
  }

  const directMatch = extractQualificationCode(rawQualification && rawQualification.id)
    || extractQualificationCode(rawQualification && rawQualification.qualificationName);
  return directMatch || "Pending";
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

function createQualificationNode(rawQualification, index) {
  const code = resolveQualificationCode(rawQualification);
  const unitGroups = Array.isArray(rawQualification && rawQualification.unitGroups)
    ? rawQualification.unitGroups
    : [];
  const rules = rawQualification && rawQualification.rulesOfCombination
    ? rawQualification.rulesOfCombination
    : { totalCredits: null, mandatoryCredits: null, optionalCredits: null, constraints: [] };
  const qualificationName = stringOrPending(rawQualification && rawQualification.qualificationName, "Qualification");
  const qualificationType = stringOrPending(rawQualification && rawQualification.qualificationType, "Qualification");
  const awardingBody = stringOrPending(rawQualification && rawQualification.awardingBody, "Pending");
  const level = stringOrPending(rawQualification && rawQualification.level, "Pending");
  const derivedFrom = nullableString(rawQualification && rawQualification.derivedFrom);
  const ruleSummary = buildRulesSummary(rules);

  return {
    id: stringOrPending(rawQualification && rawQualification.id, `qualification-${index + 1}`),
    kind: "Qualification",
    title: qualificationName,
    summary: derivedFrom
      ? `${qualificationType}, derived from ${derivedFrom}`
      : `${qualificationType}, awarding body ${awardingBody}`,
    confidence: 85,
    fields: {
      qualificationName,
      code,
      type: qualificationType,
      qualificationType,
      level,
      awardingBody,
      sizeGlh: "Pending",
      sizeCredits: numberStringOrPending(rules.totalCredits),
      gradingScheme: stringOrPending(rawQualification && rawQualification.gradingScheme),
      totalQualificationTime: "Pending",
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

function normalizeAuthoritativeAiPayload(payload, context) {
  const resolvedContext = getNormalizationContext(context);
  const envelope = payload && payload.Qualifications ? payload.Qualifications : null;
  const rawQualifications = Array.isArray(envelope && envelope.qualifications)
    ? envelope.qualifications
    : [];
  const normalizedQualifications = rawQualifications.map((qualification, index) => createQualificationNode(qualification, index));
  const firstAttentionNode = findFirstAttentionNode(normalizedQualifications);
  const normalizedConfidence = clampConfidence(envelope && envelope.confidence, resolvedContext.confidence);
  const loweredConfidence = envelope && envelope.needsAttention
    ? Math.min(normalizedConfidence, 79)
    : normalizedConfidence;

  return {
    qualificationCode: normalizedQualifications[0] && normalizedQualifications[0].fields
      ? normalizedQualifications[0].fields.code || "Pending"
      : "Pending",
    confidence: loweredConfidence,
    reviewReady: normalizedQualifications.length > 0,
    pages: resolvedContext.pages,
    documentFocus: firstAttentionNode
      ? {
        top: resolvedContext.documentFocus.top,
        height: resolvedContext.documentFocus.height,
        label: `Focus: ${firstAttentionNode.title}`
      }
      : resolvedContext.documentFocus,
    qualification: normalizedQualifications[0] || null,
    qualifications: normalizedQualifications,
    sourceTextExcerpt: resolvedContext.sourceTextExcerpt,
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