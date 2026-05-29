/**
 * Smart Board - Constants
 * 全局常量配置
 */

// Project Types（Sidebar 会从系统实时读取 Project Type 列表）
// 这里仅保留“显示层”的 icon 映射与空态建议，不再写死具体有哪些业务类型
export const PROJECT_TYPE_ICONS = {
    'ITR': 'clipboard',
    'BAS': 'clipboard',
    'Payroll': 'clipboard',
    'Bookkeeping': 'clipboard',
    'R&D Grant': 'clipboard',
    'Grants': 'clipboard',
    'Smart Grants': 'clipboard',
    'Grants 2024': 'clipboard',
    'Grants 2025': 'clipboard',
    'Grants 2026': 'clipboard',
    'Grants 2027': 'clipboard',
    'SMSF': 'clipboard',
    'Audit': 'clipboard',
    'Financial Statements': 'clipboard'
};

export const DEFAULT_PROJECT_TYPE_ICON = 'clipboard';

// Status 配置（DEPRECATED）
// - Status 选项（可选值）应以“单一真相”为准：来自后端 DocType meta（Project.status options，包含 Property Setter）。
// - Smart Board 还支持按 Project Type（Board）配置“允许的子集”，见 Board Status Settings。
// - 该常量仅保留作历史参考/兼容文档，不应在运行时使用。
export const STATUS_OPTIONS = {
    'ITR': [
        'Not Started',
        'Working',
        'Ready for Review',
        'Under Review',
        'Completed',
        'Cancelled'
    ],
    'BAS': [
        'Not Started',
        'Working',
        'Ready for Review',
        'Query from ATO',
        'Resubmit',
        'Completed',
        'Cancelled'
    ],
    'Bookkeeping': [
        'Not Started',
        'Working',
        'Completed',
        'Cancelled'
    ],
    'R&D Grant': [
        'Not Started',
        'Working',
        'Partner Review',
        'Under Review',
        'Query from AusIndustry',
        'Resubmit',
        'Approved',
        'Completed',
        'Cancelled'
    ],
    'DEFAULT': [
        'Not Started',
        'Working',
        'Ready for Review',
        'Under Review',
        'Completed',
        'Cancelled'
    ]
};

// Status 颜色映射
export const STATUS_COLORS = {
    // New global status pool (2026-02)
    'Not started': '#6b7280', // slate/gray
    'Not started yet': '#6b7280', // task pool
    'Not applicable': '#0ea5e9', // cyan-blue for clear distinction
    'Not Applicable': '#0ea5e9',
    'Working on it': '#f59e0b', // amber
    'Stuck': '#ef4444', // task pool (red)
    'Waiting for client': '#a855f7', // purple
    'R&D': '#06b6d4', // cyan

    // R&D workflow statuses (2026-04)
    'Waiting for tech meeting': '#c084fc', // light purple
    'Waiting for tech evidence': '#a78bfa', // lavender
    'Preparing R&D report': '#0d9488', // teal
    'Waiting for report review and signature': '#7c3aed', // deep violet
    'Preparing application form': '#14b8a6', // mint teal
    'Waiting for AP review': '#6d28d9', // dark purple
    'Waiting for financial accounts': '#d946ef', // fuchsia
    'Preparing R&D exp calculation': '#0891b2', // dark cyan
    'Waiting for responses to fin queries': '#ec4899', // pink
    'Final pack prep': '#84cc16', // lime (near completion)

    'Ready for manager review': '#3b82f6', // blue
    'Review points to be actioned': '#ef4444', // red
    'Ready for partner review': '#6366f1', // indigo
    'Ready to send to client': '#0ea5e9', // sky
    'Sent to client for signature': '#8b5cf6', // violet
    'Hold': '#64748b', // slate
    'Waiting of payment': '#ca8a04', // dark yellow
    'Completed': '#22c55e', // green
    'Lodged': '#22c55e', // legacy alias
    'Done': '#16a34a', // legacy alias

    // Legacy statuses (kept for backward compatibility)
    'Not Started': '#6c757d',
    'Open': '#6c757d',
    'Working': '#007bff',
    'Ready for Review': '#ffc107',
    'Under Review': '#17a2b8',
    'Partner Review': '#17a2b8',
    'Query from ATO': '#fd7e14',
    'Query from AusIndustry': '#fd7e14',
    'Resubmit': '#dc3545',
    'Approved': '#28a745',
    'Cancelled': '#6c757d'
};

