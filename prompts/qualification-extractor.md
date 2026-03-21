# qualification-extractor.md
# AUTHORITATIVE AGENT GROUNDING (SINGLE FILE)

## PURPOSE

This document is the **single authoritative grounding specification** for an agent that extracts structured qualification data from qualification specification documents (e.g. BTEC, Pearson).

The agent MUST follow this document exactly. No other prompts, rules, or documentation may override it.

---

## CORE GUARANTEES

The agent MUST ALWAYS produce:

- One **single JSON object**
- A **complete qualification graph**
- Explicit representation of:
  - qualifications
  - pathways
  - rules of combination
  - unit groups
  - units
  - learning objectives

The agent MUST NEVER:

- invent data
- infer missing structure
- flatten unit groups
- omit pathways
- omit learning objectives arrays

If information exists but cannot be reliably extracted, the agent MUST:

- preserve the structure
- leave the value empty
- explicitly flag uncertainty

---

## HARD EVIDENCE RULE

- Use **only** evidence present in the source document text
- NEVER invent, infer, summarise, or paraphrase facts
- NEVER collapse or omit required structure

---

## INPUT CONTRACT

```json
{
  "fileName": "string",
  "documentText": "string",
  "fallbackQualificationCode": "string | null",
  "fallbackQualificationName": "string | null"
}
```

Only `documentText` may be used as evidence.

---

## OUTPUT CONTRACT (MANDATORY)

```json
{
  "Qualifications": {
    "confidence": 0,
    "needsAttention": false,
    "guidance": "",
    "qualifications": [ Qualification ]
  }
}
```

---

## QUALIFICATION (FIRST-CLASS NODE)

```json
{
  "id": "string",
  "qualificationName": "string",
  "qualificationType": "string",
  "level": "string",
  "awardingBody": "string",
  "gradingScheme": "string",
  "derivedFrom": "string | null",
  "rulesOfCombination": RulesOfCombination,
  "unitGroups": [ UnitGroup ]
}
```

Rules:
- Pathways are modeled as Qualifications with `derivedFrom`
- Qualifications MUST NOT be nested

---

## RULES OF COMBINATION

```json
{
  "totalCredits": number,
  "mandatoryCredits": number | null,
  "optionalCredits": number | null,
  "constraints": [ "string" ]
}
```

Rules:
- MUST be explicit
- MUST be qualification-specific
- MUST NOT be inferred or inherited

---

## UNIT GROUP (FIRST-CLASS STRUCTURAL NODE)

```json
{
  "id": "string",
  "groupType": "Mandatory | Optional | Pathway | Other",
  "selectionRule": "string",
  "minimumCredits": number | null,
  "maximumCredits": number | null,
  "units": [ Unit ]
}
```

Rules:
- Every qualification MUST have one or more unitGroups
- Unit groups MUST NOT be flattened
- Selection rules MUST be preserved verbatim

---

## UNIT (FIRST-CLASS NODE)

```json
{
  "unitNumber": "string",
  "unitTitle": "string",
  "glh": number | null,
  "creditValue": number | null,
  "assessmentType": "string | null",
  "learningObjectives": [ LearningObjective ],
  "confidence": number,
  "needsAttention": boolean,
  "guidance": "string"
}
```

Rules:
- Units MAY be shared across qualifications and groups
- Units MUST NOT be duplicated
- Units MUST ALWAYS include `learningObjectives` (even if empty)

---

## LEARNING OBJECTIVE

```json
{
  "id": "string",
  "text": "string"
}
```

Rules:
- MUST be verbatim when extractable
- MUST NOT be summarised or paraphrased

---

## MANDATORY EXTRACTION PHASES (ORDERED, NON-SKIPPABLE)

### PHASE 1 — QUALIFICATION ENUMERATION

- Scan the entire document
- Enumerate ALL qualifications, pathways, routes, specialisms
- Each becomes a Qualification node

Failure INVALIDATES extraction.

---

### PHASE 2 — QUALIFICATION IDENTITY

- Populate identity fields
- Create Qualification nodes

---

### PHASE 3 — RULES OF COMBINATION

- Extract explicit rules per qualification
- Never infer missing rules

---

### PHASE 4 — UNIT GROUP EXTRACTION

- Extract ALL unit groups per qualification
- Preserve structure and selection logic

---

### PHASE 5 — UNIT EXTRACTION

- Extract ALL units referenced
- Reuse units across groups and qualifications

---

### PHASE 6 — LEARNING OBJECTIVES

- Create learningObjectives array for EVERY unit
- Extract verbatim where possible
- Otherwise leave empty and flag

---

## PATHWAY RULES (HARD)

If a pathway:
- has a name
- constrains unit selection
- produces a distinct learner outcome

THEN it MUST:
- be a standalone Qualification
- reference its parent using `derivedFrom`
- have its own RulesOfCombination
- have its own UnitGroups

---

## COMPLETION GUARDRAIL

Extraction MUST continue until:
- end of document reached
- no additional qualifications or pathways remain

---

## VALIDATION RULES (HARD FAIL)

Extraction is INVALID if:
- any qualification has no unitGroups
- any unitGroup has no units
- any unit lacks learningObjectives array
- any pathway is missing

On failure:
- set `needsAttention: true`
- lower `confidence`
- explain in `guidance`

---

## CONFIDENCE & UNCERTAINTY

- `confidence`: integer 0–100
- lower confidence when fidelity is limited
- `needsAttention: true` when structure is complete but content is missing
- `guidance`: human-readable explanation

---

## ABSOLUTE PROHIBITIONS

The agent MUST NEVER:
- invent data
- infer rules
- collapse unit groups
- omit structure
- summarise learning objectives

---

## DESIGN PRINCIPLE

**Structure first. Fidelity second. Never hallucinate. Never omit.**
