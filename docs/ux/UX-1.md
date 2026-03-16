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
**Status**: Draft  
**Designer**: UX Designer Agent  
**Date**: 2026-03-16  
**Related PRD**: [PRD-1.md](../artifacts/prd/PRD-1.md)

---

## 1. Overview

### Feature Summary
A web-based human-in-the-loop (HITL) interface allowing users to upload qualification specification PDFs and review the AI-extracted nested structures (Qualifications, Units, Groups, Grading) before persisting them into the master database.

### Design Goals
1. Provide a side-by-side verification experience (PDF vs. Extracted Data).
2. Clearly visualize confidence metrics to direct the reviewer's attention to potential issues.
3. Enable easy line-item editing and document-wide reprocessing to handle AI extraction errors gracefully.

### Success Criteria
- Time to review and approve an extraction is less than 5 minutes.
- Evaluators can clearly identify low-confidence nodes instantly.
- Meets WCAG 2.2 AA accessibility standards for all interactive components.

---

## 2. User Research

### User Personas
**Primary Persona: Qualification Data Analyst**
- **Goals**: Process PDFs rapidly, fix extraction mapping errors efficiently.
- **Pain Points**: Large volume, missing rules, nested dependencies.

**Secondary Persona: Qualification Content Specialist**
- **Goals**: Validate optional group logic and grading bounds against source rules.
- **Pain Points**: Hard to digest nested unit groups as flat tables.

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
3. **User Action**: Inspects nodes marked with yellow/red confidence badges.
   - **System Response**: Clicking a node highlights the corresponding section on the PDF mock view.
4. **User Action**: Clicks "Edit" to fix a misaligned Grade Scheme and saves.
   - **System Response**: Updates graph locally, marks node as "Manually Edited".
5. **User Action**: Clicks "Approve & Persist".
   - **System Response**: Submits payload to Persistence API and routes to success dashboard.

---

## 4. Component Specifications

### File Uploader
- **States**: Default, Drag-hover, Uploading (with spinner/bar), Success, Error.
- **Micro-interactions**: Subtle scale up on drag-over. Dashed border transitions to solid primary color.

### Side-by-Side Review Viewer
- **Layout**: 50/50 split width. Resizable pane barrier (desktop).
- **Left Pane (Source Document)**: Embedded PDF viewer or image representation with bounding box highlight overlays.
- **Right Pane (Extracted Structure)**: Expandable hierarchical tree or accordion cards.

### Hierarchical Data Cards (The Extraction)
- **Hierarchy Level 1**: Qualification Summary (Title, Level, TQT)
- **Hierarchy Level 2**: Unit Groups (Mandatory/Optional rules)
- **Hierarchy Level 3**: Units (Title, GLH, Credit)
- **Hierarchy Level 4**: Grade Schemes

### Confidence Badges
- **Green (High, >90%)**: Subtle checkmark, muted green background.
- **Yellow (Medium, 70-89%)**: Warning icon, yellow emphasis to draw eye.
- **Red (Low, <70%)**: Alert icon, red background, auto-expanded for immediate review.

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
- **Hover States**: shadow-md and 	ranslate-y-[-1px] for interactive cards.

---

## 6. Accessibility (WCAG 2.2 AA)
- Focus rings visible for all interactive tree nodes.
- High color contrast ratios (> 4.5:1) for all text and badges.
- ria-expanded attributes on all collapsibles within the hierarchy.

---

## 7. Interactive Prototypes

HTML/CSS prototypes have been created using Tailwind CSS with glassmorphism and modern UI principles.

- **[Upload Interface](./prototypes/index.html)**
- **[Review Workspace](./prototypes/review.html)**

---

## 8. Implementation Notes
- The review workspace should lazy-load the PDF bounds to prevent heavy DOM rendering if documents are 100+ pages.
- When an analyst edits a node, flag it so the system stops showing "Low Confidence" and overrides it with "User Verified".
