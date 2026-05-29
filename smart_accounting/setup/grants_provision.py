from __future__ import annotations

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


SMART_ACCOUNTING_ROLE = "Smart Accounting User"
SMART_GRANTS_ROLE = "Smart Grants User"
SMART_GRANTS_PROJECT_TYPE = "Smart Grants"
# Per-year Smart Grants boards. Projects are grouped onto these boards by year.
SMART_GRANTS_YEAR_BOARDS = (
    "Grants 2024",
    "Grants 2025",
    "Grants 2026",
    "Grants 2027",
)
GRANTS_TEXT_DATE_FIELDS = (
    "custom_ap_submit_date",
    "custom_industry_approval_date",
    "custom_tax_lodgement_date",
)
GRANTS_LONG_TEXT_FIELDS = (
    "custom_grants_status",
)

PERMISSION_SOURCE_DOCTYPES = [
    "Company",
    "Contact",
    "Customer",
    "Fiscal Year",
    "Page",
    "Project",
    "Project Type",
    "Saved View",
    "Task",
]


def _ensure_role() -> None:
    if frappe.db.exists("Role", SMART_GRANTS_ROLE):
        return
    doc = frappe.get_doc(
        {
            "doctype": "Role",
            "role_name": SMART_GRANTS_ROLE,
            "desk_access": 1,
            "home_page": "/smart",
        }
    )
    doc.insert(ignore_permissions=True)


def _ensure_project_type() -> None:
    for pt in (SMART_GRANTS_PROJECT_TYPE, *SMART_GRANTS_YEAR_BOARDS):
        if frappe.db.exists("Project Type", pt):
            continue
        frappe.get_doc(
            {
                "doctype": "Project Type",
                "project_type": pt,
            }
        ).insert(ignore_permissions=True)


def _project_custom_fields() -> list[dict]:
    return [
        {
            "fieldname": "custom_grants_section",
            "label": "Grants",
            "fieldtype": "Section Break",
            "insert_after": "notes",
        },
        {
            "fieldname": "custom_grants_fy_label",
            "label": "FY/CY",
            "fieldtype": "Data",
            "insert_after": "custom_grants_section",
        },
        {
            "fieldname": "custom_grants_abn_snapshot",
            "label": "ABN",
            "fieldtype": "Data",
            "insert_after": "custom_grants_fy_label",
        },
        {
            "fieldname": "custom_grants_deliverer",
            "label": "Deliverer",
            "fieldtype": "Data",
            "insert_after": "custom_grants_abn_snapshot",
        },
        {
            "fieldname": "custom_grants_state",
            "label": "State",
            "fieldtype": "Data",
            "insert_after": "custom_grants_deliverer",
        },
        {
            "fieldname": "custom_grants_industry_category",
            "label": "Industry Category",
            "fieldtype": "Data",
            "insert_after": "custom_grants_state",
        },
        {
            "fieldname": "custom_grants_type",
            "label": "Grants Type",
            "fieldtype": "Select",
            "options": "R&DTI\nEMDG",
            "insert_after": "custom_grants_industry_category",
        },
        {
            "fieldname": "custom_grants_priority",
            "label": "Grants Priority",
            "fieldtype": "Select",
            "options": "Urgent\nHigh\nMedium\nLow",
            "insert_after": "custom_grants_type",
        },
        {
            "fieldname": "custom_grants_partner_label",
            "label": "Partner",
            "fieldtype": "Data",
            "insert_after": "custom_grants_priority",
        },
        {
            "fieldname": "custom_grants_referral_text",
            "label": "Referral",
            "fieldtype": "Data",
            "insert_after": "custom_grants_partner_label",
        },
        {
            "fieldname": "custom_grants_contact_section",
            "label": "Grants Contact",
            "fieldtype": "Section Break",
            "insert_after": "custom_grants_referral_text",
        },
        {
            "fieldname": "custom_grants_owner_name",
            "label": "Responsible Person",
            "fieldtype": "Data",
            "insert_after": "custom_grants_contact_section",
        },
        {
            "fieldname": "custom_grants_contact_name",
            "label": "Contact Name",
            "fieldtype": "Data",
            "insert_after": "custom_grants_owner_name",
        },
        {
            "fieldname": "custom_grants_address_snapshot",
            "label": "Address",
            "fieldtype": "Small Text",
            "insert_after": "custom_grants_contact_name",
        },
        {
            "fieldname": "custom_grants_primary_communication",
            "label": "Primary Communication",
            "fieldtype": "Small Text",
            "insert_after": "custom_grants_address_snapshot",
        },
        {
            "fieldname": "custom_grants_progress_section",
            "label": "Grants Progress",
            "fieldtype": "Section Break",
            "insert_after": "custom_grants_primary_communication",
        },
        {
            "fieldname": "custom_grants_status",
            "label": "Application Progress",
            "fieldtype": "Long Text",
            "insert_after": "custom_grants_progress_section",
        },
        {
            "fieldname": "custom_ap_submit_date",
            "label": "AP Submit Date",
            "fieldtype": "Data",
            "insert_after": "custom_grants_status",
        },
        {
            "fieldname": "custom_industry_approval_date",
            "label": "Industry Approval Date",
            "fieldtype": "Data",
            "insert_after": "custom_ap_submit_date",
        },
        {
            "fieldname": "custom_tax_lodgement_date",
            "label": "Tax Lodgement Date",
            "fieldtype": "Data",
            "insert_after": "custom_industry_approval_date",
        },
        {
            "fieldname": "custom_rebate_amount_text",
            "label": "Rebate Amount",
            "fieldtype": "Data",
            "insert_after": "custom_tax_lodgement_date",
        },
        {
            "fieldname": "custom_fee_percentage_text",
            "label": "Fee Percentage",
            "fieldtype": "Data",
            "insert_after": "custom_rebate_amount_text",
        },
        {
            "fieldname": "custom_portal_access_expiry_date",
            "label": "Portal Access Expiry Date",
            "fieldtype": "Date",
            "insert_after": "custom_fee_percentage_text",
        },
    ]