// Frequency 选项
export const FREQUENCY_OPTIONS = [
    'One-off',
    'Monthly',
    'Quarterly',
    'Yearly'
];

// Role 选项
export const ROLE_OPTIONS = [
    'Preparer',
    'Manager',
    'Partner'
];

// Project 字段列目录（用于 Columns Manager 的“可选列池”）
// - 不依赖具体 project_type，方便未来租户自定义 Project Type
// - 仅包含“Project 可能用到”的核心字段（来自 docs/A + docs/E + 现有 ProjectService）
export const PROJECT_COLUMN_CATALOG = [
    // Core identifiers
    { field: 'project_name', label: 'Project Name', width: 260 },
    { field: 'customer', label: 'Client Name', width: 200, frozen: true },
    { field: 'custom_entity_type', label: 'Entity', width: 160 },
    // Optional (advanced): explicit entity selection (usually auto/hidden in UI)
    { field: 'custom_customer_entity', label: 'Client Entity', width: 200, hidden: true },

    // Components (computed/virtual)
    { field: '__sb_project_monthly_completion', label: 'Monthly Completion (12M)', width: 110 },

    // Classification / workflow
    { field: 'project_type', label: 'Project Type', width: 150 },
    { field: 'company', label: 'Company', width: 120 },
    { field: 'status', label: 'Status', width: 150 },
    { field: 'priority', label: 'Priority', width: 120 },

    // Team & tools
    { field: 'custom_softwares', label: 'Software', width: 160 },
    { field: 'custom_engagement_letter', label: 'Engagement Letter', width: 200 },

    // Dates / planning
    { field: 'expected_end_date', label: 'End Date', width: 130 },
    { field: 'custom_lodgement_due_date', label: 'Lodgement Due', width: 140 },

    // Periodicity / accounting specifics (docs confirmed)
    { field: 'custom_project_frequency', label: 'Frequency', width: 120 },
    { field: 'custom_target_month', label: 'Target Month', width: 130 },
    { field: 'custom_fiscal_year', label: 'Fiscal Year', width: 120 },
    { field: 'custom_year_end', label: 'Year End', width: 120 },
    { field: 'custom_grants_fy_label', label: 'FY/CY', width: 120 },
    { field: 'custom_grants_abn_snapshot', label: 'ABN', width: 140 },
    { field: 'custom_grants_deliverer', label: 'Deliverer', width: 150 },
    { field: 'custom_grants_state', label: 'State', width: 120 },
    { field: 'custom_grants_industry_category', label: 'Industry Category', width: 180 },
    { field: 'custom_grants_type', label: 'Grants Type', width: 150 },
    { field: 'custom_grants_priority', label: 'Grants Priority', width: 150 },
    { field: 'custom_grants_partner_label', label: 'Partner', width: 140 },
    { field: 'custom_grants_referral_text', label: 'Referral', width: 160 },
    { field: 'custom_grants_owner_name', label: 'Responsible Person', width: 160 },
    { field: 'custom_grants_address_snapshot', label: 'Address', width: 220 },
    { field: 'custom_grants_contact_name', label: 'Contact Name', width: 180 },
    { field: 'custom_grants_primary_communication', label: 'Primary Communication', width: 220 },
    { field: 'custom_grants_status', label: 'Application Progress', width: 180 },
    { field: 'custom_tg_tax_agent', label: 'TG Tax Agent', width: 130 },
    { field: 'custom_portal_access_received', label: 'Portal Access Received', width: 180 },
    { field: 'custom_ap_submit_date', label: 'AP Submit Date', width: 140 },
    { field: 'custom_industry_approval_date', label: 'Industry Approval Date', width: 170 },
    { field: 'custom_tax_lodgement_date', label: 'Tax Lodgement Date', width: 170 },
    { field: 'custom_rebate_amount_text', label: 'Rebate Amount', width: 150 },
    { field: 'custom_fee_percentage_text', label: 'Fee Percentage', width: 140 },
    { field: 'custom_reset_date', label: 'Reset Date', width: 130 },
    { field: 'custom_ato_status', label: 'ATO Status', width: 140 },
    { field: 'custom_lodgeit_status', label: 'LodgeIT Status', width: 150 },
    { field: 'custom_company_agent_status', label: 'Company Agent Status', width: 190 },
    { field: 'custom_xeroquickbooks_status', label: 'Xero/QuickBooks Status', width: 190 },

    // Money / notes / archive
    { field: 'estimated_costing', label: 'Budget', width: 120 },
    { field: 'notes', label: 'Notes', width: 260 },
    // "Active" is primarily a filter dimension; hide it from Columns Manager by default.
    // Keep it here for backward compatibility with Saved Views that may already reference it.
    { field: 'is_active', label: 'Active', width: 90, hidden: true },

    // Meta
    { field: 'modified', label: 'Last Updated', width: 150 }
];

