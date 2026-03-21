---
inputs:
  epic_title:
    description: "Title of the Epic"
    required: true
    default: "Adopt authoritative qualification extractor contract"
  issue_number:
    description: "Local placeholder epic number"
    required: true
    default: "2"
  priority:
    description: "Priority level"
    required: false
    default: "p0"
  author:
    description: "Document author"
    required: false
    default: "Product Manager Agent"
  date:
    description: "Creation date"
    required: false
    default: "2026-03-20"
---

# PRD: Adopt authoritative qualification extractor contract

**Epic**: #2  
**Status**: Draft  
**Author**: Product Manager Agent  
**Date**: 2026-03-20  
**Stakeholders**: Product owner, qualification content specialists, platform engineering, AI engineering, QA  
**Priority**: p0  
**Labels**: type:epic, needs:ai

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Target Users](#2-target-users)
3. [Goals and Success Metrics](#3-goals-and-success-metrics)
4. [Research Summary](#4-research-summary)
5. [Requirements](#5-requirements)
6. [GenAI Requirements](#6-genai-requirements)
7. [User Stories and Features](#7-user-stories-and-features)
8. [User Flows](#8-user-flows)
9. [Dependencies and Constraints](#9-dependencies-and-constraints)
10. [Risks and Mitigations](#10-risks-and-mitigations)
11. [Timeline and Milestones](#11-timeline-and-milestones)
12. [Out of Scope](#12-out-of-scope)
13. [Open Questions](#13-open-questions)
14. [Appendix](#14-appendix)

---

## 1. Problem Statement

### What problem are we solving?
The repository now contains an authoritative extractor prompt that defines a different AI output contract than the application currently consumes. The prompt requires a top-level `Qualifications` object with first-class qualifications, pathways, rules of combination, unit groups, units, and learning objectives. The live application still expects a graph-shaped payload with top-level `qualificationCode`, `reviewReady`, `pages`, `documentFocus`, and `qualifications`, where each node uses `kind`, `title`, `fields`, and `children`.

This mismatch creates a broken contract at the most fragile boundary in the system: AI output ingestion. If the prompt remains authoritative while the app keeps its current schema and validation rules, extraction can fail outright or produce structurally incomplete drafts. If the app is changed carelessly to consume the new prompt structure directly, the blast radius reaches review UX, persistence, audit behavior, tests, and fallback extraction.

The product need is to adopt the new authoritative extraction contract without destabilizing the working review workspace. The preferred path is to formalize the authoritative AI-facing schema, translate it into the current internal review graph through a normalization boundary, and migrate the broader product in controlled phases.

### Why is this important?
- The prompt has already been changed on the main branch, so contract drift is no longer theoretical.
- AI extraction is schema-enforced. Prompt drift is not recoverable by prompting alone once the consuming schema disagrees.
- Reviewers need continuity in the current workspace while the extraction contract matures.
- Product quality depends on being able to evolve the AI contract without rewriting every downstream consumer at the same time.

### What happens if we do not solve this?
- AI extraction requests can fail validation or return incomplete drafts.
- Reviewers can lose trust because the same document may behave differently depending on prompt revisions.
- Engineering will be forced into emergency fixes whenever prompt authors change domain structure.
- Future additions such as pathways, rules of combination, and qualification-derived variants will keep colliding with the legacy graph contract.

---

## 2. Target Users

### Primary Users

**User Persona 1: Qualification Content Reviewer**
- **Goals**: Review extracted qualifications, pathways, unit groups, units, and learning objectives without regression in the current workspace.
- **Pain Points**: Review experience breaks when extraction shape changes underneath the UI.
- **Behaviors**: Compares extracted structure to source documents, flags missing pathways, validates unit reuse, and approves structures for persistence.

**User Persona 2: AI Workflow Maintainer**
- **Goals**: Improve prompt quality and schema accuracy without accidentally breaking runtime consumers.
- **Pain Points**: Prompt changes are risky when application contracts are implicit or duplicated.
- **Behaviors**: Iterates on prompts, structured output schemas, evaluation fixtures, and provider settings.

**User Persona 3: Platform Engineer**
- **Goals**: Keep ingestion, review, persistence, and audit layers stable while introducing the new contract.
- **Pain Points**: Wide runtime coupling makes schema changes expensive and hard to validate.
- **Behaviors**: Maintains the API boundary, persistence rules, data normalization, and automated tests.

### Secondary Users
- QA engineers validating extraction regressions and review behavior
- Product owners prioritizing migration phases and risk tradeoffs
- Future integrators who may consume the authoritative contract directly

---

## 3. Goals and Success Metrics

### Business Goals
1. Preserve a stable reviewer experience while adopting the authoritative AI extraction contract.
2. Reduce the cost of future prompt or schema evolution by introducing an explicit normalization boundary.
3. Allow the product to support richer qualification concepts such as pathways and rules of combination without forcing a same-day rewrite of the UI and persistence layers.
4. Establish model, schema, and evaluation governance for AI contract changes.

### Success Metrics

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| AI extraction contract mismatch incidents | Present on current main | 0 open mismatches between prompt, AI schema, and runtime ingestion | Before next release |
| Reviewer workflow regression after contract migration | High risk | 0 Sev 1 or Sev 2 regressions in upload, review, approve, persist flows | Phase 1 release |
| Structured-output parse success rate | Unknown baseline under new prompt | 99 percent or higher on supported documents | Phase 1 pilot |
| Normalization success rate from authoritative payload to internal graph | Not implemented | 99 percent or higher for approved fixtures | Phase 1 pilot |
| Prompt/schema drift detection time | Manual and ad hoc | CI detection on every prompt or schema change | Phase 1 release |
| Pathway capture completeness | Unsupported in current graph contract | 95 percent or higher across pilot documents that contain pathways | Phase 2 |

### User Success Criteria
- Reviewers can keep using the current workspace without learning a new interaction model during the first migration phase.
- Prompt authors can evolve the authoritative contract without silently breaking ingestion.
- Engineering can test and reason about AI output using a documented external contract and a documented internal contract.

---

## 4. Research Summary

### Sources Consulted
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs
- https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview
- https://docs.cloud.google.com/document-ai/docs/overview
- https://docs.unstructured.io/ui/overview
- Existing repository sources: current prompt, current AI client, current extraction schema, PRD-1, SPEC-1, and runtime consumers in review and persistence layers

### Key Findings
1. Structured output systems work best when the schema is treated as a first-class contract, not as an informal extension of the prompt.
2. Both OpenAI and Azure OpenAI structured outputs require strict schema discipline, including required fields and explicit object definitions. This makes contract divergence between prompt and runtime especially brittle.
3. Modern document AI systems separate extraction from normalization. They extract structured document evidence, then transform it into a canonical or business-specific schema.
4. Unstructured explicitly routes varied document inputs into a canonical JSON schema before downstream chunking, enrichment, and persistence. That pattern matches this repo's need for an explicit normalization layer.
5. Google Document AI and Azure Document Intelligence both emphasize converting raw document content into structured document objects before workflow-specific use. They do not assume the extraction provider's output is identical to the consuming application's runtime model.
6. The current repo has deep internal coupling to the legacy graph contract across AI validation, merge logic, job summaries, persistence, and UI rendering. A direct cutover would increase delivery risk and regression exposure.

### Comparison Matrix

| Solution | Approach | Strengths | Weaknesses | Relevance to this PRD |
|----------|----------|-----------|------------|------------------------|
| OpenAI Structured Outputs | Strict JSON-schema-constrained model output | Strong schema adherence, explicit refusals, parser-friendly contracts | Requires careful schema management and drift controls | Validates the need to keep prompt and schema in lockstep |
| Azure OpenAI Structured Outputs | Strict structured output on Azure-hosted models | Same schema discipline plus Azure-hosted operations | Supported schema subset and nesting constraints must be respected | Confirms the current app's provider path benefits from a formal AI contract |
| Azure Document Intelligence | Extracts text, layout, tables, and structured fields | Strong document-to-structure pipeline, clear separation between analysis and app logic | Requires mapping into app-specific entities | Reinforces the extract-then-map pattern |
| Google Document AI | Processor-based document understanding returning structured document objects | Classification, splitting, extraction, and evaluation patterns | Requires processor selection and downstream mapping | Reinforces explicit document-object workflows |
| Unstructured | Routes documents into a canonical JSON schema, then transforms/chunks/persists | Clear canonical-schema boundary, runtime routing, workflow isolation | Canonical schema still needs app-specific mapping | Closest pattern match to the needed normalization layer |

### Chosen Approach Rationale
Adopt the authoritative prompt as the external AI contract, but do not make the current application consume that payload directly in phase 1. Instead:
1. Create a dedicated authoritative JSON schema that matches the prompt exactly.
2. Make the AI client validate against that authoritative schema.
3. Normalize the authoritative payload into the existing internal graph contract.
4. Keep the current review UX and persistence behavior on the internal graph until a later migration phase is explicitly planned.
5. Add evaluation fixtures and CI checks so prompt, external schema, and normalizer stay aligned.

This approach preserves reviewer continuity, reduces blast radius, and creates a durable contract boundary for future evolution.

### Rejected Alternatives
- **Immediate direct cutover to the authoritative payload everywhere**: Rejected because the internal graph contract is deeply embedded across review, persistence, and tests.
- **Rollback the prompt to the legacy graph shape and ignore the new model**: Rejected because it discards richer domain concepts already captured in the authoritative prompt.
- **Support both shapes informally with loose parsing**: Rejected because it would hide contract drift and increase runtime ambiguity.
- **Rely on prompt wording alone to force the old shape**: Rejected because structured-output systems should be governed by explicit schemas, not prompt-only conventions.

### User Needs Validation
Direct end-user interview data for this migration is not present in the repo. However, repo behavior and product artifacts provide strong evidence of user needs:
- reviewers need continuity in the current review workflow,
- AI maintainers need safe prompt iteration,
- platform engineering needs a stable ingestion boundary,
- product stakeholders need pathways and richer qualification semantics without destabilizing release quality.

Assumption flagged: the current reviewers prefer backward-compatible review UX during phase 1 rather than a simultaneous UX rewrite. This should be validated before phase 2.

### Standards and Compliance Notes
- Structured output contracts should use explicit schemas and drift checks in CI.
- AI model versions should remain pinned and change-controlled.
- Reviewer-visible extraction changes should be auditable and tied to prompt/schema versions.
- Existing accessibility expectations for the review UI remain in force because the first migration phase preserves the current workspace.

---

## 5. Requirements

### 5.1 Functional Requirements

#### Must Have (P0)
1. **Authoritative external schema**
 - The product must define a JSON schema that exactly matches the authoritative prompt contract.
 - Acceptance Criteria:
   - [ ] The schema includes the top-level `Qualifications` object.
   - [ ] Qualification, rules-of-combination, unit-group, unit, and learning-objective objects are fully defined.
   - [ ] Required and nullable fields are expressed in a structured-output-compatible way.

2. **Normalization boundary**
 - The product must transform authoritative AI output into the current internal review graph before downstream consumption.
 - Acceptance Criteria:
   - [ ] The normalizer produces the current job draft fields required by review and persistence flows.
   - [ ] The normalizer preserves qualification identity, derived pathways, rules, unit groups, units, and learning objectives.
   - [ ] The normalizer records uncertainty and attention flags rather than discarding them.

3. **Backward-compatible review experience**
 - Phase 1 must preserve current review workspace behavior for existing users.
 - Acceptance Criteria:
   - [ ] Review pages still render qualification trees and details without requiring a new UI contract.
   - [ ] Approval and persistence flows remain functional for normalized drafts.
   - [ ] Existing reviewer navigation remains intact.

4. **Drift detection**
 - The product must detect prompt/schema/runtime divergence before release.
 - Acceptance Criteria:
   - [ ] CI fails when the authoritative prompt changes without the authoritative schema and fixture updates.
   - [ ] CI fails when the normalizer no longer satisfies internal graph expectations.
   - [ ] AI response fixtures exist for at least one valid multi-qualification and one pathway-bearing document.

5. **Fallback compatibility**
 - Non-AI or fallback extraction must still emit the internal graph contract until phase 2 explicitly changes that behavior.
 - Acceptance Criteria:
   - [ ] Fallback extraction remains usable when AI credentials are unavailable.
   - [ ] Fallback output can coexist with normalized AI output in the same review workflow.

6. **Versioned observability**
 - Extraction runs must reveal which prompt, schema, and normalizer version produced the draft.
 - Acceptance Criteria:
   - [ ] Job metadata captures prompt version or hash.
   - [ ] Job metadata captures authoritative schema version.
   - [ ] Job metadata captures normalizer version.

#### Should Have (P1)
1. **Phase-2-ready data capture**
 - The normalized internal graph should preserve enough source detail to support later first-class pathway and rules-of-combination UX.
 - Acceptance Criteria:
   - [ ] Derived pathway lineage is not lost.
   - [ ] Qualification-specific rules are carried into metadata or fields for future UI use.

2. **Golden-set evaluation**
 - The product should maintain a representative extraction corpus for regression checks.
 - Acceptance Criteria:
   - [ ] Fixtures cover single qualification, multi-qualification, shared unit, and pathway documents.
   - [ ] Evaluation reports compare authoritative payload quality and normalized graph quality.

3. **Migration telemetry**
 - The product should measure how often normalized drafts still require manual reviewer edits.
 - Acceptance Criteria:
   - [ ] Review sessions can distinguish AI extraction errors from normalization losses.

#### Could Have (P2)
1. **Phase 2 direct-consumption exploration**
 - Explore whether the UI and persistence model should eventually consume authoritative structures more directly.
 - Acceptance Criteria:
   - [ ] A later decision package compares continued normalization versus internal-model replacement.

---

## 6. GenAI Requirements

### LLM Selection Criteria
- The primary model must support strict structured outputs with the schema depth required by the authoritative contract.
- The model must remain pinned to an explicit version, not a floating alias.
- The system must keep a documented fallback model or fallback extraction path for degraded-mode operation.

### Evaluation Strategy
- Evaluate both authoritative-schema compliance and business-shape normalization quality.
- Maintain a regression set with documents that exercise pathways, shared units, and sparse learning-objective sections.
- Gate prompt or model changes on fixture-based pass thresholds before promotion.

### Model Pinning Approach
- Keep the extraction model pinned via environment configuration.
- Treat model upgrades as a controlled change that requires evaluation reruns and release notes.

### Guardrails
- The prompt and schema must instruct the model to preserve missing values as empty or flagged, not inferred.
- Refusals, malformed outputs, and schema mismatches must be surfaced as explicit job failures or degraded-mode fallbacks.
- The system must not silently coerce invalid authoritative payloads into apparently valid internal drafts.

### Responsible AI Considerations
- Reviewers must remain the approval authority for persistence.
- Confidence and `needsAttention` signals must inform review but must not auto-approve content.
- Audit logs should preserve enough lineage to explain how a draft was produced and transformed.

---

## 7. User Stories and Features

### Feature Set

**Feature 1: Authoritative contract adoption**
- As an AI workflow maintainer, I want the app to validate against the new authoritative schema so that the prompt is no longer disconnected from runtime expectations.

**Feature 2: Internal graph normalization**
- As a platform engineer, I want authoritative AI output normalized into the current internal graph so that the review workspace remains stable.

**Feature 3: Drift governance and evaluation**
- As a QA engineer, I want prompt, schema, and normalizer regression checks so that contract drift is caught before release.

**Feature 4: Phase-2 migration readiness**
- As a product owner, I want pathway and rules-of-combination semantics preserved now so that a richer future UX remains possible.

### User Stories

1. **Story: Validate authoritative AI output**
 - As an AI maintainer, I want the AI client to accept only authoritative-contract output so that prompt changes are checked against an explicit schema.
 - Acceptance Criteria:
   - [ ] A mismatched payload is rejected before merge or review rendering.
   - [ ] A valid authoritative payload is accepted for normalization.

2. **Story: Normalize into the current graph**
 - As a platform engineer, I want a single normalizer to convert authoritative structures into the internal graph so that downstream consumers remain unchanged in phase 1.
 - Acceptance Criteria:
   - [ ] Qualification roots are generated for each extracted qualification.
   - [ ] Unit groups and units remain reviewable in the existing hierarchy.
   - [ ] Learning objectives are preserved in the normalized graph.

3. **Story: Preserve reviewer workflow**
 - As a qualification reviewer, I want the current workspace to continue working after the migration so that I can keep reviewing documents without retraining.
 - Acceptance Criteria:
   - [ ] I can open the review workspace for an AI-generated draft without UI breakage.
   - [ ] I can approve a normalized draft through the existing flow.

4. **Story: Detect drift in CI**
 - As QA, I want automated checks for prompt-schema-normalizer drift so that mismatches are blocked before release.
 - Acceptance Criteria:
   - [ ] Prompt-only changes fail if schemas or fixtures are stale.
   - [ ] Schema-only changes fail if normalizer expectations are stale.

5. **Story: Preserve future-rich semantics**
 - As a product owner, I want pathway and rules-of-combination information preserved even if the current UI does not fully expose them yet.
 - Acceptance Criteria:
   - [ ] Derived qualification lineage is stored in normalized output or metadata.
   - [ ] Rules-of-combination details remain available for later UX work.

---

## 8. User Flows

### Flow 1: AI extraction with authoritative contract
1. User uploads a specification.
2. The AI client sends the prompt plus authoritative schema.
3. The model returns an authoritative `Qualifications` payload.
4. The system validates the payload against the authoritative schema.
5. The normalizer converts the payload into the internal review graph.
6. The existing review workspace loads the normalized draft.

### Flow 2: Drift prevention before release
1. A maintainer edits the prompt or schema.
2. CI runs authoritative-schema and normalization fixtures.
3. If the authoritative output or normalized graph diverges from expectations, CI fails.
4. The change is corrected before release.

### Flow 3: Fallback extraction
1. AI is unavailable or misconfigured.
2. The system uses fallback extraction.
3. Fallback output continues to emit the internal review graph.
4. Review proceeds in the existing workspace.

---

## 9. Dependencies and Constraints

### Dependencies
- Existing review workspace and internal graph consumers remain the phase-1 runtime target.
- The current AI provider path must continue supporting structured outputs.
- Engineering must define authoritative fixtures and normalization tests.
- Product documentation and technical specs must be updated to reflect the dual-contract design.

### Constraints
- The current app is already tightly coupled to the legacy graph contract.
- AI output is schema-constrained, so prompt and schema changes cannot drift independently.
- Local development may continue to rely on fallback extraction when AI credentials are absent.
- The migration should avoid introducing simultaneous large UI and persistence rewrites.

---

## 10. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Normalizer loses important authoritative details | High | Medium | Preserve source detail in metadata and golden fixtures; add explicit mapping tests |
| Prompt and schema drift returns | High | High | Add CI coupling checks and documented versioning |
| Review UI still breaks on normalized edge cases | High | Medium | Use fixture-driven integration tests covering multi-qualification and pathway cases |
| Engineering treats normalization as temporary and under-specifies it | Medium | Medium | Make the boundary a formal product requirement, not an incidental helper |
| Future phase-2 work is blocked by phase-1 shortcuts | Medium | Medium | Require preservation of derived lineage and rules-of-combination metadata now |

---

## 11. Timeline and Milestones

### Phase 1: Contract stabilization
- Define authoritative schema
- Add normalization boundary
- Preserve current review workflow
- Add CI drift checks and golden fixtures

### Phase 2: Rich semantics exposure
- Expose pathways and rules of combination more directly in the review experience
- Expand persistence and reporting for authoritative concepts
- Reassess whether the internal graph should remain the long-term runtime model

### Suggested Milestones
1. Week 1: PRD, backlog, and design signoff
2. Week 2: Authoritative schema and normalizer implementation plan finalized
3. Week 3: Contract stabilization release candidate
4. Week 4: Pilot validation with pathway-bearing documents

---

## 12. Out of Scope

- Full redesign of the review workspace in phase 1
- Removal of the internal graph contract in phase 1
- Fully autonomous persistence without reviewer approval
- Replacing fallback extraction with an AI-only workflow
- Broader qualification-domain modeling beyond the authoritative prompt delta

---

## 13. Open Questions

1. Should pathways remain normalized as standalone qualification nodes indefinitely, or only as a phase-1 compatibility measure?
2. Where should rules-of-combination data live in the internal graph during phase 1 so future UX work does not require re-extraction?
3. Should fallback extraction eventually target the authoritative contract too, or remain a legacy-graph producer?
4. What reviewer-facing surfacing of `needsAttention` and `guidance` is required in phase 1 versus phase 2?
5. What minimum golden-set size is acceptable before shipping the contract migration?

---

## 14. Appendix

### Relevant Repository Surfaces
- Prompt asset: `prompts/qualification-extractor.md`
- Current AI client: `server/aiClient.js`
- Current extraction schema: `templates/qualification-extraction-schema.json`
- Draft merge workflow: `server/extractionService.js`
- Review job enrichment: `server/jobStore.js`
- Persistence layer: `server/databaseStore.js`
- Review client: `app/assets/app.js`

### Delivery Recommendation
The product recommendation is a two-contract architecture:
- **External AI contract**: authoritative prompt plus authoritative structured-output schema
- **Internal review contract**: existing normalized graph used by current review, persistence, and UI layers

Engineering should treat the normalizer as the controlled boundary between them.