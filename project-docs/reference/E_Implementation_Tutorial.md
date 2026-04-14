# 📄 Document E: Implementation Tutorial
# 实施教程文档

**项目**: Smart Accounting  
**版本**: v4.4  
**日期**: 2026-03-10  
**用途**: 🔧 **开发指南** - 如何在 ERPNext 中通过 UI 实现数据结构

---

## 2026-04 当前状态补充

### 近期已完成的实现项

- ✅ `New Project` 的 `Fiscal Year` 和 `Frequency` 自动预填已进入当前实现
- ✅ Client 创建流程已支持 `Partner` 输入，并会在后续新建 Project 时自动承接
- ✅ Users 页面已补充 admin-only 的新增、移除和状态查看能力
- ✅ Smart Grants 缺失字段与列已补齐
- ✅ Updates 页面分页与系统级分页补强已完成
- ✅ Automation Logs 已升级为正式分页导航，更适合长期检索

### 文档使用建议

- 本文档继续保留为**实施 / 配置参考**。
- 如果需要查看最近真实落地了哪些功能、何时完成、如何验证，请优先查看：
  - `../project-docs/r-and-d-notes/`
  - `../project-docs/document-map.md`

## 2026-03 重要校正（优先于旧步骤）

> 本文档保留了若干早期实施记录；如果与当前代码不一致，请以本节为准。

- **Saved View 已不是 7 字段极简版**
  - 当前实现使用 v2 schema，至少包含：`title`、`project_type`、`columns`、`filters`、`sort_by`、`sort_order`、`is_default`、`reference_doctype`、`is_active`、`scope`、`sidebar_order`
- **Project 状态配置不再依赖 `project.js` Client Script**
  - 当前口径是：`Project.status` 的全局池由 Property Setter / DocType options 决定
  - board 级 allowed subset 由 `api/board_settings.py` 管理
- **Task 团队字段以 `custom_task_members` 为准**
  - 任务团队不再以 ERPNext Assignment 作为 Smart Board 主要实现路径
- **`hooks.py` 当前不以 `doctype_js = {"Project": "public/js/project.js"}` 作为主要状态配置路径**
  - 当前产品口径是：Status 全局池来自 Property Setter / DocType options
  - board 级 allowed subset 由 `api/board_settings.py` 和前端 `BoardStatusService` 处理
- **Smart Board 当前按需加载，不通过全局 `app_include_js/app_include_css` 注入**
  - Desk Page `project_management` 与 `/smart` 产品壳共用同一前端模块
- **Project 实体字段现状**
  - 当前真实字段应包含 `custom_customer_entity`、`custom_entity_type`、`custom_year_end`
  - 其中 `custom_entity_type` 更偏展示/派生，`custom_customer_entity` 才是实际关联
- **归档元数据已落地**
  - 除 `is_active` 外，还应考虑 `custom_archive_source` / `custom_archive_source_ref`
- **Auto Repeat 章节仅作历史方案参考**
  - `custom_project_frequency` 字段仍存在，但本文档中的 Auto Repeat 自动创建步骤不应再视为当前 Smart Board 的权威实现说明

---

## 更新日志 (v4.3 - 2025-12-18)

### 团队字段架构优化（Critical - 提升SaaS可扩展性）
- ✅ **custom_team从JSON改为子表**：提升查询性能和数据完整性
- ✅ **新增Phase 2.5**：创建Project Team Member子表DocType（3个字段）
- ✅ **Project扩展字段优化**：从8个减少到7个（删除custom_team，custom_team_members改为Table类型）
- ✅ **验证清单更新**：新增Project Team Member子表验证项
- ✅ **实施步骤更新**：添加Project Team Member子表创建详细步骤

---

## 更新日志 (v4.2 - 2025-12-17)

### Status动态过滤（Phase 7新增）
- ✅ **Client Script实现**：根据project_type动态过滤status选项
- ✅ **状态超集配置**：在Property Setter配置所有可能的状态
- ✅ **用户体验优化**：每个project_type只显示相关状态，避免混淆
- ✅ **验证清单更新**：新增7.5 Status动态过滤验证项

---

## 更新日志 (v4.1 - 2025-12-17)

### 客户多实体支持（Critical）
- ✅ **Customer Entity子表**：新增子表DocType支持一个客户拥有多个实体
- ✅ **Customer字段简化**：从3个字段减少到2个（entities替代entity_type和year_end）
- ✅ **Project添加entity字段**：custom_entity_type关联具体实体（8个扩展字段）
- ✅ **Auto Repeat自动创建**：明确after_insert钩子自动创建Auto Repeat机制

### 周期性业务架构优化（v4.0）
- ✅ **Auto Repeat方案**：使用Frappe原生Auto Repeat自动创建周期性Project
- ✅ **Task字段减少**：Task扩展字段从4个减少到2个（删除team相关字段）
- ✅ **新增实施步骤**：添加Project Auto Repeat钩子配置说明

---

## 目录

