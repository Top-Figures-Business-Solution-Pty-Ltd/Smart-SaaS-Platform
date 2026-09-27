# Smart Accounting / Smart Grants — 项目完整信息包（FY26）

**用途：** 交给注册 R&D 顾问 / 税代拆分与撰写申请。本文是**项目全部信息**，不是已经砍过的申报口径。  
**期间：** 2025-07-01 至 2026-06-30（澳大利亚 FY26）  
**仓库：** `/home/jeffrey/frappe-bench/apps/smart_accounting`（Frappe app `smart_accounting`）  
**编写日期：** 2026-08-21  
**性质：** 内部技术事实稿。不是报税意见、不是已递交申请。

开发者 git 作者：`J3ffr33y` `<zigengwang464@gmail.com>`（FY26 内 323 次提交）。另有 Project Manager 与测试人员，工时在 git 外的 timesheet。

---

# A. 主体、产品与商业背景

## A1. 公司与产品名

| 项 | 内容 |
|---|---|
| 申请主体 | Top Figures Pty Ltd |
| 联系 | Jeffrey@topfigures.com.au |
| 产品 | Smart Accounting / Smart Grants |
| 内部公司实体 | **TF** = Top Figures（会计所作业）；**TG** = Top Grants（Grants / R&DTI 案件） |
| 技术底座 | Frappe Framework + ERPNext（bench：`frappe-bench`，apps：`frappe`、`erpnext`、`smart_accounting`） |
| License | MIT（`hooks.py` `app_license = "mit"`） |
| hooks 版本 | 2.1.0（`__init__.py` 仍为 `0.0.1`，以 hooks 为准） |
| 发布者（pyproject） | Top Figures Pty Ltd |

同一 Frappe Site 上用 ERPNext **Company** 区分 TF/TG，再用 User Permissions 限制可见范围。设计上未来可走 Frappe 多 Site SaaS（每租户一个 Site），FY26 实际是单 Site 多 Company。

## A2. 要解决的业务问题

澳大利亚会计事务所需要一张类似 Monday.com 的作业表，覆盖：

- 所得税申报 **ITR**
- **BAS** / **IAS**（含季度法定到期、月度 IAS 与季度 BAS 重叠）
- **Payroll & Super**（历史上还有 Payroll、Payday Super、独立 Super board，后来合并/删除）
- **Bookkeeping**（含 12 个月 Monthly Status 网格）
- **Client Information Update**
- Ad-hoc 任务
- 第二套产品：**Smart Grants**（R&DTI / EMDG 案件，按财年 board：FY 2024–FY 2027）

两套产品共享客户（Customer）和项目文档（Project），但不能共享状态池、列、自动化词汇。

## A3. 产品入口

| URL | 作用 |
|---|---|
| `/smart` | 模块选择器（Accounting / Grants 卡片，按角色显示；denied 提示） |
| `/smart/login` | 品牌登录 |
| `/smart/logout` | 登出后回 login，不进 Desk |
| `/smart/forgot-password` | 重置密码（不暴露邮箱是否存在） |
| `/smart/signup` | SaaS 注册占位，受 `smart_saas_public_enabled` 控制 |
| `/smart-accounting` | 会计产品壳，挂载 Smart Board SPA |
| `/smart-grants` | Grants 产品壳，同一 SPA，`module_key=grants`，默认进 FY 2024 |
| `/app`、`/app/*` | ERPNext Desk。非 Administrator / System Manager（及可选白名单）会被打回 `/smart` |
| `/app/project-management` | 内部 Desk Page，同一套前端（legacy） |
| 旧路径 | `/project_management`、`/project-management` 重定向到 Desk page |

**Accounting 壳排除的 Project Type：** Smart Grants、FY 2024–2027、Archived (Holding)  
**Grants 壳允许的 Project Type：** FY 2024–2027  
**Grants 允许的产品视图：** clients, users, client-projects, archived-clients, archived-projects, settings（无 Dashboard / Report / Automation Logs，由配置关掉）

---

# B. 技术架构（全部）

## B1. 分层

前端：原生 ES Modules SPA（不引入 React/Vue）。构建走 bench/esbuild，输出到 `/assets/smart_accounting/js/smart_board/*`。

依赖方向（架构契约强制）：

```
components/pages → controllers → services → backend api/*
        │                │
        ├──→ store ──────┤
        └──→ utils
```

禁止：services → components；utils → services/components；store → components。

后端：

- `api/*.py`：website-safe 白名单方法
- `custom/project.py`：`CustomProject` 覆盖 ERPNext Project
- `custom/customer.py`：Portal Access 从 Customer 扇出到全部 Project
- `overrides/project_type.py`：删除 Project Type 时项目进 `Archived (Holding)`
- `access_control.py`：`before_request` 硬门
- `setup/grants_provision.py`：角色、年 board、Grants 字段
- `patches/`：16 个 migrate 脚本
- `fixtures/`：Role、Project Type、Custom Field、Property Setter、Custom DocPerm、自定义 DocType

## B2. 前端目录职责

