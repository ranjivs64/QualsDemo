# Backlog: Authoritative Extractor Contract Migration

**Status**: Draft  
**Date**: 2026-03-20  
**Source PRD**: [PRD-2.md](../../artifacts/prd/PRD-2.md)  
**Related Existing PRD**: [PRD-1.md](../../artifacts/prd/PRD-1.md)  
**Related Existing Spec**: [SPEC-1.md](../../artifacts/specs/SPEC-1.md)

## Purpose

This backlog decomposes the authoritative extractor-contract migration into issue-ready feature and story slices. The goal is to adopt the new AI-facing `Qualifications` contract without breaking the current review workspace and persistence flow.

## Epic

### EPIC-2: Adopt authoritative qualification extractor contract
- **Priority**: P0
- **Outcome**: The application accepts the new prompt-defined AI contract through a formal schema and normalization layer while preserving the current reviewer workflow.

## Feature Issues

### FEAT-2.1: Define the authoritative AI contract
- **Priority**: P0
- **Outcome**: Prompt and structured-output schema match the same external contract.
- **Acceptance Criteria**:
  - The authoritative schema matches the `Qualifications` payload shape.
  - All prompt-required entities are represented explicitly.
  - Prompt/schema drift is detectable in CI.

### FEAT-2.2: Normalize authoritative payloads into the current internal graph
- **Priority**: P0
- **Outcome**: Downstream review and persistence consumers continue to operate on the existing graph contract.
- **Acceptance Criteria**:
  - The normalizer creates internal qualification roots from authoritative qualifications.
  - Unit groups, units, and learning objectives remain reviewable in the current hierarchy.
  - `needsAttention`, guidance, and lineage are preserved for review use.

### FEAT-2.3: Preserve current review and approval flows
- **Priority**: P0
- **Outcome**: Reviewers can keep using the current UI while the AI boundary changes.
- **Acceptance Criteria**:
  - Existing review pages load normalized drafts without runtime errors.
  - Approval and persistence still work for normalized drafts.
  - Fallback extraction remains compatible.

### FEAT-2.4: Add drift governance and evaluation fixtures
- **Priority**: P0
- **Outcome**: Prompt, schema, and normalizer changes are regression-tested before release.
- **Acceptance Criteria**:
  - Golden fixtures cover single qualification, multi-qualification, shared unit, and pathway cases.
  - CI fails when authoritative payload validation or normalization breaks.
  - Model and schema versions are captured in job metadata or logs.

### FEAT-2.5: Prepare phase-2 exposure of authoritative semantics
- **Priority**: P1
- **Outcome**: The migration does not lose pathway and rules-of-combination semantics needed later.
- **Acceptance Criteria**:
  - Derived qualification lineage is preserved.
  - Rules-of-combination details remain available after normalization.
  - A future decision point exists for direct-consumption versus continued normalization.

## Story Issues

### STORY-2.1.1: Create authoritative schema from the prompt contract
- **Parent**: FEAT-2.1
- **Priority**: P0
- **Acceptance Criteria**:
  - Given the authoritative prompt, when the schema is defined, then every required prompt entity has a corresponding schema definition.
  - Given structured-output provider constraints, when optional values are needed, then nullable required fields are used compatibly.

### STORY-2.1.2: Align AI client validation to the authoritative schema
- **Parent**: FEAT-2.1
- **Priority**: P0
- **Acceptance Criteria**:
  - Given an authoritative payload, when the AI client validates it, then mismatched legacy-shape assumptions no longer reject valid authoritative outputs.
  - Given an invalid authoritative payload, when validation runs, then the request fails with actionable error detail.

### STORY-2.2.1: Introduce a normalizer module at the AI boundary
- **Parent**: FEAT-2.2
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a valid authoritative payload, when normalization runs, then an internal graph draft is emitted.
  - Given derived pathways or shared units, when normalization runs, then lineage and reuse semantics are preserved.

### STORY-2.2.2: Map learning objectives into current reviewable structures
- **Parent**: FEAT-2.2
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a unit with learning objectives, when normalization completes, then those objectives are reviewable in the current workspace.
  - Given no extractable objectives, when normalization completes, then the internal graph still preserves emptiness and attention signals.

### STORY-2.3.1: Verify review workspace compatibility with normalized drafts
- **Parent**: FEAT-2.3
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a normalized AI draft, when the review workspace loads, then qualification tabs, hierarchy rendering, and detail panels work as they do today.
  - Given approval, when persistence is triggered, then the current flow still succeeds.

### STORY-2.3.2: Keep fallback extraction on the internal graph contract
- **Parent**: FEAT-2.3
- **Priority**: P1
- **Acceptance Criteria**:
  - Given AI is unavailable, when fallback extraction is used, then review still works without the authoritative schema path.
  - Given mixed AI and fallback test coverage, when regression checks run, then both flows remain valid.

### STORY-2.4.1: Add golden fixtures for authoritative and normalized outputs
- **Parent**: FEAT-2.4
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a pathway-bearing document, when test fixtures are reviewed, then both authoritative and normalized expected outputs exist.
  - Given a prompt or schema change, when CI runs, then fixture divergence is reported.

### STORY-2.4.2: Capture prompt, schema, and normalizer versions in job metadata
- **Parent**: FEAT-2.4
- **Priority**: P1
- **Acceptance Criteria**:
  - Given an extraction job, when metadata is inspected, then prompt, schema, and normalizer versions are visible.
  - Given a reviewer raises a defect, when the job is audited, then the producing versions can be identified.

### STORY-2.5.1: Preserve rules-of-combination semantics for future UX
- **Parent**: FEAT-2.5
- **Priority**: P1
- **Acceptance Criteria**:
  - Given qualification-specific rules, when normalization completes, then those rules are still available in stored metadata or fields.
  - Given a future UX slice, when engineering begins phase 2, then re-extraction is not required to surface those rules.

## Suggested Delivery Order

1. FEAT-2.1
2. FEAT-2.2
3. FEAT-2.3
4. FEAT-2.4
5. FEAT-2.5

## Notes

- This backlog assumes a phase-1 compatibility strategy, not an immediate full replacement of the internal graph model.
- The stories are sized so engineering can deliver the boundary safely before attempting broader UX or persistence redesign.