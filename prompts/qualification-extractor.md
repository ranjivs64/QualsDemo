
# AI Extraction Rules for BTEC Qualification Specifications

This document defines the rules and structure that an AI agent should follow to extract a standardized hierarchical representation of BTEC qualification specifications from PDF documents.

## 📘 1. Qualification Identification
- **Trigger Keywords**: Look for phrases like "BTEC Level", "Qualification Title", "Qualification Type", "GLH", "Credits", "Grading Scheme".
- **Attributes to Extract**:
  - `title`: Full name of the qualification
  - `level`: e.g., Level 1, Level 2, Level 3
  - `qualification_type`: e.g., Certificate, Extended Certificate, Diploma
  - `size_glh`: Total Guided Learning Hours
  - `size_credits`: Total credits (if available)
  - `grading_scheme`: e.g., Pass/Merit/Distinction

## 📦 2. Unit Grouping
- **Group Types**:
  - `Mandatory`: All units in this group must be completed
  - `Optional Group A`, `Optional Group B`, etc.
- **Group Identification**:
  - Look for section headers like "Mandatory Units", "Optional Units", "Optional Group A"
  - Extract `group_name` and `selection_rule` (e.g., "Choose 2 of 4 units", "Minimum 60 credits")

## 📚 3. Unit Extraction
- **Unit Attributes**:
  - `unit_number`: e.g., Unit 1, Component 2
  - `title`: Unit title
  - `glh`: Guided Learning Hours
  - `credit_value`: Credit value (if available)
  - `assessment_type`: Internal / External

## 🎯 4. Learning Outcomes
- **Identification**:
  - Look for sections titled "Learning Aims", "Learning Outcomes", or "Objectives"
- **Attributes**:
  - `description`: Text of the learning outcome

## ✅ 5. Assessment Criteria
- **Identification**:
  - Look for tables or bullet lists under each learning outcome
  - Criteria are usually grouped by grade: Pass, Merit, Distinction
- **Attributes**:
  - `grade_level`: Pass / Merit / Distinction
  - `description`: Text of the criterion

## 📄 6. Handling Multiple Qualifications in One Document
- If multiple qualifications are defined (e.g., Certificate and Extended Certificate):
  - Create separate `qualification` entries
  - Units may be shared across qualifications
  - Use `unit_groups` to define which units apply to which qualification and under what rules

## 🔁 7. Shared Units
- Units may appear in multiple qualifications
- Use a unique `unit_id` and reference it in multiple `unit_groups` across qualifications

## 🧠 8. AI Marking Engine Data Points
- Extract the following for each unit:
  - `learning_outcomes`
  - `assessment_criteria` (Pass/Merit/Distinction)
  - `grade descriptors` or `command verbs` if available


## 🧪 Validation
- Ensure that the total GLH and credit values of selected units meet the qualification’s requirements
- Validate that all mandatory units are included
- Validate that optional group rules are satisfied