| 路径 | 职责 |
|---|---|
| `index.js` | `show_smart_board` / `hide_smart_board` |
| `app.js` | URL state、视图切换、模块限制、性能埋点（约 987 行，膨胀点） |
| `columns/` | 列 registry + project/task specs |
| `components/Layout/` | Sidebar、Header、MainContent、headerToolbars |
| `components/BoardView/` | BoardTable（约 2231 行）及全部 board modal |
| `components/ClientsView/` | 客户表、新建/编辑、Client Projects |
| `components/UsersView/` | 用户列表、表单、改密 |
| `components/SettingsView/` | 资料、改密、实体同步工具 |
| `components/ActivityLogView/` | 全局活动 |
| `components/AutomationLogsView/` | 自动化运行日志 |
| `components/ReportView/` | Daily/Weekly/Monthly **占位**（无真实 KPI API） |
| `controllers/` | 新建项目/客户、自动化、board settings、status、通知、mention、entity/frequency/type 变更 |
| `services/` | projectService（Query/Command/MonthlyStatus Facade）、view、clients、notifications、boardStatus、api、uiAdapter |
| `store/modules/` | projects、filters、views、dashboard、clients |
| `utils/` | constants、csvExport、moduleConfig、urlState、viewTypes、authz、perf（`?sb_perf=1`） |

CSS：`main.css`（变量）、`layout.css`、`board.css`、`components.css`。

## B3. 后端体量（FY26 末附近）

| 文件 | 约行数 | 内容 |
|---|---|---|
| `api/project_board.py` | ~3110 | 列表、hydration、task、bulk、dashboard、搜索、默认 Saved View |
| `custom/project.py` | ~1700 | 状态、portal、自动化执行、活动、BAS/IAS 日期 |
| `api/automation.py` | ~799 | 规则 CRUD + 调度器 |
| `api/clients.py` | ~825 | 客户 CRUD/归档 |
| `api/project_rollover.py` | ~458 | Roll Over |
| 前端 JS 合计 | ~25239 | Smart Board |

## B4. site_config / Frappe defaults

| Key | 作用 |
|---|---|
| `smart_desk_access_mode` | `config`（默认）或 `admin_only` |
| `smart_desk_allow_roles` | 额外允许进 Desk 的角色 |
| `smart_desk_allow_users` | 额外允许进 Desk 的用户 |
| `smart_brand_name` / `smart_brand_tagline` | 品牌 |
| `smart_saas_public_enabled` | 是否显示注册 |
| `smart_accounting_project_type_order` | 侧栏 board 顺序 JSON |
| `smart_accounting_project_type_status_config` | 每 board 允许的 status 子集 |
| `smart_accounting_special_rule_monthly_ias_defer` | IAS 月度避开 BAS 季度月（未设则默认开） |

Desk 规则：Guest 否；Administrator 是；System Manager 是；`admin_only` 时其他人否；否则看用户/角色白名单。

产品路径未登录 → `/smart/login?redirect-to=`。无 Accounting 角色进 `/smart-accounting*` → `?denied=accounting`。无 Grants 角色同理。

`frappe.Redirect` 在 `init_request` 里会变 traceback，因此用 Werkzeug `abort(Response)` 做跳转。

覆盖：`frappe.client.insert` → `client_insert_override.insert`（/smart 下 Customer 名解析兼容）。

## B5. 调度器

- **hourly：** `run_due_date_automations_hourly`（会计 date_reaches 等）
- **daily：** `run_grants_highlight_automations`（Grants 高亮）
- **已停：** daily 的 due-date 扫描。原因：Frappe 午夜同时跑 `daily` 和 00:00 `hourly`，两个 worker 穿过 per-day cache，对每个匹配项目重复 `notify_someone`。

---

# C. 数据模型（全部字段与 DocType）

## C1. 策略演变

**v1（2024–2025，已废弃）：** 自定义 DocType 当棋盘（Partition、Engagement、Board Column/Cell 等）。

**v2.0（2025-12-16 Clean Slate）：** 最大化 ERPNext 原生 Project/Task/Customer/Contact/Project Type；只新建少量 DocType。删除 15+ 自定义类型、390+ 文件。

**Clean Slate 删除的 DocType：** Partition, Engagement, User Preferences, Task Role Assignment, Task Software, Customer Company Tag, Board Column, Board Cell, Service Line, Review Note, Client Group, Combination View, Combination View Board, Task Communication Method, Contact Social, Referral Person。

## C2. 自定义 DocType（现存 9 个）

**Software：** software_name, is_active, 树字段（lft/rgt/is_group/parent_software）

**Saved View：** title, reference_doctype, project_type, columns JSON, filters JSON, sort_by, sort_order (asc/desc), is_default, is_active, scope (Personal/Shared), sidebar_order。每 board 只允许一个 Shared 默认视图（服务端 find-or-create + dedupe patch）。

**Customer Entity（子表）：** entity_name；entity_type = Individual / Company / Partnership / Trust / Other Incorporated Entity；abn；year_end = 月；is_primary。

**Monthly Status：** reference_doctype + reference_name；project；fiscal_year；status = Not Started / Working On It / Stuck / Done；month_index。用于 Task 12 月网格 + Project 汇总（Done x/y · %）。

**Project Team Member（子表）：** user；role = Preparer / Manager / Partner / Assigned Person；assigned_date。曾用 Reviewer，patch 改为 Manager。

**Project Software（子表）：** software → Software。

**Board Automation：** enabled, automation_name, trigger_type（legacy Select，运行时读 JSON）, trigger_config JSON, actions JSON, execution_count, last_triggered。

**Automation Run Log：** run_id, automation, names, project, triggered_at, execution_source = Validate / Hourly Scheduler / Daily Scheduler / Manual / Other, result = Success / No Change / Skipped / Failed, matched_triggers, actions_attempted, message, changed_field_count, error_details, changes 子表, project_type。

**Automation Run Log Change：** fieldname, field_label, action_type, from_value, to_value。

## C3. Custom Fields — Contact（3）

custom_is_referrer (Check), custom_social_accounts (JSON), is_billing_contact (Check)

## C4. Custom Fields — Customer（6）

custom_referred_by (Link), custom_entities (Table → Customer Entity), custom_partner (Link → User), Grants Portal 分区, custom_portal_access_received (Check), custom_portal_access_expiry_date (Date)

