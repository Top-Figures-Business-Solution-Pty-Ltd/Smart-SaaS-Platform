# New System Doc

- **第一部分**是当前 Smart System：所用 ERPNext DocType、Custom Field，以及用户操作。
- **第二部分**是新系统：已经确定的需求、尚未确定的事项、以后再做的内容、demo 范围，以及参考材料。

---

# 第一部分：当前 Smart System 的功能

## 1. ERPNext 在这套系统里是什么

当前系统不是从零做的一套数据库。它跑在 **Frappe** 上，业务底盘用的是 **ERPNext**。Smart Accounting 是装在这个底盘上的一个应用：自己的页面、接口和字段，数据仍写进 ERPNext 的单据。

下面这几个词后面会反复出现。

| 词 | 在这套系统里的意思 |
| --- | --- |
| DocType | 一种单据的定义，相当于一张表加它的表单。例如 `Customer`、`Project`。 |
| 单据（Document） | 某个 DocType 里的一行具体记录。看板上的一行，就是一张 `Project` 单据。 |
| 标准字段 | ERPNext 或 Frappe 自带的字段，例如 `Project.customer`、`Project.status`。 |
| Custom Field | 加在标准 DocType 上的自定义字段。名字多以 `custom_` 开头，例如 `Project.custom_lodgement_due_date`。 |
| 子表 | 挂在主单据下面的多行表。例如一个项目可以有多行团队成员。子表本身也是一个 DocType，但没有独立的列表页。 |
| Link | 字段里存的是另一张单据的名字，用来指向它。例如项目上的客户指向 `Customer`。 |
| Property Setter | 不新建字段，只改标准字段的表现。这里主要用来改 `Project.status` 和 `Task.status` 的可选项。 |
| Role | 角色。用户通过角色决定能进 Accounting、Grants，还是 Desk。 |

用户平时不打开 ERPNext 的标准表单。他们用 Smart Board。保存时，Smart Board 再去写这些 DocType。

当前用到的标准 DocType：

| DocType | 谁提供的 | 在 Smart System 里干什么 |
| --- | --- | --- |
| `Customer` | ERPNext | 客户主档 |
| `Contact` | ERPNext | 联系人。推荐人指向这里 |
| `Project` | ERPNext | 看板上的一行工作 |
| `Task` | ERPNext | 挂在项目下面的任务 |
| `Project Type` | ERPNext | 一块看板。侧边栏的 Boards 来自这里 |
| `User` | Frappe | 登录用户，也用于合伙人、销售、团队成员 |
| `Company` | ERPNext | 项目上的公司列 |
| `Fiscal Year` | ERPNext | 会计财年，挂在项目和月度完成上 |
| `Customer Group` | ERPNext | 新建客户时的分组，缺省用 All Customer Groups |
| `Territory` | ERPNext | 新建客户时的地区，缺省用 All Territories |
| `Comment` | Frappe | 项目上的 Updates |
| `Version` | Frappe | 单据每次修改留下的版本，活动记录的“更新”来自这里 |
| `Deleted Document` | Frappe | 删除记录，活动记录的“删除”来自这里 |
| `Notification Log` | Frappe | 站内通知 |
| `Auto Repeat` | Frappe | 标准字段仍挂在 Project / Task 上，Smart Board 不把它当作业功能用 |

当前应用自己建的 DocType：

| DocType | 类型 | 干什么 |
| --- | --- | --- |
| `Customer Entity` | 子表，挂在 `Customer.custom_entities` | 客户下的实体：名称、类型、ABN、年结 |
| `Project Team Member` | 子表，挂在 `Project.custom_team_members` 和 `Task.custom_task_members` | 这个项目或任务上的人，以及角色 |
| `Software` | 独立主数据，树形 | 软件名单，例如 Xero |
| `Project Software` | 子表，挂在 `Project.custom_softwares` | 这个项目使用哪些软件 |
| `Monthly Status` | 独立单据 | 某个项目在某财年某个月的完成状态 |
| `Saved View` | 独立单据 | 一块看板上保存的列、筛选和排序 |
| `Board Automation` | 独立单据 | 一条自动化规则 |
| `Automation Run Log` | 独立单据 | 某次规则跑在某个项目上的结果 |
| `Automation Run Log Change` | 子表，挂在运行日志的 `changes` | 这次跑改了哪个字段、从什么改成什么 |

## 2. 系统概览

对外是两条产品线，共用同一套 Smart Board，看到的列和看板不同。

