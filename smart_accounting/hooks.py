"""
Smart Accounting - hooks.py
Version: 2.1 (UI Framework Added - 2026-01-04)
Based on: Document A v8.2, Document D v1.1
"""

app_name = "smart_accounting"
app_title = "Smart Accounting"
app_publisher = "Top Figures Pty Ltd"
app_description = "Smart Accounting SaaS Platform for Accounting Firms"
app_email = "Jeffrey@topfigures.com.au"
app_license = "mit"
app_version = "2.1.0"

# Required apps
# required_apps = []

# Home Page
# Set your home page route here (after implementing frontend)
# home_page = "/smart-board"

# App Include - 尽量不要全局注入页面级资源（保持架构健康）
# Smart Board 的 JS/CSS 会在 Desk Page `project_management` 内按需加载。

# Keep legacy URL stable (e.g. Cloudflare Tunnel / bookmarks)
website_redirects = [
    # Keep legacy URL stable (Cloudflare Tunnel / old shortcuts)
    {"source": r"/project_management(.*)", "target": r"/app/project-management\1"},
    # Also accept kebab-case direct entry
    {"source": r"/project-management(.*)", "target": r"/app/project-management\1"},
]

# DocType Class Overrides (Python)
override_doctype_class = {
    "Project": "smart_accounting.custom.project.CustomProject",
    "Project Type": "smart_accounting.overrides.project_type.SmartProjectType",
}

# Document Events
# Hook on document methods and events
# doc_events = {
#     "Project": {
#         "before_save": "smart_accounting.custom_methods.project.before_save"
#     }
# }

# Scheduled Tasks
#
# IMPORTANT (2026-05): only the hourly entry is scheduled.
# Reason: previously both `daily` and `hourly` ran the same date_reaches sweep,
# and at midnight Frappe dispatches the daily and the 00:00 hourly slot at the
# same time. Two workers would then race past the per-day cache guard and each
# fire `notify_someone`, producing duplicate in-app notifications for every
# matching project.
#
# `hourly` already runs at 00:00, so it fully covers what the daily entry used
# to do, and it gives us automatic catch-up if a single hour's run fails. The
# whitelisted `run_due_date_automations_daily` function is kept in
# `api/automation.py` for backward compatibility with manual `bench execute`
# invocations; it is just no longer auto-scheduled.
scheduler_events = {
    "daily": [
        # Smart Grants highlight automations (date-approaching / date-arrives).
        # Re-affirms highlights and auto-clears (Plan A) once per day at midnight.
        "smart_accounting.api.automation.run_grants_highlight_automations"
    ],
    "hourly": [
        "smart_accounting.api.automation.run_due_date_automations_hourly"
    ]
}

# Fixtures
# Export DocTypes and Custom Fields to fixtures for version control
fixtures = [
    # Roles used by Smart platform modules (so test/prod imports won't miss them)
    {
        "doctype": "Role",
        "filters": [
            ["name", "in", [
                "Smart Accounting User",
                "Smart Grants User"
            ]]
        ]
    },
    # Module-specific Project Type records required by website entrypoints and board routing
    {
        "doctype": "Project Type",
        "filters": [
            ["name", "in", [
                "Smart Grants",
                "Grants 2024",
                "Grants 2025",
                "Grants 2026",
                "Grants 2027"
            ]]
        ]
    },
    # Role permissions (customized via Role Permission Manager).
    # NOTE: We intentionally export only the permissions for Smart platform module roles
    # to avoid pulling unrelated system-wide permission customizations into this app.
    {
        "doctype": "Custom DocPerm",
        "filters": [
            ["role", "in", [
                "Smart Accounting User",
                "Smart Grants User"
            ]]
        ]
    },
    # Custom Fields for ERPNext native DocTypes
    {
        "doctype": "Custom Field",
        "filters": [
            ["dt", "in", [
                "Project",
                "Task", 
                "Customer",
                "Contact",
                "Project Type"
            ]]
        ]
    },
    # Property Setters for Select field options
    {
        "doctype": "Property Setter",
        "filters": [
            ["doc_type", "in", [
                "Project",
                "Task",
                "Customer", 
                "Contact",
                "Project Type"
            ]]
        ]
    },
    # Custom DocTypes
    {
        "doctype": "DocType",
        "filters": [
            ["name", "in", [
                "Software",
                "Saved View",
                "Customer Entity",
                "Monthly Status",
				"Project Team Member",
				"Project Software",
				"Board Automation",
				"Automation Run Log",
				"Automation Run Log Change"
            ]]
        ]
    }
]

# Override whitelisted methods
override_whitelisted_methods = {
    "frappe.client.insert": "smart_accounting.api.client_insert_override.insert"
}

# Access Control (Product shell hard-gate)
# External users will be redirected away from Desk (/app*) to /smart.
before_request = ["smart_accounting.access_control.before_request"]

# Installation
# before_install = "smart_accounting.setup.before_install"
# after_install = "smart_accounting.setup.after_install"
