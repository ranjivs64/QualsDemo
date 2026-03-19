const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const CURRENT_SCHEMA_VERSION = "2";
const defaultDbPath = path.join(__dirname, "data", "qualextract.sqlite");
const seedPath = path.join(__dirname, "seed-data.json");
const managedTables = [
  "submission_audit",
  "qual_rule_set_members",
  "qual_rule_sets",
  "grade_options",
  "grade_schemes",
  "assessment_criteria",
  "learning_outcomes",
  "unit_group_members",
  "unit_groups",
  "units",
  "qualifications",
  "jobs"
];

let database;

function getDbPath() {
  return process.env.QUAL_DB_PATH || defaultDbPath;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getSeedState() {
  return clone(readJson(seedPath));
}

function sanitizeIdPart(value, fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function serializeJob(job) {
  const qualifications = Array.isArray(job.qualifications) && job.qualifications.length
    ? job.qualifications
    : job.qualification
      ? [job.qualification]
      : [];

  return {
    id: job.id,
    file_name: job.fileName,
    artifact_json: JSON.stringify(job.artifact || null),
    qualification_code: job.qualificationCode || "Pending",
    status: job.status,
    confidence: job.confidence || 0,
    attempts: job.attempts || 1,
    updated_at: job.updatedAt,
    review_ready: job.reviewReady ? 1 : 0,
    persisted_at: job.persistedAt || null,
    pages_json: JSON.stringify(job.pages || null),
    document_focus_json: JSON.stringify(job.documentFocus || null),
    qualification_json: JSON.stringify(job.qualification || qualifications[0] || null),
    qualifications_json: JSON.stringify(qualifications),
    source_text_excerpt: job.sourceTextExcerpt || null,
    extraction_meta_json: JSON.stringify(job.extractionMeta || null)
  };
}

function deserializeJob(row) {
  if (!row) {
    return null;
  }

  const qualification = parseJson(row.qualification_json, null);
  const qualifications = parseJson(row.qualifications_json, qualification ? [qualification] : []);

  return {
    id: row.id,
    fileName: row.file_name,
    artifact: parseJson(row.artifact_json, null),
    qualificationCode: row.qualification_code,
    status: row.status,
    confidence: row.confidence,
    attempts: row.attempts,
    updatedAt: row.updated_at,
    reviewReady: Boolean(row.review_ready),
    persistedAt: row.persisted_at,
    pages: parseJson(row.pages_json, null),
    documentFocus: parseJson(row.document_focus_json, null),
    qualification: qualification || qualifications[0] || null,
    qualifications,
    sourceTextExcerpt: row.source_text_excerpt || null,
    extractionMeta: parseJson(row.extraction_meta_json, null)
  };
}

function openDatabase() {
  if (database) {
    return database;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  database = new DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");

  initializeSchema(database);
  bootstrapDatabase(database);
  return database;
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const schemaVersion = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get("schema_version");
  if (!schemaVersion || schemaVersion.value !== CURRENT_SCHEMA_VERSION) {
    rebuildSchema(db);
  } else {
    createSchema(db);
  }
}

function rebuildSchema(db) {
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const tableName of managedTables) {
    db.exec(`DROP TABLE IF EXISTS ${tableName};`);
  }
  createSchema(db);
  db.prepare(`
    INSERT INTO app_metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run("schema_version", CURRENT_SCHEMA_VERSION);
  db.exec("PRAGMA foreign_keys = ON;");
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      artifact_json TEXT,
      qualification_code TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      attempts INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      review_ready INTEGER NOT NULL,
      persisted_at TEXT,
      pages_json TEXT,
      document_focus_json TEXT,
      qualification_json TEXT,
      qualifications_json TEXT,
      source_text_excerpt TEXT,
      extraction_meta_json TEXT
    );

    CREATE TABLE IF NOT EXISTS qualifications (
      qualification_id TEXT PRIMARY KEY,
      source_job_id TEXT NOT NULL,
      source_qualification_id TEXT NOT NULL,
      code TEXT,
      name TEXT NOT NULL,
      qualification_type TEXT,
      level TEXT,
      awarding_body TEXT,
      description TEXT,
      size_glh TEXT,
      size_credits TEXT,
      grading_scheme TEXT,
      total_qualification_time TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_qualifications_source
    ON qualifications (source_job_id, source_qualification_id);

    CREATE INDEX IF NOT EXISTS idx_qualifications_job_id
    ON qualifications (source_job_id);

    CREATE TABLE IF NOT EXISTS unit_groups (
      group_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      group_type TEXT,
      selection_rule TEXT,
      minimum_units TEXT,
      rule_set TEXT,
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS units (
      unit_id TEXT PRIMARY KEY,
      source_job_id TEXT NOT NULL,
      source_unit_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      unit_number TEXT,
      unit_code TEXT,
      level TEXT,
      credit_value TEXT,
      guided_learning_hours TEXT,
      assessment_type TEXT,
      grading_scheme_name TEXT
    );

    CREATE TABLE IF NOT EXISTS unit_group_members (
      member_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      selection_rule TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES unit_groups (group_id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units (unit_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS learning_outcomes (
      learning_outcome_id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL,
      source_outcome_id TEXT,
      description TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (unit_id) REFERENCES units (unit_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_criteria (
      assessment_criterion_id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL,
      learning_outcome_id TEXT,
      grade_level TEXT,
      description TEXT NOT NULL,
      command_verb TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (unit_id) REFERENCES units (unit_id) ON DELETE CASCADE,
      FOREIGN KEY (learning_outcome_id) REFERENCES learning_outcomes (learning_outcome_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS grade_schemes (
      grade_scheme_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      unit_id TEXT,
      scheme_name TEXT NOT NULL,
      minimum_pass TEXT,
      grades_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units (unit_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS grade_options (
      grade_option_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      grade_scheme_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      rank_order INTEGER NOT NULL,
      point_value REAL,
      is_numeric INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_scheme_id) REFERENCES grade_schemes (grade_scheme_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS qual_rule_sets (
      rule_set_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      name TEXT NOT NULL,
      operator TEXT NOT NULL,
      source_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS qual_rule_set_members (
      rule_set_member_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      rule_set_id TEXT NOT NULL,
      member_type TEXT NOT NULL,
      member_ref_id TEXT NOT NULL,
      requirement_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE,
      FOREIGN KEY (rule_set_id) REFERENCES qual_rule_sets (rule_set_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submission_audit (
      audit_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE
    );
  `);
}

function bootstrapDatabase(db) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM jobs").get();
  if (row.count > 0) {
    return;
  }
  resetFromState(getSeedState());
}

function saveJob(job) {
  const db = openDatabase();
  const record = serializeJob(job);
  db.prepare(`
    INSERT INTO jobs (
      id, file_name, artifact_json, qualification_code, status, confidence,
      attempts, updated_at, review_ready, persisted_at, pages_json,
      document_focus_json, qualification_json, qualifications_json,
      source_text_excerpt, extraction_meta_json
    ) VALUES (
      $id, $file_name, $artifact_json, $qualification_code, $status, $confidence,
      $attempts, $updated_at, $review_ready, $persisted_at, $pages_json,
      $document_focus_json, $qualification_json, $qualifications_json,
      $source_text_excerpt, $extraction_meta_json
    )
    ON CONFLICT(id) DO UPDATE SET
      file_name = excluded.file_name,
      artifact_json = excluded.artifact_json,
      qualification_code = excluded.qualification_code,
      status = excluded.status,
      confidence = excluded.confidence,
      attempts = excluded.attempts,
      updated_at = excluded.updated_at,
      review_ready = excluded.review_ready,
      persisted_at = excluded.persisted_at,
      pages_json = excluded.pages_json,
      document_focus_json = excluded.document_focus_json,
      qualification_json = excluded.qualification_json,
      qualifications_json = excluded.qualifications_json,
      source_text_excerpt = excluded.source_text_excerpt,
      extraction_meta_json = excluded.extraction_meta_json
  `).run(record);
  return getJob(job.id);
}

function listJobs(status) {
  const db = openDatabase();
  if (status && status !== "all") {
    return db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC").all(status).map(deserializeJob);
  }
  return db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC").all().map(deserializeJob);
}

function getJob(jobId) {
  const db = openDatabase();
  return deserializeJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId));
}

