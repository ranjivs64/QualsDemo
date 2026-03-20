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
const { closeDatabaseForTests } = require("../server/databaseStore");

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

function createReviewJob() {
  const created = createUploadedJob("BTEC_Level3_Business_Spec.pdf");
  const draft = createExtractionDraftFromText(created, {
    text: sampleQualificationText,
    pageCount: 12
  });
  const financeUnit = draft.qualification.children[0].children.find((child) => child.title === "Unit 3: Personal and Business Finance");
  const optionalUnit = draft.qualification.children[1].children[0];

  financeUnit.children.push({
    id: "learning-outcome-1",
    kind: "Learning Outcome",
    title: "Learning Outcome 1",
    summary: "Understand the purpose of personal finance",
    confidence: 90,
    fields: {
      description: "Understand the purpose of personal finance"
    },
    children: [
      {
        id: "criterion-pass-1",
        kind: "Assessment Criterion",
        title: "Pass Criterion 1",
        summary: "Describe different financial products",
        confidence: 89,
        fields: {
          gradeLevel: "Pass",
          description: "Describe different financial products available to consumers"
        },
        children: []
      }
    ]
  });

  draft.reviewReady = false;
  draft.confidence = 82;
  draft.documentFocus = { top: 31, height: 13, label: "Focus: Unit 3 GLH" };
  financeUnit.id = "unit-3";
  optionalUnit.id = "unit-8";
  financeUnit.fields.glh = "120?";
  financeUnit.summary = "Reference T/507/5000, GLH requires verification";
  financeUnit.confidence = 68;
  financeUnit.needsAttention = true;
  financeUnit.guidance = "AI extracted a smudged GLH value. Verify before persistence.";
  financeUnit.focus = { top: 31, height: 13, label: "Focus: Unit 3 GLH" };

  return hydrateJobForReview(created.id, draft);
}

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
  assert.equal(job.reviewReady, true);
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
  const reviewJob = createReviewJob();
  const job = getJob(reviewJob.id);
  assert.ok(job);
  updateNodeField(job.id, "unit-3", "glh", "120");
  const updated = getJob(job.id);
  assert.equal(updated.qualification.children[0].children[1].fields.glh, "120");
});

test("review jobs are ready for persistence once structure exists", () => {
  const reviewJob = createReviewJob();
  assert.equal(reviewJob.reviewReady, true);
  assert.equal(reviewJob.validationSummary.counts.qualifications, 1);
  assert.equal(reviewJob.validationSummary.counts.sharedUnits, 0);
});

test("verifyNode still normalizes extracted field values", () => {
  const reviewJob = createReviewJob();
  const updated = verifyNode(reviewJob.id, "unit-3");
  assert.equal(updated.reviewReady, true);
  assert.equal(updated.confidence, 95);
  assert.equal(updated.qualification.children[0].children[1].fields.glh, "120");
});

test("approveJob persists only after review is ready", () => {
  const reviewJob = createReviewJob();
  verifyNode(reviewJob.id, "unit-3");
  const approved = approveJob(reviewJob.id);
  assert.equal(approved.status, "persisted");
  assert.ok(approved.persistedAt);

  const persisted = listPersistedQualifications();
  const qualification = persisted.find((item) => item.sourceJobId === reviewJob.id);
  assert.ok(qualification);

  const detail = getPersistedQualification(qualification.id);
  assert.equal(detail.code, "603/0455/0");
  assert.ok(detail.units.length >= 2);
  assert.ok(detail.unitGroups.length >= 1);
  assert.ok(detail.unitGroupMembers.length >= 2);
  assert.ok(detail.learningOutcomes.length >= 1);
  assert.ok(detail.assessmentCriteria.length >= 1);
  assert.ok(detail.gradeSchemes.length >= 1);
  assert.ok(detail.gradeOptions.length >= 3);
  assert.ok(detail.ruleSets.length >= 2);
  assert.ok(detail.ruleSetMembers.length >= 3);
});

