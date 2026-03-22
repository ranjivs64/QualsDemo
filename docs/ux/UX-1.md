---
inputs:
  feature_name:
    description: "Name of the feature being designed"
    required: true
    default: "Extract Qualification Structure From PDF"
  issue_number:
    description: "GitHub issue number for this feature"
    required: true
    default: "1"
  epic_id:
    description: "Parent Epic issue number"
    required: false
    default: "1"
  designer:
    description: "Designer name (agent or person)"
    required: false
    default: "UX Designer Agent"
  date:
    description: "Design date (YYYY-MM-DD)"
    required: false
    default: "2026-03-16"
---

# UX Design: Extract Qualification Structure From PDF

**Feature**: #1  
**Epic**: #1  
**Status**: Accepted  
**Designer**: UX Designer Agent  
**Date**: 2026-03-16  
**Related PRD**: [PRD-1.md](../artifacts/prd/PRD-1.md)

---

## 1. Overview

### Feature Summary
A web-based human-in-the-loop (HITL) interface allowing users to upload qualification specification PDFs and review the AI-extracted nested structures across one or more qualifications, including shared units, learning outcomes, assessment criteria, grading, and structure summaries, before persisting them into the master database.

### Design Goals
1. Provide a side-by-side verification experience (PDF vs. Extracted Data).
2. Clearly visualize confidence metrics to direct the reviewer's attention to potential issues.
3. Enable easy line-item editing and document-wide reprocessing to handle AI extraction errors gracefully.
4. Make shared-unit reuse, discovered qualification counts, and hierarchy navigation obvious without forcing reviewers to inspect every branch manually.

### Success Criteria
- Time to review and approve an extraction is less than 5 minutes.
- Evaluators can clearly identify low-confidence nodes instantly.
- Evaluators can identify shared units, qualification counts, and nested structure scope without expanding the full tree.
- Meets WCAG 2.2 AA accessibility standards for all interactive components.

---

## 2. User Research

### User Personas
**Primary Persona: Qualification Data Analyst**
- **Goals**: Process PDFs rapidly, fix extraction mapping errors efficiently.
- **Pain Points**: Large volume, missing rules, nested dependencies, and repeated units appearing in more than one qualification.

**Secondary Persona: Qualification Content Specialist**
- **Goals**: Validate optional group logic, grading bounds, learning outcomes, and assessment criteria against source rules.
- **Pain Points**: Hard to digest nested unit groups as flat tables and easy to miss whether one unit is shared across qualifications.

---

## 3. User Flows

### Primary Flow: Upload and Review
**Trigger**: User navigates to the "New Extraction" page.
**Goal**: Upload PDF, review extraction, and persist data.

**Detailed Steps**:
1. **User Action**: Drags & drops a PDF file onto the upload zone.
   - **System Response**: Validates file, starts async extraction, shows progress loader.
2. **User Action**: Clicks "Review" once extraction is complete.
   - **System Response**: Loads Side-by-Side Review Workspace.
3. **User Action**: Inspects the specification summary, qualification tabs, shared-unit badges, and confidence indicators.
  - **System Response**: The review workspace shows how many qualifications were discovered and highlights where the same unit is reused elsewhere.
4. **User Action**: Expands a unit to review linked learning outcomes and assessment criteria.
  - **System Response**: The right pane shows criterion grade level, extracted command verb, and source-linked evidence.
5. **User Action**: Clicks "Edit" to fix a misaligned criterion, group rule, or grade scheme and saves.
  - **System Response**: Updates the draft locally, marks the node as "Manually Edited", and refreshes the displayed structure context.
6. **User Action**: Collapses or expands hierarchy groups to focus on a specific qualification branch.
  - **System Response**: The selected hierarchy branch hides or reveals nested entities without losing the current qualification context.
7. **User Action**: Clicks "Approve & Persist".
  - **System Response**: Submits the reviewed payload to the Persistence API once at least one qualification structure exists and routes to the success dashboard.

---

## 4. Component Specifications

### File Uploader
- **States**: Default, Drag-hover, Uploading (with spinner/bar), Success, Error.
- **Micro-interactions**: Subtle scale up on drag-over. Dashed border transitions to solid primary color.

