# 📄 Document B: Code Architecture Refactoring
# 代码架构重构文档

**项目**: Smart Accounting  
**版本**: v1.2  
**日期**: 2026-03-10  
**状态**: ✅ 已落地（持续迭代）

---

## 2026-04 当前状态补充

### 架构与产品层近期变化

- ✅ **Smart Accounting / Smart Grants 的并行使用路径已进一步确认**
  - 近期工作重点之一是确认分离后的结构能够长期内部使用，并在实际操作中继续演进。
- ✅ **系统稳定性与日常运维已持续进行**
  - 包括日常 debug、数据备份测试、VM checkpoint 整理与测试。
- ✅ **系统级分页治理已完成一轮收口**
  - Users、Project Activity、Notifications、Dashboard、Client/Status Projects、Global Activity Log、Automations、Saved Views、Automation Logs 均已按当前产品需要补齐或强化。
- ✅ **文档治理开始进入体系化管理**
  - 项目文档入口与 R&D Notes 已单独建立，后续周更与验证记录将进入统一文档体系，而不是继续散落。

### 当前建议

- 本文档继续保留为**架构演进参考**。
- 与每周工作、验证、操作性维护更相关的内容，请转到：
  - `../project-docs/r-and-d-notes/`
  - `../project-docs/document-map.md`

## 文档目的

> 本文档是 Smart Accounting 项目的**代码架构重构规划文档**。
> 
> - **分析当前架构的核心问题**
> - **定义当前已落地架构**
> - **记录 2026-03 的主要膨胀区与后续重构路线**

---

## 2026-03 对齐说明

### 当前实现的核心结论
- Smart Board 已不再只是单一 board 页面，而是一个完整产品壳：`dashboard`、`board`、`client-projects`、`status-projects`、`archived-clients`、`automation-logs`、`settings`、`report`
- 当前最值得警惕的膨胀区不是“没有模块化”，而是**某些模块已经开始补丁式扩张**：`app.js` 的导航状态机、`MainContent.showPlaceholder()` 的 view mount/destroy、`project_board.py` 的 God module 化
- 现阶段建议采用**增量收敛**，而不是大重写：优先抽统一导航入口、product view registry、后端 shared helpers

### 当前优先重构的 3 个区域
1. `public/js/smart_board/app.js`
   当前同时承担路由器、URL 同步、filter 生命周期、页面装配器职责，已出现多处重复导航分支。
2. `public/js/smart_board/components/Layout/MainContent.js`
   `showPlaceholder()` 中各 product view 的 destroy/create/init 模板重复明显，适合做 registry 化。
3. `api/project_board.py`
   已同时承载 Project 查询、Task 批量读取、Monthly Status、Dashboard、hydration、user meta 等职责，边界过宽。

---

## 目录

