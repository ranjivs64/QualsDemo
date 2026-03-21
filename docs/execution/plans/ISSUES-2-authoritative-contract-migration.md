# Issue Pack: Authoritative Extractor Contract Migration

**Status**: Draft  
**Date**: 2026-03-20  
**Source PRD**: [PRD-2.md](../../artifacts/prd/PRD-2.md)  
**Source Backlog**: [BACKLOG-2-authoritative-contract-migration.md](./BACKLOG-2-authoritative-contract-migration.md)

## Purpose

This file converts the local backlog into issue-ready Epic, Feature, and Story bodies. The workspace does not expose a live issue tracker artifact, so these are formatted for direct use in GitHub Issues or another tracker.

## Epic

### Title
`[Epic] Adopt authoritative qualification extractor contract`

### Labels
`type:epic`, `priority:p0`, `needs:ai`

### Body
```md
## Overview
Adopt the new authoritative extractor prompt contract without breaking the current review workspace. The application must treat the prompt-defined `Qualifications` payload as the external AI contract, validate it through an explicit schema, and normalize it into the existing internal review graph for phase 1.

## Problem
The current prompt and the current application schema no longer match. The prompt requires a top-level `Qualifications` object with first-class qualifications, pathways, rules of combination, unit groups, units, and learning objectives. The live application still expects a graph-based payload with top-level review metadata and `kind` / `fields` / `children` nodes.

## Desired Outcome
- Prompt and AI schema are aligned.
- AI output is normalized into the existing internal graph.
- Review and persistence flows remain stable in phase 1.
- Contract drift is caught by CI.
- Pathways and rules-of-combination semantics are preserved for later UX work.

## Child Features
- FEAT-2.1 Define the authoritative AI contract
- FEAT-2.2 Normalize authoritative payloads into the current internal graph
- FEAT-2.3 Preserve current review and approval flows
- FEAT-2.4 Add drift governance and evaluation fixtures
- FEAT-2.5 Prepare phase-2 exposure of authoritative semantics

## PRD
- [PRD-2.md](../../artifacts/prd/PRD-2.md)
```

## Feature Issues

### FEAT-2.1

#### Title
`[Feature] Define the authoritative AI contract`

#### Labels
`type:feature`, `priority:p0`, `needs:ai`

#### Body
```md
## Description
Define the authoritative structured-output schema that matches the prompt-defined `Qualifications` contract and make it the explicit AI-facing contract.

## Parent Epic
- [Epic] Adopt authoritative qualification extractor contract

## Story List
- STORY-2.1.1 Create authoritative schema from the prompt contract
- STORY-2.1.2 Align AI client validation to the authoritative schema

## Acceptance Criteria
- The authoritative schema matches the `Qualifications` payload shape.
- All prompt-required entities are represented explicitly.
- Prompt/schema drift is detectable in CI.
```

### FEAT-2.2

#### Title
`[Feature] Normalize authoritative payloads into the current internal graph`

#### Labels
`type:feature`, `priority:p0`, `needs:ai`

#### Body
```md
## Description
Introduce a formal normalization boundary so authoritative AI output is converted into the app's current internal review graph before review, persistence, and audit consumers run.

## Parent Epic
- [Epic] Adopt authoritative qualification extractor contract

## Story List
- STORY-2.2.1 Introduce a normalizer module at the AI boundary
- STORY-2.2.2 Map learning objectives into current reviewable structures

## Acceptance Criteria
- The normalizer creates internal qualification roots from authoritative qualifications.
- Unit groups, units, and learning objectives remain reviewable in the current hierarchy.
- `needsAttention`, guidance, and lineage are preserved for review use.
```

### FEAT-2.3

#### Title
`[Feature] Preserve current review and approval flows`

#### Labels
`type:feature`, `priority:p0`

