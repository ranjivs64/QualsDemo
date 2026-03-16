const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const tempRoot = path.join(os.tmpdir(), `qualextract-tests-${process.pid}`);
process.env.QUAL_DB_PATH = path.join(tempRoot, "qualextract-test.sqlite");
process.env.QUAL_UPLOADS_DIR = path.join(tempRoot, "uploads");

const {
  resetState,
  createUploadedJob,
  hydrateJobForReview,
  getJob,
  updateNodeField,
  verifyNode,
  approveJob,
  reprocessJob,
  listPersistedQualifications,
  getPersistedQualification
} = require("../server/jobStore");
const { processExtractionJob, createExtractionDraftFromText } = require("../server/extractionService");
const { closeDatabaseForTests } = require("../server/database");

const sampleQualificationText = `
Pearson BTEC Level 3 National Extended Diploma in Business
Qualification number 603/0455/0
Mandatory Units
All mandatory units must be completed
Unit 1: Exploring Business
Reference H/507/8148
GLH 90
Credit value 10
Assessment Internal
Grade scheme Pass / Merit / Distinction
Unit 3: Personal and Business Finance
Reference T/507/5000
GLH 120
Credit value 15
Assessment External
Grade scheme Pass / Merit / Distinction
Optional Units
Choose at least 1 unit from this group
Unit 8: Recruitment and Selection Process
Reference F/507/8155
GLH 60
Credit value 10
Assessment Internal
Grade scheme Pass / Merit / Distinction
`;

test.beforeEach(() => {
  resetState();
});

test.after(() => {
  resetState();
  closeDatabaseForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("createUploadedJob creates a processing job", () => {
  const job = createUploadedJob("Demo_Qualification.pdf");
  assert.equal(job.status, "processing");
  assert.equal(job.fileName, "Demo_Qualification.pdf");
  assert.equal(job.reviewReady, false);
});

test("createUploadedJob stores artifact metadata when provided", () => {
  const artifact = {
    originalFileName: "Artifact.pdf",
    storedFileName: "123-Artifact.pdf",
    mimeType: "application/pdf",
    sizeBytes: 321,
    uploadedAt: "2026-03-16T15:00:00.000Z",
    expiresAt: "2026-03-17T15:00:00.000Z"
  };
  const job = createUploadedJob("Artifact.pdf", artifact);
  assert.deepEqual(job.artifact, artifact);
});

test("hydrateJobForReview moves a processing job into review with qualification data", () => {
  const created = createUploadedJob("Hydrated.pdf");
  const job = hydrateJobForReview(created.id, created.fileName);
  assert.equal(job.status, "review");
  assert.equal(job.qualification.kind, "Qualification");
  assert.equal(job.reviewReady, false);
});

test("processExtractionJob uses fallback extraction when AI is not configured", async () => {
  delete process.env.OPENAI_API_KEY;
  const created = createUploadedJob("BTEC_Level3_Business_Spec.pdf");
  const hydrated = await processExtractionJob(created.id);
  assert.equal(hydrated.status, "review");
  assert.equal(hydrated.extractionMeta.provider, "fallback");
  assert.equal(hydrated.qualification.kind, "Qualification");
});

test("createExtractionDraftFromText builds groups, units, grade schemes, and rule hints from text", () => {
  const job = createUploadedJob("Business_Qualification.pdf");
  const draft = createExtractionDraftFromText(job, {
    text: sampleQualificationText,
    pageCount: 12
  });

  assert.equal(draft.qualification.kind, "Qualification");
  assert.equal(draft.qualification.children.length, 2);
  assert.equal(draft.qualification.children[0].fields.groupType, "Mandatory");
  assert.equal(draft.qualification.children[1].fields.groupType, "Optional");
  assert.equal(draft.qualification.children[1].fields.minimumUnits, "1");
  assert.equal(draft.qualification.children[0].children.length, 2);
  assert.equal(draft.qualification.children[1].children.length, 1);
  assert.equal(draft.qualification.children[0].children[0].children[0].kind, "Grade Scheme");
  assert.equal(draft.qualification.children[0].children[0].children[0].fields.grades, "P, M, D");
  assert.equal(draft.reviewReady, true);
  assert.equal(draft.extractionMeta.parser, "text-heuristics");
});

test("updateNodeField updates a node field value", () => {
  const job = getJob("job-btec-business");
  assert.ok(job);
  updateNodeField(job.id, "unit-3", "glh", "120");
  const updated = getJob(job.id);
  assert.equal(updated.qualification.children[0].children[1].fields.glh, "120");
});

test("verifyNode marks the review job ready for persistence", () => {
  const updated = verifyNode("job-btec-business", "unit-3");
  assert.equal(updated.reviewReady, true);
  assert.equal(updated.confidence, 95);
  assert.equal(updated.qualification.children[0].children[1].fields.glh, "120");
});

test("approveJob persists only after review is ready", () => {
  verifyNode("job-btec-business", "unit-3");
  const approved = approveJob("job-btec-business");
  assert.equal(approved.status, "persisted");
  assert.ok(approved.persistedAt);

  const persisted = listPersistedQualifications();
  const qualification = persisted.find((item) => item.sourceJobId === "job-btec-business");
  assert.ok(qualification);

  const detail = getPersistedQualification(qualification.id);
  assert.equal(detail.code, "603/0455/0");
  assert.ok(detail.units.length >= 2);
  assert.ok(detail.unitGroups.length >= 1);
  assert.ok(detail.unitGroupMembers.length >= 2);
  assert.ok(detail.gradeSchemes.length >= 1);
  assert.ok(detail.gradeOptions.length >= 3);
  assert.ok(detail.ruleSets.length >= 2);
  assert.ok(detail.ruleSetMembers.length >= 3);
});

test("reprocessJob resets a job back to processing", () => {
  const job = reprocessJob("job-btec-business");
  assert.equal(job.status, "processing");
  assert.equal(job.reviewReady, false);
  assert.equal(job.qualification, null);
  assert.equal(job.attempts, 2);
});