def _force_project_fieldtype_to_data(fieldname: str, length: int = 140) -> None:
    fieldname = str(fieldname or "").strip()
    if not fieldname:
        return
    custom_field_name = f"Project-{fieldname}"
    if not frappe.db.exists("Custom Field", custom_field_name):
        return

    current_type = str(frappe.db.get_value("Custom Field", custom_field_name, "fieldtype") or "").strip()
    if current_type != "Date":
        return

    rows = frappe.db.sql(f"SHOW COLUMNS FROM `tabProject` LIKE %s", (fieldname,), as_dict=True) or []
    current_column_type = str((rows[0] or {}).get("Type") or "").strip().lower() if rows else ""
    if "varchar" not in current_column_type:
        frappe.db.sql(f"ALTER TABLE `tabProject` MODIFY COLUMN `{fieldname}` varchar({int(length or 140)})")
    frappe.db.set_value(
        "Custom Field",
        custom_field_name,
        {
            "fieldtype": "Data",
            "length": int(length or 140),
        },
        update_modified=False,
    )


def sync_grants_text_date_field_metadata() -> dict:
    for fieldname in GRANTS_TEXT_DATE_FIELDS:
        custom_field_name = f"Project-{fieldname}"
        if not frappe.db.exists("Custom Field", custom_field_name):
            continue
        frappe.db.set_value(
            "Custom Field",
            custom_field_name,
            {
                "fieldtype": "Data",
                "length": 140,
            },
            update_modified=False,
        )
    frappe.clear_cache(doctype="Project")
    return {"updated_fields": list(GRANTS_TEXT_DATE_FIELDS)}


def sync_grants_long_text_field_metadata() -> dict:
    for fieldname in GRANTS_LONG_TEXT_FIELDS:
        custom_field_name = f"Project-{fieldname}"
        if not frappe.db.exists("Custom Field", custom_field_name):
            continue
        frappe.db.set_value(
            "Custom Field",
            custom_field_name,
            {
                "fieldtype": "Long Text",
            },
            update_modified=False,
        )
    frappe.clear_cache(doctype="Project")
    return {"updated_fields": list(GRANTS_LONG_TEXT_FIELDS)}


def _ensure_custom_fields() -> None:
    for fieldname in GRANTS_TEXT_DATE_FIELDS:
        _force_project_fieldtype_to_data(fieldname)
    create_custom_fields({"Project": _project_custom_fields()}, update=True)


def _permission_rows_for(role: str) -> set[tuple[str, int]]:
    rows = frappe.get_all(
        "Custom DocPerm",
        filters={"role": role},
        fields=["parent", "permlevel"],
        limit_page_length=500,
    )
    return {
        (str(row.get("parent") or "").strip(), int(row.get("permlevel") or 0))
        for row in (rows or [])
        if str(row.get("parent") or "").strip()
    }


def _clone_docperms() -> None:
    source_rows = frappe.get_all(
        "Custom DocPerm",
        filters={
            "role": SMART_ACCOUNTING_ROLE,
            "parent": ["in", PERMISSION_SOURCE_DOCTYPES],
        },
        fields=[
            "parent",
            "permlevel",
            "read",
            "write",
            "create",
            "delete",
            "submit",
            "cancel",
            "amend",
            "report",
            "export",
            "import",
            "share",
            "print",
            "email",
            "select",
            "if_owner",
        ],
        order_by="parent asc, permlevel asc",
        limit_page_length=500,
    )
    existing = _permission_rows_for(SMART_GRANTS_ROLE)

    for row in source_rows or []:
        parent = str(row.get("parent") or "").strip()
        permlevel = int(row.get("permlevel") or 0)
        if not parent or (parent, permlevel) in existing:
            continue

        doc = frappe.new_doc("Custom DocPerm")
        doc.parent = parent
        doc.role = SMART_GRANTS_ROLE
        doc.permlevel = permlevel
        for key in (
            "read",
            "write",
            "create",
            "delete",
            "submit",
            "cancel",
            "amend",
            "report",
            "export",
            "import",
            "share",
            "print",
            "email",
            "select",
            "if_owner",
        ):
            setattr(doc, key, int(row.get(key) or 0))
        doc.insert(ignore_permissions=True)
        existing.add((parent, permlevel))


def provision() -> dict:
    _ensure_role()
    _ensure_project_type()
    _ensure_custom_fields()
    _clone_docperms()
    frappe.clear_cache(doctype="Project")
    frappe.clear_cache(doctype="Project Type")
    return {
        "role": SMART_GRANTS_ROLE,
        "project_type": SMART_GRANTS_PROJECT_TYPE,
        "custom_fields": [d["fieldname"] for d in _project_custom_fields() if d.get("fieldtype") != "Section Break"],
        "permission_doctypes": PERMISSION_SOURCE_DOCTYPES,
    }