Portal 以 Customer 为源，on_update 扇出到该客户全部 Project。

## C5. Custom Fields — Task（4）

custom_fiscal_year, custom_period, custom_task_members (Table → Project Team Member), auto_repeat

Task.status 池：Not started yet / Working on it / Stuck / Done

## C6. Custom Fields — Project（45+）

**作业/会计：** custom_fiscal_year, custom_target_month (Select 空+Jan–Dec), custom_project_frequency (Yearly, Half-Yearly, Quarterly, Monthly, Fortnightly, Weekly, One-off), custom_engagement_letter (Attach), custom_reset_date, custom_year_end (Select 空+月), custom_archive_source (Manual / Automation / Client Archive), custom_archive_source_ref, custom_entity_type (展示用 Data), custom_team_members, custom_lodgement_due_date, custom_softwares (Table MultiSelect), custom_customer_entity, custom_ato_status / custom_lodgeit_status / custom_company_agent_status / custom_xeroquickbooks_status（Not started / Not applicable / Done）, auto_repeat

**Grants：** custom_grants_fy_label (FY/CY), custom_engagement_date, custom_grants_abn_snapshot, custom_grants_state, custom_grants_industry_category, custom_grants_type (R&DTI / EMDG), custom_grants_priority (`-` / S1–S4，`-` 表示无优先级以免新建被强制 S1), custom_grants_salesperson, custom_grants_partner_label, custom_grants_referral_text, custom_grants_owner_name, custom_grants_contact_name, custom_grants_address_snapshot, custom_grants_primary_communication, custom_grants_status (Long Text 进度), custom_ap_submit_date / custom_industry_approval_date / custom_tax_lodgement_date（文本日期）, custom_rebate_amount_text, custom_fee_percentage_text, custom_fee_arrangement, custom_portal_access_received, custom_tg_tax_agent, custom_portal_access_expiry_date, custom_board_row_highlight, custom_board_row_highlight_by（隐藏，高亮归属）

另有 fixtures 里的 `custom_grants_section` 等 Section Break。

## C7. Project.status 全局池（Property Setter）

Not started; Working on it; Waiting for client; R&D; Waiting for tech meeting; Waiting for tech evidence; Preparing R&D report; Waiting for report review and signature; Preparing application form; Waiting for AP review; Waiting for financial accounts; Preparing R&D exp calculation; Waiting for responses to fin queries; Final pack prep; Ready for manager review; Review points to be actioned; Ready for partner review; Ready to send to client; Sent to client for signature; Hold; Waiting for CTR; Waiting for payment; Not to Proceed; Completed

默认：Not started。ERPNext 原默认 Open 已去掉；API 插入若落到 Open 会在 `before_insert` 强制改成 Not started。

R&D 工作流那一串状态**只作用于 Smart Grants boards**（board-level subset）。会计 board 用作业向状态。`Not to Proceed` 只给 Grants。历史别名：Done / Lodged → Completed；Waiting of payment 错字 → Waiting for payment。

Board Settings API 再切「该 board 允许哪些 status」。

## C8. 角色与权限

产品角色：

- Smart Accounting User — home `/smart`，进 `/smart-accounting`
- Smart Grants User — 进 `/smart-grants`；权限从 Accounting 角色克隆到 Company/Contact/Customer/Fiscal Year/Page/Project/Project Type/Saved View/Task

两角色对上述 DocType 的 Custom DocPerm 大体：Project/Task/Customer/Saved View 可 CRUD+export（Project 还 import）；Contact/Fiscal Year/Page 只读+export；Company 读写创建；Project Type 读写创建。

作业角色（单元格）：Preparer, Manager, Partner。

## C9. Project Type / Board 清单（设计 + 代码）

图标映射中出现：ITR, BAS, Payroll, Payroll & Super, Bookkeeping, R&D Grant, Grants, FY 2024–2027, SMSF, Audit, Financial Statements。

Grants 年 board：FY 2024, FY 2025, FY 2026, FY 2027。占位：Archived (Holding)。遗留聚合板 “Smart Grants” 已用 patch 删除。

Payroll 曾改名为 Payroll & Super；Payday Super、一次性 Super board 已删，项目进 holding。

---

# D. 产品功能清单（用户能看见的全部）

## D1. Board（核心表）

- 按 Project Type 分 board；侧栏顺序可配
- Saved View：列显隐/顺序、过滤、排序、Personal/Shared、每板一个默认 Shared
- 列管理（双栏）
- 行内编辑（click / Enter / blur / Esc）；Notes textarea **滚动时不提交**（否则底行笔记会自己关掉）
- 菜单型编辑器：异步刷新选项时禁用 blur 提交（否则闪退）
- 下拉按屏幕空间向上或向下
- Target Month / Year End 可清空
- 多值人员（MultiLinkPicker 头像两位缩写）、多值 Software
- 子任务展开；任务列单独 specs；任务字母序
- Monthly Status 12 月格 + 项目汇总条（Done / Working on it / Stuck 分段，hover 明细）
- Engagement Letter：整格点击上传/Replace，Frappe `/api/method/upload_file`
- 冻结首列；表头不透明；列宽记忆；虚拟滚动 + 无限加载；展开行高度计入虚拟列表
- 按当前可见列动态请求 fields；子表按需 hydration；in-flight 去重；快速切 board 防旧数据回写
- 请求未知 Custom Field 会在后端丢掉，避免 SQL 1054
- 搜索：项目名、客户、notes（Text Editor）、software 关联
- Filter：气泡、本地 presets、Entity 必须是 select；高级过滤组
- Sort：仅 SQL 安全字段；非法 sort 被清掉；Ad-hoc 默认 created 序；也可按首列 client/project 排
- Bulk：选择、bulk 改字段、bulk 改 software、bulk 改角色、bulk 给多项目加同一 task、CSV 导出选中行、Roll Over / Duplicate
- 斑马纹；TF/TG company 徽章；VT badge
- Last Updated → 项目活动弹窗；可 undo 字段变更（乐观并发 expected_to_value）
- Updates（Comment）：分页、编辑、删除、@mention → 通知
- 新建 Project：客户、类型、频率、财年预填、Grants 可选年 board 与 company；Client Projects 视图里客户锁死
- 归档/恢复；删除 board 后项目进 Holding，恢复时弹类型选择
- Grants 隐藏列仍参与校验；越界 Select 会挡保存，有 cleanup patch

