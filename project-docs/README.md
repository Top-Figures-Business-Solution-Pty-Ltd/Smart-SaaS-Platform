# Project Documentation Hub

This folder is the single entry point for project-facing documentation in `smart_accounting`.

Goals:
- keep project documents easy to find
- separate long-lived reference docs from working notes
- keep weekly R&D records in one predictable place

## Structure

- `document-map.md`
  Master index of existing project documents and where they currently live.
- `reference-library.md`
  Grouped reading guide for design, architecture, implementation, and working records.
- `reference/`
  Migrated core reference documents from the old `docs/` folder.
- `r-and-d-notes/`
  Weekly working notes, investigation records, experiments, decisions, and validation logs.
- `working-notes/`
  Pointers to active checklists and temporary-but-reusable planning notes.

## Rules

- New project documentation should be added under `project-docs/` whenever possible.
- Existing legacy documents may remain in their current paths, but they should be indexed here.
- Weekly updates should go into `r-and-d-notes/`, not scattered across chat logs or ad-hoc files.
- Use neutral operational wording for investigation records, validation notes, and supporting artefacts.

## Quick Links

- [Document Map](document-map.md)
- [Reference Library](reference-library.md)
- [Reference Docs](reference/README.md)
- [R&D Notes](r-and-d-notes/README.md)
- [Working Notes](working-notes/README.md)