1. [重构背景与目标](#1-重构背景与目标)
2. [当前架构分析](#2-当前架构分析)
3. [目标架构设计](#3-目标架构设计)
4. [重构策略](#4-重构策略)
5. [风险评估](#5-风险评估)

---

## 1. 重构背景与目标

### 1.1 项目概况

| 指标 | 值 |
|------|-----|
| **总代码行数** | ~50,000+ |
| **前端 JS** | 34,448 行 / 40+ 文件 |
| **后端 Python** | ~5,000 行 / 15+ 文件 |
| **CSS** | ~5,000 行 / 10+ 文件 |

### 1.2 当前架构健康度（2026-01 更新）

| 维度 | 评分 | 说明 |
|------|------|------|
| **模块化** | 7/10 | 已采用 ES Modules 分层（components/services/store/utils），并持续拆分大文件 |
| **耦合度** | 7/10 | 已引入 env/ui/navigation adapter，减少对 `frappe.*` 的散落依赖 |
| **可维护性** | 7/10 | Header/MainContent/BoardTable 已拆分；后续按功能继续拆分子模块 |
| **可测试性** | 3/10 | 仍缺少测试框架，但模块边界已清晰，具备引入测试的基础 |

### 1.3 重构动机

当前系统能够正常运行，但存在以下核心问题需要通过重构解决：

| 问题类别 | 具体表现 |
|---------|---------|
| **历史全局污染（Legacy）** | 旧 Desk 页面存在 window.Manager 互相调用；Smart Board 已避免该模式 |
| **大文件风险（当前关注点）** | `project_board.py` 与 `BoardTable.js` 复杂度偏高，需要持续拆分（已做第一轮拆分） |
| **无模块系统（Legacy）** | 旧页面依赖手动加载；Smart Board 已统一 ES Modules + bench/esbuild 构建 |
| **API 分散** | API 调用散落各处，错误处理不统一 |

### 1.4 重构目标

#### ✅ 已确定的核心目标

| 目标 | 说明 | SaaS 价值 |
|------|------|----------|
| **模块化** | UI、业务逻辑、数据层分离 | 可维护、可测试、团队协作 |
| **最高可扩展性** | 插件式架构，功能可插拔 | 按需定制、快速迭代 |
| **UI 与逻辑解耦** | 改 UI 不影响业务代码 | 多主题、白标、快速换肤 |
| **消除代码冗余** | DRY 原则，组件复用 | 维护成本降低 |

#### ✅ 当前已确定的实现方案

```
- [x] 模块化技术：ES Modules
- [x] 状态管理：自定义 Store（modules/projects/filters/dashboard/clients）
- [x] 构建方式：bench/esbuild 输出到 /assets/smart_accounting/js/smart_board/*
- [x] 产品入口：/smart Website Shell + /app/project-management 内部入口
- [x] 适配层：uiAdapter / navigationService / env
```

---

## 2. 当前架构分析

### 2.1 技术栈

```
Frontend:
├── JavaScript (ES6+) + ES Modules
├── 自定义 Store（类 Redux）
├── 自研行内编辑器（Inline editors）/ MultiLinkPicker
└── CSS Variables + Smart Board 组件样式

Backend:
├── Python 3.10+
├── Frappe Framework 15.x
├── ERPNext 15.x
├── MariaDB 10.x
└── Redis
```

### 2.2 代码结构

```
smart_accounting/
├── smart_accounting/
│   ├── hooks.py                    # Frappe 钩子配置
│   ├── access_control.py           # 权限控制
│   │
│   ├── public/                     # 前端资源
│   │   ├── js/smart_board/          # ✅ Smart Board（ES Modules）
│   │   │   ├── app.js               # 应用编排（薄）
│   │   │   ├── components/          # Sidebar/Header/MainContent/BoardTable...
│   │   │   ├── columns/specs/       # 列定义（Project/Task）
│   │   │   ├── services/            # project/view/fileUpload/meta...
│   │   │   └── store/               # modules/projects/filters/views...
│   │   └── css/smart_board/         # Smart Board 样式
│   │
│   ├── www/                        # Website 页面（产品壳）
│   │   ├── smart/                  # ✅ `/smart`：平台 selector / module chooser
│   │   ├── smart-accounting/       # ✅ `/smart-accounting`：当前 Accounting 模块入口
│   │   └── smart-grants/           # ✅ `/smart-grants`：未来 Grants 模块占位入口
│   │
│   ├── page/                       # Desk Page（内部/管理员可用）
│   │   └── project_management/     # `/app/project-management`：按需加载 Smart Board（Desk 内嵌）
│
└── docs/                           # 文档
```

### 2.3 2026-01 已落地的“防回归”工程改进
- ✅ **编辑器稳定性**：EditingManager 增加 portal click 保护，MultiLinkPicker 不再因为“点下拉就退出”导致无法选择
- ✅ **附件上传**：统一走 Frappe 原生 `/api/method/upload_file`，并提供列级 commit 强制落库（避免只更新 UI 未保存）
- ✅ **性能护栏**：
  - 动态 fields（按可见列请求）
  - 子表 hydration 按需
  - 虚拟滚动 + 无限滚动分页
  - task counts 预取 in-flight 去重
  - projects/fetchProjects 并发回写保护（快速切换 board 不闪回）

### 2.3 模块边界问题

#### 当前状态（高耦合）

```
┌─────────────────────────────────────────────────────────────────┐
│                      window (Global Scope)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ SubtaskMgr   │  │ ModalMgr     │  │ ReportsMgr   │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                    │
│         │    直接调用     │    直接调用     │                    │
│         ▼                 ▼                 ▼                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ TableMgr     │  │ FilterMgr    │  │ EditorsMgr   │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                    │
│         └─────────────────┼─────────────────┘                    │
│                           │                                      │
│                           ▼                                      │
│                    ┌──────────────┐                              │
│                    │ ProjectMgmt  │ (main.js)                    │
│                    └──────────────┘                              │
│                                                                  │
│  问题: 所有 Manager 都在 window 上，互相直接调用                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 依赖示例

```javascript
// main.js 直接引用所有 Manager
this.tableManager = window.TableManager;
this.filterManager = window.FilterManager;
this.modalManager = window.ModalManager;
// ... 20+ 个直接引用

// subtask.js 直接调用其他 Manager
window.ModalManager.showSubtaskModal();
window.TableManager.refreshRow();

// 问题: 任何模块都可以调用任何其他模块
```

### 2.4 核心技术债务（2026-01 更新）

| ID | 问题 | 影响 | 优先级 |
|----|------|------|--------|
| TD-001 | 全局变量污染 (20+ window.Manager) | 可维护性、可测试性 | 🔴 高 |
| TD-002 | God File - index.py (3,059行) | 可维护性 | 🔴 高 |
| TD-003 | God File - combination-view.js (2,325行) | 可维护性 | 🔴 高 |
| TD-004 | 无 ES6 模块系统 | 开发效率 | ✅ 已解决（Smart Board 已使用 ES Modules） |
| TD-005 | 编辑器重复代码 | 代码复用 | 🟡 中 |
| TD-006 | API 调用分散 | 错误处理一致性 | 🟡 中 |
| TD-007 | 无单元测试 | 重构信心 | 🟢 低 |

---

## 2.5 已落地的目标架构（2026-01）

### 2.5.1 产品入口与隔离

**对外用户**：
- 先进入 `/smart`（Website Shell selector）
- 再按角色进入 `/smart-accounting` 或 `/smart-grants`
- 访问任何 `/app*`（Desk）会被重定向回 `/smart`（由 `hooks.py before_request` + `access_control.py` 实现）

**管理员/内部**：
- 仍可访问 Desk（`/app`）用于系统维护与配置

### 2.5.2 Smart Board 模块分层（已落地）

```
smart_board/
├── app.js                          # 应用编排（尽量保持“薄”）
├── components/
│   ├── Layout/                     # Sidebar/Header/MainContent
│   └── BoardView/                  # BoardTable/Row/Cell + 子模块
├── controllers/                    # action handler（避免 app.js 膨胀）
├── services/                       # api/ui/navigation adapter
├── store/                          # state 管理
└── utils/                          # constants/helpers/viewTypes/env
```

### 2.5.3 “防膨胀”策略（必须遵守）
- `app.js`：只做编排；任何“动作分发/业务细节”下沉到 `controllers/*` 或 `services/*`
- 组件内不得散落 `frappe.set_route/new_doc/ui.Dialog` 等 Desk-only 调用，统一走 `services/navigationService.js` 与 `services/uiAdapter.js`
- `BoardTable` 等复杂组件按 “render / resize / storage / editing / sorting” 子模块持续拆分

---

## 2.6 构建与缓存策略（开发期注意）

当前 Smart Board 以 ESM 文件直接从 `/assets/.../*.js` 载入，浏览器会对静态资源设置较长缓存（例如 `Cache-Control: max-age=43200`）。

开发期建议：
- Chrome DevTools → Network 勾选 **Disable cache**
- 或使用无痕窗口测试
- 修改代码后执行：`bench build --app smart_accounting` + `bench --site <site> clear-cache && bench --site <site> clear-website-cache`

> 未来如果希望完全避免“旧模块缓存导致 UI 不更新”，可以将 Smart Board 打包为带 hash 的 bundle（文件名变化自动 cache-bust）。

---

## 3. 目标架构设计

> 2026-03 更新：当前目标不是“重新设计一套新架构”，而是在现有 Smart Board 分层上继续做**去膨胀和职责收敛**。

### 3.1 架构愿景

```
/smart 平台 selector
  ├── /smart-accounting
  │   ├── SmartBoardApp（只做编排 / navigateToView）
  │   ├── product-view registry（dashboard / clients / client-projects / status-projects / settings / logs / report）
  │   ├── board runtime（BoardTable + feature modules）
  │   ├── services / controllers / store / utils
  │   └── API: queries / tasks / monthly-status / automation / clients / board-settings
  └── /smart-grants
      └── placeholder shell（本阶段仅占位，不含 grants 业务）
```

### 3.2 技术选型

```
待定

考虑方向：
- 模块化方案: ES6 Modules / AMD / ...
- 状态管理: EventBus / Simple Store / ...
- 构建工具: 是否引入 / 如何与 Frappe 集成 / ...
- 测试框架: ...
```

### 3.3 模块划分

```
待定
```

### 3.4 API 层设计

```
待定
```

---

## 4. 重构策略

> 🚧 **待规划**

### 4.1 重构原则

```
待定

可能的原则：
- 渐进式重构 vs 大规模重写
- 保持系统可用
- 优先解决高影响问题
- ...
```

### 4.2 阶段划分

```
待定
```

### 4.3 里程碑

```
待定
```

---

## 5. 风险评估

### 5.1 技术风险

| 风险 | 描述 | 缓解措施 |
|------|------|---------|
| 回归风险 | 重构过程中破坏现有功能 | 待定 |
| 依赖冲突 | 新技术与 Frappe 框架的兼容性 | 待定 |
| 学习成本 | 新架构的学习曲线 | 待定 |

### 5.2 业务风险

| 风险 | 描述 | 缓解措施 |
|------|------|---------|
| 交付延迟 | 重构可能影响新功能开发进度 | 待定 |
| 用户影响 | 重构期间可能出现不稳定 | 待定 |

---

## 附录

### A. 相关文档

- `project-docs/reference/A_Data_Model_Assessment.md` - 数据模型评估
- `project-docs/reference/C_Business_Process_Flows.md` - 业务流程文档

### B. 修订历史

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| 1.0 | 2025-12-09 | 初始版本：从架构审查文档改为重构规划文档 |