## D2. 会计自动化

触发（accounting）：Status changes to；Status is（**禁止作为唯一触发**，否则每次保存/调度重复命中）；Project type is；Date reaches（on / on or after）

动作：按频率滚 Lodgement Due；Reset status；Notify someone（Assigned Person / Preparer / Manager / Partner）；Archive project；Push a date（frequency / 1 week / fortnight / month / quarter / year，含 Target Month 按频率推月）

特殊规则：

- EOM：当前是月末则月/季/半年/年步进仍落在目标月末
- Fortnightly
- 季度 BAS/IAS：不是 +3 个月，而是滚到配置表下一档法定日，最后一档停止并提示  
  表：FY 2025-26 Q3 = 2026-05-26；Q4 = 2026-08-25；FY 2026-27 Q1 = 2026-11-25；Q2 = 2027-02-28；Q3 = 2027-05-25
- IAS Monthly：若落到 BAS 季度月 1/4/7/10，顺延一个月（EOM 安全）；Target Month Select 有平行逻辑；管理员可关

命名自动化 + 旧数据 backfill。trigger_type 与 DocType 选项不同步时强制 coerce，避免 Select 校验挡保存。

## D3. Grants 自动化

触发：Date arrives；Date is approaching（月/周/天）  
动作：Highlight row（颜色）；Clear highlight  
每日调度重申/自动清除（Plan A）。高亮归属字段防止乱清别人的高亮。

## D4. Roll Over / Duplicate

选项目 → 复制到本 board 或另一 Project Type（Grants 典型：复制到下一 FY）。  
策略：carry / clear / set；子表只允许 team、software；永远带 customer、company、fiscal year；project_name 唯一索引，后缀不叠（FY/CY/Grants/Roll Over 标签会剥）；日期 +1 年保 EOM；lodgement 可 +1 年；可归档原件。  
`insert()` 会填 DocType 默认（Year End 曾默认 January），因此有 `skip_year_end_autosync` 和 blank-default month Select patch，把默认当空。

## D5. 其他产品页

- **Dashboard / Home：** 我的项目（团队成员关系）、非零 status 指示、点进 status-projects；排除已归档
- **Status Projects：** 按状态下钻
- **Clients：** 搜索分页、新建（可填 Partner、Trust 等实体；Trust 有 Customer type fallback）、编辑、归档客户并归档其项目、恢复
- **Client Projects：** 该客户跨 board 项目；可在锁客户下建项目
- **Archived Clients / Archived Projects**
- **Users：** Admin 增删改、模块角色开关、设密码、搜索分页
- **Settings：** 改资料头像、改密码、Board 顺序、每板 status 子集、IAS defer 开关、实体 backfill 调试工具
- **Notifications：** 铃铛、未读数、标已读、load-more
- **Activity Log：** 全局过滤用户/对象/类型、load-more
- **Automation Logs：** 按类型、深链到项目、Recent Runs
- **Report：** 路由已接，内容 coming soon（设计文档 F 规划了 KPI/队列/工作量，未实现）
- **Email：** 自动化 notify 可走站内 + SMTP；有失败保护；曾切回 SMTP mode

## D6. 明确未做 / 占位

- Report 真实数据
- Kanban / Gantt / 日历（设计文档提到，非主路径）
- 公开 SaaS 注册默认关闭
- 多 Site 租户第二阶段

---

# E. 白名单 API 全表

**activity_log：** get_activity_users, get_activity_log, get_project_activity, undo_project_activity  

**automation：** get_automation_meta, get_automations, save_automation, toggle_automation, delete_automation, run_due_date_automations_daily（手工 bench，不再调度）, run_due_date_automations_hourly, run_grants_highlight_automations  

**automation_logs：** get_automation_run_logs  

**board_settings：** get_project_types, get_project_type_order, set_project_type_order, get_project_type_status_config, set_project_type_status_config, get_special_rule_flag, set_special_rule_flag  

**clients：** get_clients, archive_client, restore_client, create_client, update_client, check_client_name_exists, delete_client  

**mentions：** search_users  

**notifications：** get_my_notifications, get_unread_count, mark_as_read, mark_all_as_read  

**profile：** get_my_profile, set_my_profile_image  

**project_board：** get_projects_list, get_board_fiscal_start_month, set_monthly_status, get_monthly_status_bundle, set_project_team_members, set_project_softwares, bulk_set_project_field, bulk_set_project_softwares, bulk_set_project_team_role, get_task_counts, get_tasks_for_projects, create_project, create_task_for_project, bulk_create_task_for_projects, set_task_team_members, bulk_set_task_field, delete_tasks, delete_project_cascade, get_my_projects_with_roles, get_my_project_names_by_status, hydrate_project_children, get_user_meta, query_project_names_advanced, search_project_names, ensure_default_board_view  

