# Qualification Data Model Overview

## 🎓 Qualification

A **Qualification** is the central entity and represents a complete course or program.

**Examples:**
- GCSE in Geography A
- BTEC National in Business
- A-Level Mathematics

Each Qualification includes the following attributes:

- **Name** (e.g., *GCSE in Geography A*)
- **Code** (e.g., *1GA0*)
- **Type** (e.g., *GCSE*, *BTEC*, *A-Level*)
- **Level** (e.g., *Level 1/2*, *Level 3*)
- **Awarding Body** (e.g., *Pearson Edexcel*)
- **Description**
- **Additional metadata** as required

---

## 📦 Units (Modules or Components)

Each Qualification is composed of **Units**, which are the core building blocks of the course.

**Examples:**
- *Component 1: Shakespeare and Post‑1914 Literature*
- *Unit 3: Using Social Media in Business*

Each Unit includes:

- **Name**
- **Code**
- **Level**
- **Credit Value** (if applicable)
- **Guided Learning Hours (GLH)**
- **Assessment Type**  
  - Internal  
  - External
- **Grading Scheme** (linked to a Grade Scheme)

---

## 🧮 Grade Schemes and Grade Options

Each Unit is assessed using a **Grade Scheme**, which defines how results are evaluated.

### Grade Scheme defines:
- The **grading scale**  
  - Example: *GCSE 9–1*  
  - Example: *BTEC Pass / Merit / Distinction*
- Whether grades are **numeric**
- The **minimum pass grade**

### Grade Options

Each Grade Scheme contains multiple **Grade Options**.

**Examples:**
- GCSE: `9`, `8`, … `1`, `U`
- BTEC: `D*`, `D`, `M`, `P`, `N`

Each Grade Option includes:

- **Symbol** (e.g., `9`, `D*`)
- **Rank** (used for ordering)
- **Point Value** (used for calculating totals or aggregates)

---

## 🧩 Unit Groups

Units are organized into **Unit Groups** to support qualification rules.

**Examples:**
- Mandatory Units
- Optional Units
- Group A / Group B

Each Unit Group defines:

- **Minimum required units or credits**
- Whether **all units are mandatory**
- A **RuleSet** that governs how groups are combined

---

## 🔗 Unit Group Members

The **UnitGroupMember** entity links Units to Unit Groups.

It specifies:

- Which **Units belong to which Unit Groups**
- Whether each Unit is **mandatory within the group**

---

## 🧠 Rule Sets

Some Qualifications require complex completion rules, such as:

- *“You must complete all Mandatory Units AND at least 2 Optional Units”*
- *“Choose 1 from Group A OR 2 from Group B”*

These rules are modeled using:

### QualRuleSet
- Defines the logical relationship:
  - `AND`
  - `OR`

### QualRuleSetMember
- Links Rule Sets to:
  - Unit Groups
  - Other nested Rule Sets (for complex logic)

---

## ✅ Summary

This model supports:

- Simple and complex qualification structures
- Flexible grading schemes
- Clear separation of mandatory and optional learning paths
- Extensible rule logic for real‑world academic requirements