test("approveJob persists multiple qualifications from one job and reuses shared units", () => {
  const created = createUploadedJob("BTEC_Level1_and_Level2_Vehicle_Technology.pdf");
  const sharedUnit = {
    id: "unit-shared-1",
    kind: "Unit",
    title: "Unit 1: Vehicle Systems Basics",
    summary: "Reference V/100/1001, GLH 60, internally assessed",
    confidence: 95,
    fields: {
      unitNumber: "Unit 1",
      reference: "V/100/1001",
      glh: "60",
      creditValue: "10",
      assessmentType: "Internal",
      gradeScheme: "Pass / Merit / Distinction",
      gradingScheme: "Pass / Merit / Distinction"
    },
    children: []
  };

  const qualificationOne = {
    id: "qualification-level-1",
    kind: "Qualification",
    title: "Pearson BTEC Level 1 Certificate in Vehicle Technology",
    summary: "Level 1 qualification",
    confidence: 95,
    fields: {
      qualificationName: "Pearson BTEC Level 1 Certificate in Vehicle Technology",
      code: "601/0001/1",
      type: "Certificate",
      qualificationType: "Certificate",
      level: "Level 1",
      awardingBody: "Pearson",
      sizeGlh: "180",
      sizeCredits: "18",
      gradingScheme: "Pass / Merit / Distinction"
    },
    children: [
      {
        id: "group-level-1-mandatory",
        kind: "Unit Group",
        title: "Mandatory Units",
        summary: "All listed units must be completed",
        confidence: 95,
        fields: {
          groupType: "Mandatory",
          selectionRule: "All listed units must be completed",
          minimumUnits: "0",
          ruleSet: "All listed units must be completed"
        },
        children: [sharedUnit]
      }
    ]
  };

  const qualificationTwo = {
    id: "qualification-level-2",
    kind: "Qualification",
    title: "Pearson BTEC Level 2 Diploma in Vehicle Technology",
    summary: "Level 2 qualification",
    confidence: 95,
    fields: {
      qualificationName: "Pearson BTEC Level 2 Diploma in Vehicle Technology",
      code: "601/0002/2",
      type: "Diploma",
      qualificationType: "Diploma",
      level: "Level 2",
      awardingBody: "Pearson",
      sizeGlh: "360",
      sizeCredits: "36",
      gradingScheme: "Pass / Merit / Distinction"
    },
    children: [
      {
        id: "group-level-2-mandatory",
        kind: "Unit Group",
        title: "Mandatory Units",
        summary: "All listed units must be completed",
        confidence: 95,
        fields: {
          groupType: "Mandatory",
          selectionRule: "All listed units must be completed",
          minimumUnits: "0",
          ruleSet: "All listed units must be completed"
        },
        children: [sharedUnit]
      }
    ]
  };

  const reviewJob = hydrateJobForReview(created.id, {
    qualificationCode: "601/0001/1",
    confidence: 95,
    reviewReady: true,
    pages: { current: 1, total: 20 },
    documentFocus: { top: 20, height: 10, label: "Focus: qualification overview" },
    qualification: qualificationOne,
    qualifications: [qualificationOne, qualificationTwo],
    sourceTextExcerpt: "Vehicle technology combined specification",
    extractionMeta: {
      provider: "fallback",
      extractedAt: "2026-03-19T00:00:00.000Z",
      parser: "test-fixture"
    }
  });

  const approved = approveJob(reviewJob.id);
  assert.equal(approved.status, "persisted");

  const persisted = listPersistedQualifications().filter((item) => item.sourceJobId === reviewJob.id);
  assert.equal(persisted.length, 2);

  const firstDetail = getPersistedQualification(persisted[0].id);
  const secondDetail = getPersistedQualification(persisted[1].id);
  assert.equal(firstDetail.units.length, 1);
  assert.equal(secondDetail.units.length, 1);
  assert.equal(firstDetail.units[0].id, secondDetail.units[0].id);

  const reviewState = getJob(reviewJob.id);
  assert.equal(reviewState.validationSummary.counts.sharedUnits, 1);
});

test("updateNodeField updates shared units across linked qualifications", () => {
  const created = createUploadedJob("Shared_Unit_Test.pdf");
  const sharedUnit = {
    id: "unit-shared-1",
    kind: "Unit",
    title: "Unit 1: Shared Systems",
    summary: "Reference V/100/1001, GLH 60, internally assessed",
    confidence: 78,
    needsAttention: true,
    fields: {
      unitNumber: "Unit 1",
      reference: "V/100/1001",
      glh: "60?",
      creditValue: "10",
      assessmentType: "Internal",
      gradeScheme: "Pass / Merit / Distinction",
      gradingScheme: "Pass / Merit / Distinction"
    },
    children: []
  };

  const qualificationOne = {
    id: "qualification-one",
    kind: "Qualification",
    title: "Qualification One",
    summary: "Shared unit test one",
    confidence: 90,
    fields: { qualificationName: "Qualification One", code: "100/0001/1" },
    children: [
      {
        id: "group-one",
        kind: "Unit Group",
        title: "Mandatory Units",
        summary: "All listed units must be completed",
        confidence: 90,
        fields: { groupType: "Mandatory", minimumUnits: "0", selectionRule: "All listed units must be completed" },
        children: [sharedUnit]
      }
    ]
  };

  const qualificationTwo = {
    id: "qualification-two",
    kind: "Qualification",
    title: "Qualification Two",
    summary: "Shared unit test two",
    confidence: 90,
    fields: { qualificationName: "Qualification Two", code: "100/0002/2" },
    children: [
      {
        id: "group-two",
        kind: "Unit Group",
        title: "Mandatory Units",
        summary: "All listed units must be completed",
        confidence: 90,
        fields: { groupType: "Mandatory", minimumUnits: "0", selectionRule: "All listed units must be completed" },
        children: [sharedUnit]
      }
    ]
  };

  const reviewJob = hydrateJobForReview(created.id, {
    qualificationCode: "100/0001/1",
    confidence: 78,
    reviewReady: false,
    pages: { current: 1, total: 10 },
    documentFocus: { top: 25, height: 10, label: "Focus: shared unit GLH" },
    qualification: qualificationOne,
    qualifications: [qualificationOne, qualificationTwo],
    sourceTextExcerpt: "Shared unit test",
    extractionMeta: { provider: "fallback", parser: "test-fixture" }
  });

  updateNodeField(reviewJob.id, "unit-shared-1", "glh", "60");
  const updated = getJob(reviewJob.id);

  assert.equal(updated.qualifications[0].children[0].children[0].fields.glh, "60");
  assert.equal(updated.qualifications[1].children[0].children[0].fields.glh, "60");
  assert.equal(updated.reviewReady, true);
});

test("approveJob persists reviewed structures without validation gating", () => {
  const reviewJob = createReviewJob();
  const approved = approveJob(reviewJob.id);
  assert.equal(approved.status, "persisted");
});

test("reprocessJob resets a job back to processing", () => {
  const reviewJob = createReviewJob();
  const job = reprocessJob(reviewJob.id);
  assert.equal(job.status, "processing");
  assert.equal(job.reviewReady, false);
  assert.equal(job.qualification, null);
  assert.equal(job.attempts, 2);
});