- **Smart Accounting**：会计作业。一块看板是一种 `Project Type`，例如站点上的 ITR、BAS、Payroll。这些类型存在 `Project Type` 单据里，侧边栏实时读取，不写死在代码中。代码里只给一部分名字准备了图标：ITR、BAS、Payroll、Payroll & Super、Bookkeeping、SMSF、Audit、Financial Statements。
- **Smart Grants**：补助申报。一块看板是一个财年，代码里固定为 `FY 2024`、`FY 2025`、`FY 2026`、`FY 2027`。这四条加上 `Archived (Holding)` 会随应用一起安装成 `Project Type`。

一条工作在看板上是一张 `Project`。客户身份在 `Customer`。项目通过标准字段 `Project.customer` 指向客户。

## 3. 入口、登录与模块隔离

用户走网站上的产品入口，不走 ERPNext Desk 的标准界面。

| 路径 | 作用 |
| --- | --- |
| `/smart/login`、`/smart/logout` | 登录、退出 |
| `/smart/forgot-password`、`/smart/signup` | 忘记密码、注册页 |
| `/smart` | 登录后的产品选择 |
| `/smart-accounting` | Smart Accounting |
| `/smart-grants` | Smart Grants |
| `/login`、`/signup`、`/update-password` | 会转到上面的产品页面，避免露出 ERPNext 登录页 |
| `/app/...` | ERPNext Desk。普通用户会被送回 `/smart` |

能进 Desk 的是 Administrator、System Manager，以及站点配置里单独允许的用户或角色。

模块用两个 Frappe Role 分开：

- `Smart Accounting User` 才能进 `/smart-accounting`
- `Smart Grants User` 才能进 `/smart-grants`

页面按这个角色拦。看板上的列也按模块过滤：Accounting 看不到 Grants 专有列，反过来一样。两条线仍共用一批接口，例如读项目、改项目。接口是否再按模块拦一层，并没有和页面完全一致。

用户可以做的操作：

- 用产品登录页登录、退出、走忘记密码
- 只拥有其中一个角色时，只能打开对应那条产品线
- 管理员可以进入 Desk 做系统维护

## 4. 导航里有哪些页面

左侧导航分三段。

**上面**

- Home（视图名 `dashboard`）：当前用户参与的项目，以及按状态的数量。数据来自 `Project` 和 `Project Team Member`。
- Report（视图名 `report`）：导航和页面在，业务内容仍是占位。

**中间是 Boards**

每一块看板是一条 `Project Type`。旁边可以导出这块看板的 CSV。管理员可以打开看板设置，也可以新建 Project Type。最下面有 Archived Projects。

**下面**

- Clients
- Users
- Archived Clients
- Automation Logs
- Settings

另外几个视图没有单独的左侧入口，从别的页面进去：

- `client-projects`：某个客户名下的项目
- `status-projects`：从 Home 按某个状态点进去的项目
- `activity`：全局活动记录。代码里能打开这个视图，当前侧边栏没有把它列成一项

Settings 里现在能用的是 My Profile 和 Change Password。Personal Preferences 和 Notification Preferences 按钮在，但是禁用的。管理员还能看到 Debug Tools。

## 5. 客户

客户是一张 ERPNext `Customer`。列表、新建、编辑都不走标准客户表单，走 Smart Board 的客户页。

用户可以做的操作：

- 搜索客户，看列表
- 新建客户
- 编辑客户名称、实体类型、年结、负责合伙人
- 保存前检查名称是否已经存在
- 归档客户，以及从归档里恢复
- 删除客户
- 点进一个客户，看他名下的项目

新建时写入的标准字段：

| 字段 | 说明 |
| --- | --- |
| `customer_name` | 客户名称，必填，不能和已有客户重名 |
| `customer_type` | 客户类型。不填时按 Individual 处理，再转成 ERPNext 允许的值 |
| `customer_group` | 不填则用 All Customer Groups |
| `territory` | 不填则用 All Territories |

自定义字段：

| 字段 | 类型 | 指向 | 说明 |
| --- | --- | --- | --- |
| `custom_partner` | Link | `User` | 负责合伙人 |
| `custom_referred_by` | Link | `Contact` | 推荐人。客户页当前的新建和编辑流程没有把这个字段露出来 |
| `custom_entities` | 子表 | `Customer Entity` | 这个客户下的实体 |
| `custom_portal_access_received` | Check |  | Grants 门户权限是否已收到。客户保存后会抄到该客户的项目上 |
| `custom_portal_access_expiry_date` | Date |  | 门户权限到期日。同样会抄到项目上 |

`Customer Entity` 每一行：