#### Body
```md
## Description
Keep the existing review workspace and approval flow working while the AI boundary changes underneath it.

## Parent Epic
- [Epic] Adopt authoritative qualification extractor contract

## Story List
- STORY-2.3.1 Verify review workspace compatibility with normalized drafts
- STORY-2.3.2 Keep fallback extraction on the internal graph contract

## Acceptance Criteria
- Existing review pages load normalized drafts without runtime errors.
- Approval and persistence still work for normalized drafts.
- Fallback extraction remains compatible.
```

### FEAT-2.4

#### Title
`[Feature] Add drift governance and evaluation fixtures`

#### Labels
`type:feature`, `priority:p0`, `needs:ai`

#### Body
```md
## Description
Add automated safeguards so prompt, schema, and normalization changes are regression-tested before release.

## Parent Epic
- [Epic] Adopt authoritative qualification extractor contract

## Story List
- STORY-2.4.1 Add golden fixtures for authoritative and normalized outputs
- STORY-2.4.2 Capture prompt, schema, and normalizer versions in job metadata

## Acceptance Criteria
- Golden fixtures cover single qualification, multi-qualification, shared unit, and pathway cases.
- CI fails when authoritative payload validation or normalization breaks.
- Model and schema versions are captured in job metadata or logs.
```

### FEAT-2.5

#### Title
`[Feature] Prepare phase-2 exposure of authoritative semantics`

#### Labels
`type:feature`, `priority:p1`, `needs:ai`

#### Body
```md
## Description
Preserve pathways and rules-of-combination semantics during phase 1 so later UX and persistence work can expose them without re-extraction.

## Parent Epic
- [Epic] Adopt authoritative qualification extractor contract

## Story List
- STORY-2.5.1 Preserve rules-of-combination semantics for future UX

## Acceptance Criteria
- Derived qualification lineage is preserved.
- Rules-of-combination details remain available after normalization.
- A future decision point exists for direct-consumption versus continued normalization.
```

## Story Issues

### STORY-2.1.1

#### Title
`<Story> Create authoritative schema from the prompt contract`

#### Labels
`type:story`, `priority:p0`, `needs:ai`

#### Body
```md
As an AI workflow maintainer,
I want an authoritative structured-output schema that matches the prompt contract,
So that the application validates the same external shape the prompt is asking the model to return.

## Parent
- FEAT-2.1 Define the authoritative AI contract

## Acceptance Criteria
- Given the authoritative prompt, when the schema is defined, then every required prompt entity has a corresponding schema definition.
- Given structured-output provider constraints, when optional values are needed, then nullable required fields are used compatibly.
```

### STORY-2.1.2

#### Title
`<Story> Align AI client validation to the authoritative schema`

#### Labels
`type:story`, `priority:p0`, `needs:ai`

#### Body
```md
As a platform engineer,
I want the AI client to validate authoritative payloads rather than legacy graph-shaped payloads,
So that valid authoritative outputs are accepted and invalid outputs fail clearly.

## Parent
- FEAT-2.1 Define the authoritative AI contract

## Acceptance Criteria
- Given an authoritative payload, when the AI client validates it, then mismatched legacy-shape assumptions no longer reject valid authoritative outputs.
- Given an invalid authoritative payload, when validation runs, then the request fails with actionable error detail.
```

### STORY-2.2.1

#### Title
`<Story> Introduce a normalizer module at the AI boundary`

#### Labels
`type:story`, `priority:p0`, `needs:ai`

#### Body
```md
As a platform engineer,
I want authoritative AI output normalized into the current internal graph,
So that downstream review and persistence flows keep working in phase 1.

## Parent
- FEAT-2.2 Normalize authoritative payloads into the current internal graph

## Acceptance Criteria
- Given a valid authoritative payload, when normalization runs, then an internal graph draft is emitted.
- Given derived pathways or shared units, when normalization runs, then lineage and reuse semantics are preserved.
```

### STORY-2.2.2

#### Title
`<Story> Map learning objectives into current reviewable structures`

#### Labels
`type:story`, `priority:p0`, `needs:ai`