function clearAllData(db = openDatabase()) {
  db.exec(`
    DELETE FROM submission_audit;
    DELETE FROM qual_rule_set_members;
    DELETE FROM qual_rule_sets;
    DELETE FROM grade_options;
    DELETE FROM grade_schemes;
    DELETE FROM assessment_criteria;
    DELETE FROM learning_outcomes;
    DELETE FROM unit_group_members;
    DELETE FROM unit_groups;
    DELETE FROM units;
    DELETE FROM qualifications;
    DELETE FROM jobs;
  `);
}

function createQualificationId(job, node, index) {
  return `${sanitizeIdPart(job.id, "job")}-qualification-${sanitizeIdPart(node.id || `qualification-${index + 1}`, `qualification-${index + 1}`)}`;
}

function getQualificationNodes(job) {
  const nodes = Array.isArray(job.qualifications) && job.qualifications.length
    ? job.qualifications
    : job.qualification
      ? [job.qualification]
      : [];

  return nodes.filter((node) => node && node.kind === "Qualification");
}

function parseGradeSymbols(gradesValue) {
  if (!gradesValue) {
    return [];
  }
  if (Array.isArray(gradesValue)) {
    return gradesValue.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(gradesValue)
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNumericGrade(symbol) {
  return /^\d+$/.test(symbol);
}

function pointValueForGrade(symbols, index) {
  const symbol = symbols[index];
  if (isNumericGrade(symbol)) {
    return Number(symbol);
  }
  return symbols.length - index;
}

function detectRuleOperator(sourceText) {
  const value = String(sourceText || "").toUpperCase();
  if (/\bOR\b/.test(value)) {
    return "OR";
  }
  return "AND";
}

function extractUnitNumber(node) {
  const fields = node.fields || {};
  if (fields.unitNumber) {
    return fields.unitNumber;
  }
  const match = String(node.title || "").match(/^(Unit|Component)\s+([A-Za-z0-9]+)/i);
  return match ? `${match[1]} ${match[2]}` : null;
}

function createUnitId(job, node) {
  const fields = node.fields || {};
  const identity = fields.unitId
    || fields.reference
    || fields.unitCode
    || fields.unitNumber
    || extractUnitNumber(node)
    || node.id
    || node.title;
  return `${sanitizeIdPart(job.id, "job")}-unit-${sanitizeIdPart(identity, "unit")}`;
}

function extractCommandVerb(text) {
  const match = String(text || "").trim().match(/^(identify|describe|explain|assess|analyse|analyze|evaluate|demonstrate|use|compare|justify|plan|create|produce|review)\b/i);
  return match ? match[1] : null;
}

function deleteQualificationGraph(db, qualificationId) {
  db.prepare("DELETE FROM submission_audit WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM qual_rule_set_members WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM qual_rule_sets WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM grade_options WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM grade_schemes WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM unit_group_members WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM unit_groups WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM qualifications WHERE qualification_id = ?").run(qualificationId);
}

function cleanupOrphanedUnits(db) {
  db.exec(`
    DELETE FROM units
    WHERE unit_id NOT IN (
      SELECT DISTINCT unit_id FROM unit_group_members
    );
  `);
}

function persistLearningOutcomes(db, unitId, node, processedUnitIds) {
  if (processedUnitIds.has(unitId)) {
    return;
  }

  db.prepare("DELETE FROM assessment_criteria WHERE unit_id = ?").run(unitId);
  db.prepare("DELETE FROM learning_outcomes WHERE unit_id = ?").run(unitId);

  const insertOutcome = db.prepare(`
    INSERT INTO learning_outcomes (
      learning_outcome_id, unit_id, source_outcome_id, description, sort_order
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertCriterion = db.prepare(`
    INSERT INTO assessment_criteria (
      assessment_criterion_id, unit_id, learning_outcome_id, grade_level, description, command_verb, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const directCriteria = Array.isArray(node.fields && node.fields.assessmentCriteria)
    ? node.fields.assessmentCriteria
    : [];
  const outcomeNodes = [];

  (node.children || []).forEach((child) => {
    if (child.kind === "Learning Outcome") {
      outcomeNodes.push(child);
    }
  });

  const fieldOutcomes = Array.isArray(node.fields && node.fields.learningOutcomes)
    ? node.fields.learningOutcomes.map((item, index) => ({
      id: `field-outcome-${index + 1}`,
      description: typeof item === "string" ? item : item.description,
      assessmentCriteria: Array.isArray(item && item.assessmentCriteria) ? item.assessmentCriteria : []
    }))
    : [];

  const normalizedOutcomes = [
    ...outcomeNodes.map((child) => ({
      id: child.id,
      description: child.fields && child.fields.description ? child.fields.description : child.title,
      assessmentCriteria: child.children || []
    })),
    ...fieldOutcomes
  ];

  normalizedOutcomes.forEach((outcome, outcomeIndex) => {
    const outcomeId = `${unitId}-outcome-${sanitizeIdPart(outcome.id || outcomeIndex + 1, `outcome-${outcomeIndex + 1}`)}`;
    insertOutcome.run(
      outcomeId,
      unitId,
      outcome.id || null,
      outcome.description || `Learning outcome ${outcomeIndex + 1}`,
      outcomeIndex
    );

    outcome.assessmentCriteria.forEach((criterion, criterionIndex) => {
      const description = typeof criterion === "string"
        ? criterion
        : criterion.fields && criterion.fields.description
          ? criterion.fields.description
          : criterion.description || criterion.title;
      const gradeLevel = typeof criterion === "string"
        ? null
        : criterion.fields && criterion.fields.gradeLevel
          ? criterion.fields.gradeLevel
          : null;
      insertCriterion.run(
        `${outcomeId}-criterion-${criterionIndex + 1}`,
        unitId,
        outcomeId,
        gradeLevel,
        description || `Assessment criterion ${criterionIndex + 1}`,
        extractCommandVerb(description),
        criterionIndex
      );
    });
  });

  directCriteria.forEach((criterion, criterionIndex) => {
    const description = typeof criterion === "string" ? criterion : criterion.description;
    const gradeLevel = typeof criterion === "string" ? null : criterion.gradeLevel || null;
    insertCriterion.run(
      `${unitId}-criterion-direct-${criterionIndex + 1}`,
      unitId,
      null,
      gradeLevel,
      description || `Assessment criterion ${criterionIndex + 1}`,
      extractCommandVerb(description),
      criterionIndex
    );
  });

  processedUnitIds.add(unitId);
}

function persistApprovedQualification(job, options = {}) {
  const qualificationNodes = getQualificationNodes(job);
  if (!job || !qualificationNodes.length) {
    return null;
  }

  const db = openDatabase();
  const timestamp = options.submittedAt || job.persistedAt || job.updatedAt;
  const existingRows = db.prepare(`
    SELECT qualification_id AS qualificationId, source_qualification_id AS sourceQualificationId
    FROM qualifications
    WHERE source_job_id = ?
  `).all(job.id);
  const processedUnitIds = new Set();
  const persistedIds = [];
  const results = [];

  const insertQualification = db.prepare(`
    INSERT INTO qualifications (
      qualification_id, source_job_id, source_qualification_id, code, name, qualification_type,
      level, awarding_body, description, size_glh, size_credits, grading_scheme,
      total_qualification_time, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_job_id, source_qualification_id) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      qualification_type = excluded.qualification_type,
      level = excluded.level,
      awarding_body = excluded.awarding_body,
      description = excluded.description,
      size_glh = excluded.size_glh,
      size_credits = excluded.size_credits,
      grading_scheme = excluded.grading_scheme,
      total_qualification_time = excluded.total_qualification_time,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);
  const insertGroup = db.prepare(`
    INSERT INTO unit_groups (
      group_id, qualification_id, title, summary, group_type, selection_rule,
      minimum_units, rule_set, is_mandatory, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertUnit = db.prepare(`
    INSERT INTO units (
      unit_id, source_job_id, source_unit_id, title, summary, unit_number, unit_code,
      level, credit_value, guided_learning_hours, assessment_type, grading_scheme_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id) DO UPDATE SET
      source_job_id = excluded.source_job_id,
      source_unit_id = excluded.source_unit_id,
      title = excluded.title,
      summary = excluded.summary,
      unit_number = excluded.unit_number,
      unit_code = excluded.unit_code,
      level = excluded.level,
      credit_value = excluded.credit_value,
      guided_learning_hours = excluded.guided_learning_hours,
      assessment_type = excluded.assessment_type,
      grading_scheme_name = excluded.grading_scheme_name
  `);
  const insertGroupMember = db.prepare(`
    INSERT INTO unit_group_members (
      member_id, qualification_id, group_id, unit_id, is_mandatory, selection_rule, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertScheme = db.prepare(`
    INSERT INTO grade_schemes (
      grade_scheme_id, qualification_id, unit_id, scheme_name, minimum_pass, grades_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGradeOption = db.prepare(`
    INSERT INTO grade_options (
      grade_option_id, qualification_id, grade_scheme_id, symbol, rank_order, point_value, is_numeric
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRuleSet = db.prepare(`
    INSERT INTO qual_rule_sets (
      rule_set_id, qualification_id, name, operator, source_text, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertRuleSetMember = db.prepare(`
    INSERT INTO qual_rule_set_members (
      rule_set_member_id, qualification_id, rule_set_id, member_type, member_ref_id, requirement_text, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAudit = db.prepare(`
    INSERT INTO submission_audit (audit_id, qualification_id, job_id, submitted_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  qualificationNodes.forEach((qualificationNode, qualificationIndex) => {
    const fields = qualificationNode.fields || {};
    const sourceQualificationId = String(qualificationNode.id || `qualification-${qualificationIndex + 1}`);
    const existing = existingRows.find((row) => row.sourceQualificationId === sourceQualificationId);
    const qualificationId = existing ? existing.qualificationId : createQualificationId(job, qualificationNode, qualificationIndex);
    persistedIds.push(qualificationId);

    insertQualification.run(
      qualificationId,
      job.id,
      sourceQualificationId,
      fields.code || job.qualificationCode || null,
      qualificationNode.title,
      fields.qualificationType || fields.type || null,
      fields.level || null,
      fields.awardingBody || null,
      qualificationNode.summary || null,
      fields.sizeGlh || null,
      fields.sizeCredits || null,
      fields.gradingScheme || null,
      fields.totalQualificationTime || null,
      job.status,
      timestamp,
      timestamp
    );

    db.prepare("DELETE FROM submission_audit WHERE qualification_id = ?").run(qualificationId);
    db.prepare("DELETE FROM qual_rule_set_members WHERE qualification_id = ?").run(qualificationId);
    db.prepare("DELETE FROM qual_rule_sets WHERE qualification_id = ?").run(qualificationId);
    db.prepare("DELETE FROM grade_options WHERE qualification_id = ?").run(qualificationId);
    db.prepare("DELETE FROM grade_schemes WHERE qualification_id = ?").run(qualificationId);
    db.prepare("DELETE FROM unit_group_members WHERE qualification_id = ?").run(qualificationId);
    db.prepare("DELETE FROM unit_groups WHERE qualification_id = ?").run(qualificationId);

    const groupRecords = [];
    const rootRuleSetId = `${qualificationId}-rules-root`;
    insertRuleSet.run(
      rootRuleSetId,
      qualificationId,
      "Qualification completion rules",
      "AND",
      qualificationNode.summary || null,
      0
    );

    function walk(node, context) {
      const nodeFields = node.fields || {};
      if (node.kind === "Unit Group") {
        const groupId = `${qualificationId}-${sanitizeIdPart(node.id, "group")}`;
        const selectionRule = nodeFields.selectionRule || nodeFields.ruleSet || node.summary || null;
        const isMandatory = /mandatory/i.test(node.title) || /mandatory/i.test(String(nodeFields.groupType || ""));
        insertGroup.run(
          groupId,
          qualificationId,
          node.title,
          node.summary || null,
          nodeFields.groupType || null,
          selectionRule,
          nodeFields.minimumUnits || null,
          nodeFields.ruleSet || selectionRule,
          isMandatory ? 1 : 0,
          context.sortOrder
        );
        const childRuleSetId = `${groupId}-rules`;
        insertRuleSet.run(
          childRuleSetId,
          qualificationId,
          `${node.title} rule set`,
          detectRuleOperator(selectionRule),
          selectionRule,
          context.sortOrder
        );
        insertRuleSetMember.run(
          `${rootRuleSetId}-${groupId}`,
          qualificationId,
          rootRuleSetId,
          "unit-group",
          groupId,
          selectionRule,
          context.sortOrder
        );
        groupRecords.push({ groupId, childRuleSetId, isMandatory, selectionRule });
        (node.children || []).forEach((child, index) => walk(child, { groupId, unitId: null, sortOrder: index }));
        return;
      }

      if (node.kind === "Unit") {
        const unitId = createUnitId(job, node);
        const gradeSchemeName = nodeFields.gradingScheme || nodeFields.gradeScheme || null;
        upsertUnit.run(
          unitId,
          job.id,
          nodeFields.unitId || node.id || null,
          node.title,
          node.summary || null,
          extractUnitNumber(node),
          nodeFields.reference || nodeFields.unitCode || null,
          nodeFields.level || null,
          nodeFields.creditValue || null,
          nodeFields.glh || null,
          nodeFields.assessmentType || null,
          gradeSchemeName
        );

        if (context.groupId) {
          const groupRecord = groupRecords.find((item) => item.groupId === context.groupId);
          insertGroupMember.run(
            `${context.groupId}-${unitId}`,
            qualificationId,
            context.groupId,
            unitId,
            groupRecord && groupRecord.isMandatory ? 1 : 0,
            groupRecord ? groupRecord.selectionRule : null,
            context.sortOrder
          );
          if (groupRecord) {
            insertRuleSetMember.run(
              `${groupRecord.childRuleSetId}-${unitId}`,
              qualificationId,
              groupRecord.childRuleSetId,
              "unit",
              unitId,
              node.summary || null,
              context.sortOrder
            );
          }
        }

        persistLearningOutcomes(db, unitId, node, processedUnitIds);

        (node.children || []).forEach((child, index) => {
          if (child.kind === "Grade Scheme") {
            const schemeFields = child.fields || {};
            const gradeSchemeId = `${qualificationId}-${sanitizeIdPart(child.id, "grade-scheme")}`;
            const symbols = parseGradeSymbols(schemeFields.grades);
            insertScheme.run(
              gradeSchemeId,
              qualificationId,
              unitId,
              schemeFields.schemeName || child.title,
              schemeFields.minimumPass || null,
              JSON.stringify(symbols),
              index
            );
            symbols.forEach((symbol, symbolIndex) => {
              insertGradeOption.run(
                `${gradeSchemeId}-${symbolIndex}`,
                qualificationId,
                gradeSchemeId,
                symbol,
                symbolIndex,
                pointValueForGrade(symbols, symbolIndex),
                isNumericGrade(symbol) ? 1 : 0
              );
            });
          }
        });
        return;
      }

      (node.children || []).forEach((child, index) => walk(child, { groupId: context.groupId, unitId: context.unitId, sortOrder: index }));
    }

    walk(qualificationNode, { groupId: null, unitId: null, sortOrder: 0 });

    insertAudit.run(
      `audit-${qualificationId}-${Date.parse(timestamp) || Date.now()}`,
      qualificationId,
      job.id,
      timestamp,
      JSON.stringify(qualificationNode)
    );

    results.push(getPersistedQualification(qualificationId));
  });

  existingRows
    .filter((row) => !persistedIds.includes(row.qualificationId))
    .forEach((row) => deleteQualificationGraph(db, row.qualificationId));
  cleanupOrphanedUnits(db);

  return results.length === 1 ? results[0] : results;
}

function listPersistedQualifications() {
  const db = openDatabase();
  return db.prepare(`
    SELECT
      q.qualification_id AS id,
      q.source_job_id AS sourceJobId,
      q.source_qualification_id AS sourceQualificationId,
      q.code,
      q.name,
      q.qualification_type AS type,
      q.qualification_type AS qualificationType,
      q.level,
      q.awarding_body AS awardingBody,
      q.status,
      q.updated_at AS updatedAt,
      COUNT(DISTINCT ugm.unit_id) AS unitCount,
      COUNT(DISTINCT g.group_id) AS groupCount
    FROM qualifications q
    LEFT JOIN unit_group_members ugm ON ugm.qualification_id = q.qualification_id
    LEFT JOIN unit_groups g ON g.qualification_id = q.qualification_id
    GROUP BY q.qualification_id
    ORDER BY q.updated_at DESC
  `).all();
}

function getPersistedQualification(qualificationId) {
  const db = openDatabase();
  const qualification = db.prepare(`
    SELECT
      qualification_id AS id,
      source_job_id AS sourceJobId,
      source_qualification_id AS sourceQualificationId,
      code,
      name,
      qualification_type AS type,
      qualification_type AS qualificationType,
      level,
      awarding_body AS awardingBody,
      description,
      size_glh AS sizeGlh,
      size_credits AS sizeCredits,
      grading_scheme AS gradingScheme,
      total_qualification_time AS totalQualificationTime,
      status,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM qualifications
    WHERE qualification_id = ?
  `).get(qualificationId);

  if (!qualification) {
    return null;
  }

  return {
    ...qualification,
    unitGroups: db.prepare(`
      SELECT
        group_id AS id,
        title,
        summary,
        group_type AS groupType,
        selection_rule AS selectionRule,
        minimum_units AS minimumUnits,
        rule_set AS ruleSet,
        is_mandatory AS isMandatory,
        sort_order AS sortOrder
      FROM unit_groups
      WHERE qualification_id = ?
      ORDER BY sort_order ASC
    `).all(qualificationId),
    unitGroupMembers: db.prepare(`
      SELECT
        member_id AS id,
        group_id AS groupId,
        unit_id AS unitId,
        is_mandatory AS isMandatory,
        selection_rule AS selectionRule,
        sort_order AS sortOrder
      FROM unit_group_members
      WHERE qualification_id = ?
      ORDER BY sort_order ASC
    `).all(qualificationId),
    units: db.prepare(`
      SELECT DISTINCT
        u.unit_id AS id,
        u.source_unit_id AS sourceUnitId,
        ugm.group_id AS groupId,
        u.title,
        u.summary,
        u.unit_number AS unitNumber,
        u.unit_code AS code,
        u.level,
        u.credit_value AS creditValue,
        u.guided_learning_hours AS guidedLearningHours,
        u.assessment_type AS assessmentType,
        u.grading_scheme_name AS gradingSchemeName,
        ugm.sort_order AS sortOrder
      FROM units u
      INNER JOIN unit_group_members ugm ON ugm.unit_id = u.unit_id
      WHERE ugm.qualification_id = ?
      ORDER BY ugm.sort_order ASC, u.title ASC
    `).all(qualificationId),
    learningOutcomes: db.prepare(`
      SELECT
        lo.learning_outcome_id AS id,
        lo.unit_id AS unitId,
        lo.source_outcome_id AS sourceOutcomeId,
        lo.description,
        lo.sort_order AS sortOrder
      FROM learning_outcomes lo
      INNER JOIN unit_group_members ugm ON ugm.unit_id = lo.unit_id
      WHERE ugm.qualification_id = ?
      ORDER BY lo.sort_order ASC
    `).all(qualificationId),
    assessmentCriteria: db.prepare(`
      SELECT
        ac.assessment_criterion_id AS id,
        ac.unit_id AS unitId,
        ac.learning_outcome_id AS learningOutcomeId,
        ac.grade_level AS gradeLevel,
        ac.description,
        ac.command_verb AS commandVerb,
        ac.sort_order AS sortOrder
      FROM assessment_criteria ac
      INNER JOIN unit_group_members ugm ON ugm.unit_id = ac.unit_id
      WHERE ugm.qualification_id = ?
      ORDER BY ac.sort_order ASC
    `).all(qualificationId),
    gradeSchemes: db.prepare(`
      SELECT
        grade_scheme_id AS id,
        unit_id AS unitId,
        scheme_name AS schemeName,
        minimum_pass AS minimumPass,
        grades_json AS gradesJson,
        sort_order AS sortOrder
      FROM grade_schemes
      WHERE qualification_id = ?
      ORDER BY sort_order ASC
    `).all(qualificationId).map((row) => ({
      ...row,
      grades: parseJson(row.gradesJson, [])
    })),
    gradeOptions: db.prepare(`
      SELECT
        grade_option_id AS id,
        grade_scheme_id AS gradeSchemeId,
        symbol,
        rank_order AS rankOrder,
        point_value AS pointValue,
        is_numeric AS isNumeric
      FROM grade_options
      WHERE qualification_id = ?
      ORDER BY rank_order ASC
    `).all(qualificationId),
    ruleSets: db.prepare(`
      SELECT
        rule_set_id AS id,
        name,
        operator,
        source_text AS sourceText,
        sort_order AS sortOrder
      FROM qual_rule_sets
      WHERE qualification_id = ?
      ORDER BY sort_order ASC
    `).all(qualificationId),
    ruleSetMembers: db.prepare(`
      SELECT
        rule_set_member_id AS id,
        rule_set_id AS ruleSetId,
        member_type AS memberType,
        member_ref_id AS memberRefId,
        requirement_text AS requirementText,
        sort_order AS sortOrder
      FROM qual_rule_set_members
      WHERE qualification_id = ?
      ORDER BY sort_order ASC
    `).all(qualificationId),
    audit: db.prepare(`
      SELECT
        audit_id AS id,
        submitted_at AS submittedAt,
        payload_json AS payloadJson
      FROM submission_audit
      WHERE qualification_id = ?
      ORDER BY submitted_at DESC
    `).all(qualificationId).map((row) => ({
      ...row,
      payload: parseJson(row.payloadJson, null)
    }))
  };
}

function resetFromState(state) {
  const db = openDatabase();
  clearAllData(db);
  for (const job of state.jobs || []) {
    saveJob(job);
    if (job.status === "persisted" && (job.qualification || (Array.isArray(job.qualifications) && job.qualifications.length))) {
      persistApprovedQualification(job, { submittedAt: job.persistedAt || job.updatedAt });
    }
  }
  return { jobs: listJobs() };
}

function closeDatabaseForTests() {
  if (!database) {
    return;
  }
  database.close();
  database = undefined;
}

module.exports = {
  getSeedState,
  listJobs,
  getJob,
  saveJob,
  resetFromState,
  persistApprovedQualification,
  listPersistedQualifications,
  getPersistedQualification,
  closeDatabaseForTests
};