// Sort capability boundary:
// - Sort should only expose SQL-safe Project columns that are genuinely useful to end users.
// - Do NOT treat every visible/display column as sortable. Hydrated/child-table/attachment-style
//   fields such as custom_softwares may render fine in the board but are not safe ORDER BY targets.
export const SORTABLE_PROJECT_FIELDS = new Set([
    'creation',
    'project_name',
    'customer',
    'project_type',
    'company',
    'status',
    'priority',
    'expected_end_date',
    'custom_lodgement_due_date',
    'custom_project_frequency',
    'custom_target_month',
    'custom_fiscal_year',
    'custom_year_end',
    'custom_grants_fy_label',
    'custom_grants_deliverer',
    'custom_grants_state',
    'custom_grants_industry_category',
    'custom_grants_type',
    'custom_grants_priority',
    'custom_grants_partner_label',
    'custom_grants_owner_name',
    'custom_grants_status',
    'custom_ap_submit_date',
    'custom_industry_approval_date',
    'custom_tax_lodgement_date',
    'custom_reset_date',
    'custom_ato_status',
    'custom_lodgeit_status',
    'custom_company_agent_status',
    'custom_xeroquickbooks_status',
    'estimated_costing',
    'modified',
]);

export function isSortableProjectField(field) {
    const f = String(field || '').trim();
    return !!f && SORTABLE_PROJECT_FIELDS.has(f);
}

// Shared default columns for all Smart Grants boards (Smart Grants + per-year boards).
// Returns a fresh array each call so different boards never share a mutable reference.
function makeGrantsDefaultColumns() {
    return [
        { field: 'project_name', label: 'Company Name', width: 240, frozen: true },
        { field: 'project_type', label: 'Board', width: 140 },
        { field: 'custom_grants_fy_label', label: 'FY/CY', width: 120 },
        { field: 'custom_grants_abn_snapshot', label: 'ABN', width: 140 },
        { field: 'custom_grants_deliverer', label: 'Deliverer', width: 150 },
        { field: 'custom_grants_state', label: 'State', width: 120 },
        { field: 'custom_grants_industry_category', label: 'Industry', width: 180 },
        { field: 'custom_grants_partner_label', label: 'Partner', width: 140 },
        { field: 'custom_grants_referral_text', label: 'Referral', width: 160 },
        { field: 'custom_grants_owner_name', label: 'Responsible', width: 160 },
        { field: 'custom_grants_contact_name', label: 'Contact', width: 180 },
        { field: 'custom_grants_primary_communication', label: 'Communication', width: 220 },
        { field: 'custom_grants_status', label: 'Progress', width: 180 },
        { field: 'custom_tg_tax_agent', label: 'TG Tax Agent', width: 130 },
        { field: 'custom_portal_access_received', label: 'Portal Access Received', width: 180 },
        { field: 'custom_ap_submit_date', label: 'AP Submit', width: 140 },
        { field: 'custom_industry_approval_date', label: 'Industry Approval', width: 170 },
        { field: 'custom_tax_lodgement_date', label: 'Tax Lodgement', width: 170 },
        { field: 'custom_rebate_amount_text', label: 'Rebate', width: 150 },
        { field: 'custom_fee_percentage_text', label: 'Fee %', width: 130 },
        { field: 'modified', label: 'Last Updated', width: 160 }
    ];
}