#### Body
```md
As a qualification reviewer,
I want learning objectives from authoritative AI output to remain reviewable in the current workspace,
So that richer extraction data is not lost during normalization.

## Parent
- FEAT-2.2 Normalize authoritative payloads into the current internal graph

## Acceptance Criteria
- Given a unit with learning objectives, when normalization completes, then those objectives are reviewable in the current workspace.
- Given no extractable objectives, when normalization completes, then the internal graph still preserves emptiness and attention signals.
```

### STORY-2.3.1

#### Title
`<Story> Verify review workspace compatibility with normalized drafts`

#### Labels
`type:story`, `priority:p0`

#### Body
```md
As a qualification reviewer,
I want the review workspace to behave the same way after the AI contract migration,
So that I can continue review and approval without workflow disruption.

## Parent
- FEAT-2.3 Preserve current review and approval flows

## Acceptance Criteria
- Given a normalized AI draft, when the review workspace loads, then qualification tabs, hierarchy rendering, and detail panels work as they do today.
- Given approval, when persistence is triggered, then the current flow still succeeds.
```

### STORY-2.3.2

#### Title
`<Story> Keep fallback extraction on the internal graph contract`

#### Labels
`type:story`, `priority:p1`

#### Body
```md
As a platform engineer,
I want fallback extraction to remain compatible with the current review graph,
So that local and degraded-mode workflows still function while the AI path changes.

## Parent
- FEAT-2.3 Preserve current review and approval flows

## Acceptance Criteria
- Given AI is unavailable, when fallback extraction is used, then review still works without the authoritative schema path.
- Given mixed AI and fallback test coverage, when regression checks run, then both flows remain valid.
```

### STORY-2.4.1

#### Title
`<Story> Add golden fixtures for authoritative and normalized outputs`

#### Labels
`type:story`, `priority:p0`, `needs:ai`

#### Body
```md
As QA,
I want golden fixtures for both authoritative and normalized outputs,
So that prompt, schema, and normalization regressions are caught before release.

## Parent
- FEAT-2.4 Add drift governance and evaluation fixtures

## Acceptance Criteria
- Given a pathway-bearing document, when test fixtures are reviewed, then both authoritative and normalized expected outputs exist.
- Given a prompt or schema change, when CI runs, then fixture divergence is reported.
```

### STORY-2.4.2

#### Title
`<Story> Capture prompt, schema, and normalizer versions in job metadata`

#### Labels
`type:story`, `priority:p1`, `needs:ai`

#### Body
```md
As a QA engineer,
I want extraction jobs to record prompt, schema, and normalizer versions,
So that defects can be traced to the exact contract-producing artifacts.

## Parent
- FEAT-2.4 Add drift governance and evaluation fixtures

## Acceptance Criteria
- Given an extraction job, when metadata is inspected, then prompt, schema, and normalizer versions are visible.
- Given a reviewer raises a defect, when the job is audited, then the producing versions can be identified.
```

### STORY-2.5.1

#### Title
`<Story> Preserve rules-of-combination semantics for future UX`

#### Labels
`type:story`, `priority:p1`, `needs:ai`

#### Body
```md
As a product owner,
I want qualification rules-of-combination semantics preserved during phase 1 normalization,
So that future UX and persistence work can expose them without re-extraction.

## Parent
- FEAT-2.5 Prepare phase-2 exposure of authoritative semantics

## Acceptance Criteria
- Given qualification-specific rules, when normalization completes, then those rules are still available in stored metadata or fields.
- Given a future UX slice, when engineering begins phase 2, then re-extraction is not required to surface those rules.
```

## Suggested Tracker Order

1. Create the Epic.
2. Create all Features linked to the Epic.
3. Create Stories under each Feature in delivery order.
4. Move FEAT-2.1 and FEAT-2.2 into active planning first.

## Notes

- These issue bodies assume local-mode planning where issue creation may be manual.
- Titles and labels follow the conventions already used in repo planning artifacts.