### Side-by-Side Review Viewer
- **Layout**: 50/50 split width. Resizable pane barrier (desktop).
- **Left Pane (Source Document)**: Embedded PDF viewer or image representation with bounding box highlight overlays.
- **Right Pane (Extracted Structure)**: Expandable hierarchical tree or accordion cards with specification summary cards, qualification tabs, and shared-unit indicators.

### Hierarchical Data Cards (The Extraction)
- **Hierarchy Level 0**: Document Summary (qualification count, shared-unit count, unit count, outcome count, criteria count)
- **Hierarchy Level 1**: Qualification Summary (Title, Level, GLH, Credits, grading scheme)
- **Hierarchy Level 2**: Unit Groups (Mandatory/Optional rules, selection requirements)
- **Hierarchy Level 3**: Units (Title, GLH, Credit, shared-unit badge, assessment type)
- **Hierarchy Level 4**: Learning Outcomes
- **Hierarchy Level 5**: Assessment Criteria (grade level, command verb, structural context)
- **Contextual Branches**: Grade Schemes and Qualification Rule Sets remain accessible from qualification and unit detail views.
- **Navigation Pattern**: Any hierarchy level with children can be expanded or collapsed independently.

### Shared-Unit Indicators
- **Badge**: "Shared across N qualifications" appears on unit cards and detail headers.
- **Interaction**: Selecting the badge reveals all linked qualifications and groups using that unit.
- **Reviewer Benefit**: Prevents duplicate edits and makes reuse explicit before approval.

### Specification Summary Rail
- **Placement**: Sticky top section in the extracted-structure pane.
- **Contents**: Qualification count, shared-unit count, unit count, learning outcome count, assessment-criteria count, and approval availability.
- **Behavior**: The summary gives structural context at a glance and stays visible while the reviewer navigates the hierarchy.

### Confidence Badges
- **Green (High, >90%)**: Subtle checkmark, muted green background.
- **Yellow (Medium, 70-89%)**: Warning icon, yellow emphasis to draw eye.
- **Red (Low, <70%)**: Alert icon, red background, auto-expanded for immediate review.

### Approval and Persistence Panel
- **Primary Action**: Approve and Persist.
- **Secondary Actions**: Reject, Reprocess, Save Draft.
- **Readiness Pattern**: Approval becomes available once extraction has produced at least one qualification structure for review.
- **Audit Context**: The panel shows qualification, shared-unit, unit, outcome, and criteria counts alongside the current approval state.

---

## 5. Design System

### Typography
- **Sans-serif**: Inter, system-ui (Clean, legible data presentation).
- **Scale**:
  - H1: 1.5rem (24px) - Page Titles
  - H2: 1.25rem (20px) - Section Headers
  - Body: 0.875rem (14px) - Standard text and tables.

### Colors (Tailwind Reference)
- **Primary**: Blue (600: #2563eb)
- **Neutral**: Gray (50: #f9fafb to 900: #111827)
- **Success**: Emerald (600: #16a34a)
- **Warning**: Amber (500: #f59e0b)
- **Danger**: Red (600: #dc2626)

### Elevation & Depth
- **Panels**: shadow-sm and seamless 1px borders.
- **Hover States**: shadow-md and translate-y-[-1px] for interactive cards.

---

## 6. Accessibility (WCAG 2.2 AA)
- Focus rings visible for all interactive tree nodes.
- High color contrast ratios (> 4.5:1) for all text and badges.
- aria-expanded attributes on all collapsibles within the hierarchy.
- Shared-unit badges and summary indicators must expose text equivalents to screen readers.
- Keyboard users must be able to move between qualification tabs, hierarchy toggles, and hierarchy nodes without pointer interaction.

---

## 7. Interactive Prototypes

HTML/CSS prototypes have been created using Tailwind CSS with glassmorphism and modern UI principles.

- **[Upload Interface](./prototypes/index.html)**
- **[Review Workspace](./prototypes/review.html)**

---

## 8. Implementation Notes
- The review workspace should lazy-load the PDF bounds to prevent heavy DOM rendering if documents are 100+ pages.
- When an analyst edits a node, flag it so the system stops showing "Low Confidence" and overrides it with "User Verified".
- Shared-unit edits should prompt the reviewer to choose whether the change applies to the canonical shared unit or only to one qualification-specific membership.
- Structure summary counts should refresh after edits and reprocess actions so approval availability stays accurate.
