# Smart System Business Domain Boundaries

This document records the current business boundaries found during the system
risk review. It is intended to guide incremental ERPNext optimization and the
future custom platform design.

## Source Of Truth

- `Customer` is the source of truth for the client identity, client status,
  partner ownership, portal access, and shared contact context.
- `Project` is the source of truth for work execution: board, workflow status,
  responsible people, lodgement or grants dates, engagement month, and per-year
  grant/application state.
- Smart Grants snapshot fields on `Project` are convenience copies for delivery
  workflows. They should not silently diverge from the Customer record unless the
  business explicitly decides the grant file needs a historical snapshot.

## Smart Grants Snapshot Policy

Use this rule when adding or editing Grants columns:

- If the field describes the client generally, store it on `Customer` or a client
  entity and make the Project value read-only or refreshable.
- If the field describes this year's grant engagement, store it on `Project`.
- If the field must preserve the value as it was when the grant was prepared,
  keep it as a Project snapshot and label it as historical.

Current Project snapshot fields that should be reviewed before long-term use:

- `custom_grants_abn_snapshot`
- `custom_grants_address_snapshot`
- `custom_grants_contact_name`
- `custom_grants_primary_communication`
- `custom_grants_partner_label`

Recommended next step: add a "Refresh from Client" action for snapshot fields
instead of letting every snapshot behave like ordinary free text.

## Module Permission Boundary

Current behavior uses page routing to separate Smart Accounting and Smart Grants,
but API methods are shared. Long term, every whitelisted method should declare one
of these access levels:

- `accounting`: requires Smart Accounting access.
- `grants`: requires Smart Grants access.
- `shared`: requires either module role.
- `admin`: requires Administrator, System Manager, or a purpose-built admin role.

Do not rely on `/smart-accounting` and `/smart-grants` page guards alone for data
security. API methods must enforce the same boundary.

## Future Custom Platform Domains

For the future non-ERP system, avoid using one wide `Project` object for every
workflow. Prefer these domain objects:

- `Client`: identity, contacts, entities, portal access, relationship ownership.
- `Engagement`: signed or active client work for a fiscal year/month and product.
- `GrantApplication`: R&D/EMDG-specific workflow, evidence, dates, status, fees.
- `AccountingJob`: BAS/IAS/ITR/payroll/bookkeeping-specific workflow and due dates.
- `UserAssignment`: role-based work allocation independent of the job type.
- `ActivityEvent`: immutable audit trail for all user and automation changes.
- `AutomationRule`: admin-owned workflow rule with scoped triggers/actions.

This split keeps client data stable while allowing accounting and grants workflows
to evolve independently.
