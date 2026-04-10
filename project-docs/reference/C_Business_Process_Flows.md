# 📄 Document C: Business Process Flows
# 业务流程文档

**项目**: Smart Accounting  
**版本**: v2.1  
**日期**: 2026-03-10  
**状态**: ✅ Smart Board 已落地（流程持续细化）

---

## 2026-04 当前状态补充

### 近期业务推进相关变化

- ✅ **Smart Grants 已开始进入实际业务使用**
  - 相关页面已开始使用，数据导入工作已启动并完成首轮导入。
- ✅ **Grants 联系信息与字段结构已继续校对**
  - 包括 contact information 核对，以及缺失字段/列的补充。
- ✅ **Email 与 Report 工作重新进入操作链**
  - 近期已继续推进 email 发送与 report 相关工作，适合在后续流程细化中补充为支持性流程。
- ✅ **系统运维与稳定性检查持续穿插在业务流程之间**
  - 当前真实工作不只包括业务处理，也包括备份、权限调整、debug、验证与维护。

### 文档定位提醒

- 本文档更适合记录**稳定的业务流程模型**。
- 与每周发生的导入、核对、验证、支持性处理相关内容，建议统一写入：
  - `../project-docs/r-and-d-notes/`

## 文档目的

> 本文档描述 Smart Accounting 系统的**业务流程**。
> 
> **当前状态**: General Workflow，后续会逐步细化。
> 
> **BPMN 源文件**: 使用 draw.io 绘制，原图附在本文档同目录下。

---

## 目录