| 字段 | 类型 | 选项或说明 |
| --- | --- | --- |
| `entity_name` | Data | 实体名称。编辑客户时跟着客户名称走 |
| `entity_type` | Select | Individual、Company、Partnership、Trust、Other Incorporated Entity |
| `abn` | Data | ABN |
| `year_end` | Select | January 到 December。新建时如果带了实体，年结必填 |
| `is_primary` | Check | 是否主实体。项目创建时如果没填年结，会从主实体带过来 |

归档不是另存一张表。归档把 `Customer.disabled` 设为 1，并把这个客户底下 `Project.is_active = Yes` 的项目改成 `No`。恢复时把 `disabled` 设回 0，并恢复当时一起归档的项目。

`Contact` 上还有自定义字段，当前客户页没有当成主要操作：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `custom_is_referrer` | Check | 这个联系人是不是推荐人 |
| `custom_social_accounts` | JSON | 社交账号 |
| `is_billing_contact` | Check | 是否账单联系人。这是加在 Contact 上的自定义勾选 |

## 6. Smart Accounting 看板

一块会计看板等于一种 `Project Type`。打开看板时，只列出 `project_type` 落在这一类、并且属于会计模块字段范围的项目。

用户可以做的操作见第 8 节。这一节只列会计线会看到的数据。

直接用的 `Project` 标准字段：

| 字段 | 看板上的名称 | 说明 |
| --- | --- | --- |
| `project_name` | Project Name | 项目名称 |
| `customer` | Client Name | 指向 `Customer` |
| `status` | Status | 工作状态。可选项被 Property Setter 改过，见第 10 节 |
| `project_type` | Project Type | 指向 `Project Type`，决定在哪块看板 |
| `company` | Company | 指向 `Company` |
| `priority` | Priority | ERPNext 自带优先级 |
| `expected_end_date` | End Date | 结束日期 |
| `notes` | Notes | 备注 |
| `estimated_costing` |  | 标准成本字段，列目录里有 |
| `is_active` |  | Yes / No。No 表示从当前看板拿掉，进入归档 |
| `modified` |  | 最后修改时间 |

会计线自定义字段：

| 字段 | 类型 | 指向或选项 | 看板上的含义 |
| --- | --- | --- | --- |
| `custom_customer_entity` | Link | `Customer Entity` | 这个项目对应哪个实体。列默认隐藏 |
| `custom_entity_type` | Data |  | 实体类型。展示用，创建时可以从实体带出 |
| `custom_fiscal_year` | Link | `Fiscal Year` | 财年 |
| `custom_year_end` | Select | January–December | 年结。新建项目时如果空着，从客户实体带出 |
| `custom_target_month` | Select | January–December | 目标月份 |
| `custom_project_frequency` | Select | Yearly、Half-Yearly、Quarterly、Monthly、Fortnightly、Weekly、One-off | 频率 |
| `custom_lodgement_due_date` | Date |  | 申报截止日 |
| `custom_reset_date` | Date |  | 重置日期。自动化可以用它判断日期到了 |
| `custom_engagement_letter` | Attach |  | Engagement Letter 文件 |
| `custom_team_members` | 子表 | `Project Team Member` | 团队 |
| `custom_softwares` | 子表 | `Project Software` | 使用的软件 |
| `custom_ato_status` | Select | Not started、Not applicable、Done | ATO 状态 |
| `custom_lodgeit_status` | Select | 同上 | LodgeIT 状态 |
| `custom_company_agent_status` | Select | 同上 | Company Agent 状态 |
| `custom_xeroquickbooks_status` | Select | 同上 | Xero/QuickBooks 状态 |
| `custom_archive_source` | Select | Manual、Automation、Client Archive。删看板时另写 Type Deleted | 谁把它归档的 |
| `custom_archive_source_ref` | Data |  | 归档来源的补充引用 |

十二个月完成情况不是 `Project` 上的一个字段。看板用一个虚拟列去读 `Monthly Status`：某张单据（通常是这个 `Project`）、某个 `Fiscal Year`、某个月（`month_index`）一条状态。状态下拉是 Not Started、Working On It、Stuck、Done。