**project_entity：** get_project_customer_entities, set_project_customer_entity, set_project_year_end, backfill_project_year_end, backfill_project_customer_entities  

**project_rollover：** get_rollover_field_meta, roll_over_projects  

**updates：** get_project_updates, add_project_update, update_project_update, delete_project_update, get_project_update_counts, get_project_updates_for_export  

**users：** get_users, create_user, update_user, set_user_password  

**client_insert_override：** insert  

非白名单但重要：notification_delivery（站内+邮件）、status_admin / project_board_admin（bench 迁移工具）

## CustomProject 钩子摘要

before_insert：客户规范化；Year End 从 Entity 来（默认当空）；Partner 从 Customer.custom_partner；status 拉进合法池。  
validate：实体类型同步；portal 同步；跑 Board Automation；归档来源字段；活动 diff。  
update_percent_complete：调用 ERPNext 后**写回原 status**，防止 % 完成把状态改成 Open/Completed。  
on_update：写 SB_ACTIVITY；写 Automation Run Log。

---

# F. 迁移补丁（16 个，生产 `bench migrate` 会跑）

1. migrate_project_status_done_to_lodged — Done/Lodged → Completed  
2. backfill_board_automation_names — 旧规则补名字  
3. migrate_reviewer_to_manager  
4. backfill_project_year_end  
5. relabel_grant_fy_to_fy_cy  
6. drop_grants_deliverer_field  
7. dedupe_shared_default_views  
8. migrate_portal_access_to_customer  
9. drop_smart_grants_board  
10. rename_waiting_of_payment_status  
11. cleanup_grants_select_values — 清掉会挡保存的非法 Grants Select  
12. rename_grants_boards_to_fy — Grants 20XX → FY 20XX  
13. blank_default_month_selects — 月份 Select 前面加空，避免默认 January  
14. rename_payroll_and_drop_payday_super  
15. drop_super_project_type  
16. add_grants_salesperson_engagement_date  

---

# G. 文档与运维记录位置

| 文件 | 内容 |
|---|---|
| README.md | 产品概述、v2.0/v2.1/v2.2 |
| CLEAN_SLATE_REPORT.md | 2025-12-16 删除清单 |
| project-docs/reference/A_Data_Model_Assessment.md | 数据模型 v8.4 |
| B_Code_Architecture_Review.md | 代码架构，膨胀点 |
| C_Business_Process_Flows.md | 报税 BPMN（概念，不是当前状态机 1:1） |
| D_UI_Design.md | UI |
| E_Implementation_Tutorial.md | 实施 |
| F_Report_Page_Design.md | Report 目标设计 |
| architecture.md | 架构契约 |
| public/js/smart_board/README.md | 前端说明 |
| r-and-d-notes/2026/2026-04.md | 仅 4 月运营周报（开账号、UI、分页、补字段） |
| .project-checklists/pagination-review-2026-04-01.md | 分页清单 |
| documents/ Week2/Week3 PDF | 早期规划（ERPNext 数据结构），非实验日志 |

业务流程图（文档 C）概念：Create Task → 收资料 → 做账 → Review ↔ 返工 → 签字+发票并行 → Lodge ATO；客户 Sign EL → Review → Sign → Pay → Confirm。三角色 CLIENT / Preparer / Manager / Partner。三层状态：Project.status、Task.status、Monthly Status。

---

# H. 团队与 FY26 工时口径（事实）

- **开发：** 一人（git J3ffr33y）。  
- **PM、测试：** 有，timesheet 在 git 外。  
- 2025-07：仓库无提交。首提交 2025-08-27。FY26 窗口内 323 commit。全库到 2026-08 还有少量 FY27 提交，**不要混进 FY26 申请**。

内部讨论过的申报规划（非正式、供顾问改）：开发者工时大约一半可论证为实验+直接支持；PM/测试只报导向或验证技术未知问题的时间；不要因为「都在 UI 上」把外观抛光全部算 supporting。顾问以本文事实为准自行切。

---

# I. R&D 叙事（实验、未知、新知识）— 供顾问抽取

以下把**整年工作**都写进实验程序。顾问可再标 Core / Support / Exclude。

## I1. 一条核心活动（建议，可改）

**中文：** 在 ERPNext 原生 Project / Task / Customer 上，会计事务所多业务看板（含 Grants 异构域与 ATO 向日期自动化）能否稳定实现，结果无法事先确定。

**English：** Experimental development to determine whether ERPNext’s native Project, Task and Customer documents could sustain a Monday-style, multi-board, inline-editable practice OS for an Australian accounting firm — including a second Grants domain and heterogeneous statutory date automations — without a custom board-cell schema and without forking the framework. The outcome could not be known in advance from vendor documentation or ordinary application of known SaaS patterns.

## I2. Source investigation（含事后合理倒推）

查阅或作为合格专业人士基线的材料：

- Frappe/ERPNext：DocType、Custom Field、Property Setter、Auto Repeat、Website vs Desk、权限、`frappe.call`、scheduler daily/hourly  
- ERPNext Project 模块（项目文档，不是电子表格）  
- Monday.com 仅作交互参照，无 Frappe 实现  
- 已知 SPA 手段：虚拟列表、列 registry、类 Redux store  

这些材料**没有**说明：把 Project 行当 Monday item、子表当标签并在 tbody innerHTML 替换后提交、两个产品共享一个全局 Select 池、频率+EOM+季度法定日+IAS defer 写在 validate+调度器上、copy 时 DocType 默认值与用户值无法区分、daily 与午夜 hourly 会双跑。

