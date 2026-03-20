const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test, expect } = require("@playwright/test");

const repoRoot = path.join(__dirname, "..", "..");
const tempRoot = path.join(os.tmpdir(), `qualextract-playwright-${process.pid}`);
const dbPath = path.join(tempRoot, "qualextract-playwright.sqlite");
const uploadsDir = path.join(tempRoot, "uploads");
const port = 3400 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;

let serverProcess;

function loadJobStore() {
  process.env.QUAL_DB_PATH = dbPath;
  process.env.QUAL_UPLOADS_DIR = uploadsDir;

  const jobStorePath = require.resolve("../../server/jobStore");
  const databaseStorePath = require.resolve("../../server/databaseStore");
  delete require.cache[jobStorePath];
  delete require.cache[databaseStorePath];

  const jobStore = require("../../server/jobStore");
  const databaseStore = require("../../server/databaseStore");
  return { ...jobStore, closeDatabaseForTests: databaseStore.closeDatabaseForTests };
}

function seedBlockedReviewJob() {
  const { resetState, createUploadedJob, hydrateJobForReview, closeDatabaseForTests } = loadJobStore();
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

  hydrateJobForReview(created.id, {
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

  closeDatabaseForTests();
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
      // Retry until ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for the Playwright test server to start.");
}

test.describe("review workspace", () => {
  test.beforeAll(async () => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });

    seedBlockedReviewJob();

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

  test.afterAll(async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGINT");
      await new Promise((resolve) => {
        serverProcess.once("exit", resolve);
      });
    }

    const { closeDatabaseForTests } = loadJobStore();
    closeDatabaseForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("supports qualification switching, collapsible groups, and persistence in the browser", async ({ page }) => {
    await page.goto(baseUrl);

    await page.getByRole("button", { name: "Open next review" }).click();

    await expect(page.getByRole("heading", { name: "Qualification review workspace" })).toBeVisible();
    await expect(page.locator("#qualificationTabs [role='tab']")).toHaveCount(2);
    await expect(page.locator("#validationRail")).toContainText("2 qualifications discovered");

    await page.getByRole("tab", { name: /Foundation Diploma/ }).click();
    await expect(page.locator("#qualificationTabs [aria-selected='true']")).toContainText("Foundation Diploma");
    await expect(page.locator("#hierarchyTree")).toContainText("Pearson BTEC Level 3 National Foundation Diploma in Business");

    const foundationGroup = page.locator("#hierarchyTree [data-node-id='group-foundation-mandatory']");
    const foundationChildren = page.locator("#hierarchyTree .tree-children[data-parent-node-id='group-foundation-mandatory']");
    await expect(foundationChildren).toBeVisible();
    await foundationGroup.getByRole("button", { name: "Collapse Mandatory Units" }).click();
    await expect(foundationChildren).toBeHidden();
    await foundationGroup.getByRole("button", { name: "Expand Mandatory Units" }).click();
    await expect(foundationChildren).toBeVisible();

    await page.getByRole("tab", { name: /Extended Diploma/ }).click();
    await expect(page.locator("#hierarchyTree")).toContainText("Unit 3: Personal and Business Finance");

    await page
      .locator("#hierarchyTree .tree-card")
      .filter({ hasText: "Unit 3: Personal and Business Finance" })
      .first()
      .click();
    await expect(page.locator("input[data-field='glh']")).toHaveValue("120?");

    await expect(page.getByRole("button", { name: "Approve and Persist" })).toBeEnabled();
    await page.getByRole("button", { name: "Approve and Persist" }).click();

    await expect(page.locator("#view-history.is-active")).toBeVisible();
    await expect(page.locator("#historyTableBody")).toContainText("Persisted");
    await expect(page.locator("#historyTableBody")).toContainText("BTEC_Business_Family_2026.pdf");
  });
});