1. [参与角色](#1-参与角色)
2. [主流程 - Tax Return Workflow](#2-主流程---tax-return-workflow)
3. [流程节点说明](#3-流程节点说明)
4. [状态映射](#4-状态映射)
5. [待细化内容](#5-待细化内容)

---

## 1. 参与角色

| 泳道 | 角色 | 说明 |
|------|------|------|
| **CLIENT** | 客户 | 签署 EL、审核、签字、付款、确认完成 |
| **USER** | 内部用户 | Preparer/Manager/Partner，执行具体工作 |

> **注**: 当前图中没有 SYSTEM 泳道，系统操作隐含在 USER 操作中。
> 后续细化时可以拆分出 SYSTEM 泳道。

### 1.2 2026-01：Smart Board 对应的“系统触点”

> 当前平台入口为 `/smart` selector；已落地业务模块主要是 **Smart Accounting（`/smart-accounting`）**，并直接驱动 ERPNext 的 Project/Task 数据：
- **Board（按 Project Type）**：查看/筛选/编辑 Project 字段
- **Dashboard**：展示我的 active Projects 与高频状态卡片，可跳转 `status-projects`
- **Client Projects**：从 Clients 进入的 cross-project-type 项目列表，带临时 customer scope
- **Status Projects**：从 Dashboard 状态卡进入的项目列表，带临时 status scope
- **Archived Clients / Archived Projects**：查看与恢复归档记录
- **Automation Logs**：查看自动化执行结果与字段变化
- **Tasks（展开行）**：查看/编辑 Task（含人员、Monthly Status）
- **Engagement Letter**：在 Project 的 `custom_engagement_letter`（Attach）上传/Replace/查看
- **Saved View**：保存列配置与过滤条件，作为默认视图来源
- **Monthly Status**：Task 的月度网格状态 + Project 的月度汇总（Done x/y · %）

### 1.1 外部用户入口（/smart）说明（2026-03 更新）

在 SaaS 产品化模式下：
- 外部用户不进入 ERPNext Desk（`/app`），平台入口为 **`/smart`**
- `/smart` 负责 selector / module chooser
- 当前日常业务主要通过 **`/smart-accounting`** 完成（Boards / Clients / Settings 等），底层仍复用 ERPNext/Frappe 的 DocType 数据
- **`/smart-grants`** 当前只是占位模块入口，尚未承载 grants 业务流程

这不会改变业务流程本身，但会改变“用户触点”：
- USER/CLIENT 先在 `/smart` 选择模块
- 当前实际操作入口统一在 `/smart-accounting` 完成（查看项目、更新状态、沟通/评论等）

---

## 2. 主流程 - Tax Return Workflow

### 2.1 BPMN 流程图

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                                                                             │
│                                                                                                                     │
│    ●───►┌─────────┐                              ┌─────────┐      ┌─────────────┐                                  │
│         │ Sign EL │                              │ Review  │──►◇──┤    Sign     │                                  │
│         └────┬────┘                              └────┬────┘   │   └──────┬──────┘                                  │
│              │                                        ▲        │          │                                         │
│              │                                        │        │No        │                                         │
│              │                                        │        ▼          │                                         │
│              │                                        │   ┌─────────┐     │    ┌───────────┐   ┌───────────┐       │
│              │                                        │   │ Send to │     │    │    Pay    │   │  Confirm  │       │
│              │                                        │   │ Rework  │     │    │  Invoice  │   │ Complete  │───►●   │
│              │                                        │   └────┬────┘     │    └─────┬─────┘   └───────────┘       │
│              │                                        │        │          │          │                              │
│              │                                        └────────┘          │          │                              │
│                                                        (Yes)              │          │                              │
├─────────────┼────────────────────────────────────────────────────────────┼──────────┼──────────────────────────────┤
│  USER       │                                                             │          │                              │
│             ▼                                                             │          │                              │
│      ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐       │          │                              │
│      │  Create   │──►│  Collect  │──►│   Work    │──►│  Review   │──►◇   │          │                              │
│      │   Task    │   │   Docs    │   │           │   │           │   │   │          │                              │
│      └───────────┘   └───────────┘   └─────▲─────┘   └───────────┘   │   │          │                              │
│                                            │                          │   │          │                              │
│                                            │    ┌───────────┐        │No │          │                              │
│                                            │    │  Review   │◄───────┘   │          │                              │
│                                            └────│ Feedback  │            │          │                              │
│                                                 └───────────┘            │Yes       │                              │
│                                                                          │          │                              │
│                                                                          ▼          │                              │
│                                                                         ⊕           │                              │
│                                                                      ┌──┴──┐        │                              │
│                                                                      │     │        │                              │
│                                                                      ▼     ▼        │                              │
│                                                               ┌─────────┐ ┌─────────┐                              │
│                                                               │ Send for│ │  Send   │                              │
│                                                               │ Signing │ │ Invoice │                              │
│                                                               └────┬────┘ └────┬────┘                              │
│                                                                    │           │                                    │
│                                                                    ▼           ▼                                    │
│                                                               ┌─────────┐ ┌─────────┐                              │
│                                                               │ Review  │ │ Review  │                              │
│                                                               │Signature│ │ Payment │                              │
│                                                               └────┬────┘ └────┬────┘                              │
│                                                                    │           │                                    │
│                                                                    └─────┬─────┘                                    │
│                                                                          │                                          │
│                                                                          ⊕                                          │
│                                                                          │                                          │
│                                                                          ▼                                          │
│                                                                   ┌───────────┐                                    │
│                                                                   │  Lodge    │                                    │
│                                                                   │  to ATO   │                                    │
│                                                                   └───────────┘                                    │
│                                                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Legend:  ● Start/End   ◇ Exclusive Gateway (XOR)   ⊕ Parallel Gateway (AND)   ──► Flow
```

### 2.2 流程概述

```
CLIENT: Sign EL ─────────────────────► Review ──► Sign ──► Pay Invoice ──► Confirm Complete
                                         ▲         │
                                         │ (Rework)│
                                         └─────────┘

USER:   Create Task ──► Collect Docs ──► Work ──► Review ──► [Send for Signing + Send Invoice] ──► Lodge to ATO
                                          ▲          │
                                          │ (Reject) │
                                          └──────────┘
```

---

## 3. 流程节点说明

### 3.1 CLIENT 节点

| 节点 | 说明 | 触发条件 | 后续操作 |
|------|------|---------|---------|
| **Sign EL** | 签署 Engagement Letter | 流程开始 | 触发 USER 创建 Task |
| **Review** | 客户审核工作成果 | USER 发送审核请求 | 通过→Sign / 不通过→Send to Rework |
| **Send to Rework** | 退回修改 | 客户不满意 | 返回 Review |
| **Sign** | 签字确认 | 审核通过 | 等待 Invoice |
| **Pay Invoice** | 支付账单 | 收到 Invoice | USER Review Payment |
| **Confirm Complete** | 确认完成 | 全部完成 | 流程结束 |

### 3.2 USER 节点

| 节点 | 说明 | 触发条件 | 后续操作 |
|------|------|---------|---------|
| **Create Task** | 创建任务 | 客户签署 EL | Collect Docs |
| **Collect Docs** | 收集客户资料 | Task 创建后 | Work |
| **Work** | 执行工作 | 资料收集完成 | Review |
| **Review** | 内部审核 (Manager/Partner) | 工作完成 | 通过→并行 / 不通过→Feedback |
| **Review Feedback** | 处理审核意见 | 审核不通过 | 返回 Work |
| **Send for Signing** | 发送给客户签字 | 审核通过 (并行) | Review Signature |
| **Send Invoice** | 发送账单给客户 | 审核通过 (并行) | Review Payment |
| **Review Signature** | 确认客户签字 | 客户签字后 | 等待汇合 |
| **Review Payment** | 确认客户付款 | 客户付款后 | 等待汇合 |
| **Lodge to ATO** | 提交给 ATO | 签字+付款确认 | 流程结束 |

### 3.3 网关说明

| 网关 | 类型 | 位置 | 说明 |
|------|------|------|------|
| **Review Gateway (USER)** | XOR | Review 后 | Approved → 继续 / Rejected → Feedback |
| **Client Approval Gateway** | XOR | Client Review 后 | Approved → Sign / Not Approved → Rework |
| **Parallel Split** | AND | 审核通过后 | 同时触发 Signing 和 Invoice 流程 |
| **Parallel Join** | AND | Lodge 前 | 等待 Signature 和 Payment 都完成 |

---

## 4. 状态映射

> **2026-03 对齐说明**：下面的 Tax Return BPMN 仍可作为概念流程参考，但它**不是**当前系统里一一对应的状态机。当前产品里同时存在三套状态，需要区分：
- **Project.status**：Board 主表的业务状态，来源于 Project.status 全局状态池，并可按 board 配 allowed subset
- **Task.status**：Task 本体状态（粗粒度）
- **Monthly Status.status**：Task 的财年 12 个月进度状态，用于月度网格和 Project 月度汇总

### 4.1 当前系统中的状态口径

| 状态层 | 当前用途 | 典型示例 |
|---------|---------|---------|
| **Project.status** | Board 主表显示、Dashboard 状态统计、状态筛选 | Not started / Working on it / Ready for manager review / Completed |
| **Task.status** | Task 本体粗粒度状态 | Open / Working / Completed |
| **Monthly Status.status** | Task 月度进度 | Not started yet / Working on it / Stuck / Done |

### 4.2 当前 UI 中的关键流程触点

| 触点 | 当前行为 |
|------|---------|
| **Dashboard 状态卡 → Status Projects** | 带临时 `status` scope 进入列表；离开产品页切回普通 board 时会清空该临时过滤 |
| **Clients → Client Projects** | 带临时 `customer` scope 进入 cross-project-type 列表；离开后清空该临时过滤 |
| **Archived Clients / Archived Projects** | 只查看归档对象；恢复后返回 active 数据流 |
| **Automation Logs** | 查看 rule 执行历史、字段变化、并可打开关联项目 |

### 4.3 旧 BPMN 与当前实现的关系

- BPMN 中的 `Collect Docs / Review / Send for Signing / Invoice` 更适合作为**业务阶段语义**，不应直接等同于当前任一单一字段。
- 若需要严格流程控制，建议未来通过 **Board Automation + comments/activity log + board status subset** 去表达，而不是把所有业务节点强塞进 Task.status。

---

## 5. 待细化内容

> 以下内容将在后续版本中逐步添加

### 5.1 TODO: 细化流程

- [ ] **Sign EL 流程**: Engagement Letter 签署的详细步骤
- [ ] **Collect Docs 流程**: 文档收集的具体步骤，文档清单管理
- [ ] **Review 流程**: Manager 和 Partner 两级审核的详细流程

### 5.2 状态体系（2026-01 实际实现）

> 注意：系统里同时存在三套“状态”，用途不同，避免混淆：
- **Project.status**：项目主状态（业务线/流程阶段），用于 Board 主表显示与筛选
- **Task.status**：任务本体状态（ERPNext 原生），用于任务列表的粗粒度状态
- **Monthly Status.status**：月度进度（按财年 12 个月），用于 Task 的月度网格与 Project 的月度汇总

### 5.3 Engagement Letter（EL）在系统中的落点
- 目前落点：`Project.custom_engagement_letter`（Attach）
- Smart Board 行为：整格点击上传，上传使用 Frappe 原生 `/api/method/upload_file`，并写回该字段，表格展示文件名与 Replace
- [ ] **Client Review 流程**: 客户审核的详细交互
- [ ] **Invoice 流程**: 账单生成、发送、跟踪的详细步骤
- [ ] **Lodge 流程**: ATO 提交的详细步骤

### 5.2 TODO: 添加其他 Workflow

- [ ] **BAS Workflow**: 商业活动报表流程
- [ ] **Bookkeeping Workflow**: 簿记流程
- [ ] **Grant Workflow**: TG 项目流程
- [ ] **Client Onboarding Workflow**: 新客户入职流程

### 5.3 TODO: 系统操作映射

- [ ] 添加 SYSTEM 泳道
- [ ] 映射每个 USER 操作对应的系统 API
- [ ] 定义自动化触发规则

### 5.4 TODO: 异常流程

- [ ] 任务取消流程
- [ ] 客户退出流程
- [ ] 超时处理流程

---

## 附录

### A. BPMN 源文件

- 原图使用 draw.io 绘制
- 文件位置: `project-docs/reference/bpmn/tax-return-workflow.drawio`

### B. 相关文档

- `project-docs/reference/A_Data_Model_Assessment.md` - 数据模型重构规划
- `project-docs/reference/B_Code_Architecture_Review.md` - 代码架构审查

### C. 修订历史

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| 1.0 | 2025-12-01 | 初始版本 |
| 2.0 | 2025-12-09 | 根据 draw.io BPMN 图更新；简化结构；添加待细化章节 |