1. [概述](#1-概述)
2. [添加 Custom Fields](#2-添加-custom-fields)
3. [创建 Saved View DocType](#3-创建-saved-view-doctype)
4. [配置 Select 选项](#4-配置-select-选项)
5. [实施顺序](#5-实施顺序)
   - Phase 1: 创建 Customer Entity 子表 DocType
   - Phase 2: Customer & Contact 扩展
   - Phase 2.5: 创建 Project Team Member 子表 DocType
   - Phase 3: 创建 Software DocType
   - Phase 4: Project 扩展（当前字段以文首校正为准）
   - Phase 5: Task 扩展（2字段）
   - Phase 6: 创建 Saved View DocType（当前实现为 v2）
   - Phase 7: Board Status 配置（当前口径）
   - Phase 8: Project Frequency / Auto Repeat（历史兼容路径）
6. [实施顺序总结](#6-实施顺序总结)
7. [验证清单](#7-验证清单)

---

## 1. 概述

### 1.1 需要做的事情

| 任务 | 说明 |
|------|------|
| **创建 Customer Entity 子表** | 新建子表 DocType（5 个字段）|
| **扩展 Customer** | 添加 2 个 custom fields（含entities子表）|
| **扩展 Contact** | 添加 3 个 custom fields |
| **创建 Project Team Member 子表** | 新建子表 DocType（3 个字段）|
| **扩展 Project** | 添加 7 个 custom fields（含team_members子表）|
| **扩展 Task** | 添加 2 个 custom fields（最大化利用原生字段）|
| **创建 Software DocType** | 新建极简 DocType（2 个字段）|
| **创建 Saved View DocType** | 新建当前实现使用的 Saved View v2 DocType |
| **Board Status 配置** | `board_settings.py` + Property Setter（board allowed statuses）|
| **Project Frequency / 历史 Auto Repeat** | 旧文档保留；不应作为当前 Smart Board 权威实现路径 |
| **配置选项** | 配置 Select 字段的选项（通过 Property Setter）|

### 1.2 操作方式

- **UI操作**：Custom Fields、DocType创建、Property Setter配置
- **代码实现（当前口径）**：
  - **Board 状态配置**：`api/board_settings.py` + `BoardStatusService`
  - **/smart 产品页**：`www/smart/` + Smart Board ESM 入口
  - **Project Server Override（project.py）**：实体同步、归档来源字段、Board Automation 执行
  - **Saved View / Board 配置**：`services/viewService.js`、`api/board_settings.py`

### 1.3 产品入口（/smart）与 Desk（/app）隔离（2026-03 更新）

> **对外用户**：先进入 **`/smart`**（selector / module chooser），当前业务主要使用 **`/smart-accounting`**，不在 Desk（`/app`）中操作。  
> **管理员/内部**：仍可使用 Desk（`/app`）进行系统配置与维护。

代码落地（已实现）：
- `apps/smart_accounting/smart_accounting/www/smart/`：`/smart` 平台 selector 页面
- `apps/smart_accounting/smart_accounting/www/smart-accounting/`：`/smart-accounting` Accounting 模块入口
- `apps/smart_accounting/smart_accounting/www/smart-grants/`：`/smart-grants` Grants 占位模块入口
- `apps/smart_accounting/smart_accounting/access_control.py` + `hooks.py before_request`：外部用户访问 `/app*` 重定向到 `/smart`

---

## 2. 添加 Custom Fields

### 2.1 进入 Customize Form

```
方法 1: Setup → Customize → Customize Form
方法 2: 地址栏输入 /app/customize-form
```

### 2.2 操作步骤

1. 在 "Enter Form Type" 输入要扩展的 DocType（如 `Project`）
2. 点击 "Go" 或按回车
3. 滚动到字段列表底部
4. 点击 **"Add Row"** 添加新字段
5. 填写字段信息
6. 点击 **"Save"** 保存

### 2.3 字段类型说明

| Fieldtype | 用途 | 示例 |
|-----------|------|------|
| `Data` | 单行文本 | custom_entity_type |
| `Select` | 下拉选择 | custom_target_month |
| `Link` | 链接到其他 DocType | custom_referred_by → Contact |
| `Date` | 日期 | custom_lodgement_due_date |
| `Check` | 复选框 | custom_is_referrer |
| `Text` | 多行纯文本 | custom_notes |
| `Text Editor` | 多行富文本 | notes（原生）|
| `JSON` | JSON 数据 | custom_social_accounts |
| `Table MultiSelect` | 多选 | custom_softwares → Project Software → Software |

### 2.4 字段属性说明

| 属性 | 说明 |
|------|------|
| **Label** | 显示名称（用户看到的）|
| **Fieldname** | 字段名（系统使用，自定义字段以 `custom_` 开头）|
| **Fieldtype** | 字段类型 |
| **Options** | Select 的选项（每行一个）/ Link 的目标 DocType |
| **Mandatory** | 是否必填 |
| **In List View** | 是否在列表视图显示 |
| **In Standard Filter** | 是否在筛选器显示 |
| **Insert After** | 插入到哪个字段后面（控制位置）|

---

## 3. 创建 Saved View DocType

### 3.1 进入 DocType 创建页面

```
方法 1: Setup → DocType → New DocType
方法 2: 地址栏输入 /app/doctype/new-doctype
```

### 3.2 基本设置

| 设置项 | 值 |
|--------|-----|
| Name | `Saved View` |
| Module | `Smart Accounting` |
| Is Submittable | ❌ No |
| Allow Rename | ✅ Yes |
| Track Changes | ✅ Yes |

### 3.3 添加字段（当前实现建议：Saved View v2）

| # | Label | Fieldname | Fieldtype | Options | Mandatory | 说明 |
|---|-------|-----------|-----------|---------|-----------|------|
| 1 | Title | `title` | Data | | ✅ | 视图名称 |
| 2 | Project Type | `project_type` | Link | Project Type | | 兼容字段；普通 board 默认仍与 Project Type 对应 |
| 3 | Columns | `columns` | JSON | | ✅ | 当前支持 `{ project, tasks }` 结构 |
| 4 | Filters | `filters` | JSON | | | 当前包含 filters/or_filters/search/ui |
| 5 | Sort By | `sort_by` | Data | | | 兼容旧字段 |
| 6 | Sort Order | `sort_order` | Select | asc<br/>desc | | 兼容旧字段 |
| 7 | Is Default | `is_default` | Check | | | 默认视图标记 |
| 8 | Reference Doctype | `reference_doctype` | Data | | ✅ | 当前实现固定为 `Project` |
| 9 | Is Active | `is_active` | Check | | | 当前是否启用 |
| 10 | Scope | `scope` | Data | | | 当前实现使用 `Shared` |
| 11 | Sidebar Order | `sidebar_order` | Int | | | 用于 sidebar 顺序 |

> **说明**：
> - 当前仓库实际实现已使用 **Saved View v2**；旧的“7 字段极简版”仅保留为历史背景
> - `reference_doctype` / `is_active` / `scope` / `sidebar_order` 已在前端与后端查询链路中被使用
> - `project_type` 目前保留作兼容字段；普通 board 的 pinned 逻辑更多体现在 `filters.ui` 中

### 3.4 设置权限

在 DocType 的 Permissions 部分添加：

| Role | Read | Write | Create | Delete |
|------|------|-------|--------|--------|
| System Manager | ✅ | ✅ | ✅ | ✅ |
| 其他需要的角色 | ... | ... | ... | ... |

### 3.5 保存

点击 **Save** 保存 DocType。

---

## 4. 配置 Select 选项

### 4.1 修改现有字段的选项

如果需要修改 Select 字段的选项（如 Project 的 status）：

1. 进入 **Customize Form**
2. 选择 DocType（如 Project）
3. 找到要修改的字段（如 status）
4. 修改 **Options** 列的内容（每行一个选项）
5. 保存

### 4.2 示例：Project Status 选项

```
Not Started
Working
Ready for Review
Under Review
Completed
Cancelled
```

### 4.3 示例：Task Status 选项

```
Open
Working
Completed
```

---

## 5. 实施顺序

### Phase 0（新增）：启用 /smart 平台壳（对外入口）

1. 访问 `/smart`
   - 未登录应跳转到登录页（或提示登录）
   - 登录后应能看到 selector / module chooser
2. 访问 `/smart-accounting`
   - 应能看到当前 Smart Accounting UI
3. 访问 `/smart-grants`
   - 当前应看到 placeholder / coming soon 页面
4. 验证访问隔离
   - 外部用户访问 `/app` 或 `/app/*` → 应被重定向到 `/smart`
   - 管理员（System Manager/Administrator）仍可访问 `/app`
5. 开发期注意缓存
   - Smart Board 使用 ESM 直载 `/assets/.../*.js`，浏览器会缓存较长时间（可能需要 hard refresh 才能看到更新）
   - 推荐：Chrome DevTools 勾选 Disable cache 或使用无痕窗口测试
   - 修改代码后执行：
     - `bench build --app smart_accounting`
     - `bench --site <site> clear-cache && bench --site <site> clear-website-cache`

### Phase 1: 创建 Customer Entity 子表 DocType

> ⚠️ **重要**：必须先创建Customer Entity子表，才能在Customer中添加custom_entities字段！

**Step 1: 创建 Customer Entity DocType（子表）**

1. 进入：Setup → DocType → New DocType
2. 填写基本信息：
   - Name: `Customer Entity`
   - Module: `Smart Accounting`
   - **Is Child Table**: ✅ **Yes**（重要！）
   - Is Submittable: ❌ No

**Step 2: 添加字段（5个）**

| # | Label | Fieldname | Fieldtype | Options | Mandatory |
|---|-------|-----------|-----------|---------|-----------|
| 1 | Entity Name | `entity_name` | Data | | ✅ |
| 2 | Entity Type | `entity_type` | Select | Individual<br/>Company<br/>Trust<br/>Partnership<br/>SMSF | ✅ |
| 3 | ABN | `abn` | Data | | |
| 4 | Year End | `year_end` | Select | June<br/>December<br/>March<br/>September | |
| 5 | Is Primary | `is_primary` | Check | | |

**Step 3: 设置权限并保存**

---

### Phase 2: Customer & Contact 扩展

**Step 1: Customer 扩展（2个字段）**

| Label | Fieldname | Fieldtype | Options |
|-------|-----------|-----------|---------|
| Referred By | `custom_referred_by` | Link | Contact |
| Entities | `custom_entities` | Table | Customer Entity |

> **v4.1 变化**：删除了`custom_entity_type`和`custom_year_end`字段，改为`custom_entities`子表

**Step 2: Contact 扩展（3个字段）**

| Label | Fieldname | Fieldtype | Options |
|-------|-----------|-----------|---------|
| Is Referrer | `custom_is_referrer` | Check | |
| Contact Role | `custom_contact_role` | Select | Director<br/>Accountant<br/>Admin<br/>Other |
| Social Accounts | `custom_social_accounts` | JSON | |

> ✅ **说明（可选）**：`custom_contact_role` 当前在 Smart Board / 核心流程中未使用，可先不加。  
> 当你们需要在 UI 中按联系人角色筛选/展示/权限控制时，再按本节把字段补上即可。

---

### Phase 2.5: 创建 Project Team Member 子表 DocType

> ⚠️ **重要**：必须先创建Project Team Member子表，才能在Project中添加custom_team_members字段！

**Step 1: 创建 Project Team Member DocType（子表）**

1. 进入：Setup → DocType → New DocType
2. 填写基本信息：
   - Name: `Project Team Member`
   - Module: `Smart Accounting`
   - **Is Child Table**: ✅ **Yes**（重要！）
   - Is Submittable: ❌ No

**Step 2: 添加字段（3个）**

| # | Label | Fieldname | Fieldtype | Options | Mandatory |
|---|-------|-----------|-----------|---------|-----------|
| 1 | User | `user` | Link | User | ✅ |
| 2 | Role | `role` | Select | Preparer<br/>Manager<br/>Partner | ✅ |
| 3 | Assigned Date | `assigned_date` | Date | | |

**role 选项**：
```
Preparer
Manager
Partner
```

**Step 3: 设置权限并保存**

**优势**：
- ✅ 支持数据库级别查询：可以高效查询"Bob的所有Projects"
- ✅ 数据完整性：外键约束，用户删除时可以检查关联
- ✅ 报表友好：直接SQL聚合统计每个人的工作量
- ✅ SaaS可扩展：大规模数据（>10000 Projects）性能稳定

---

### Phase 3: 创建 Software DocType

> **重要**：必须先创建 Software DocType，才能在 Project 中添加 custom_softwares 字段！

**Step 1: 创建 Software DocType**

1. 进入：Setup → DocType → New DocType
2. 填写基本信息：
   - Name: `Software`
   - Module: `Smart Accounting`
   - Is Submittable: ❌ No
   - Allow Rename: ✅ Yes

**Step 2: 添加字段（仅2个）**

| # | Label | Fieldname | Fieldtype | Mandatory | 默认值 |
|---|-------|-----------|-----------|-----------|--------|
| 1 | Software Name | `software_name` | Data | ✅ | |
| 2 | Is Active | `is_active` | Check | | ✅ Yes |

> **说明**：极简设计，TF/TG 共用。无需 company 字段。

**Step 3: 设置权限并保存**

**Step 4: 创建 Software 记录（推荐）**

创建常用的会计软件记录，方便后续在Project中选择：

1. 进入：Accounting → Software → New
2. 创建常用软件记录：
   - Xero
   - MYOB
   - QuickBooks
   - Reckon
   - 其他业务使用的软件

> **提示**：这一步可以现在做，也可以在需要时再创建

---

### Phase 3.5（新增）：创建 Monthly Status DocType（用于月度进度网格）

> **用途**：支撑“Monthly Task Status（12个月）”组件与 Project 端的“Done x/y · %”月度汇总。  
> **设计原则**：用一个通用 DocType 存“某对象在某财年的第 N 月的状态”，未来可扩展到 Project/其他对象，不新增更多 DocType。
>
> ⚠️ **关键字段**：`month_index`（1-12）必须存在，否则无法展开 12 个月列。

**Step 1: 创建 Monthly Status DocType（普通 DocType）**

1. 进入：Setup → DocType → New DocType
2. 填写基本信息：
   - Name: `Monthly Status`
   - Module: `Smart Accounting`
   - **Is Child Table**: ❌ No（普通 DocType）
   - Track Changes: ✅ 建议开启（审计谁改了状态）

**Step 2: 添加字段（至少 6 个）**

| # | Label | Fieldname | Fieldtype | Options | Mandatory | 说明 |
|---|-------|-----------|-----------|---------|-----------|------|
| 1 | Reference Doctype | `reference_doctype` | Link | DocType | ✅ | 默认值建议填 `Task` |
| 2 | Reference Name | `reference_name` | Dynamic Link | reference_doctype | ✅ | 指向具体 Task（未来可扩展到 Project） |
| 3 | Project | `project` | Link | Project |  | **建议保留**：用于 Project 月度汇总查询性能 |
| 4 | Fiscal Year | `fiscal_year` | Link | Fiscal Year | ✅ | |
| 5 | Month Index | `month_index` | Int | | ✅ | 取值 1-12（财年第几月，不是自然月） |
| 6 | Status | `status` | Select | Not Started<br/>Working On It<br/>Stuck<br/>Done | ✅ | 四个状态即可 |

**Step 3: 保存 + 导出 fixtures**

- 修改后执行：
  - `bench --site <site> export-fixtures --app smart_accounting`
- 确认：
  - `smart_accounting/fixtures/doctype.json` 包含 `Monthly Status`

---

### Phase 4: Project 扩展（8 个字段）

> ⚠️ **注意**：project_type 是 ERPNext 原生字段，无需添加 custom 字段！

> **前提条件**：
> 1. 确保已创建业务所需的Project Type记录（如ITR、BAS、Bookkeeping、R&D Grant、Financial Statements等）
> 2. 确保已创建Project Team Member子表（Phase 2.5）
> 
> 创建Project Type方式：
> 1. 进入：Projects → Project Type → New
> 2. 填写Project Type名称（如 "ITR", "BAS", "R&D Grant"）
> 3. 保存

| Label | Fieldname | Fieldtype | Options | 说明 |
|-------|-----------|-----------|---------|------|
| Entity Type | `custom_entity_type` | Data | | **v4.1新增**：关联Customer Entity，如 "Client A Pty Ltd" |
| Team Members | `custom_team_members` | Table | Project Team Member | **v4.3优化**：从JSON改为子表，提升查询性能 |
| Fiscal Year | `custom_fiscal_year` | Link | Fiscal Year | 如 "FY24", "FY25" |
| Target Month | `custom_target_month` | Select | January<br/>February<br/>March<br/>April<br/>May<br/>June<br/>July<br/>August<br/>September<br/>October<br/>November<br/>December | 目标月份 |
| Lodgement Due Date | `custom_lodgement_due_date` | Date | | ATO 法定截止日期 |
| Project Frequency | `custom_project_frequency` | Select | Monthly<br/>Quarterly<br/>Yearly<br/>One-off | **会自动创建Auto Repeat**（非One-off时；选项需与 Auto Repeat.frequency 一致）|
| Softwares | `custom_softwares` | Table MultiSelect | Project Software | Table MultiSelect 的子表为 `Project Software`；子表字段 `software` Link → `Software` |
| Engagement Letter | `custom_engagement_letter` | Attach | | 业务文件附件（Smart Board 支持上传/查看） |

补充说明（Smart Board 行为）：
- Engagement Letter 上传使用 Frappe 原生 `/api/method/upload_file`
- 上传成功后会写回 `Project.custom_engagement_letter`，表格会显示文件名并支持 Replace

> **custom_team_members 说明**：子表字段，可以添加多个团队成员，每个成员有角色（Preparer/Reviewer/Partner）。支持高效的数据库查询和统计。

> **custom_project_frequency 说明**：选择频率后，系统会自动创建Auto Repeat记录（通过after_insert钩子）

---

### Phase 5: Task 扩展（2 个字段）

> ⚠️ **注意**：Task 大量使用 ERPNext 原生字段，仅添加业务扩展字段
> 
> **原生字段**（无需添加）：exp_start_date, exp_end_date, expected_time, actual_time, status, priority, description 等

| Label | Fieldname | Fieldtype | Options | 说明 |
|-------|-----------|-----------|---------|------|
| Fiscal Year | `custom_fiscal_year` | Link | Fiscal Year | 如 "FY24", "FY25" |
| Period | `custom_period` | Data | | 如 "Q1", "Q2", "Q3", "Q4" |

### Phase 5.1（新增）：Task 成员子表（用于 Smart Board 人员 cell + 任务分配一致性）

> **背景**：Smart Board 的 Task 人员单元格需要稳定的数据结构来渲染头像/增删成员。  
> **原则**：与 Project 的 `custom_team_members` 复用同一个子表 DocType（`Project Team Member`），避免两套成员结构分裂。

在 **Task** DocType 添加字段：

| Label | Fieldname | Fieldtype | Options | 说明 |
|-------|-----------|-----------|---------|------|
| Task Members | `custom_task_members` | Table | Project Team Member | Task 级成员；Smart Board 优先使用该字段 |

关键要求：
- `custom_task_members` 必须是 **Table**，Options 必须是 `Project Team Member`（否则后端 append/前端渲染会失败）
- 如果你历史上用过别的字段名，建议统一迁移到 `custom_task_members`（Smart Board API 会优先识别它）

---

### Phase 6: 创建 Saved View DocType（7 个字段）

按照 [第 3 节](#3-创建-saved-view-doctype) 的步骤创建，共 7 个字段（极简设计）。

---

### Phase 7: 配置 Status 选项和动态过滤

> **核心需求**：不同project_type需要显示不同的status选项（如ITR只需5个状态，R&D Grant需要10个状态）

#### Step 1: 配置 Status 超集（Property Setter）

首先在Project.status字段配置所有可能的状态（超集）：

1. 进入：Setup → Customize → Customize Form
2. 选择 DocType: `Project`
3. 找到 `status` 字段
4. 修改 **Options**（所有可能的状态）：

```
Not started
Working on it
Waiting for client
R&D
Ready for manager review
Review points to be actioned
Ready for partner review
Ready to send to client
Sent to client for signature
Hold
Waiting of payment
Completed
```

5. 点击 **Update**

> **说明**：状态选项以 `Project.status` 的 DocType meta（含 Property Setter）为单一真相。  
> Board 侧做的是“允许子集”配置，不再推荐在前端脚本里硬编码状态映射。

---

#### Step 2: 实现动态过滤（Client Script - 历史兼容路径）

**目标**：为仍依赖 Project 表单前端过滤的旧站点保留兼容做法。

> **当前推荐口径**：新实现优先使用 Property Setter + `api/board_settings.py` + Smart Board `BoardStatusService`，不要再把状态映射硬编码为主方案。

**实现步骤：**

**2.1 创建Client Script文件**

1. 创建目录（如果不存在）：

```bash
mkdir -p /home/jeffrey/frappe-bench/apps/smart_accounting/smart_accounting/public/js
```

2. 创建文件：`apps/smart_accounting/smart_accounting/public/js/project.js`

```bash
touch /home/jeffrey/frappe-bench/apps/smart_accounting/smart_accounting/public/js/project.js
```

3. 将以下代码写入 `project.js`：

```javascript
// Project Client Script - Dynamic Status Filtering

frappe.ui.form.on('Project', {
    refresh: function(frm) {
        filter_status_options(frm);
    },
    
    project_type: function(frm) {
        // 切换project_type时重新过滤status选项
        filter_status_options(frm);
    }
});

function filter_status_options(frm) {
    // 定义每个project_type允许的status
    const status_map = {
        'ITR': [
            'Not Started',
            'Working',
            'Ready for Review',
            'Under Review',
            'Lodged',
            'Completed',
            'Cancelled'
        ],
        'BAS': [
            'Not Started',
            'Working',
            'Ready for Review',
            'Query from ATO',
            'Resubmit',
            'Lodged',
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
        'Financial Statements': [
            'Not Started',
            'Working',
            'Ready for Review',
            'Partner Review',
            'Completed',
            'Cancelled'
        ]
        // 可以继续添加其他project_type...
    };
    
    // 获取当前project_type允许的status
    const project_type = frm.doc.project_type;
    const allowed_statuses = status_map[project_type];
    
    if (allowed_statuses && allowed_statuses.length > 0) {
        // 动态设置status字段的选项
        frm.set_df_property('status', 'options', allowed_statuses);
        frm.refresh_field('status');
    }
}
```

**2.2 配置到 hooks.py（仅旧站点兼容时使用）**

编辑：`apps/smart_accounting/smart_accounting/hooks.py`

```python
# 以下配置仅在旧站点仍保留前端表单过滤时使用

# 方式1：全局JS
app_include_js = [
    "/assets/smart_accounting/js/project.js"
]

# 或者方式2：针对特定DocType（推荐）
doctype_js = {
    "Project": "public/js/project.js"
}
```

**2.3 清除缓存**

```bash
cd /home/jeffrey/frappe-bench
bench clear-cache
bench restart
```

---

#### Step 3: 验证

1. 打开或创建一个Project
2. 选择 `project_type = "ITR"`
3. 查看 `status` 下拉选项，应该只显示ITR相关的6个状态
4. 切换 `project_type = "R&D Grant"`
5. 查看 `status` 下拉选项，应该显示R&D Grant相关的8个状态

---

#### 优势

- ✅ **用户体验好**：每个project_type只看到相关状态，避免混淆
- ✅ **实现简单**：一个JS文件即可
- ✅ **易于维护**：修改status_map即可调整
- ✅ **数据完整**：后端保存完整status值，不影响数据
- ✅ **灵活配置**：可以随时添加新的project_type映射

#### 未来升级路径（Phase 2+）

如果需要更灵活的配置（通过UI而非代码），可以升级到：

**方案：Status DocType + 关系表**
```python
# 创建独立的Status DocType
Status:
  - status_name
  - color
  - is_active

# 扩展Project Type
Project Type:
  - custom_allowed_statuses (Table → Status)
```

这样每个租户可以通过UI自定义每个project_type的status列表。

---

### Phase 8: 配置 Auto Repeat（周期性Project）

> **v4.1 更新**：用户创建Project时选择frequency，系统自动创建Auto Repeat（无需手动配置）

#### Step 1: 实现 Auto Repeat 自动创建（代码 - 必须）

**after_insert 钩子**：Project创建后自动创建Auto Repeat

```python
# apps/smart_accounting/smart_accounting/overrides/project.py

from erpnext.projects.doctype.project.project import Project
import frappe

class CustomProject(Project):
    def after_insert(self):
        """Project创建后自动创建Auto Repeat"""
        super().after_insert()
        if self.custom_project_frequency and self.custom_project_frequency != "One-off":
            self.create_auto_repeat()
    
    def create_auto_repeat(self):
        """根据custom_project_frequency创建Auto Repeat"""
        try:
            auto_repeat = frappe.new_doc("Auto Repeat")
            auto_repeat.reference_doctype = "Project"
            auto_repeat.reference_document = self.name
            auto_repeat.frequency = self.custom_project_frequency  # Monthly/Quarterly/Yearly
            auto_repeat.start_date = self.expected_start_date or frappe.utils.today()
            auto_repeat.insert(ignore_permissions=True)
            
            # 关联到Project
            frappe.db.set_value("Project", self.name, "auto_repeat", auto_repeat.name)
            
            frappe.msgprint(f"已自动创建Auto Repeat: {auto_repeat.name}")
        except Exception as e:
            frappe.log_error(f"Failed to create Auto Repeat for {self.name}: {str(e)}")
    
    def validate(self):
        """修改frequency时同步Auto Repeat"""
        super().validate()
        if self.has_value_changed("custom_project_frequency") and self.auto_repeat:
            self.sync_auto_repeat_frequency()
    
    def sync_auto_repeat_frequency(self):
        """同步frequency到Auto Repeat"""
        if self.custom_project_frequency == "One-off":
            # 改为One-off，禁用Auto Repeat
            frappe.db.set_value("Auto Repeat", self.auto_repeat, "disabled", 1)
        else:
            auto_repeat = frappe.get_doc("Auto Repeat", self.auto_repeat)
            auto_repeat.frequency = self.custom_project_frequency
            auto_repeat.disabled = 0
            auto_repeat.save(ignore_permissions=True)
```

#### Step 2: 实现 on_recurring 钩子（代码 - 必须）

**on_recurring 钩子**：Auto Repeat创建新Project时自动命名

在代码中实现 Project 的 on_recurring 方法：

```python
# apps/smart_accounting/smart_accounting/overrides/project.py

from erpnext.projects.doctype.project.project import Project
from frappe.utils import getdate, add_months, get_last_day

class CustomProject(Project):
    def on_recurring(self, reference_doc, auto_repeat_doc):
        """Auto Repeat创建新Project时触发"""
        
        # 1. 生成新名称（包含entity信息）
        date = getdate(auto_repeat_doc.next_schedule_date)
        
        # 构建名称部分
        parts = [self.customer]
        
        # 如果有entity，添加到名称中（v4.1新增）
        if self.custom_entity_type:
            # 从entity_type提取简短标识
            # 例如："Client A Pty Ltd" -> "(Pty Ltd)"
            entity_short = self.custom_entity_type.replace(self.customer, "").strip()
            if entity_short:
                parts.append(f"({entity_short})")
        
        # 生成period
        if auto_repeat_doc.frequency == "Monthly":
            period = date.strftime("%B %Y")  # "August 2025"
        elif auto_repeat_doc.frequency == "Quarterly":
            quarter = (date.month - 1) // 3 + 1
            period = f"Q{quarter} FY{date.year % 100}"
        else:
            period = f"FY{date.year % 100}"
        
        parts.append(period)
        parts.append(self.project_type)
        
        self.project_name = " - ".join(parts)
        # 结果："Client A (Pty Ltd) - August 2025 - BAS"
        
        # 2. 更新日期
        self.expected_start_date = date
        if auto_repeat_doc.frequency == "Monthly":
            self.expected_end_date = get_last_day(date)
        elif auto_repeat_doc.frequency == "Quarterly":
            self.expected_end_date = get_last_day(add_months(date, 3))
        else:
            self.expected_end_date = get_last_day(add_months(date, 12))
        
        # 3. 继承关键字段（用户可修改）
        self.custom_entity_type = reference_doc.custom_entity_type
        
        # 继承团队成员子表
        for member in reference_doc.custom_team_members:
            self.append('custom_team_members', {
                'user': member.user,
                'role': member.role,
                'assigned_date': frappe.utils.today()
            })
        
        # 4. 重置状态
        self.status = "Not Started"
        self.percent_complete = 0
        self.notes = ""
```

#### Step 3: 创建文件结构（必须）

**创建overrides目录和文件**：

1. 创建目录结构（如果不存在）：

```bash
mkdir -p /home/jeffrey/frappe-bench/apps/smart_accounting/smart_accounting/overrides
```

2. 创建 `__init__.py`（让Python识别为包）：

```bash
touch /home/jeffrey/frappe-bench/apps/smart_accounting/smart_accounting/overrides/__init__.py
```

3. 创建 `project.py` 文件：

```bash
touch /home/jeffrey/frappe-bench/apps/smart_accounting/smart_accounting/overrides/project.py
```

4. 将上面Step 1和Step 2的代码复制到 `project.py` 文件中（完整的CustomProject类，包含after_insert, create_auto_repeat, validate, sync_auto_repeat_frequency, on_recurring方法）

**文件结构示例**：
```
apps/smart_accounting/smart_accounting/
├── overrides/
│   ├── __init__.py
│   └── project.py  ← 完整的CustomProject类代码
└── hooks.py  ← 配置override_doctype_class
```

---

#### Step 4: 配置钩子到 hooks.py（以当前实现为准）

```python
# apps/smart_accounting/smart_accounting/hooks.py

# 覆盖 ERPNext 原生 Project（当前实现）
override_doctype_class = {
    "Project": "smart_accounting.custom.project.CustomProject"
}
```

> **重要提示**：
> - 上面是当前仓库的主要 hooks 口径
> - 旧文档中的 `project.js` / `doctype_js` 仅可视为历史方案或站点兼容路径，不再是当前 Status 配置主路径

---

#### Step 5: 清除缓存并重启（必须）

```bash
cd /home/jeffrey/frappe-bench
bench clear-cache
bench restart
```

> **说明**：修改Python代码后必须重启，否则不会生效

---

#### Step 6: 验证 Auto Repeat

1. 等待系统定时任务运行（每天检查）
2. 或者手动触发：在 Auto Repeat 文档点击 **Create Documents**
3. 检查是否自动创建了新 Project：
   - 名称自动更新（如 "Client A - August 2025 BAS"）
   - 日期自动更新
   - 团队配置继承
   - 状态重置为 "Not Started"

#### 优势

- ✅ 完全利用 Frappe 原生功能
- ✅ 自动化程度高，无需人工干预
- ✅ 每个周期是独立 Project，层级清晰
- ✅ 支持 Monthly/Quarterly/Yearly 频率

---

## 6. 实施顺序总结

| Phase | 内容 | 方式 |
|-------|------|------|
| **准备** | 创建 Project Type 记录 | UI (Projects → Project Type → New) |
| **1** | 创建 Customer Entity 子表 DocType | UI (New DocType - 子表，5字段) |
| **2** | Customer & Contact 扩展 | UI (Customize Form) |
| **2.5** | 创建 Project Team Member 子表 DocType | UI (New DocType - 子表，3字段) |
| **3** | 创建 Software DocType 和记录 | UI (New DocType + 创建记录，2字段) |
| **4** | Project 扩展（当前字段以文首校正为准）| UI (Customize Form) |
| **5** | Task 扩展（2字段）| UI (Customize Form) |
| **6** | 创建 Saved View DocType | UI（当前实现为 Saved View v2） |
| **7** | Board Status 配置 | Property Setter + `api/board_settings.py` + `BoardStatusService` |
| **8** | Auto Repeat 兼容路径 | 仅当目标站点仍启用该路径时验证 |

> **说明**：
> - "准备"阶段需要创建业务所需的Project Type记录（如ITR、BAS、R&D Grant等），这些是ERPNext原生数据，在后续Phase中会用到。
> - Phase 2.5（v4.3新增）：创建Project Team Member子表，用于Project的团队成员管理，相比JSON方式大幅提升查询性能和数据完整性。

---

## 7. 验证清单

### 7.0 当前验证顺序

> 建议按 **P0 → P1 → P2 → P3** 顺序推进：先让 Smart Board 有数据、再补齐缺失字段/基础数据、再验证状态与 Auto Repeat，最后再清理过期配置。

#### P0：让 Smart Board 立刻能正常出数据

- [ ] **确保 Project 字段 `custom_softwares` 已存在**（Table MultiSelect → `Project Software` → `Software`）
  - 目的：避免前端请求字段不存在导致列表空白
  - 步骤：
    - Setup → Customize → **Customize Form** → DocType 选 `Project`
    - Add Row：Label=Softwares / Fieldname=`custom_softwares` / Fieldtype=`Table MultiSelect` / Options=`Project Software`
    - Save
- [ ] **创建至少 1 条 Project 记录**（`project_type=ITR`，`status` 任意）
  - 目的：验证页面“不是因为没数据才空”
  - 步骤：
    - Projects → Project → New
    - 填 `project_name`、选 `customer`、选 `company`、选 `project_type=ITR`、随便选一个 `status` → Save
- [ ] **（如果改了 UI 配置/fixtures）执行一次** `bench clear-cache` + `bench restart`
  - 目的：让元数据/缓存刷新
  - 步骤：
    - 服务器命令行：`cd /home/jeffrey/frappe-bench`
    - 执行：`bench --site dev.localhost clear-cache && bench restart`

#### P1：补齐文档缺项的配置

- [ ] **（可选）Contact 增加字段 `custom_contact_role`**（Select；当前未用到，可延后）
  - 步骤：
    - Setup → Customize → Customize Form → DocType 选 `Contact`
    - Add Row：Label=Contact Role / Fieldname=`custom_contact_role` / Fieldtype=`Select` / Options（每行一个，如 Director/Accountant/...）
    - Save
- [ ] **Software DocType 创建基础数据**：Xero / MYOB / QuickBooks / Excel（至少几条）
  - 步骤：
    - 搜索 “Software” 列表 → New
    - 填 `software_name`（如 Xero），`is_active` 勾选 → Save（重复创建几条）
- [ ] **创建 Project Type 记录**（ERPNext 原生）：ITR / BAS / Bookkeeping / Payroll / R&D Grant / Financial Statements（至少你侧边栏要用到的）
  - 步骤：
    - Projects → Project Type → New
    - 填 `project_type`（如 ITR）→ Save（重复创建需要的类型）

#### P1：修正容易踩坑的选项（避免后续自动化报错）

- [ ] **检查 `custom_project_frequency` 选项**：建议去掉 `Half-Yearly`（Auto Repeat 不支持）
  - 建议集合：Monthly / Quarterly / Yearly / One-off
  - 步骤：
    - Setup → Customize → Customize Form → DocType 选 `Project`
    - 找到字段 `custom_project_frequency` → Options 改成建议集合（每行一个）→ Save

#### P2：跑通两条关键业务链路（功能验证）

- [ ] **Status 动态过滤验证**：Project 表单切换 `project_type`，status 选项会变化
  - 步骤：
    - 打开任意 Project 表单
    - 切换 `project_type`（ITR/BAS/Bookkeeping/R&D Grant）观察 `status` 下拉选项是否随之变化
- [ ] **Auto Repeat 验证**
  - [ ] 创建 Project 时选 `custom_project_frequency != One-off`
  - [ ] 保存后自动创建 Auto Repeat
  - [ ] 修改 frequency 后 Auto Repeat 同步更新
  - [ ] Auto Repeat 自动创建新 Project，并继承 team/entity，并重置 status
  - 步骤（建议按顺序做）：
    - 新建 Project：把 `custom_project_frequency` 选 Monthly/Quarterly/Yearly（不要选 One-off）→ Save
    - 回到 Project，看 `auto_repeat` 字段是否自动填入
    - 修改 `custom_project_frequency` 再 Save：检查对应 Auto Repeat 的 `frequency` 是否同步
    - 等 scheduler 跑一次或手动触发 Auto Repeat：检查新 Project 的命名/团队/实体/状态是否符合预期

#### P3：清理过期配置（不影响跑通，但影响表单体验/一致性）

- [ ] **更新 `fixtures/property_setter.json` 的 Project `field_order`**（目前明显是旧字段名）
  - 建议：等你确认最终字段/布局后再统一导出 fixtures
  - 步骤（推荐做法）：
    - 先在 UI 把 Project 表单布局/字段顺序调整到满意
    - 执行导出 fixtures（你现在用的策略是把 Custom Field / Property Setter / DocType 导出到 `fixtures/`）

> **说明（2026-01-05 自动对照）**：以下 ✅/⬜ 的勾选，若未特别说明，表示“**仅根据本仓库 `fixtures/*` 与代码目录结构**判断”，不代表你在 UI 中已完成实际创建/验证（比如“能创建记录”“功能跑通”等仍需你手动验证）。

### 7.1 DocType 和基础数据创建验证

- [x] Customer Entity 子表DocType 创建成功（**v4.1新增**，5字段）【fixtures/doctype.json】
- [x] Project Team Member 子表DocType 创建成功（**v4.3新增**，3字段）【fixtures/doctype.json】
- [x] Software DocType 创建成功（2字段）【fixtures/doctype.json】
- [x] Saved View DocType 创建成功（当前实现为 v2）【fixtures/doctype.json】
- [ ] 能创建 Customer Entity 记录（entity_name, entity_type, abn, year_end, is_primary）
- [ ] 能创建 Project Team Member 记录（user, role, assigned_date）
- [ ] 能创建 Software 记录（如 Xero, MYOB）
- [ ] 已创建业务所需的 Project Type 记录（ITR, BAS, Bookkeeping, R&D Grant, Financial Statements等）

### 7.2 字段扩展验证

- [x] Customer 扩展：2 个字段（`custom_referred_by`, `custom_entities`）【fixtures/custom_field.json】
- [ ] Contact 扩展：3 个字段（`custom_is_referrer`, `custom_contact_role`, `custom_social_accounts`）
  - [x] `custom_is_referrer`【fixtures/custom_field.json】
  - [ ] `custom_contact_role`（当前 fixtures 中未发现）
  - [x] `custom_social_accounts`【fixtures/custom_field.json】
- [ ] Project 扩展：当前关键字段已补齐（以文首校正与 fixtures 为准）
  - [x] `custom_entity_type`【fixtures/custom_field.json】
  - [x] `custom_team_members`【fixtures/custom_field.json】
  - [x] `custom_fiscal_year`【fixtures/custom_field.json】
  - [x] `custom_target_month`【fixtures/custom_field.json】
  - [x] `custom_lodgement_due_date`【fixtures/custom_field.json】
  - [x] `custom_project_frequency`【fixtures/custom_field.json】
  - [x] `custom_softwares`【fixtures/custom_field.json】
  - [x] `custom_engagement_letter`【fixtures/custom_field.json】
- [x] Task 扩展：2 个字段（`custom_fiscal_year`, `custom_period`）【fixtures/custom_field.json】
- [ ] Task 成员子表：`custom_task_members`（Table → `Project Team Member`）

### 7.3 功能验证

- [ ] Customer 可以添加多个 entities（子表）
- [ ] Project 可以添加多个 team_members（子表）**v4.3新增**
- [ ] 在 Project 表单中能看到当前所需关键字段（含 Engagement Letter、实体关联与团队字段）
- [ ] Project.custom_entity_type 可以从 Customer.custom_entities 选择
- [ ] Project.custom_team_members 可以添加团队成员并选择角色（以当前 `Project Team Member.role` 选项为准）**v4.3新增**
- [ ] Project.project_type 可以正常选择（ERPNext 原生字段，无需扩展）
- [ ] Project.custom_softwares 可以选择 Software 记录
- [ ] Customer、Contact、Task 的扩展字段都能正常显示
- [ ] Saved View 能正常保存当前 v2 字段内容

### 7.4 Select 选项验证

- [ ] Project status 选项正确（配置了所有状态超集）
- [ ] Task status 选项正确
- [ ] Customer Entity.entity_type 选项正确
- [ ] 其他 Select 字段选项正确

### 7.5 Board Status 配置验证（当前口径）

**代码文件验证**：
- [x] 文件存在：`apps/smart_accounting/smart_accounting/api/board_settings.py`
- [x] 文件存在：`apps/smart_accounting/smart_accounting/public/js/smart_board/services/boardStatusService.js`
- [x] `Project.status` 的全局池应来自 Property Setter / DocType options
- [ ] 若目标站点仍保留 `project.js` / `doctype_js` 兼容逻辑，请单独记录，不作为当前主路径验收标准
- [ ] 执行了 `bench clear-cache` 和 `bench restart`

**功能验证**：
- [ ] Project.status 全局池已按站点需要配置
- [ ] Board Settings API 返回的 allowed subset 与当前项目类型一致
- [ ] Smart Board 中切换不同 board 时，状态选项只显示当前允许的 subset
- [ ] 保存的 status 值在后端完整保留，且不会被前端过滤逻辑错误覆盖
- [ ] 若站点同时存在旧表单过滤逻辑，已明确它只是兼容层，不与当前 board 配置打架

### 7.6 Auto Repeat 兼容路径验证（历史参考）

> 仅当目标站点仍启用该路径时执行。本节不再代表当前 Smart Board 的权威实现说明。

**代码文件验证**：
- [x] 目录存在：`apps/smart_accounting/smart_accounting/custom/`（本仓库使用 `custom/`，不是 `overrides/`）
- [x] 文件存在：`apps/smart_accounting/smart_accounting/custom/project.py`
- [x] project.py包含CustomProject类（after_insert, create_auto_repeat, validate, sync_auto_repeat_frequency, on_recurring）
- [x] hooks.py配置正确：`override_doctype_class = {"Project": "smart_accounting.custom.project.CustomProject"}`
- [ ] 执行了 `bench clear-cache` 和 `bench restart`

**功能验证**：
- [ ] 创建Project时选择custom_project_frequency（非One-off）
- [ ] Project保存后自动创建Auto Repeat记录（**after_insert钩子**）
- [ ] Project.auto_repeat字段自动关联到Auto Repeat
- [ ] 修改custom_project_frequency时Auto Repeat同步更新（**validate钩子**）
- [ ] Auto Repeat自动创建新Project（名称包含entity信息和period）
- [ ] 新Project的custom_entity_type正确继承
- [ ] 新Project团队配置正确继承（`custom_team_members`）
- [ ] 新Project状态重置为"Not Started"，percent_complete=0

---

## 附录

### A. 相关文档

| 文档 | 说明 |
|------|------|
| `project-docs/reference/A_Data_Model_Assessment.md` | 数据模型设计（字段详细定义）|
| `project-docs/reference/D_UI_Design.md` | UI 设计文档 |

### B. 修订历史

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| 1.0 | 2025-12-12 | 初始版本，纯 UI 操作方式 |
| 2.0 | 2025-12-16 | **重大更新**：① 删除 custom_fiscal_year 字段（Project 从 8 个改为 6 个扩展字段）；② 删除过时字段引用（custom_primary_contact 等）；③ 添加 Software DocType 创建步骤（Phase 2）；④ 添加 Project Type 扩展步骤（Phase 3）；⑤ 修正 project_type 为原生字段；⑥ 更新字段类型示例；⑦ 完善验证清单 |
| 2.1 | 2025-12-17 | **周期性任务优化**：① Project 恢复 fiscal_year 字段（从 6 个改为 7 个扩展字段）；② Task 精简为 2 个扩展字段（fiscal_year, period），最大化利用 ERPNext 原生字段；③ 明确 Project + Task 架构处理周期性任务；④ 更新所有字段数量和验证清单 |
| 3.0 | 2025-12-17 | **最终精简优化**：① Software DocType 精简到 2 个字段（删除 companies/is_global，TF/TG 共用）；② 删除 Phase 3（Project Type 无需扩展）；③ Saved View 精简到 7 个字段（删除 view_type/target_doctype/group_by/company/is_system 等）；④ 重新编号 Phase（原 Phase 4-7 改为 Phase 3-6）；⑤ 更新所有字段数量和验证清单 |