`Project Team Member` 每一行：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user` | Link → `User` | 哪个人 |
| `role` | Select | Preparer、Manager、Partner、Assigned Person |
| `assigned_date` | Date | 分配日期 |

新建项目时，如果团队里还没有 Partner，会用 `Customer.custom_partner` 自动补一行 Partner。

`Software` 是可以维护的软件名单（名称、是否启用，并带树形上下级）。`Project Software` 每一行只用一个字段 `software`，指向 `Software`。

## 7. Smart Grants 看板

一块 Grants 看板等于一个财年 `Project Type`：`FY 2024` 到 `FY 2027`。客户列 `customer` 固定在最左边，不能被别的列挤走。

Grants 和会计共用 `project_name`、`customer`、`status`、`notes`、`project_type`。Grants 不使用会计那组到期日、月度完成、软件、ATO 状态字段。

Grants 自定义字段都在 `Project` 上：

| 字段 | 类型 | 指向或选项 | 含义 |
| --- | --- | --- | --- |
| `custom_grants_fy_label` | Data |  | FY/CY 文字 |
| `custom_engagement_date` | Date |  | 签约月份 |
| `custom_grants_abn_snapshot` | Data |  | ABN。存在项目上，是一份快照，不是客户主档 |
| `custom_grants_state` | Data |  | 州 |
| `custom_grants_industry_category` | Data |  | 行业 |
| `custom_grants_type` | Select | R&DTI、EMDG | 补助类型 |
| `custom_grants_priority` | Select | -、S1、S2、S3、S4 | 优先级 |
| `custom_grants_salesperson` | Link → `User` |  | 销售 |
| `custom_grants_partner_label` | Data |  | 合伙人，这里是文字，不是 Link |
| `custom_grants_referral_text` | Data |  | 推荐人文字 |
| `custom_grants_owner_name` | Data |  | 负责人文字 |
| `custom_grants_address_snapshot` | Small Text |  | 地址快照 |
| `custom_grants_contact_name` | Data |  | 联系人姓名快照 |
| `custom_grants_primary_communication` | Small Text |  | 主要沟通方式快照 |
| `custom_grants_status` | Long Text |  | Application Progress，一段文字，不是状态下拉 |
| `custom_ap_submit_date` | Data |  | AP 提交日期。类型是文字，不是 Date |
| `custom_industry_approval_date` | Data |  | 行业批准日期。同样是文字 |
| `custom_tax_lodgement_date` | Data |  | 报税日期。同样是文字 |
| `custom_rebate_amount_text` | Data |  | 返点金额文字 |
| `custom_fee_percentage_text` | Data |  | 收费比例文字 |
| `custom_fee_arrangement` | Small Text |  | 收费安排 |
| `custom_tg_tax_agent` | Select | TG - Yes、No | 是否 TG 税务代理 |
| `custom_portal_access_received` | Check |  | 门户权限是否收到 |
| `custom_portal_access_expiry_date` | Date |  | 门户权限到期日 |
| `custom_board_row_highlight` | Data |  | 这一行的高亮颜色。给自动化用，不是业务人员手填的资料 |
| `custom_board_row_highlight_by` | Data |  | 高亮是哪条规则打上的 |

门户权限的两个字段在 `Customer` 和 `Project` 上各有一份。客户主档保存时，会写到这个客户的项目上。项目上那一份仍可以在看板里单独改。

用户在 Grants 看板上还可以把一行滚到下一年的看板。详见第 8 节的 Roll over。

## 8. 两块看板共用的表格能力

这些操作 Accounting 和 Grants 都有。改的都是当前模块允许的那些 `Project` 字段。

用户可以做的操作：

- 打开一块看板，滚动查看项目。行多的时候分段加载
- 显示、隐藏列，调列宽和顺序。会计和 Grants 各自只能看到自己的列
- 在单元格里直接改值，改完写回 `Project`，或写回团队、软件、月度状态这些子表
- 搜索项目名
- 排序
- 打开高级筛选
- 把当前的列、筛选、排序存成一张 `Saved View`。范围可以是 Personal 或 Shared，并可以标成这块看板的默认视图
- 勾选多行，批量改同一个字段
- 批量改软件（写 `custom_softwares`）
- 批量改某一个角色上的人（写 `custom_team_members`）
- 从看板菜单导出 CSV
- 新建项目：选择客户、项目类型，并带上这块看板需要的字段
- Roll over / 复制一行到同一块或另一块看板
- 归档项目，或从归档恢复。原看板已经不存在时，项目先放在 `Project Type = Archived (Holding)`，恢复时再选一块真正的看板
- 删除项目，并连同它的任务一起删

Roll over 时这些列不给用户选带走或清空，系统固定处理：

| 字段 | 处理 |
| --- | --- |
| `customer` | 总是带走 |
| `company` | 总是带走 |
| `project_type` | 改成目标看板 |
| `project_name` | 按规则重新命名 |

其余数据列可以选带走、清空，或在复制时设成新值。Grants 默认滚到下一年的财年看板，状态重置为 Not started。也可以留在同一块看板。

`Saved View` 的字段：

| 字段 | 说明 |
| --- | --- |
| `title` | 视图名称 |
| `reference_doctype` | 这套视图针对哪种单据，看板用的是 Project |
| `project_type` | 属于哪块看板 |
| `columns` | 列配置，JSON |
| `filters` | 筛选，JSON |
| `sort_by`、`sort_order` | 排序。顺序是 asc 或 desc |
| `is_default` | 是否这块看板的默认视图 |
| `is_active` | 是否还在用 |
| `scope` | Personal 或 Shared |
| `sidebar_order` | 排序用的数字 |

## 9. 任务

任务是 ERPNext 的 `Task`，用标准字段 `project` 挂在某个 `Project` 下面。

用户可以做的操作：

- 在项目行上展开，看下面的任务
- 给一个项目新建任务
- 给选中的多个项目各建一条任务
- 改任务上的字段
- 改任务上的人员
- 删除任务，可以选择连同子任务一起删

看板上会用到的 `Task` 字段包括标准的 `subject`、`status`、`project`、`priority`，以及：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `custom_fiscal_year` | Link → `Fiscal Year` | 财年 |
| `custom_period` | Data | 期间文字 |
| `custom_task_members` | 子表 `Project Team Member` | 任务上的人，角色选项和项目团队相同 |
| `auto_repeat` | Link → `Auto Repeat` | ERPNext 标准重复任务字段，Smart Board 没有把它做成单独功能 |

`Task.status` 的可选项被改成：Not started yet、Working on it、Stuck、Done。默认是 Not started yet。

## 10. 状态与看板设置

项目状态下拉不是 ERPNext 原版的 Open / Completed。Property Setter 把 `Project.status` 改成下面这一池，默认 Not started：

Not started、Working on it、Waiting for client、R&D、Waiting for kickoff、Waiting for tech meeting、Waiting for tech evidence、Waiting for evidence review、Preparing R&D report、Waiting for report review and signature、Preparing application form、Waiting for AP review、Waiting for financial accounts、Preparing R&D exp calculation、Waiting for responses to fin queries、Final pack prep、Ready for manager review、Review points to be actioned、Ready for partner review、Ready to send to client、Sent to client for signature、Hold、Waiting for CTR、Waiting for payment、Not to Proceed、Completed。

Grants 使用其中按申报顺序排过的一段，从 Not started、Hold、Waiting for kickoff，一直到 Waiting for payment、Completed、Not to Proceed。

每一块看板还可以只启用这一池里的一部分。这个选择存在看板设置里，不另建一张业务单据。管理员可以：

- 调整看板在侧边栏的顺序
- 为某一种 `Project Type` 勾选允许出现的状态
- 开关个别特殊规则

普通改状态发生在看板单元格里，写的仍是 `Project.status`。

## 11. 自动化、提醒与通知

一条规则是一张 `Board Automation`。

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否启用 |
| `automation_name` | 规则名称 |
| `trigger_type` | 旧的触发类型字段，保存时仍要填一个合法选项 |
| `trigger_config` | 真正的触发条件，JSON |
| `actions` | 要执行的动作，JSON 数组 |
| `execution_count` | 跑过多少次 |
| `last_triggered` | 上次触发时间 |

管理员可以做的操作：

- 按当前模块列出规则、按名字搜索
- 新建或修改一条规则
- 启用、停用、删除

Accounting 能选的触发：

| 触发 | 含义 |
| --- | --- |
| Status changes to | 状态变成某一个值 |
| Status is | 状态已经是某一个值。不能单独作为唯一条件，避免每次保存都重复触发 |
| Project type is | 项目类型是某一块看板 |
| Date reaches | 某个日期字段到了当天，或到了及之后。日期字段从 `Project` 上的 Date 字段里选，不包括 ERPNext 自带的预计开始、预计结束、实际开始、实际结束 |

Accounting 能选的动作：

| 动作 | 写到哪里 |
| --- | --- |
| Roll Lodgement Due forward by frequency | 按 `custom_project_frequency` 把 `custom_lodgement_due_date` 往后推 |
| Reset status to | 把 `Project.status` 改成指定状态 |
| Notify someone | 通知该项目上某个角色的人：Assigned Person、Preparer、Manager 或 Partner |
| Archive project | 把项目归档 |
| Push a date | 把选定的日期或目标月份往后推一段：按频率、一周、两周、一月、一季或一年 |

Grants 能选的触发是 Date arrives（日期到了）和 Date is approaching（提前若干月、周、天）。动作是 Highlight row（给 `custom_board_row_highlight` 写颜色）和 Clear highlight。

到期类规则每小时跑一次。Grants 高亮每天跑一次。每次跑在某个项目上的结果写成 `Automation Run Log`：哪条规则、哪个项目、何时、从定时任务还是别处触发、成功还是失败、匹配了哪些条件、尝试了哪些动作、改了几个字段。具体改动在子表 `Automation Run Log Change`：`fieldname`、`field_label`、`action_type`、`from_value`、`to_value`。

通知本身写成 Frappe 的 `Notification Log`，接收人是被点名的 `User`。这包括自动化里的 Notify someone，也包括 Updates 里 @ 某人。邮件是否另发，取决于通知邮件开关。

Automation Logs 页面给用户看这些运行记录。

## 12. 动态、评论与撤销

项目上的 Updates 不是自定义表。一条 Update 是一张 Frappe `Comment`：`comment_type = Comment`，`reference_doctype = Project`，`reference_name` 是这个项目。

用户可以做的操作：

- 打开一个项目的 Updates，新增、修改、删除
- 在内容里 @ 人。被 @ 的人会收到 `Notification Log`
- 打开一个项目的活动记录
- 看全局活动：按人、按对象（项目或客户）、按动作（创建、更新、删除）筛选。更新的具体值默认遮住，输入正确密码后才显示
- 撤销一条项目字段修改，或按批次一起撤销

全局活动从三处拼出来：

| 动作 | 读哪张单据 |
| --- | --- |
| 创建 | `Project` 或 `Customer` 自己的创建时间和创建人 |
| 更新 | `Version`，其中 `ref_doctype` 是 Project 或 Customer |
| 删除 | `Deleted Document` |

项目行上的活动记录和撤销，针对的是允许撤销的那些项目字段变更。

## 13. 用户、角色与权限

用户是 Frappe `User`。用户管理页不打开标准用户表单。

管理员可以做的操作：

- 搜索用户
- 新建用户：姓名、邮箱、是否启用、能否进 Accounting、能否进 Grants
- 修改这些资料
- 给用户设密码

新建时邮箱就是 `User.name`。姓名拆进标准的 `first_name` / `last_name`。不发送 ERPNext 的欢迎邮件。两个模块权限就是给这个用户加上或去掉 Role `Smart Accounting User`、`Smart Grants User`。

每个登录用户在 Settings 里可以改自己的资料和密码。

谁能改什么，沿用 Frappe 对 `Customer`、`Project`、`Task` 的读写权限，再叠加：

- 管用户、管自动化、管看板设置，需要管理员一类角色（Administrator、System Manager，或代码里认的同类角色）
- 看不看得见一块看板，先看有没有对应模块角色
- 归档客户、改客户，需要对该 `Customer` 有写权限

## 14. 当前数据是怎么放的

业务上的一件事，和实际存放的位置：

| 业务上的东西 | 实际存放 |
| --- | --- |
| 客户是谁、是否归档、负责合伙人 | `Customer`：`customer_name`、`disabled`、`custom_partner` |
| 客户下的实体、ABN、年结 | `Customer Entity`，挂在 `Customer.custom_entities` |
| 会计或 Grants 的一行工作 | 一张 `Project` |
| 这行工作在哪块看板 | `Project.project_type` → `Project Type` |
| 这行工作属于哪个客户 | `Project.customer` → `Customer` |
| 会计截止日、频率、年结、各种外部系统状态 | `Project` 上的 `custom_*` 字段 |
| Grants 的 ABN、地址、联系人 | 也在 `Project` 的快照字段上，不回写客户主档 |
| 门户权限 | `Customer` 和 `Project` 各一份。客户保存时抄到项目 |
| 谁在做这个项目 | `Project Team Member` |
| 用什么软件 | `Software` 主数据，加上 `Project Software` |
| 每个月做完没有 | `Monthly Status` |
| 任务 | `Task` |
| 列和筛选怎么摆 | `Saved View` |
| 到期提醒、自动改状态、Grants 高亮 | `Board Automation`，结果在 `Automation Run Log` |
| 项目讨论 | `Comment` |
| 谁改过客户或项目 | `Version` |
| 站内提醒 | `Notification Log` |

## 15. 现在还没做完或只是占位的部分

- Report 页只有导航和空页面
- Settings 里的 Personal Preferences、Notification Preferences 是禁用按钮
- `Customer.custom_referred_by` 和 Contact 上的推荐人、社交账号字段已经加在单据上，客户页的新建和编辑没有把它们当成主要操作
- Grants 的 AP 提交、行业批准、报税这三个字段类型是 Data，不是 Date
- 活动记录这个视图能打开，当前左侧导航没有单独一项

## 16. 主要流程

工作看板只列出 `is_active = Yes` 的项目。Archived Projects 只列出 `is_active = No` 的项目。

### 新建客户

1. 客户名称必填，且不能与已有 `Customer.customer_name` 或单据名重复。
2. 未填客户类型时按 Individual 写入，再转成 ERPNext 允许的值。
3. 未填客户分组、地区时，分别使用 All Customer Groups、All Territories。
4. 若同时提交主实体，实体名称和实体类型都要有，年结必填。该行写入 `Customer.custom_entities`，`is_primary = 1`。
5. 负责合伙人写入 `Customer.custom_partner`。

没有客户写权限时不能保存。

### 归档客户与恢复客户

归档需要对该 `Customer` 有写权限。

1. `Customer.disabled` 设为 1。
2. 该客户下所有 `is_active = Yes`、且当前用户有写权限的项目改为 `is_active = No`。
3. 这些项目的 `custom_archive_source` 写 Client Archive，`custom_archive_source_ref` 写客户单据名。
4. 这一步不跑看板自动化。没有写权限的项目跳过，不中断其余项目。

恢复同样需要写权限。

1. `Customer.disabled` 设回 0。
2. 只恢复同时满足这三项的项目：属于该客户、`is_active = No`、`custom_archive_source = Client Archive` 且 `custom_archive_source_ref` 是该客户。
3. 恢复后 `is_active = Yes`，归档来源两个字段清空。不跑看板自动化。

手动归档或自动化归档的项目，不会因为恢复客户而被打开。

### 删除客户

需要 `Customer` 删除权限。只要还有任意 `Project.customer` 指向该客户，就拒绝删除，并返回关联项目数量。没有关联项目时删除这张 `Customer`。

### 新建项目

创建接口接受的字段只有：`project_name`、`customer`、`company`、`custom_fiscal_year`、`project_type`、`custom_grants_fy_label`、`custom_project_frequency`、`custom_year_end`、`custom_target_month`、`status`、`priority`。

页面上的必填项：

- Accounting：项目名称、客户、公司、财年、项目类型。
- Grants：项目名称、客户、公司、项目类型。项目类型只能是 FY 2024 到 FY 2027。公司默认 Top Grants，频率默认 One-off。

保存前和保存时：

1. 未登录、数据不是对象、项目名称为空，直接失败。
2. `project_name` 已存在则失败，不创建第二张。
3. 没有 `Project` 创建权限则失败。
4. `customer` 可以传客户单据名。若传的是客户显示名，且只匹配到一个 `Customer`，则改写成单据名。匹配到多个则失败。
5. `custom_year_end` 为空，或只是字段默认值时，从所链接的 `Customer Entity.year_end` 带入；没有链接实体时，从该客户的主实体带入，并写上 `custom_customer_entity`。
6. 团队里还没有带用户的 Partner 时，用 `Customer.custom_partner` 补一行，角色 Partner，分配日期为当天。
7. `status` 不在当前状态下拉里时，改为 Not started；池子里没有这一项则用第一项。ERPNext 计算完成百分比时不会把状态改回 Open。

校验失败时不留下半张项目。成功后返回新建的 `Project`。

### 归档项目

在工作看板上勾选项目，确认后把 `is_active` 写成 No。这些行从当前看板消失，出现在 Archived Projects。

保存时若没有另行标明来源，`custom_archive_source` 写 Manual，`custom_archive_source_ref` 清空。这条保存会跑看板自动化。

另外两种归档不走这个按钮：

- 自动化动作 Archive project：`is_active = No`，来源 Automation，引用写规则名称。
- Roll over 时勾选归档原项目：来源 Manual，并且不跑看板自动化。

### 恢复项目

只在 Archived Projects 里操作。确认后把 `is_active` 写成 Yes，并清空 `custom_archive_source`、`custom_archive_source_ref`。恢复后的行离开归档列表。

`project_type` 为 Archived (Holding) 的项目不能直接回到原看板。系统先要求为每一行另选一块当前模块里存在的看板，选中的类型写入 `project_type`，然后再恢复。取消选择则整批都不恢复。

### 删除看板

删除一条 `Project Type` 时：

1. 仍挂在这块看板上的项目改到 `project_type = Archived (Holding)`，`is_active = No`。
2. `custom_archive_source` 写 Type Deleted，`custom_archive_source_ref` 写被删看板的名称。
3. 指向这块看板的 `Board Automation` 删除。`Project Template` 上的项目类型清空。
4. Archived (Holding) 自身不会被挪走，也不会按这个流程删掉。

这次改写用数据库直接更新，不跑项目保存上的自动化。

### Roll over

在工作看板上勾选项目后打开。Grants 和 Accounting 都可用。

目标看板：

- Grants 默认下一年。当前看板名里有四位年份，且下一年的看板在 FY 2024 到 FY 2027 之中，就用那一块；否则用另一块财年看板。
- Accounting 默认留在当前看板。可选目标来自当前模块允许的 `Project Type`。

每一列可以带走、清空，或设成新值。日期列还可以选择加一年。Accounting 的财年默认加一年：取结束日次日开始的那个 `Fiscal Year`，没有则取开始日更晚的下一张。

系统固定处理，不进入带走或清空：

| 字段 | 结果 |
| --- | --- |
| `customer`、`company` | 原值抄到新项目 |
| `custom_fiscal_year` | 先抄原值；若选择财年加一且用户没有另设，则改成下一财年 |
| `project_type` | 目标看板 |
| `status` | 新项目写成 Not started。界面上这一列默认是清空 |
| `project_name` | 重新命名 |
| `is_active` | 不抄 |

新名称先去掉原名称末尾的财年或 `(Roll Over)` 标记，再加后缀。后缀优先用用户填写的；没有则在看板变了时用目标看板名，财年变了时用新财年，否则用 `(Roll Over)`。名称仍冲突时，在括号里从 2 开始递增。

团队和软件只有在用户选择带走时才复制。团队行的分配日期改为当天，空角色写成 Preparer。

用户选择清空的字段在插入后仍保持空，不用单据默认值填回去。年结若被带走或被设成新值，创建时不再从客户实体覆盖。

源项目必须可读。新项目按正常创建权限插入。某一行失败不影响其他行。只有生成了副本、且用户勾了归档原项目时，才把对应源项目设为 `is_active = No`，来源 Manual，不跑自动化。

### 删除项目

确认文案说明会连同任务一起删除，且不能撤销。需要该 `Project` 的删除权限。

1. 先删挂在该项目上的 `Task`。默认连同 `parent_task` 下面的子任务，先删子任务再删父任务。删任务前先删它的 `Monthly Status`。任一任务删不掉则停止，项目保留。
2. 再删指向该项目的 `Auto Repeat`。删不掉则停止，项目保留。
3. 再删指向该项目的 `Monthly Status`。
4. 最后删 `Project`。若仍被其他单据引用，删除失败，项目保留。

### 撤销项目修改

项目保存时，看板字段的前后值写成 `Comment`，`comment_type = Info`，内容以 `SB_ACTIVITY::` 开头。

可以撤销的是：`custom_` 字段，以及 `customer`、`project_name`、`status`、`notes`、`project_type`、`company`、`priority`、`expected_start_date`、`expected_end_date`、`estimated_costing`、`is_active`。字段必须不是只读，也不是子表。`custom_archive_source`、`custom_archive_source_ref`、`custom_board_row_highlight` 不记入可撤销记录。

撤销需要该项目的写权限。当前值必须仍等于当时改成的值，否则拒绝，不覆盖后来的修改。写回旧值时不跑看板自动化。

批量撤销按同一次修改的批次处理。不能撤销、没有写权限、或字段已被再改过的行跳过，其余行继续写回。

---

# 第二部分：新系统

需求只从对话里已经说定的内容写入。说定的放第 1 节，还没选的放第 2 节，明确可以后做的放第 3 节。参考材料放第 5 节，不从里面采纳功能。

## 1. 已确定

新系统按当前 Smart Grants 的方式运营：用看板管理工作，并记录过程。只使用流程的记录、管理和控制时，系统就能运行。

先做独立的任务管理。数据由人工录入。

工作状态的操作应当足够顺滑。

后加的功能加上之后，原来的工作流用法保持可用。

## 2. 尚未确定

- CRM 不排除。做到哪一步尚未确定。
- AI 与代码如何分界。候选有两个：Agent 负责复杂任务、本地 AI 负责简单任务；或者 Agent 与代码分离。
- 待处理邮件接到页面上的方式。

## 3. 以后再做

这些已经说过要有，但不在第一版里做。

- 评估能否用 API 同步 shared drive。这不是任务管理运行的前提。
- 邮件：提示待处理邮件；收到后自动生成回复草稿，人工审核后才发送；发送后记录时长，并持续追踪邮件状态。
- AI 流程自动化。

## 4. Demo 范围

Demo 只包含按 Smart Grants 方式运行的工作流：流程的记录、管理和控制。

邮件、shared drive 同步、AI，以及第 5 节参考材料里的内容，都不在 demo 里。

## 5. 参考：Grant OS 交付包

来源是领导提供的 `Grant-OS-交付包.zip`。其中有开发指南、架构方案网页和 `CLAUDE.md`。它描述的是另一套补助案件系统方案，包括证据、申报主张、死线、收费、规则、邮件与网盘、会计软件、政府门户、AI 闸门和学习闭环。

该包用于对照。其中的功能、阶段计划和「不做什么」都不是本系统已经确定的需求。