考虑过的替代路径：自定义 Board Cell 库（试了，失败）；继续用 Desk 当客户 UI（SaaS 隔离不够）；用 Auto Repeat 当申报周期引擎（后来放弃，ATO 表对不上）；会计/Grants 拆成两个 DocType（会拆破共享客户，未做完整分叉，改在一个 Project 上隔离）。

## I3. 技术不确定性

**T1** Frappe 文档能否当 spreadsheet cell（内联、子任务、多值人员/软件、评论、tbody 替换）。  
**T2** 必须自建 Board Column/Cell，还是原生 Project + Saved View 投影就够。  
**T3** 可编辑大表在权限 RPC + 子表 hydration + 切 board 下是否可交互。  
**T4** 全局 Property Setter vs 每 board 状态/列子集，会否挡保存或串工作流。  
**T5** 自动化 DSL 在 validate+调度器上组合频率/EOM/BAS/IAS/`status_is` 会否写错或连响。  
**T6** Roll Over 的 carry/clear/set 与 insert 默认值、唯一项目名。  
**T7** `/smart` 壳拦截 Desk 会否循环或 traceback。  
**T8** 过滤/排序能否对着 Frappe 字段类型（含 Text Editor、子表）生成合法 SQL。

## I4. 实验过程（按时间，含产品工作）

**Phase 0 2025-08：** 初始化 app，导出 DocType，IP 保护骨架。

**Phase 1 2025-09–11 自定义棋盘：** workspace/board 自由创建、列管理、多值单元格、子任务、评论、@、筛选、bulk 归档删除、Combination View、CSV 导入导出（Range Error）、Client Group、Engagement 页、Desk 隔离 header。  
**10 月 28 日软件/人员单元格连续 10 次尝试**（selector 能弹，current selections 一直 loading）。  
11 月 Project Recovering：Customer Company Tag、后端重建、流程图。  
**结果：自定义 cell store 不可维持（H1a 证伪）。**

**Phase 2 2025-12 Clean Slate：** 清回原生；确认只用 Project；团队从 JSON 改子表；Customer Entity；Saved View 替代 Partition；Auto Repeat 写入设计后又降级。导出 v2 fixtures。

**Phase 3 2026-01 Smart Board 装置：** UIDev 01–18：/smart 顶栏、模块化、列管理、Column Registry、Editing Manager、通用编辑器、bulk、Updates 入口、性能、Filter、角色、内联编辑完成、Task 进表、Dashboard、Bookkeeping 月状态、EL 上传、挡 /app、通知、客户表、Users 角色、New Client/Project、Settings 改密、命名规范化、Activity Log、横纵滚动对齐。这是验证 T1/T3/T7 的唯一试验台。

**Phase 4 2026-02 自动化 + 架构收口：** T6–T9 服务拆分；status 单一真相来自 meta；去掉 alert；Frequency 可编；Entity 列；Done→Lodged→后又 Completed；EOM；filter 气泡；命名自动化；status_is 及 cannot_be_only；archive 动作；fortnightly；nested modal；表头不透明；localStorage meta 分用户不一致；第一列决定排序；Reset Date；客户名与 project name 混淆修复。

**Phase 5 2026-03 双产品 + 观测：** Email + 失败保护 + SMTP；月完成分段可视化；Client Projects 内建项目；Trust onboarding；Year End 同步+backfill；Updates 编辑删除 undo；去 dead code；System Manager 可进 Desk；按频率 push_date；新建弹窗禁止点空白关闭；自动化审计日志整页；Home 状态下钻；客户归档；Monday 式 Sort；Dashboard 去归档；导航清临时 filter；**拆 /smart selector + accounting + grants**；Grants 专用列和表单；Users 管理；Client 上 Partner，建项目自动带出。3 月中 Grants 数据导入成功（运营，也是双域试验的真实数据）。

**Phase 6 2026-04：** 图标/按钮/行距抛光；Updates 单滚动区+分页；补 Grants 列；Users/通知/自动化日志/活动分页；文档收口到 project-docs 和 R&D notes 模板；sort 白名单；**季度 BAS/IAS 规则 + Q4 上限**；R&D 状态只给 Grants；TG Tax Agent、Portal Access；CSV 导出；第五种实体 Other Incorporated Entity；**IAS Monthly defer + admin toggle**。

**Phase 7 2026-05：** Status Projects 分页空表修复；午夜通知去重；Ad-hoc 任务；unhide 列后 hydration；Grants 创建带 company；grants type/priority；**年 board Grants 2024–2027**；默认进第一年；Not to Proceed；Portal Access Expiry；删 Deliverer；**默认 Saved View 原子 find-or-create**。

**Phase 8 2026-06：** Grants 日期临近高亮 + daily 调度；退役聚合 Smart Grants 板；S1–S4 与 `-`；Top Grants 默认 company；非法 Select 清理；年 board 改名 FY；**Roll Over 会计+Grants**；Fee Arrangement；归档原件、lodgement+1年、安全命名；carry/clear/set 对默认值加固；月份 Select 默认空；隐藏 Grants 列；斑马纹；VT badge；季度 BAS lodgement 到期日写入自动化。

## I5. 新知识

**K1** 自定义 Board Cell 在 Frappe 上长期不可运维；原生文档能当 cell store 当且仅当：列是投影（Saved View+registry）、子表走 website-safe API、未知 field 在 SQL 前丢掉、in-flight generation 防旧画。  
**K2** 多值人员/软件不能靠 DOM id；selection 必须由应用持有（10 次失败记录）。  
**K3** Property Setter 全局；双产品需要全量池 + board 子集 + 自动化 module tag + migrate 清理越界值，否则框架拒存。  
**K4** DocType 默认值在 insert 上与用户值无法区分；Roll Over / 创建同步必须把默认当空。  
**K5** EOM、fortnightly、季度法定表+硬停、IAS 避开 BAS 季度月，必须特判先行、通用 `add_months` 放最后。  
**K6** `status_is` 不能单独触发；daily 与午夜 hourly 会双跑。  
**K7** Auto Repeat 不是 ATO 周期的权威；频率是 Project 上的数据，滚动是自动化动作。  
**K8** `/smart` + before_request 白名单可做客户壳；跳转必须 Werkzeug abort。  
**K9** localStorage 里的 DocType meta 跨用户/浏览器不一致。

