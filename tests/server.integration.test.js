const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(os.tmpdir(), `qualextract-server-tests-${process.pid}`);
const dbPath = path.join(tempRoot, "qualextract-server.sqlite");
const uploadsDir = path.join(tempRoot, "uploads");
const port = 3100 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;

process.env.QUAL_DB_PATH = dbPath;
process.env.QUAL_UPLOADS_DIR = uploadsDir;

const { resetState, createUploadedJob, hydrateJobForReview } = require("../server/jobStore");
const { closeDatabaseForTests } = require("../server/databaseStore");

let serverProcess;
let startupRecoveryJobId;

function seedBlockedReviewJob() {
  resetState();

  const created = createUploadedJob("BTEC_Business_Family_2026.pdf");
  const sharedUnit = {
    id: "unit-shared-3",
    kind: "Unit",
    title: "Unit 3: Personal and Business Finance",
    summary: "Reference T/507/5000, GLH 120?, externally assessed",
    confidence: 68,
    needsAttention: true,
    guidance: "AI extracted a smudged GLH value. Verify before approval.",
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
        id: "learning-outcome-a",
        kind: "Learning Outcome",
        title: "Outcome A",
        summary: "Explore the personal finance sector and services for individuals",
        confidence: 91,
        fields: {
          description: "Explore the personal finance sector and services for individuals"
        },
        children: [
          {
            id: "criterion-a-p1",
            kind: "Assessment Criterion",
            title: "A.P1",
            summary: "Explain the different features of personal current accounts",
            confidence: 78,
            fields: {
              gradeLevel: "P1?",
              description: "Explain the different features of personal current accounts",
              commandVerb: "Explain"
            },
            children: []
          }
        ]
      }
    ]
  };

  const qualificationOne = {
    id: "qualification-extended-diploma",
    kind: "Qualification",
    title: "Pearson BTEC Level 3 National Extended Diploma in Business",
    summary: "Extended Diploma pathway",
    confidence: 93,
    fields: {
      qualificationName: "Pearson BTEC Level 3 National Extended Diploma in Business",
      code: "603/0455/0",
      qualificationType: "Diploma",
      level: "Level 3",
      awardingBody: "Pearson",
      sizeCredits: "180",
      sizeGlh: "1080"
    },
    children: [
      {
        id: "group-extended-mandatory",
        kind: "Unit Group",
        title: "Mandatory Units",
        summary: "All listed units must be completed",
        confidence: 90,
        fields: {
          groupType: "Mandatory",
          minimumUnits: "0",
          selectionRule: "All listed units must be completed"
        },
        children: [sharedUnit]
      }
    ]
  };

  const qualificationTwo = {
    id: "qualification-foundation-diploma",
    kind: "Qualification",
    title: "Pearson BTEC Level 3 National Foundation Diploma in Business",
    summary: "Foundation Diploma pathway",
    confidence: 92,
    fields: {
      qualificationName: "Pearson BTEC Level 3 National Foundation Diploma in Business",
      code: "603/0454/9",
      qualificationType: "Diploma",
      level: "Level 3",
      awardingBody: "Pearson",
      sizeCredits: "120",
      sizeGlh: "720"
    },
    children: [
      {
        id: "group-foundation-mandatory",
        kind: "Unit Group",
        title: "Mandatory Units",
        summary: "At least 2 units are required",
        confidence: 88,
        fields: {
          groupType: "Optional",
          minimumUnits: "2",
          selectionRule: "Choose at least 2 units"
        },
        children: [sharedUnit]
      }
    ]
  };

  return hydrateJobForReview(created.id, {
    qualificationCode: "603/0455/0",
    confidence: 68,
    reviewReady: false,
    pages: { current: 14, total: 92 },
    documentFocus: { top: 31, height: 13, label: "Focus: Unit 3 GLH" },
    qualification: qualificationOne,
    qualifications: [qualificationOne, qualificationTwo],
    sourceTextExcerpt: "Learners study the purpose and importance of personal and business finance.",
    extractionMeta: {
      provider: "fallback",
      parser: "test-fixture"
    }
  });
}

async function waitForServerReady() {
  const timeoutAt = Date.now() + 10_000;
  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for the server to start.");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.title || `Request failed with ${response.status}`);
  }
  return payload;
}

test.before(async () => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  seedBlockedReviewJob();
  startupRecoveryJobId = createUploadedJob("Resume_On_Start.pdf").id;
  closeDatabaseForTests();

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      QUAL_DB_PATH: dbPath,
      QUAL_UPLOADS_DIR: uploadsDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", () => {});
  serverProcess.stderr.on("data", () => {});

  await waitForServerReady();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGINT");
    await new Promise((resolve) => {
      serverProcess.once("exit", resolve);
    });
  }
  closeDatabaseForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("serves the updated live review workspace shell", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Qualification review workspace/);
  assert.match(html, /id="validationRail"/);
  assert.match(html, /id="qualificationTabs"/);
  assert.match(html, /id="approvalPanel"/);
});

test("supports structure-first approval through the real HTTP API", async () => {
  const jobsResponse = await fetchJson(`${baseUrl}/api/v1/jobs`);
  const job = jobsResponse.items.find((item) => item.fileName === "BTEC_Business_Family_2026.pdf");

  assert.ok(job);
  assert.equal(job.validationSummary.counts.qualifications, 2);
  assert.equal(job.validationSummary.counts.sharedUnits, 1);
  assert.equal(job.reviewReady, true);

  const approvedResponse = await fetchJson(`${baseUrl}/api/v1/jobs/${job.id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(approvedResponse.item.status, "persisted");
  assert.ok(approvedResponse.item.persistedAt);
});

test("retries processing jobs that were stranded before server startup", async () => {
  const timeoutAt = Date.now() + 10_000;
  let recoveredJob;

  while (Date.now() < timeoutAt) {
    const response = await fetchJson(`${baseUrl}/api/v1/jobs/${startupRecoveryJobId}`);
    recoveredJob = response.item;
    if (recoveredJob.status !== "processing") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  assert.ok(recoveredJob);
  assert.equal(recoveredJob.status, "review");
  assert.equal(recoveredJob.extractionMeta.aiError, "An uploaded PDF artifact is required for AI extraction.");
});