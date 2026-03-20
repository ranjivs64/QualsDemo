# Backlog Refresh: Qualification Extractor Prompt Alignment

**Status**: Draft  
**Date**: 2026-03-19  
**Source PRD**: [PRD-1.md](../../artifacts/prd/PRD-1.md)  
**Source Spec**: [SPEC-1.md](../../artifacts/specs/SPEC-1.md)  
**Source UX**: [UX-1.md](../../ux/UX-1.md)

## Purpose

This backlog refresh translates the revised prompt-aligned PRD into issue-ready feature and story items. These are local placeholders because the workspace does not include a live issue tracker artifact.

## Feature Issues

### FEAT-1: Multi-qualification extraction graph
- **Priority**: P0
- **Outcome**: One source PDF can produce multiple qualification records with stable shared-unit identity.
- **Depends on**: Existing upload and extraction workflow
- **Acceptance Criteria**:
  - Extraction supports more than one qualification in a single document.
  - Shared units are persisted once and referenced consistently across qualifications.
  - Qualification-to-group-to-unit relationships remain reviewable in draft form.

### FEAT-2: Review workspace for outcomes, criteria, and shared units
- **Priority**: P0
- **Outcome**: Reviewers can inspect and correct shared units, learning outcomes, assessment criteria, and validation blockers.
- **Depends on**: FEAT-1
- **Acceptance Criteria**:
  - The review tree shows document, qualification, group, unit, learning outcome, and assessment criterion levels.
  - Shared units are clearly marked and traceable to all linked qualifications.
  - Reviewers can see confidence, source links, and validation state for each level.

### FEAT-3: Persistence API and data model expansion
- **Priority**: P0
- **Outcome**: Approved submissions support multiple qualifications, shared units, outcomes, criteria, and validation summaries.
- **Depends on**: FEAT-1
- **Acceptance Criteria**:
  - The submission contract supports qualifications, shared units, memberships, learning outcomes, and assessment criteria.
  - Referential integrity rules enforce correct parent-child linkage.
  - Submission remains idempotent.

### FEAT-4: Deterministic validation and audit hardening
- **Priority**: P0
- **Outcome**: Approval is gated by structural validation and complete audit records.
- **Depends on**: FEAT-1, FEAT-3
- **Acceptance Criteria**:
  - Mandatory-unit coverage, GLH totals, credit totals, and optional-group rules are validated before approval.
  - Blockers prevent approval unless an override path with rationale is allowed.
  - Audit logs capture edits, reprocess lineage, shared-unit decisions, and validation outcomes.

### FEAT-5: Evaluation coverage for revised extraction scope
- **Priority**: P1
- **Outcome**: Quality gates measure the new extraction surface, not only the original qualification graph.
- **Depends on**: FEAT-1, FEAT-3, FEAT-4
- **Acceptance Criteria**:
  - Evaluation fixtures include multi-qualification documents and shared-unit cases.
  - Outcome-to-unit and criterion-to-outcome linkage is measured.
  - Command verbs or grade descriptors are validated when present.

## Story Issues

### STORY-1.1: Extract multiple qualifications from one uploaded PDF
- **Parent**: FEAT-1
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a document with multiple qualifications, when extraction completes, then each qualification appears as a separate draft qualification node.
  - Given one upload, when draft data is retrieved, then all extracted qualifications are returned in one lineage.

### STORY-1.2: Reuse shared units across qualifications
- **Parent**: FEAT-1
- **Priority**: P0
- **Acceptance Criteria**:
  - Given the same unit appears in more than one qualification, when mapping completes, then the system generates one canonical shared-unit identity.
  - Given a reviewer opens a shared unit, when they inspect usage, then all linked qualifications and groups are visible.

### STORY-1.3: Persist learning outcomes and assessment criteria in draft output
- **Parent**: FEAT-1
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a unit contains learning outcomes, when extraction completes, then each outcome is linked to the correct unit.
  - Given an outcome contains criteria, when extraction completes, then each criterion is linked to the correct outcome or unit.

### STORY-2.1: Show validation summary rail in the review workspace
- **Parent**: FEAT-2
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a draft has blockers or warnings, when the review workspace loads, then the validation summary rail lists them by severity.
  - Given a reviewer selects a validation item, when navigation occurs, then the affected node is expanded and focused.

### STORY-2.2: Add shared-unit indicators to unit cards and detail panels
- **Parent**: FEAT-2
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a unit is shared, when the hierarchy renders, then the unit shows a shared-unit badge.
  - Given the badge is activated, when the detail panel opens, then linked qualifications and groups are listed.

### STORY-2.3: Review assessment criteria with grade level and command verb context
- **Parent**: FEAT-2
- **Priority**: P1
- **Acceptance Criteria**:
  - Given an assessment criterion includes a grade level, when the criterion is opened, then the grade level is displayed.
  - Given a command verb or grade descriptor is present, when the criterion detail is opened, then the extracted verb or descriptor is visible and editable.

### STORY-3.1: Expand the submission payload for revised entities
- **Parent**: FEAT-3
- **Priority**: P0
- **Acceptance Criteria**:
  - Given an approved submission, when the payload is frozen, then it includes qualifications, shared units, memberships, learning outcomes, assessment criteria, validation summary, and audit annotations.
  - Given the same idempotency key is reused, when submission is retried, then the persistence API does not duplicate the graph.

### STORY-3.2: Enforce referential validation for outcomes and criteria
- **Parent**: FEAT-3
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a learning outcome references a missing unit, when contract validation runs, then the submission is rejected.
  - Given a criterion references an invalid parent, when contract validation runs, then the submission is rejected with actionable error detail.

### STORY-4.1: Gate approval on mandatory-unit, GLH, credit, and selection-rule validation
- **Parent**: FEAT-4
- **Priority**: P0
- **Acceptance Criteria**:
  - Given qualification totals or group rules are present, when validation runs, then mismatches are surfaced as blockers or warnings.
  - Given unresolved blockers remain, when a reviewer attempts approval, then approval is prevented unless an allowed override rationale is provided.

### STORY-4.2: Audit shared-unit edits and validation overrides
- **Parent**: FEAT-4
- **Priority**: P1
- **Acceptance Criteria**:
  - Given a reviewer edits a shared unit, when the change is saved, then the audit trail records whether the edit is canonical or qualification-specific.
  - Given a reviewer overrides a blocker, when approval proceeds, then the override rationale is preserved with the approved payload.

### STORY-5.1: Expand evaluation fixtures for revised prompt scope
- **Parent**: FEAT-5
- **Priority**: P1
- **Acceptance Criteria**:
  - Given the evaluation corpus, when the suite runs, then it includes multi-qualification and shared-unit documents.
  - Given extracted criteria contain verbs or descriptors, when evaluation runs, then preservation of those fields is checked.

## Suggested Delivery Order

1. FEAT-1
2. FEAT-3
3. FEAT-4
4. FEAT-2
5. FEAT-5

## Notes

- Feature and story IDs are local placeholders.
- These items are intentionally scoped to the revised prompt delta rather than the full product backlog.