## I6. 英文块（可贴表）

**Technical uncertainty：** Frappe documents, Property Setter option pools, field defaults, Select validation, Auto Repeat, and the daily/hourly scheduler are not a spreadsheet, a per-board schema, or a statutory date engine. Competent professionals could not determine from vendor documentation whether a native-document cell store, dual-product isolation on one DocType, and composed lodgement automations would remain correct under save, copy, and schedule.

**New knowledge：** Conditions under which native ERPNext documents can act as a cell store; that a custom board-cell schema is not maintainable on this stack; that dual products require subsetted global Selects plus migrate-time cleanup; that DocType defaults must be treated as empty during roll-over; that state triggers cannot be sole automation triggers; that Frappe daily and midnight hourly jobs collide; that Auto Repeat is the wrong authority for ATO lodgement cycles.

---

# J. FY26 全部 git commit（323 条，按月）

作者一律 J3ffr33y。2025-07 无提交。

### 2025-08（2）
feat: Initialize App  
Export DocType configurations and data structure

### 2025-09（50）
Add IP protection framework structure for future SaaS implementation  
ui designing  
Fill in Client name  
Format good, need editable fields  
MVP构建：能够正常列出数据，新建任务时可以直接在数据库同步新任务…  
MVP构建：当前client name处可以编辑…  
MVP构建：new task 和 person按钮已能运行…  
MVP构建：当前可实时更新数据…  
MVP构建：demostration前的保存…  
功能：可以拖拽table宽度了  
MVP页面优化：action person, preparer, reviewer, partner目前已经editable…  
MVP页面改进：目前添加了comment功能…  
MVP改进：comment可以查看activity log并且可以艾特人了  
MVP页面改进：实现Year End的可编辑…拖拽column width可以被记忆  
重要改动：为了提高用户自由度…对doctype进行了很多添加或改变  
功能优化：software字段和人员字段都可同时存在多个  
功能优化：改善了弹出框的布局  
功能优化：用户当前可以在网页中创建workspace/board了  
功能优化：优化了create workspace/boards时候的parent relationship  
功能强化：竖直滑动的时候保留project name和column header  
补充了doctype（两次）  
功能增强：column management select/unselect  
功能增强：column management debug…待完成 EL 和 Group  
功能强化：Client Group Doctype  
Implemented Engagement Page, and save before splitting html,css and js files  
Reconstructed Coding Files, and implemented subtask function  
Implemented bulk selector and archive, delete function  
Status implemented  
Improved 'Person' filter and User cells  
debug: board creation successful  
Service Line Doctype Improved  
frequency deleted in service line doctype  
Added status option  
changed default home page to smart accounting workspace  
uopdated homepage  
Updated category in the Service Line Doctype  
Debug & added needed columns for task(frequency and reset date)  
Debug errors  
ｊｓｏｎ  
Window Layout and Column Width problem are improved  
Improved Calendar Selector, and Improved User Display Layouts…  
Layout Improved  
workspace/board debug  
Improved client name column  
Initially Finalised Client Name Selector Function  
Implemented Manege Clients Function  
Implemented the 'New Project' function in the button 'new tasks'  
Debug: When a Partition has been created, the visible columns are all aligned…  
DEBUG: new client year end

### 2025-10（65）
Added Combination View Feature, But not finish yet  
Debugged Combination View Feature, Added Save View Feature…  
Improved css  
Updated some doctypes  
Save new version  
Improved CLI performance  
filter centralize  
Added Engagement Creation Feature  
Added empty option in month columns  
Implemented new header…avoid normal users from going back to ERPNext  
Finished URL setting and redirect permission setting.(Debug Needed)  
refactor: Optimize access control system and improve code health  
Debug: URL limitation blocked api usation…  
Notification Icon added, but no functionality achieved yet  
Bulk Update Feature Halfway Completed  
Improved Status Selector Style  
Bulk Update 3/4 implemented  
Improved Bulk Update function…User-related cells and priority cells  
Improved Filter Interface and filter logic  
Added communication method and contact social  
Implemented Communication Method and Client Contact columns…  
Improved Note function  
Added Process Date Column  
Debugged for the note feature and api bug  
Function Improvements: loading page…loading time  
Improved Column Management Function: client name not required; subtask/comment on first column  
Manage Columns function improved: 左右双栏  
Improved subtask button style  
Improved Subtask Count feature…  
1st Attempt of Performance Improvement of Software and Person cells  
导出/导入 function initially implemented  
Improved Template downloading in CSV Import…Uncaught Range Error  
Added doctypes for client-centric & contact-centric tasks  
selecting task-centric, client-centric and contact-centric views when creating a board  
Improved 导出function for softwares  
Improved import…multiple roles, softwares, communication methods  
After deleting useless doctypes, try keeping 导入/导出 function works  
Added Referral Person doctype back  
Checkpoint1024: Import not completed yet, Performance Improvement Needed  
fiture 导出  
Improved loading animation, also improved loading time  
Preparing for Reconstruct structure for query and part of frontend  
Checkpoint for monday development: still need debug for subtask when refreshing  
Subtask column config function implemented…  
Subtask Debug Partially Finished, Currently all columns working well  
minor functionality implemented  
New Attempt of Software&Person  
Second … Tenth attempt debugging software&person cells（共 10 次；第 10 次 selector 可用但仍 loading current selections，清理了 id creation）  
Improved Doctype, Added referral, contact links…architecture .md  
Improved .md file, improved data architecture  
Moved Manage Clients button and Persons Button to a high level header  
1st–6th Attempt of management dashboard / client management / staffs table / client groups / buttons

