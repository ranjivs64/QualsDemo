const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeAuthoritativeAiPayload } = require("../server/aiDraftNormalizer");

test("normalizeAuthoritativeAiPayload maps shared units and learning objectives into the internal graph", () => {
  const fallbackDraft = {
    qualificationCode: "603/0455/0",
    confidence: 78,
    reviewReady: false,
    pages: { current: 1, total: 92 },
    documentFocus: { top: 28, height: 12, label: "Focus pending" },
    qualification: {
      id: "qualification-draft",
      kind: "Qualification",
      title: "Fallback Qualification",
      confidence: 78,
      fields: {
        qualificationName: "Fallback Qualification",
        code: "603/0455/0",
        qualificationType: "Diploma",
        level: "Level 3",
        awardingBody: "Pearson",
        sizeGlh: "Pending",
        sizeCredits: "Pending",
        gradingScheme: "Pending",
        totalQualificationTime: "Pending"
      },
      children: []
    },
    qualifications: []
  };

  const payload = {
    Qualifications: {
      confidence: 84,
      needsAttention: false,
      guidance: "",
      qualifications: [
        {
          id: "extended-diploma",
          qualificationName: "Pearson BTEC Level 3 National Extended Diploma in Business",
          qualificationType: "Diploma",
          level: "Level 3",
          awardingBody: "Pearson",
          gradingScheme: "Pass / Merit / Distinction",
          derivedFrom: null,
          rulesOfCombination: {
            totalCredits: 180,
            mandatoryCredits: 120,
            optionalCredits: 60,
            constraints: ["Complete all mandatory units"]
          },
          unitGroups: [
            {
              id: "group-mandatory-a",
              groupType: "Mandatory",
              selectionRule: "All listed units must be completed",
              minimumCredits: 120,
              maximumCredits: null,
              units: [
                {
                  unitNumber: "Unit 1",
                  unitTitle: "Exploring Business",
                  glh: 90,
                  creditValue: 10,
                  assessmentType: "Internal",
                  learningObjectives: [
                    {
                      id: "lo-1",
                      text: "Explore the features of business activity."
                    }
                  ],
                  confidence: 88,
                  needsAttention: false,
                  guidance: ""
                }
              ]
            }
          ]
        },
        {
          id: "foundation-diploma",
          qualificationName: "Pearson BTEC Level 3 National Foundation Diploma in Business",
          qualificationType: "Diploma",
          level: "Level 3",
          awardingBody: "Pearson",
          gradingScheme: "Pass / Merit / Distinction",
          derivedFrom: "extended-diploma",
          rulesOfCombination: {
            totalCredits: 120,
            mandatoryCredits: 90,
            optionalCredits: 30,
            constraints: ["Choose at least one optional unit"]
          },
          unitGroups: [
            {
              id: "group-mandatory-b",
              groupType: "Mandatory",
              selectionRule: "All listed units must be completed",
              minimumCredits: 90,
              maximumCredits: null,
              units: [
                {
                  unitNumber: "Unit 1",
                  unitTitle: "Exploring Business",
                  glh: 90,
                  creditValue: 10,
                  assessmentType: "Internal",
                  learningObjectives: [
                    {
                      id: "lo-1",
                      text: "Explore the features of business activity."
                    }
                  ],
                  confidence: 88,
                  needsAttention: false,
                  guidance: ""
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const normalized = normalizeAuthoritativeAiPayload(payload, fallbackDraft);

  assert.equal(normalized.qualifications.length, 2);
  assert.equal(normalized.qualification.fields.code, "603/0455/0");
  assert.equal(normalized.qualifications[0].children[0].fields.groupType, "Mandatory");
  assert.equal(
    normalized.qualifications[0].children[0].children[0].id,
    normalized.qualifications[1].children[0].children[0].id
  );
  assert.equal(normalized.qualifications[0].children[0].children[0].children[0].kind, "Learning Outcome");
  assert.equal(normalized.extractionMeta.authoritativeQualificationCount, 2);
});