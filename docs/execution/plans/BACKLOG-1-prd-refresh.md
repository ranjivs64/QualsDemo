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
- **Outcome**: Reviewers can inspect and correct shared units, learning outcomes, assessment criteria, and the discovered structure for every qualification in a specification.
- **Depends on**: FEAT-1
- **Acceptance Criteria**:
  - The review tree shows document, qualification, group, unit, learning outcome, and assessment criterion levels.
  - Shared units are clearly marked and traceable to all linked qualifications.
  - The workspace summarizes how many qualifications were discovered and supports expandable and collapsible hierarchy groups.

### FEAT-3: Persistence API and data model expansion
- **Priority**: P0
- **Outcome**: Approved submissions support multiple qualifications, shared units, outcomes, criteria, and review audit annotations.
- **Depends on**: FEAT-1
- **Acceptance Criteria**:
  - The submission contract supports qualifications, shared units, memberships, learning outcomes, and assessment criteria.
  - Referential integrity rules enforce correct parent-child linkage.
  - Submission remains idempotent.

### FEAT-4: Structure-first review navigation and audit hardening
- **Priority**: P0
- **Outcome**: Reviewers can navigate large extracted structures quickly, and persistence captures the relevant review audit trail once structure review is complete.
- **Depends on**: FEAT-1, FEAT-3
- **Acceptance Criteria**:
  - Qualification summary cards show how many qualifications, shared units, units, outcomes, and criteria were discovered.
  - Group and nested hierarchy sections can be expanded and collapsed during review.
  - Audit logs capture edits, reprocess lineage, shared-unit decisions, and persistence actions.

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

### STORY-2.1: Show discovered-qualification summary in the review workspace
- **Parent**: FEAT-2
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a specification contains multiple qualifications, when the review workspace loads, then the summary shows how many qualifications were discovered.
  - Given shared units, outcomes, or criteria exist, when the summary renders, then the counts are shown as structural context for review.

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

### STORY-2.4: Expand and collapse hierarchy groups during review
- **Parent**: FEAT-2
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a qualification contains nested groups, when the hierarchy renders, then each group can be collapsed or expanded independently.
  - Given a reviewer changes qualification tabs, when they reopen a group, then navigation remains focused on the selected qualification structure.

### STORY-3.1: Expand the submission payload for revised entities
- **Parent**: FEAT-3
- **Priority**: P0
- **Acceptance Criteria**:
  - Given an approved submission, when the payload is frozen, then it includes qualifications, shared units, memberships, learning outcomes, assessment criteria, structure summary counts, and audit annotations.
  - Given the same idempotency key is reused, when submission is retried, then the persistence API does not duplicate the graph.

### STORY-3.2: Enforce referential validation for outcomes and criteria
- **Parent**: FEAT-3
- **Priority**: P0
- **Acceptance Criteria**:
  - Given a learning outcome references a missing unit, when contract validation runs, then the submission is rejected.
  - Given a criterion references an invalid parent, when contract validation runs, then the submission is rejected with actionable error detail.

### STORY-4.1: Allow persistence once at least one qualification structure exists
- **Parent**: FEAT-4
- **Priority**: P0
- **Acceptance Criteria**:
  - Given extraction has produced one or more qualification structures, when a reviewer approves, then persistence can proceed.
  - Given no qualification structure exists, when a reviewer attempts approval, then persistence is prevented with actionable guidance.

### STORY-4.2: Audit shared-unit edits and persistence actions
- **Parent**: FEAT-4
- **Priority**: P1
- **Acceptance Criteria**:
  - Given a reviewer edits a shared unit, when the change is saved, then the audit trail records whether the edit is canonical or qualification-specific.
  - Given a reviewer persists a reviewed structure, when submission completes, then the audit trail records the persistence action and linked extraction lineage.

### STORY-5.1: Expand evaluation fixtures for revised prompt scope
- **Parent**: FEAT-5
- **Priority**: P1
- **Acceptance Criteria**:
  - Given the evaluation corpus, when the suite runs, then it includes multi-qualification and shared-unit documents.
  - Given extracted criteria contain verbs or descriptors, when evaluation runs, then preservation of those fields is checked.

## Suggested Delivery Order

1. FEAT-1
2. FEAT-2
3. FEAT-3
4. FEAT-4
5. FEAT-5

## Notes

- Feature and story IDs are local placeholders.
- These items are intentionally scoped to the revised prompt delta rather than the full product backlog.