### 2025-11（7）
Project Recovering 1st–4th：customer company tag；backend performance；reconstructed project_management backend；reduced console.log  
5th–7th：flowcharts；buttons；architecture summary

### 2025-12（8）
Added/Updated Documents（多条）  
Cleared doctypes to the original version, rebuild data structure  
Confirmed basic data structure plan  
Initially confirmed data structure  
Export fixtures of the initial version data structure

### 2026-01（56）
UI BUILDING  
Initial Attempt of new UI: 3 project types shown  
UIDev01–18：结构、/smart、模块化、Columns、更多列、inline editing、Column Registry、Editing Manager、APIs、通用编辑器、column specs、bulk 列、Update 入口、Performance、清理迁移、Filter、Role Assignment、inline 完成、bulk select、Task 进表、Dashboard、bookkeeping monthly status、首列、task bulk、更多 project types、monthly 汇总、upload  
Blocked /app url for non-admin users  
Notification and Update  
personnel columns in Task  
client table  
Filter column select rules  
task monthly status not clickable  
User Role + fixture  
New Client；board setting；Settings + password；New Project；new client in New Project；performance；底部滑动对齐；naming rules；scroll bar；update icon；Client edit；working area；Activity Log；normalize name 后删除该按钮

### 2026-02（55）
Status config；只显示 unarchived；structure T6–T9；去掉 alert；customer_name 方案B；Project Type 可改；二次确认；toast；build_version 防缓存；nested modal；opaque header；Frequency + Auto Repeat 同步；Entity 列+头像两位+Done→Lodged+filter select；filter 气泡；试了一条 Automation；junk files；new project client 字段；EOM rollover；按首列排序；sidebar export + filter presets + notes/software 搜索；下拉方向；menu editor blur 闪退；Entity filter 改 select；Target Month Clear；Fiscal year editable；store 统一排序；update log；Reset Date + Lodged→Completed；profile；fixture；localStorage meta 分用户；clean bookkeeping saved view；文档；Monday-style automation + fortnightly + bulk task/project + 撤回动态 extra fields；create project client/name 混淆；order tasks；permission；fortnightly in automation；archive project 动作；named automations + status is + push a date + Select 兼容；status is 限制；Automation modal 保草稿 + Save as；reviewer→Manager；notification 跳转

### 2026-03（34）
Email Notification；分段月完成 + FY 徽章色 + Target Month push + 底行 Notes 不自动关；Client Projects 内建项目 + Trust；Client Information Update status + Year End backfill；undo + updates 编辑删除；删 legacy；System Manager Desk；push_date by frequency；禁止点空白关新建弹窗；automation run logging；Automation Logs 整页；Home 下钻 + 客户归档；Sort 系统；dashboard 排除归档；切板清 filter；导航/filter/query 重构；dashboard 非零 status；**split selector / accounting / grants placeholder**；**split UI boundaries grants page/columns/form**；header crash；selector copy live grants；fixtures；table data type 两次；new project；email failure protection；SMTP；user part；email 多轮；Partner in Client；User edit for admins

### 2026-04（19）
sidebar icons；button/form styles；table readability；updates modal 分页；missing Grants fields after ABN；Users pagination；notifications load-more；automations/activity pagination；pagination rollout；Documentation Implemented；column labels + title escaping；sort safe fields；**quarterly BAS/IAS + Q4 guard**；rollover guidance placeholder；**R&D statuses scoped to Grants**；TG Tax Agent + Portal Access；CSV export；Other Incorporated Entity；**IAS Monthly defer toggle**

### 2026-05（10）
empty Status Projects + de-dupe midnight notifications；Ad-hoc tasks UX；column hydration after unhide；company in grants create；grants type & priority；**year boards 2024–2027 + FY/CY + board picker**；default first year board + Not to Proceed；Portal Access Expiry；remove Deliverer + migrate；**single shared default view atomic find-or-create**

### 2026-06（17）
Grants date-approaching highlight；daily scheduler highlights；retire legacy Smart Grants board；Columns Layout；S1–S4 + Top Grants default company + notes editors；**clear stale Grants Select**；rename Grants 20XX → FY 20XX；Roll Over Grants；Roll Over Grants+Accounting；Fee Arrangement + blank/- priority；archive-original + lodgement+1yr + naming + Home status edit；rollover vs defaults；blank month Selects；hidden grants columns + zebra；VT badge；Quarterly BAS Lodgement Due dates for automation

---

# K. 顾问使用说明

1. 本文是**全量事实**。申报时请自行标 Core / Support / Exclude，不要假定每一行都可报。  
2. 最硬的同时期证据：Clean Slate 删除清单、2025-10-28 十次单元格尝试、`cannot_be_only`、hooks 里 daily/hourly 双跑注释、`skip_year_end_autosync`、越界 Select cleanup、BAS/IAS 日期表。  
3. 4 月 R&D notes 是运营周报，不能当实验正文。  
4. FY27（2026-07 起，例如 2026-08-18 的 Grants fields / activity tracking）另立期间。  
5. 代码路径均相对于 `apps/smart_accounting/`。

---

*End of pack. Compiled from the live repo, fixtures, architecture docs, and the complete FY26 git log.*
