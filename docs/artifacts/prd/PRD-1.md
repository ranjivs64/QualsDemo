---
inputs:
  epic_title:
    description: "Title of the Epic"
    required: true
    default: "Extract Qualification Structure From PDF"
  issue_number:
    description: "Local placeholder epic number"
    required: true
    default: "1"
  priority:
    description: "Priority level"
    required: false
    default: "p1"
  author:
    description: "Document author"
    required: false
    default: "Product Manager Agent"
  date:
    description: "Creation date"
    required: false
    default: "2026-03-16"
---

# PRD: Extract Qualification Structure From PDF

**Epic**: #1  
**Status**: Draft  
**Author**: Product Manager Agent  
**Date**: 2026-03-16  
**Stakeholders**: Product owner, data operations, qualification content specialists, platform engineering  
**Priority**: p1

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Target Users](#2-target-users)
3. [Goals and Success Metrics](#3-goals-and-success-metrics)
4. [Research Summary](#4-research-summary)
5. [Requirements](#5-requirements)
6. [User Stories and Features](#6-user-stories-and-features)
7. [User Flows](#7-user-flows)
8. [Dependencies and Constraints](#8-dependencies-and-constraints)
9. [Risks and Mitigations](#9-risks-and-mitigations)
10. [Timeline and Milestones](#10-timeline-and-milestones)
11. [Out of Scope](#11-out-of-scope)
12. [Open Questions](#12-open-questions)
13. [Appendix](#13-appendix)

---

## 1. Problem Statement

### What problem are we solving?
Qualification specification PDFs contain the structure needed to create qualification, unit, grading, grouping, learning-outcome, assessment-criteria, and ruleset records, but that structure is trapped in long-form documents and must be interpreted manually. The updated extraction prompt also requires the system to handle multiple qualifications in one document, shared units reused across qualifications, and qualification-rule validation before approval. The goal is to extract the qualification structure defined in [QualStructure.md](../../../QualStructure.md), present the extracted structure in a reviewable visualization, and only persist the approved structure through an API.

### Why is this important?
Manual extraction is slow, error-prone, and inconsistent across operators. The risk is highest when one PDF contains several related qualifications, overlapping unit catalogs, or detailed grading and assessment text that must be preserved for downstream marking and review. A review-first extraction workflow reduces turnaround time, improves consistency, and creates a governed path from PDF source to structured qualification data.

### What happens if we do not solve this?
Teams will continue to rely on manual interpretation of PDFs, causing long lead times, mismatched unit-group rules, duplicated shared units, missing learning outcomes or assessment criteria, inconsistent grade mappings, and higher downstream data-fix effort in the target system.

---

## 2. Target Users

### Primary Users

**User Persona 1: Qualification Data Analyst**
- **Demographics**: Internal operations user, moderate technical literacy, high domain knowledge
- **Goals**: Convert qualification PDFs into structured records quickly and accurately
- **Pain Points**: Re-keying data, missing nested completion rules, hard-to-audit spreadsheets
- **Behaviors**: Reads PDFs manually, compares sections across pages, enters records into downstream systems

**User Persona 2: Qualification Content Specialist**
- **Demographics**: Subject matter expert, low to moderate technical literacy
- **Goals**: Validate that extracted structures match source documents before publishing
- **Pain Points**: Hard to verify whether optional groups, mandatory rules, and grading schemes were captured correctly
- **Behaviors**: Reviews PDF sections manually, annotates errors, requests corrections

### Secondary Users
- Platform engineers integrating the workflow with storage and downstream APIs
- Data governance and compliance stakeholders who need auditability
- Product owners tracking extraction quality and throughput

---

## 3. Goals and Success Metrics

### Business Goals
1. Reduce qualification-structure extraction effort per PDF by at least 60 percent.
2. Achieve review-approved structured output for the qualification schema in a single workflow.
3. Ensure persistence occurs only through an API after explicit user confirmation.
4. Support prompt-defined extraction depth, including multi-qualification documents, shared units, learning outcomes, assessment criteria, and validation rules.

### Success Metrics

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| Median analyst time per PDF | Unknown, manual baseline to be measured | 60 percent reduction from baseline | Within 8 weeks of pilot |
| First-pass review approval rate | Unknown | 85 percent or higher | Within 8 weeks of pilot |
| Schema completeness rate for required entities | Unknown | 95 percent or higher for Qualification, Unit, Learning Outcome, Assessment Criterion, Grade Scheme, Unit Group, and Rule Set fields | Within pilot |
| Multi-qualification parsing accuracy | Unknown | 95 percent or higher on pilot documents containing more than one qualification | Within pilot |
| Shared-unit reuse accuracy | Unknown | 100 percent of approved shared units persisted once and referenced many times | Within pilot |
| Incorrect persistence before approval | Manual risk exists | 0 | Day 1 |
| API persistence success after approval | Unknown | 99 percent or higher | Within pilot |

### User Success Criteria
- Users can upload a PDF and see the extracted qualification structure as a navigable hierarchy, including multiple qualifications when present.
- Users can compare extracted content against the source document before approving it.
- Users can approve or reject extracted entities without direct database access.
- Users can review learning outcomes, assessment criteria, and shared-unit reuse before approval.

---

## 4. Research Summary

### Sources Consulted
- https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview
- https://docs.cloud.google.com/document-ai/docs/overview
- https://docs.unstructured.io/ui/overview
- https://github.com/Unstructured-IO/unstructured/issues/3511
- https://github.com/VikParuchuri/marker/issues/442
- https://github.com/jsvine/pdfplumber/issues/760
- https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
- https://www.w3.org/WAI/standards-guidelines/wcag/
- https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/

### Key Findings
1. The strongest production pattern is layout-aware document processing, not plain OCR. Azure Document Intelligence and Google Document AI both emphasize text plus layout, tables, key-value pairs, classification, and structured outputs.
2. Qualification PDFs are likely semistructured rather than fixed-template documents. This favors a hybrid design: layout/vision extraction followed by deterministic mapping into the qualification schema.
3. Open-source parsing tools are useful for experimentation but show operational instability. Unstructured issue #3511 shows repeated dependency/version breakage, and Marker issue #442 shows environment/runtime instability in interactive app scenarios.
4. Pure PDF parsing libraries like pdfplumber provide useful low-level control, but user feedback indicates format-handling edge cases still need careful treatment. They are better suited as fallback or diagnostic tooling than the primary extraction engine for this workflow.
5. File-upload security is a first-order requirement. OWASP explicitly highlights unrestricted file upload as a high-severity risk, including content, metadata, file-name, and execution risks.
6. The review UI must be accessible. W3C recommends WCAG 2.2 as the current standard; the visualization and confirmation workflow should target WCAG AA.
7. The current product assumption is that qualification PDFs do not contain personal data in practice. Privacy scope is therefore lower than a PII-bearing workflow, but the system should still minimize retention and apply standard secure handling.
8. Because no insertion API currently exists, phase 1 must define and deliver the API contract and the database schema that supports qualifications, units, grade schemes, groups, and rulesets.
9. The revised extraction prompt adds domain-specific requirements beyond the original qualification graph: multiple qualifications may appear in one document, units can be shared across qualifications, learning outcomes and assessment criteria must be captured per unit, and grade descriptors or command verbs should be extracted when present.
10. No family-specific fixed-layout assumptions are available yet, so phase 1 should default to a generalized semistructured extraction path while leaving room for future qualification-family hints.

### Comparison Matrix

| Solution | Approach | Strengths | Weaknesses | User Reception Signal |
|----------|----------|-----------|------------|-----------------------|
| Azure Document Intelligence | OCR + layout + tables + custom models | Strong structured extraction, custom extraction/classification, API-first | Cloud dependency, cost management required | Product docs position it for structured document processing at scale |
| Google Document AI | OCR + processors + extraction/classification/splitting | Mature processor model, strong workflow coverage, structured document objects | Cloud dependency, processor setup overhead | Product docs emphasize scalable structured extraction workflows |
| Unstructured | Canonical JSON partitioning with page routing | Strong normalization pipeline, chunking, enrichment | Version instability and dependency friction reported in issue #3511 | Real users reported repeated NLTK/version issues across releases |
| Marker | Vision-heavy PDF-to-structured output | Strong layout preservation potential, useful for rich PDFs | Runtime/environment issues reported in issue #442 | Real users reported repeated Streamlit/runtime integration problems |
| pdfplumber | Low-level PDF parsing library | Fine-grained control over text, tables, and layout | Requires more custom logic, weaker end-to-end extraction abstraction | Issue #760 shows real-world output/format edge cases and documentation gaps |

### Chosen Approach Rationale
Use a hybrid AI-assisted extraction workflow:
1. A layout-aware document extraction service performs OCR and layout understanding.
2. A deterministic mapper converts extracted elements into the qualification schema from [QualStructure.md](../../../QualStructure.md), including qualification-level metadata, shared units, learning outcomes, assessment criteria, and validation rules.
3. A review UI renders a hierarchical visualization with source-page references and confidence signals across qualifications, units, learning outcomes, and assessment criteria.
4. Reviewers can either edit extracted values directly or adjust extraction inputs and reprocess the document.
5. Deterministic validation checks confirm GLH totals, credit totals, mandatory coverage, and optional-group rules before approval can proceed.
6. Persistence is blocked until an explicit user confirmation submits the approved payload to a database-facing API.

This approach balances extraction quality, auditability, and schema control.

### Rejected Alternatives
- **Plain OCR plus regex only**: Rejected because qualification structures include nested groups and rule sets that depend on layout and section semantics.
- **Direct auto-insert into database after extraction**: Rejected because the user explicitly requires confirmation before insertion and no direct insertion.
- **Purely manual data entry**: Rejected because it does not meet the speed, consistency, or traceability goals.
- **Open-source-only primary stack for initial release**: Rejected for phase 1 because user feedback shows avoidable operational instability for production-facing extraction workflows.

### User Needs Validation
Direct user evidence from this specific Pearson qualification workflow is not present in the repository. Evidence from public user discussions shows recurring needs for:

- reliable extraction from semistructured PDFs,
- preservation of layout and tables,
- accurate handling of repeated or shared structural entities across one source document,
- visibility into detailed academic outcomes and criteria rather than summary-only extraction,
- stable runtime behavior,
- easier review of extracted structure before use.

Assumption flagged: no direct user interviews or internal support-ticket data were available in this workspace, so pilot discovery must validate the exact review behaviors, acceptable confidence thresholds, expectations for learning-outcome and criteria review depth, and API payload expectations for shared-unit reuse.

### Standards and Compliance Notes
- **Security**: OWASP file-upload protections must govern upload handling, file validation, storage isolation, and download behavior.
- **Accessibility**: Review and confirmation UI should meet WCAG 2.2 AA.
- **Privacy**: Current assumption is no personal data in qualification PDFs. Retention should still be minimized, with uploaded PDFs and rejected extraction payloads retained for 1 day.

---

## 5. Requirements

### 5.1 Functional Requirements

#### Must Have (P0)
1. **PDF ingestion**: Users can upload a qualification PDF for processing.
 - **User Story**: As a data analyst, I want to upload a qualification PDF so that the system can attempt extraction.
 - **Acceptance Criteria**:
   - [ ] The system accepts only allowed file types and size ranges.
   - [ ] The system validates file metadata and content before processing.
   - [ ] The system records an audit event for each upload.

2. **Schema-aligned extraction**: The system extracts the qualification structure aligned to the target model.
 - **User Story**: As a content specialist, I want extracted data to match the qualification schema so that I can review it as structured content.
 - **Acceptance Criteria**:
  - [ ] The output supports one or more Qualification records per source document.
  - [ ] The output supports Units, Learning Outcomes, Assessment Criteria, Grade Schemes, Grade Options, Unit Groups, Unit Group Members, Qual Rule Sets, and Rule Set Members.
  - [ ] The output preserves parent-child relationships between entities.
  - [ ] Shared units are assigned stable unique identifiers and can be referenced by more than one qualification or unit group.
  - [ ] Assessment criteria capture grade level and criterion text, and preserve command verbs or grade descriptors when present.
   - [ ] Missing or ambiguous fields are surfaced as unresolved rather than silently defaulted.

3. **Review visualization**: The system displays extracted content using a clear visualization.
 - **User Story**: As a reviewer, I want to see the extracted structure visually so that I can validate it quickly against the PDF.
 - **Acceptance Criteria**:
  - [ ] The UI shows a hierarchy view for document -> qualifications -> groups -> units -> learning outcomes -> assessment criteria, with grading and rules available in context.
   - [ ] The UI shows a detail pane or table for the selected entity.
  - [ ] The UI surfaces source-page references and confidence levels for extracted entities.
  - [ ] The UI clearly shows when a unit is shared across qualifications.
  - [ ] Confidence is informative only and does not auto-approve content.

4. **Explicit confirmation gate**: Users must confirm the extracted structure before persistence.
 - **User Story**: As a reviewer, I want an approval step so that unverified extraction is never persisted.
 - **Acceptance Criteria**:
   - [ ] No persistence action is available before extraction is displayed.
   - [ ] The user can approve, reject, or send back for correction.
   - [ ] Approved payloads are frozen for submission and logged with reviewer identity and timestamp.

5. **API-only persistence**: Approved structures are inserted through an API and never directly into the database.
 - **User Story**: As a platform engineer, I want persistence to occur only through an API so that integration remains governed and decoupled.
 - **Acceptance Criteria**:
  - [ ] The product includes a new API contract and backing database design for qualification structures.
   - [ ] The client submits approved structures only to a configured API endpoint.
  - [ ] The API contract supports the qualification schema, multiple qualifications from one extraction, and nested entities.
  - [ ] The API contract preserves shared-unit identity and many-to-many qualification-to-unit relationships.
   - [ ] Success and failure responses are visible to the user.

6. **Reviewer correction options**: Reviewers can either edit extracted values directly or adjust extraction parameters and reprocess.
 - **User Story**: As a reviewer, I want both direct editing and reprocessing options so that I can choose the fastest path to a correct structure.
 - **Acceptance Criteria**:
  - [ ] The reviewer can edit supported extracted fields before approval.
  - [ ] The reviewer can trigger reprocessing with adjusted instructions or settings.
  - [ ] The system records whether approval followed manual edits or reprocessing.

7. **Qualification-rule validation**: The system validates extraction output against qualification rules before approval.
 - **User Story**: As a reviewer, I want structural validation before approval so that incomplete or contradictory qualification graphs are caught early.
 - **Acceptance Criteria**:
  - [ ] The system checks that mandatory units are present.
  - [ ] The system checks GLH and credit totals against qualification or group rules when available.
  - [ ] The system checks optional-group selection rules, such as minimum units or credits.
  - [ ] Validation failures block approval until resolved or explicitly overridden with rationale.

8. **Auditability**: The workflow records what was extracted, reviewed, approved, edited, reprocessed, and submitted.
 - **User Story**: As a governance stakeholder, I want a trace of extraction and approval decisions so that outcomes are auditable.
 - **Acceptance Criteria**:
   - [ ] Extraction runs have unique identifiers.
   - [ ] Review decisions are logged.
  - [ ] Submitted payload versions are retained or referentially recoverable.
  - [ ] Audit records identify whether a unit was shared, whether command verbs were extracted, and which validations passed or failed.

#### Should Have (P1)
1. **Source-linked review**: Clicking an extracted node highlights the relevant PDF page or section.
 - **User Story**: As a reviewer, I want quick source linkage so that I can verify difficult sections faster.

2. **Validation rules**: The system flags likely structural issues before approval.
 - **User Story**: As a reviewer, I want rule-based validation so that I can catch incomplete or contradictory structures earlier.

3. **Draft edits before approval**: The reviewer can correct extraction mistakes before approval.
 - **User Story**: As a reviewer, I want lightweight edits so that I can resolve minor issues without reprocessing the entire file.

4. **Guided reprocessing**: The reviewer can adjust instructions and rerun extraction.
 - **User Story**: As a reviewer, I want to reprocess with adjustments so that recurring extraction mistakes can be corrected systematically.

5. **Command-verb normalization**: The system highlights extracted command verbs or grade descriptors for reviewer confirmation.
 - **User Story**: As a reviewer, I want command verbs surfaced consistently so that assessment intent is preserved for downstream marking use cases.

#### Could Have (P2)
1. **Batch processing**: Process multiple PDFs in a queue.
2. **Extraction-learning loop**: Capture corrected reviews to improve future extraction quality.
3. **Template hints by qualification family**: Apply family-specific extraction heuristics for known document patterns.
4. **Prompt profiles by awarding body**: Apply provider-specific extraction guidance for document families beyond BTEC.

#### Won't Have (Out of Scope)
- Direct database writes from the UI or extractor.
- Full authoring of qualification content from scratch.
- Automatic publication to downstream channels without review.

### 5.2 AI/ML Requirements

#### Technology Classification
- [x] **AI/ML powered** - requires model inference for layout and content extraction
- [ ] **Rule-based / statistical** - no model needed
- [x] **Hybrid** - AI extraction plus deterministic schema mapping and validations

#### Model Requirements

| Requirement | Specification |
|-------------|---------------|
| **Model Type** | Vision/layout extraction model with OCR and document-structure understanding |
| **Provider** | Any provider that supports production-grade layout extraction and API access |
| **Latency** | Near-real-time for single PDF review starts, batch acceptable for long documents |
| **Quality Threshold** | 95 percent completeness on required schema entities in pilot set, including learning outcomes and assessment criteria; 85 percent first-pass review approval |
| **Cost Budget** | To be defined during vendor selection; must support predictable per-document economics |
| **Data Sensitivity** | Internal, non-PII by current product assumption |

#### Inference Pattern
- [x] Real-time API for user-triggered document processing
- [ ] Batch processing only
- [ ] RAG
- [ ] Fine-tuned model in phase 1
- [ ] Multi-agent orchestration
- [x] Agent with tools in the sense of extraction plus deterministic mapping and validation services

#### Data Requirements
- **Training / evaluation data**: A pilot corpus of qualification PDFs with manually verified target structures, including multi-qualification documents and shared-unit cases
- **Grounding data**: The qualification schema defined in [QualStructure.md](../../../QualStructure.md), plus prompt-derived mapping rules for learning outcomes, assessment criteria, grade descriptors, command verbs, and validation logic
- **Data sensitivity**: Internal, no personal data expected
- **Volume**: Initial pilot volume to be defined; design should not assume single-document-only scale

#### Model Pinning and Change Management
- The selected extraction model version must be pinned explicitly.
- Model version must be externally configurable.
- Any model change must be tested against a fixed evaluation set before release.
- Approved evaluation baselines must be stored for comparison.

#### Responsible AI Requirements

| Concern | Requirement |
|---------|-------------|
| **Guardrails** | Reject unsupported file types, display low-confidence outputs clearly, block persistence without review, and block approval on unresolved structural validation failures unless explicitly overridden |
| **Transparency** | Clearly label the output as AI-assisted extraction pending user confirmation |
| **Fairness** | Validate extraction quality across different qualification formats, page densities, scan qualities, and documents containing multiple qualifications or shared units |
| **Privacy** | Retain uploaded PDFs and rejected extraction payloads for 1 day; minimize all other retained artifacts |
| **Human Oversight** | Mandatory human confirmation before API submission |
| **Accountability** | Maintain extraction, review, and submission audit logs |

#### AI-Specific Acceptance Criteria
- [ ] Extraction quality is measured on a representative evaluation set before release.
- [ ] Low-confidence or unresolved fields are clearly marked for review.
- [ ] Multi-qualification extraction and shared-unit reuse are validated on the evaluation set.
- [ ] Learning outcomes and assessment criteria are extracted with correct unit linkage.
- [ ] Model version is pinned and auditable.
- [ ] The system degrades gracefully when extraction fails.
- [ ] No API submission occurs without human confirmation.
- [ ] Confidence is displayed to reviewers without auto-marking entities as correct.
- [ ] Command verbs or grade descriptors are preserved when present in the source.

### 5.3 Non-Functional Requirements

#### Performance
- **Response Time**: Initial extraction feedback within 10 seconds for typical PDFs, or clear async status for longer jobs
- **Throughput**: Pilot-ready for concurrent analyst usage
- **Uptime**: 99.5 percent or higher for the review and submission workflow

#### Security
- **Authentication**: Required for upload, review, and approval actions
- **Authorization**: Role-based access for reviewer and submitter actions
- **Data Protection**: Encryption in transit and at rest
- **Compliance**: OWASP file upload controls and WCAG 2.2 AA for UI

#### Scalability
- **Concurrent Users**: Initial support for small operations teams, expandable later
- **Data Volume**: Support for multi-page qualification PDFs and nested structures
- **Growth**: Should scale to qualification-family rollouts without schema redesign

#### Usability
- **Accessibility**: WCAG 2.2 AA target
- **Browser Support**: Latest two versions of major desktop browsers
- **Surface**: Web application
- **Mobile**: Not a primary target for phase 1; tablet-friendly review is desirable
- **Localization**: English only for phase 1 unless qualification sources require otherwise

#### Reliability
- **Error Handling**: Clear extraction, validation, and API submission errors
- **Recovery**: Retry transient extraction/API failures safely
- **Monitoring**: Health, latency, extraction quality, and submission outcomes tracked

---

## 6. User Stories and Features

### Feature 1: Ingest and Extract Qualification Structure
**Description**: Upload a PDF and produce schema-aligned structured output, including multiple qualifications and detailed academic assessment structures when present.  
**Priority**: P0  
**Epic**: #1

| Story ID | As a... | I want... | So that... | Acceptance Criteria | Priority | Estimate |
|----------|---------|-----------|------------|---------------------|----------|----------|
| US-1.1 | Data analyst | to upload a qualification PDF | the system can process it | - [ ] file validated<br>- [ ] job accepted<br>- [ ] audit record created | P0 | 3 days |
| US-1.2 | Data analyst | structured extraction mapped to the qualification schema | I can review entities instead of raw OCR text | - [ ] required entities created<br>- [ ] relationships preserved<br>- [ ] unresolved fields flagged<br>- [ ] learning outcomes and assessment criteria linked to the right unit | P0 | 5 days |
| US-1.3 | Content specialist | multiple qualifications and shared units extracted correctly from one document | I can avoid duplicate cleanup after review | - [ ] multiple qualifications supported<br>- [ ] shared units reused by reference<br>- [ ] selection rules preserved | P0 | 4 days |

### Feature 2: Visual Review and Confirmation
**Description**: Present extracted content in a reviewable hierarchy with source linkage and validation context.  
**Priority**: P0

| Story ID | As a... | I want... | So that... | Acceptance Criteria | Priority | Estimate |
|----------|---------|-----------|------------|---------------------|----------|----------|
| US-2.1 | Reviewer | a hierarchical visualization of the extracted structure in a web app | I can validate nested units, groups, outcomes, criteria, and rules quickly | - [ ] tree view available<br>- [ ] detail pane available<br>- [ ] source references visible<br>- [ ] confidence displayed<br>- [ ] shared units visibly identified | P0 | 4 days |
| US-2.2 | Reviewer | an explicit confirm or reject action | unverified extractions are not persisted | - [ ] approval required<br>- [ ] rejection path available<br>- [ ] decision logged | P0 | 2 days |
| US-2.3 | Reviewer | edit and reprocess options | I can correct extraction errors efficiently | - [ ] edit option available<br>- [ ] reprocess option available<br>- [ ] adjustments recorded<br>- [ ] validation blockers explained | P1 | 4 days |

### Feature 3: API Submission and Audit Trail
**Description**: Submit approved structures to a downstream API and record the outcome.  
**Priority**: P0

| Story ID | As a... | I want... | So that... | Acceptance Criteria | Priority | Estimate |
|----------|---------|-----------|------------|---------------------|----------|----------|
| US-3.1 | Platform engineer | approved structures sent only through a newly created API | the database remains decoupled from the UI | - [ ] no direct DB access<br>- [ ] payload contract supported<br>- [ ] multiple qualifications supported<br>- [ ] API response shown | P0 | 3 days |
| US-3.2 | Governance stakeholder | a full audit trail | I can trace who approved and what was submitted | - [ ] submission logged<br>- [ ] version retained<br>- [ ] failures traceable<br>- [ ] shared-unit decisions and validation outcomes traceable | P1 | 2 days |

### Feature 4: Qualification Persistence Platform
**Description**: Define the persistence contract and backing data model for approved structures.  
**Priority**: P0

| Story ID | As a... | I want... | So that... | Acceptance Criteria | Priority | Estimate |
|----------|---------|-----------|------------|---------------------|----------|----------|
| US-4.1 | Platform engineer | an API contract for qualifications, units, learning outcomes, assessment criteria, grade schemes, groups, and rulesets | approved payloads can be inserted consistently | - [ ] request schema defined<br>- [ ] nested entities supported<br>- [ ] shared-unit references supported<br>- [ ] validation rules documented | P0 | 3 days |
| US-4.2 | Platform engineer | a database schema that accommodates the qualification model | the API can persist approved structures reliably | - [ ] schema covers all entities<br>- [ ] relationships defined<br>- [ ] shared-unit reuse supported<br>- [ ] retention behavior documented | P0 | 3 days |

### Feature 5: Extraction Validation and Correction Support
**Description**: Help reviewers catch and resolve common structural and academic-rule issues before approval.  
**Priority**: P1

| Story ID | As a... | I want... | So that... | Acceptance Criteria | Priority | Estimate |
|----------|---------|-----------|------------|---------------------|----------|----------|
| US-5.1 | Reviewer | validation warnings for incomplete or contradictory structures | I can focus on risky sections first | - [ ] warnings surfaced<br>- [ ] affected nodes identified<br>- [ ] GLH, credit, and selection-rule failures called out | P1 | 3 days |
| US-5.2 | Reviewer | lightweight editing of extracted values | I can fix small issues without rerunning extraction | - [ ] edit mode limited to approved fields<br>- [ ] changes logged | P1 | 4 days |
| US-5.3 | Reviewer | command verbs and grade descriptors normalized for review | I can preserve marking intent without reading every source paragraph | - [ ] extracted verbs displayed<br>- [ ] reviewer can correct normalization<br>- [ ] approved value retained in audit trail | P1 | 3 days |

---

## 7. User Flows

### Primary Flow: Upload, Review, Confirm, Submit
**Trigger**: User selects a qualification PDF to process.  
**Preconditions**: User is authenticated and authorized to review qualification extractions.

**Steps**:
1. User uploads a PDF.
2. System validates file type, size, and safety rules.
3. System runs extraction and mapping to the qualification schema.
4. System groups extracted content into one or more qualifications, resolves shared units, and links learning outcomes and assessment criteria to units.
5. System runs deterministic validation for mandatory coverage, GLH or credit totals, and optional-group rules.
6. System displays the extracted structure as a hierarchy with details, source links, confidence cues, and validation status.
7. User reviews the structure, optionally edits values or adjusts reprocessing inputs.
8. User either approves or rejects the result.
9. If approved, system submits the approved payload to the downstream API.
10. System displays submission success or failure and records an audit trail.
11. **Success State**: Approved structure is persisted through API and linked to the extraction record.

**Alternative Flows**:
- **7a. Extraction failure**: System shows extraction error and allows retry.
- **7b. Low-confidence extraction**: System flags fields for manual attention before approval.
- **7c. Reviewer correction path**: Reviewer edits values directly or adjusts extraction guidance and reprocesses.
- **7d. Validation failure**: System blocks approval, identifies affected qualifications, groups, or units, and requires correction or override rationale.
- **7e. API failure after approval**: System preserves approved payload and offers safe retry without duplicate submission.

### Secondary Flow: Reject and Reprocess
**Trigger**: Reviewer determines the extraction is not accurate enough.

**Steps**:
1. Reviewer rejects the extracted result.
2. Reviewer optionally records rejection reasons.
3. System marks the extraction as rejected.
4. User may re-upload or re-run processing with updated settings.
5. **Success State**: No data is submitted; review trace is preserved.

---

## 8. Dependencies and Constraints

### Dependencies
- Access to a document extraction engine with layout-aware OCR and structured output support
- A new downstream API and backing database capable of accepting the qualification structure and nested entities
- Authentication and authorization services for upload, review, and approval
- An evaluation corpus of representative qualification PDFs and expected outputs
- Prompt and schema definitions that specify multi-qualification handling, shared-unit identity, and validation rules

### Constraints
- The system must align to the qualification schema defined in [QualStructure.md](../../../QualStructure.md).
- The system must align to the extraction rules in [prompts/qualification-extractor.md](../../../prompts/qualification-extractor.md).
- The target delivery surface is a web application.
- Persistence must happen through an API only.
- No direct database insertion is allowed.
- Uploaded PDFs and rejected extraction payloads must be retained for 1 day only.
- The workflow must accommodate semistructured and potentially long PDFs.
- The workflow must accommodate documents that contain multiple qualifications and shared units.
- Uploaded files must be handled under strict file-upload security controls.

---

## 9. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Extraction misses nested rules or optional groups | High | Medium | Use layout-aware extraction plus schema validations and mandatory human review |
| PDF formats vary widely across qualification families | High | High | Build pilot corpus across document families, start with generalized extraction, add family-specific hints only when patterns are observed |
| Shared units are duplicated instead of reused across qualifications | High | Medium | Define stable shared-unit identity rules and validate referential reuse before persistence |
| Learning outcomes or assessment criteria are linked to the wrong unit | High | Medium | Require source-linked review, unit-level validation, and evaluation-set checks for outcome-to-unit linkage |
| Downstream API contract does not cleanly support nested structure | High | Medium | Define payload contract early and validate with sample approved payloads |
| Review UI is too weak to support fast validation | Medium | Medium | Prioritize hierarchy visualization, source references, and validation warnings |
| File upload or document storage introduces security risk | High | Medium | Apply OWASP file upload protections, isolated storage, scanning, and strict allow lists |
| Reviewers may disagree on what confidence means | Medium | Medium | Display confidence as a cue only and require user judgment for approval |
| Sensitive data handling assumptions are wrong | Medium | Low | Reconfirm non-PII classification during pilot onboarding and adjust controls if needed |
| Model or library changes degrade extraction quality | Medium | Medium | Pin model versions, maintain evaluation baseline, require regression testing before changes |


## 10. Timeline and Milestones

### Milestone 1: Discovery and Contract Definition
- Define target API contract
- Define database schema for qualification persistence
- Assemble pilot PDF corpus
- Define evaluation rubric for schema completeness, shared-unit reuse, and review approval

### Milestone 2: Extraction and Mapping MVP
- Implement upload, extraction, and schema mapping
- Support required entities from the qualification model, including learning outcomes and assessment criteria
- Support multi-qualification documents and shared-unit references
- Produce machine-readable payloads for review

### Milestone 3: Review Visualization and Confirmation
- Deliver hierarchy view and entity detail view
- Add explicit approval and rejection workflow
- Add direct edit and guided reprocess options
- Add validation blockers and override rationale capture
- Add audit logging for review decisions

### Milestone 4: API Submission Pilot
- Submit approved payloads to downstream API
- Add retry-safe failure handling
- Measure pilot quality, review speed, shared-unit reuse accuracy, and submission success

---

## 11. Out of Scope

- End-to-end content authoring or editing of source qualification documents
- Direct database writes from UI, service, or operator tooling
- Fully autonomous persistence without human confirmation
- Large-scale historical backfill migration in phase 1
- General-purpose PDF extraction beyond qualification-structure use cases

---

## 12. Open Questions

1. Should phase 1 API support only create operations, or also idempotent upsert behavior for repeated approved submissions?
2. What reviewer-adjustable inputs should be exposed for reprocessing in phase 1: free-text instructions, section boundaries, qualification type hints, or all of these?
3. Should edited values be highlighted separately from machine-extracted values in the approved payload and audit log?
4. What pilot dataset size is sufficient to establish a reliable baseline for extraction quality across semistructured qualification PDFs?
5. Should source-PDF storage and extracted-payload retention follow the same 1-day policy for approved submissions, or should approved payloads be retained longer for auditability?
6. What is the canonical identity rule for shared units across multiple qualifications when source documents vary in unit numbering or naming conventions?
7. Should grade descriptors and command verbs be stored as normalized reference data, free text, or both?

---

## 13. Appendix

### A. Target Qualification Structure
The extraction target is the qualification model documented in [QualStructure.md](../../../QualStructure.md), plus the extraction-specific detail defined in the revised prompt, including:
- One or more Qualifications per source document
- Shared Units with stable reuse identifiers
- Learning Outcomes linked to Units
- Assessment Criteria linked to Learning Outcomes or Units
- Grade Schemes
- Grade Options
- Unit Groups
- Unit Group Members
- Qual Rule Sets
- Qual Rule Set Members
- Grade descriptors or command verbs when present in source content

### B. Suggested Visualization Pattern
- Left panel: hierarchical tree of document -> qualifications -> unit groups -> units -> learning outcomes -> assessment criteria
- Main panel: selected entity details in table or form view
- Supporting elements: source-page chips, confidence/review-needed badge, validation warnings, shared-unit indicators, approval banner

### C. Draft Feature Breakdown
- Feature 1: PDF ingestion and schema extraction
- Feature 2: Visual review and confirmation
- Feature 3: API-only persistence and audit
- Feature 4: Qualification persistence platform
- Feature 5: Validation and correction support

### D. Story Drafts for Issue Creation
- Story: Upload a qualification PDF and start extraction
- Story: Map extracted document content to the qualification schema, including learning outcomes and assessment criteria
- Story: Extract multiple qualifications and reuse shared units correctly
- Story: Review extracted qualification structure in a hierarchy view
- Story: Approve or reject extracted content before submission
- Story: Submit approved structure to downstream API
- Story: Record audit trail for extraction, approval, and submission

### E. Workspace Notes
- This workspace does not currently contain an issue tracker or repository-local workflow files.
- Epic number `1` is a local placeholder used to create a PRD filename and structure.
- Product decisions captured on 2026-03-16: web app delivery, 1-day retention for uploaded PDFs and rejected payloads, non-PII assumption, dual reviewer correction path (edit or reprocess), and API plus database creation required in phase 1.
- Product update captured on 2026-03-19: revised prompt requires explicit support for multiple qualifications per document, shared units, learning outcomes, assessment criteria, command-verb capture, and pre-approval structural validation.