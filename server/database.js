const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const defaultDbPath = path.join(__dirname, "data", "qualextract.sqlite");
const seedPath = path.join(__dirname, "seed-data.json");

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

function serializeJob(job) {
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
    qualification_json: JSON.stringify(job.qualification || null),
    source_text_excerpt: job.sourceTextExcerpt || null,
    extraction_meta_json: JSON.stringify(job.extractionMeta || null)
  };
}

function deserializeJob(row) {
  if (!row) {
    return null;
  }
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
    qualification: parseJson(row.qualification_json, null),
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
      source_text_excerpt TEXT,
      extraction_meta_json TEXT
    );

    CREATE TABLE IF NOT EXISTS qualifications (
      qualification_id TEXT PRIMARY KEY,
      source_job_id TEXT NOT NULL UNIQUE,
      code TEXT,
      name TEXT NOT NULL,
      type TEXT,
      level TEXT,
      awarding_body TEXT,
      description TEXT,
      total_qualification_time TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unit_groups (
      group_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      group_type TEXT,
      minimum_units TEXT,
      rule_set TEXT,
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS unit_group_members (
      member_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES unit_groups (group_id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units (unit_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS units (
      unit_id TEXT PRIMARY KEY,
      qualification_id TEXT NOT NULL,
      group_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      unit_code TEXT,
      level TEXT,
      credit_value TEXT,
      guided_learning_hours TEXT,
      assessment_type TEXT,
      grade_scheme_name TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (qualification_id) REFERENCES qualifications (qualification_id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES unit_groups (group_id) ON DELETE SET NULL
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
      document_focus_json, qualification_json, source_text_excerpt, extraction_meta_json
    ) VALUES (
      $id, $file_name, $artifact_json, $qualification_code, $status, $confidence,
      $attempts, $updated_at, $review_ready, $persisted_at, $pages_json,
      $document_focus_json, $qualification_json, $source_text_excerpt, $extraction_meta_json
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
    DELETE FROM unit_group_members;
    DELETE FROM units;
    DELETE FROM unit_groups;
    DELETE FROM qualifications;
    DELETE FROM jobs;
  `);
}

function createQualificationId(job) {
  const base = job.qualification && job.qualification.id ? job.qualification.id : "qualification";
  return `${base}-${job.id}`;
}

function parseGradeSymbols(gradesValue) {
  if (!gradesValue) {
    return [];
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

function persistApprovedQualification(job, options = {}) {
  if (!job || !job.qualification) {
    return null;
  }

  const db = openDatabase();
  const existing = db.prepare("SELECT qualification_id FROM qualifications WHERE source_job_id = ?").get(job.id);
  const qualificationId = existing ? existing.qualification_id : createQualificationId(job);
  const qualification = job.qualification;
  const fields = qualification.fields || {};
  const timestamp = options.submittedAt || job.persistedAt || job.updatedAt;

  db.prepare(`
    INSERT INTO qualifications (
      qualification_id, source_job_id, code, name, type, level, awarding_body,
      description, total_qualification_time, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_job_id) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      type = excluded.type,
      level = excluded.level,
      awarding_body = excluded.awarding_body,
      description = excluded.description,
      total_qualification_time = excluded.total_qualification_time,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    qualificationId,
    job.id,
    fields.code || job.qualificationCode || null,
    qualification.title,
    fields.type || null,
    fields.level || null,
    fields.awardingBody || null,
    qualification.summary || null,
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
  db.prepare("DELETE FROM units WHERE qualification_id = ?").run(qualificationId);
  db.prepare("DELETE FROM unit_groups WHERE qualification_id = ?").run(qualificationId);

  const insertGroup = db.prepare(`
    INSERT INTO unit_groups (
      group_id, qualification_id, title, summary, group_type, minimum_units,
      rule_set, is_mandatory, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertUnit = db.prepare(`
    INSERT INTO units (
      unit_id, qualification_id, group_id, title, summary, unit_code, level,
      credit_value, guided_learning_hours, assessment_type, grade_scheme_name, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGroupMember = db.prepare(`
    INSERT INTO unit_group_members (
      member_id, qualification_id, group_id, unit_id, is_mandatory, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?)
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

  const groupRecords = [];
  const rootRuleSetId = `${qualificationId}-rules-root`;
  insertRuleSet.run(
    rootRuleSetId,
    qualificationId,
    "Qualification completion rules",
    "AND",
    qualification.summary || null,
    0
  );

  function walk(node, context) {
    const nodeFields = node.fields || {};
    if (node.kind === "Unit Group") {
      const groupId = `${qualificationId}-${node.id}`;
      const groupMandatory = /mandatory/i.test(node.title) || /mandatory/i.test(String(nodeFields.groupType || ""));
      insertGroup.run(
        groupId,
        qualificationId,
        node.title,
        node.summary || null,
        nodeFields.groupType || null,
        nodeFields.minimumUnits || null,
        nodeFields.ruleSet || null,
        groupMandatory ? 1 : 0,
        context.sortOrder
      );
      const childRuleSetId = `${groupId}-rules`;
      insertRuleSet.run(
        childRuleSetId,
        qualificationId,
        `${node.title} rule set`,
        detectRuleOperator(nodeFields.ruleSet || node.summary),
        nodeFields.ruleSet || node.summary || null,
        context.sortOrder
      );
      insertRuleSetMember.run(
        `${rootRuleSetId}-${groupId}`,
        qualificationId,
        rootRuleSetId,
        "unit-group",
        groupId,
        nodeFields.ruleSet || node.summary || null,
        context.sortOrder
      );
      groupRecords.push({ groupId, childRuleSetId, isMandatory: groupMandatory });
      (node.children || []).forEach((child, index) => walk(child, { groupId, unitId: null, sortOrder: index }));
      return;
    }

    if (node.kind === "Unit") {
      const unitId = `${qualificationId}-${node.id}`;
      insertUnit.run(
        unitId,
        qualificationId,
        context.groupId || null,
        node.title,
        node.summary || null,
        nodeFields.reference || null,
        nodeFields.level || null,
        nodeFields.creditValue || null,
        nodeFields.glh || null,
        nodeFields.assessmentType || null,
        nodeFields.gradeScheme || null,
        context.sortOrder
      );
      if (context.groupId) {
        const groupRecord = groupRecords.find((item) => item.groupId === context.groupId);
        insertGroupMember.run(
          `${context.groupId}-${unitId}`,
          qualificationId,
          context.groupId,
          unitId,
          groupRecord && groupRecord.isMandatory ? 1 : 0,
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
      (node.children || []).forEach((child, index) => walk(child, { groupId: context.groupId, unitId, sortOrder: index }));
      return;
    }

    if (node.kind === "Grade Scheme") {
      const gradeSchemeId = `${qualificationId}-${node.id}`;
      const symbols = parseGradeSymbols(nodeFields.grades);
      insertScheme.run(
        gradeSchemeId,
        qualificationId,
        context.unitId || null,
        node.title,
        nodeFields.minimumPass || null,
        JSON.stringify(symbols),
        context.sortOrder
      );
      symbols.forEach((symbol, index) => {
        insertGradeOption.run(
          `${gradeSchemeId}-${index}`,
          qualificationId,
          gradeSchemeId,
          symbol,
          index,
          pointValueForGrade(symbols, index),
          isNumericGrade(symbol) ? 1 : 0
        );
      });
      return;
    }

    (node.children || []).forEach((child, index) => walk(child, { groupId: context.groupId, unitId: context.unitId, sortOrder: index }));
  }

  walk(qualification, { groupId: null, unitId: null, sortOrder: 0 });

  db.prepare(`
    INSERT INTO submission_audit (audit_id, qualification_id, job_id, submitted_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    `audit-${job.id}-${Date.parse(timestamp) || Date.now()}`,
    qualificationId,
    job.id,
    timestamp,
    JSON.stringify(job.qualification)
  );

  return getPersistedQualification(qualificationId);
}

function listPersistedQualifications() {
  const db = openDatabase();
  return db.prepare(`
    SELECT
      q.qualification_id AS id,
      q.source_job_id AS sourceJobId,
      q.code,
      q.name,
      q.type,
      q.level,
      q.awarding_body AS awardingBody,
      q.status,
      q.updated_at AS updatedAt,
      COUNT(DISTINCT u.unit_id) AS unitCount,
      COUNT(DISTINCT g.group_id) AS groupCount
    FROM qualifications q
    LEFT JOIN units u ON u.qualification_id = q.qualification_id
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
      code,
      name,
      type,
      level,
      awarding_body AS awardingBody,
      description,
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
        sort_order AS sortOrder
      FROM unit_group_members
      WHERE qualification_id = ?
      ORDER BY sort_order ASC
    `).all(qualificationId),
    units: db.prepare(`
      SELECT
        unit_id AS id,
        group_id AS groupId,
        title,
        summary,
        unit_code AS code,
        level,
        credit_value AS creditValue,
        guided_learning_hours AS guidedLearningHours,
        assessment_type AS assessmentType,
        grade_scheme_name AS gradeSchemeName,
        sort_order AS sortOrder
      FROM units
      WHERE qualification_id = ?
      ORDER BY sort_order ASC
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
    if (job.status === "persisted" && job.qualification) {
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