// 默认列配置（按 project_type）
export const DEFAULT_COLUMNS = {
    'ITR': [
        { field: 'customer', label: 'Client Name', width: 200, frozen: true },
        { field: 'custom_entity_type', label: 'Entity', width: 150 },
        { field: 'company', label: 'TF/TG', width: 80 },
        { field: 'custom_softwares', label: 'Software', width: 120 },
        { field: 'status', label: 'Status', width: 150 },
        { field: 'custom_lodgement_due_date', label: 'Due Date', width: 120 },
        { field: 'notes', label: 'Notes', width: 250 }
    ],
    'BAS': [
        { field: 'customer', label: 'Client Name', width: 200, frozen: true },
        { field: 'custom_entity_type', label: 'Entity', width: 150 },
        { field: 'company', label: 'TF/TG', width: 80 },
        { field: 'custom_softwares', label: 'Software', width: 120 },
        { field: 'status', label: 'Status', width: 150 },
        { field: 'custom_project_frequency', label: 'Frequency', width: 100 },
        { field: 'custom_target_month', label: 'Target Month', width: 120 },
        { field: 'custom_lodgement_due_date', label: 'Due Date', width: 120 },
        { field: 'notes', label: 'Notes', width: 250 }
    ],
    'Payroll': [
        { field: 'customer', label: 'Client Name', width: 200, frozen: true },
        { field: 'company', label: 'TF/TG', width: 80 },
        { field: 'custom_softwares', label: 'Software', width: 120 },
        { field: 'status', label: 'Status', width: 150 },
        { field: 'custom_project_frequency', label: 'Frequency', width: 100 },
        { field: 'expected_end_date', label: 'Process Date', width: 120 },
        { field: 'notes', label: 'Notes', width: 250 }
    ],
    'Bookkeeping': [
        { field: 'customer', label: 'Client Name', width: 200, frozen: true },
        { field: 'company', label: 'TF/TG', width: 80 },
        { field: 'custom_softwares', label: 'Software', width: 120 },
        { field: 'status', label: 'Status', width: 150 },
        { field: 'custom_project_frequency', label: 'Frequency', width: 100 },
        { field: 'notes', label: 'Notes', width: 250 }
    ],
    'Client Information Update': [
        { field: 'customer', label: 'Client Name', width: 220, frozen: true },
        { field: 'project_name', label: 'Project Name', width: 240 },
        { field: 'custom_ato_status', label: 'ATO', width: 140 },
        { field: 'custom_lodgeit_status', label: 'LodgeIT', width: 150 },
        { field: 'custom_company_agent_status', label: 'Company Agent', width: 190 },
        { field: 'custom_xeroquickbooks_status', label: 'Xero/QuickBooks', width: 200 },
        { field: 'custom_year_end', label: 'Year End', width: 120 },
        { field: 'custom_fiscal_year', label: 'Fiscal Year', width: 130 },
        { field: 'status', label: 'Status', width: 150 },
        { field: 'modified', label: 'Last Updated', width: 160 }
    ],
    'Smart Grants': makeGrantsDefaultColumns(),
    'Grants 2024': makeGrantsDefaultColumns(),
    'Grants 2025': makeGrantsDefaultColumns(),
    'Grants 2026': makeGrantsDefaultColumns(),
    'Grants 2027': makeGrantsDefaultColumns(),
    'DEFAULT': [
        { field: 'customer', label: 'Client Name', width: 200, frozen: true },
        { field: 'project_name', label: 'Project Name', width: 250 },
        { field: 'status', label: 'Status', width: 150 },
        { field: 'expected_end_date', label: 'Due Date', width: 120 },
        { field: 'notes', label: 'Notes', width: 250 }
    ]
};

// API 端点
export const API_ENDPOINTS = {
    PROJECTS: '/api/resource/Project',
    SAVED_VIEWS: '/api/resource/Saved View',
    USERS: '/api/resource/User',
    CUSTOMERS: '/api/resource/Customer'
};

// 本地存储键名
export const STORAGE_KEYS = {
    COLUMN_WIDTHS: 'smart_board_column_widths',
    LAST_VIEW: 'smart_board_last_view',
    USER_PREFERENCES: 'smart_board_user_preferences'
};

// 分页配置
export const PAGINATION = {
    DEFAULT_PAGE_SIZE: 50,
    PAGE_SIZE_OPTIONS: [20, 50, 100, 200]
};

