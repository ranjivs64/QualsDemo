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
const { processExtractionJob } = require("../server/extractionService");
const { closeDatabaseForTests } = require("../server/databaseStore");

function createReviewDraftFixture() {
  const financeUnit = {
    id: "unit-3",
    kind: "Unit",
    title: "Unit 3: Personal and Business Finance",
    summary: "Reference T/507/5000, GLH requires verification",
    confidence: 68,
    needsAttention: true,
    guidance: "AI extracted a smudged GLH value. Verify before persistence.",
    focus: { top: 31, height: 13, label: "Focus: Unit 3 GLH" },
    fields: {
      unitNumber: "Unit 3",
      reference: "T/507/5000",
      glh: "120?",
      creditValue: "15",
      assessmentType: "External",
      gradeScheme: "Pass / Merit / Distinction",
      gradingScheme: "Pass / Merit / Distinction"
    },
    children: [
      {
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
      }
    ]
  };

  return {
    qualificationCode: "603/0455/0",
    confidence: 82,
    reviewReady: false,
    pages: { current: 1, total: 12 },
    documentFocus: { top: 31, height: 13, label: "Focus: Unit 3 GLH" },
    sourceTextExcerpt: "Learners study the purpose and importance of personal and business finance.",
    extractionMeta: {
      provider: "openai",
      model: "gpt-5.1-2026-01-15",
      inputMode: "pdf-file"
    },
    qualification: {
      id: "qualification-draft",
      kind: "Qualification",
      title: "Pearson BTEC Level 3 National Extended Diploma in Business",
      summary: "Diploma, awarding body Pearson",
      confidence: 91,
      fields: {
        qualificationName: "Pearson BTEC Level 3 National Extended Diploma in Business",
        code: "603/0455/0",
        type: "Diploma",
        qualificationType: "Diploma",
        level: "Level 3",
        awardingBody: "Pearson",
        sizeGlh: "Pending",
        sizeCredits: "180",
        gradingScheme: "Pass / Merit / Distinction",
        totalQualificationTime: "Pending"
      },
      children: [
        {
          id: "group-1",
          kind: "Unit Group",
          title: "Mandatory Units",
          summary: "All listed units must be completed",
          confidence: 90,
          fields: {
            groupType: "Mandatory",
            minimumUnits: "0",
            selectionRule: "All listed units must be completed",
            ruleSet: "All listed units must be completed"
          },
          children: [
            {
              id: "unit-1",
              kind: "Unit",
              title: "Unit 1: Exploring Business",
              summary: "Reference H/507/8148, GLH 90, internally assessed",
              confidence: 93,
              fields: {
                unitNumber: "Unit 1",
                reference: "H/507/8148",
                glh: "90",
                creditValue: "10",
                assessmentType: "Internal",
                gradeScheme: "Pass / Merit / Distinction",
                gradingScheme: "Pass / Merit / Distinction"
              },
              children: [
                {
                  id: "grade-scheme-unit-1",
                  kind: "Grade Scheme",
                  title: "Pass / Merit / Distinction",
                  summary: "Minimum pass grade P",
                  confidence: 91,
                  fields: {
                    schemeName: "Pass / Merit / Distinction",
                    minimumPass: "P",
                    grades: "P, M, D"
                  },
                  children: []
                }
              ]
            },
            financeUnit
          ]
        },
        {
          id: "group-2",
          kind: "Unit Group",
          title: "Optional Units",
          summary: "Choose at least 1 unit",
          confidence: 88,
          fields: {
            groupType: "Optional",
            minimumUnits: "1",
            selectionRule: "Choose at least 1 unit",
            ruleSet: "Choose at least 1 unit"
          },
          children: [
            {
              id: "unit-8",
              kind: "Unit",
              title: "Unit 8: Recruitment and Selection Process",
              summary: "Reference F/507/8155, GLH 60, internally assessed",
              confidence: 90,
              fields: {
                unitNumber: "Unit 8",
                reference: "F/507/8155",
                glh: "60",
                creditValue: "10",
                assessmentType: "Internal",
                gradeScheme: "Pass / Merit / Distinction",
                gradingScheme: "Pass / Merit / Distinction"
              },
              children: []
            }
          ]
        }
      ]
    }
  };
}

function createReviewJob() {
  const created = createUploadedJob("BTEC_Level3_Business_Spec.pdf");
  return hydrateJobForReview(created.id, createReviewDraftFixture());
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

test("processExtractionJob does not create heuristic metadata without an uploaded PDF artifact", async () => {
  const created = createUploadedJob("BTEC_Level3_Business_Spec.pdf");
  const hydrated = await processExtractionJob(created.id);
  assert.equal(hydrated.status, "review");
  assert.equal(hydrated.extractionMeta.provider, "openai");
  assert.equal(hydrated.extractionMeta.inputMode, "pdf-file");
  assert.equal(hydrated.extractionMeta.aiError, "An uploaded PDF artifact is required for AI extraction.");
  assert.equal(hydrated.qualifications.length, 0);
  assert.equal(hydrated.qualification, null);
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