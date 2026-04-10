# 📐 Smart Accounting Architecture
# 架构与开发规范（Smart Board + /smart 产品壳）

**项目**：Smart Accounting  
**最后更新**：2026-02-04  
**适用范围**：`apps/smart_accounting/smart_accounting/`（前端 Smart Board + 后端 API/Hook/Override）  

> 这份文档的定位是“**架构契约**”：告诉团队哪些边界是**必须遵守的**，哪些是**建议**，以及如何在不破坏现有功能的前提下持续演进。

---

## 2026-04 当前状态补充

### 当前新增的治理方向

- ✅ **文档管理已开始收口到统一入口**
  - 项目文档总入口现为 `../project-docs/README.md`
- ✅ **R&D Notes 已建立**
  - 后续每周的研发记录、验证记录、操作性支持材料统一进入 `../project-docs/r-and-d-notes/`
- ✅ **长期参考文档与工作型记录已开始分层**
  - `docs/` 继续保留设计/架构/实施参考
  - `project-docs/` 负责统一入口、索引、周更与工作型记录

### 当前建议

- 稳定设计与架构边界，继续保留在 `docs/`
- 周更、验证、调查、支持性记录，不再继续散落，统一进入 `project-docs/`

## 1) 目标 / 非目标

### 目标

- **架构健康优先**：一个文件只做一类职责；UI / 业务规则 / 数据访问分离。
- **入口稳定、实现可拆**：对外 API（例如 `ProjectService`）保持稳定，内部实现可随时重构拆分。
- **依赖方向固定**：页面/组件 → store/services/utils；services 不反向依赖组件；避免循环依赖。
- **SaaS-ready**：支持白标、权限隔离、性能扩展、可观测性与未来功能开关。

### 非目标

- 这不是“功能说明书”；不枚举所有业务细节。
- 不强制引入新框架（目前使用原生 ES Modules + Frappe 环境）。

---

## 2) 系统总览（后端 / 前端 / 产品壳）

### 2.1 /smart 产品壳 vs /app Desk

- **对外用户**：只使用 `/smart`（Website Shell），避免进入 Desk (`/app*`)。
- **管理员/内部**：可按配置访问 Desk 做系统维护。

落地位置：

- **产品壳页面**：`smart_accounting/www/smart/*`（`/smart`, `/smart/login`, `/smart/logout` 等）
- **访问控制**：`smart_accounting/access_control.py` + `hooks.py: before_request`

### 2.2 Smart Board 前端（Website-safe SPA）

入口稳定：

- `smart_accounting/public/js/smart_board/index.js`
  - 导出 `smart_accounting.show_smart_board()` / `smart_accounting.hide_smart_board()`
  - 支持 **Embedded（Desk Page 挂载）** 与 **Fullscreen（挂到 body）** 两种模式

主应用：

- `smart_accounting/public/js/smart_board/app.js` (`SmartBoardApp`)
  - 负责布局、路由视图切换、初始化数据加载、URL state 管理与性能埋点

### 2.3 后端 API（website-safe）

推荐把 Smart Board 需要的后端能力放在：

- `smart_accounting/api/*.py`：whitelisted 方法（website-safe）
- `smart_accounting/custom/*.py`：DocType override（如 `Project`）

---

## 3) 目录结构与职责（前端）

路径：`smart_accounting/public/js/smart_board/`

### `components/`（UI 渲染与事件）

- **只做 UI**：DOM 渲染、事件绑定、组件内状态（例如 input 值、展开收起）。
- **禁止/避免**：
  - 直接 `frappe.call()`（数据访问应在 services）
  - 复杂工作流编排（应在 controllers）
- 典型文件：
  - `components/Layout/*`：侧边栏/头部/主内容布局
  - `components/BoardView/*`：表格、过滤、Columns Manager、各种 modal
  - `components/ClientsView/*`、`components/SettingsView/*` 等产品页

### `controllers/`（工作流编排 / 跨组件协调）

- 打开 modal、串联多步流程、落库后刷新列表、统一 toast/错误提示。
- 允许依赖：`components/`、`services/`、`utils/`（不依赖 store 也可以，但通常会拿 app/store）
- 示例：`controllers/newProjectController.js`、`controllers/newClientController.js`

### `services/`（数据访问 / API Facade）

- **单一领域**：一个 service 负责一个后端域或一个清晰用例（例如 `BoardStatusService`）。
- **禁止**：依赖 `components/`（避免 UI 反向耦合）
- **允许**：依赖 `utils/`、`ApiService`、`Perf`、`uiAdapter`
- 典型文件：
  - `services/api.js`：对 `frappe.client.*` 的基础封装
  - `services/projectService.js`：稳定外部入口（Facade）
  - `services/projectQueryService.js` / `projectCommandService.js` / `monthlyStatusService.js`：内部按职责拆分
  - `services/doctypeMetaService.js`：DocType meta 缓存（Select options 等）
  - `services/uiAdapter.js`：Website/Desk UI 适配（toast/msgprint/confirm）

### `store/`（状态管理）

- `store/store.js`：类 Redux 的 Store，支持 `dispatch`（异步 action）和 `commit`（同步 mutation）
- `store/modules/*`：按域拆模块（projects/filters/views/dashboard/clients）
- 规则：
  - actions 调 services 获取/更新数据
  - mutations 只做同步 state 更新
  - components/pages 通过 store 订阅 state 来刷新 UI

### `columns/`（列行为注册表：渲染/编辑/commit）

目标：**避免把“字段特性”塞进 `BoardTable.js`**。

- `columns/registry.js`：列 spec 注册表（exact field / prefix field）
- `columns/specs/*`：按域定义列 spec（project/task）
- `columns/registerDefaultSpecs.js`：side-effect 注册（保持极小，只做 register）

### `utils/`（纯工具 / 纯规则）

- 优先纯函数；尽量无副作用。
- 允许少量与环境有关的工具（例如 `env.js`），但要集中，不要散落。
- 兼容层：
  - `utils/helpers.js` 仅作为 re-export（保持旧 import 不炸），新代码应直接 import 具体模块。

---

## 4) 后端结构与职责（Frappe/ERPNext）

路径：`smart_accounting/`

### `api/`（whitelisted：Smart Board 的网站端后端）

- `api/project_board.py`：Board 相关查询/写入（Project/Task/Monthly Status 等）
- `api/board_settings.py`：Board Settings（Project Type order / status subset config）
- `api/clients.py` / `api/profile.py` / `api/updates.py` / `api/mentions.py` / `api/notifications.py` / `api/activity_log.py` / `api/automation.py`

原则：

- **website-safe**：不依赖 Desk UI；返回结构稳定（dict/list）。
- **权限清晰**：需要登录/权限的地方先 guard（例如 `_ensure_logged_in()`）。
- **返回 shape 稳定**：前端依赖 `message` 结构时，尽量保持字段不随意改名。
- **调度任务显式注册**：如日期触发类自动化（`date_reaches`）统一走 `hooks.py -> scheduler_events`，避免隐式副作用。

### `custom/`（DocType override：最小可控的后端业务规则）

例如：

- `custom/project.py`：`Project` 的行为修正（例如 status 合法性、percent_complete 的副作用隔离）

原则：

- 只做“**必须在后端保证的系统不变量**”（例如“status 必须在池里”）。
- 避免把“展示层逻辑”写进 override。

### `www/`（Website Shell）

- `www/smart/*`：自定义登录/登出/壳页面、品牌配置入口等。

### `hooks.py`

- 注册 `before_request`（产品壳隔离）
- 注册 `override_doctype_class`
- fixtures（Role/Custom DocPerm/Custom Field/Property Setter/DocType 等）

---

## 5) 依赖方向（强制规则）

### 5.1 允许的依赖（推荐图）

```
components/pages  →  controllers  →  services  →  backend(api/*)
        │                 │
        ├──→ store ───────┤
        └──→ utils  ←─────┘
```

### 5.2 禁止的依赖

- **services → components**（禁止）
- **utils → services/components**（禁止，避免循环/副作用）
- **store/modules → components**（禁止）
- 任意模块形成循环依赖（ESM 下会产生 undefined/时序 bug）

---

## 6) 稳定入口与兼容层（必须保留）

### 6.1 前端入口（稳定）

- `smart_board/index.js`：`show_smart_board()` / `hide_smart_board()`

### 6.2 Service 入口（稳定）

为了允许内部重构，“外部入口”应保持稳定：

- `services/projectService.js`：Facade（内部可拆 `Query/Command/MonthlyStatus`）
- `utils/helpers.js`：兼容层（re-export 到按域小模块）

### 6.3 Deprecated 策略（建议）

- 不要“删掉旧入口”导致全局爆炸。
- 正确做法：
  - 新建按域模块（例如 `projectQueryService.js`）
  - 旧入口改为薄转发
  - 标记 deprecated（注释 + 文档）
  - 后续分批迁移调用方

---

## 7) 新增功能（Feature）落地模板

> 先回答：它属于哪个领域？Board / Clients / Settings / Activity / Shell？

### 7.1 推荐拆分方式

- **UI 渲染**：`components/<Domain>/*`
- **工作流编排**：`controllers/<feature>Controller.js`
- **数据访问**：`services/<feature>Service.js`
- **状态**（如需要）：`store/modules/<domain>.js` 增 action/mutation
- **纯规则/格式化**：`utils/<domain>.js`

### 7.2 自检（PR 必做）

- 改动是否只触及相关领域？
- 新逻辑是否放在“唯一归属”的模块里？（否则先重构再加功能）

---

## 8) 新增列（Column）规范（Project/Task）

### 8.1 判断列的类型

- **直连字段**：DocField（`Project.foo` / `Task.bar`）
- **子表/聚合字段**：需要 hydrate（例如 `custom_team_members`）
- **派生/虚拟列**：不落库（例如 `__sb_*`、`team:<Role>`）

### 8.2 实施清单（Project 列为例）

1) **列出数据来源**

- 若是新字段：需要先在 ERPNext UI 创建（Customize Form / Property Setter）。
- 若字段来自子表：确认 query/hydrate 能拿到。

2) **加入 Columns Manager 的“可选列池”（如需）**

- `utils/constants.js`：`PROJECT_COLUMN_CATALOG`（控制是否可在 Columns Manager 里选择）

3) **定义列行为（渲染/编辑/commit）**

- `columns/specs/projectColumns.js`（或 `taskColumns.js`）
- 通过 `columnRegistry` 注册，不要把字段特性塞进 `BoardTable.js`

4) **确保查询拿到必要字段**

- Board 视图默认从 Saved View 的可见列推导 fields（见 `SmartBoardApp.loadViewData`）。
- 如果你的列依赖隐含字段（例如 `team:<Role>` 依赖 `custom_team_members`），要在推导逻辑中补齐（已有示例）。

5) **如需要后端写入**

- 优先走 `ApiService.updateDoc`（标准字段）
- 复杂写入：在 `services/` 新增命令方法 + 后端 `api/*` 新增 whitelisted 方法

6) **过滤器/高级过滤（如需要）**

- `utils/filterColumns.js` 控制哪些字段可被过滤
- 若列被废弃：统一放入 `utils/deprecatedColumns.js`，确保 Columns + Filters 都不出现

### 8.3 回归点（新增列必测）

- 列显示/隐藏、拖拽排序、列宽持久化
- inline 编辑 commit 是否正确落库
- load more / virtualization 下渲染是否稳定
- Advanced Filter 是否出现正确的字段/选项

---

## 9) Status（状态）单一真相（Source of Truth）

原则：

- **Status 可选值**来自后端 DocType meta：`Project.status` 的 options（包含 Property Setter / Customize Form）。
- Board 可配置“允许的子集”，但子集必须来自 pool（避免 typo）。
- 当前终态为 **`Completed`**（历史值如 `Done`/`Lodged` 仅作兼容映射，不应作为新配置继续使用）。

落地：

- 后端：`api/board_settings.py` → `_get_project_status_pool()` / `get_project_type_status_config`
- 前端：`services/boardStatusService.js` → `getEffectiveOptions()`
- 展示层颜色：`utils/constants.js` → `STATUS_COLORS`

## 9.1 Automation（2026-02 能力）

- 规则存储：`Board Automation.trigger_config`（JSON）+ `actions`（JSON）
- Trigger 支持：
  - `status_change`
  - `project_type_is`
  - `date_reaches`（Date 字段到期）
- 支持 **复合 Trigger（AND）**：`trigger_config.triggers[]`
- 日期触发执行路径：
  - `hooks.py -> scheduler_events.daily -> api.automation.run_due_date_automations_daily`

---

## 10) 性能与可观测性（建议）

- **字段投影**：按可见列动态决定 `fetchProjects(fields)`，避免拉全量字段。
- **in-flight 去重**：同查询并发共享 Promise（见 `ProjectQueryService`）。
- **虚拟滚动/分页**：大表格必须使用（`BoardTableVirtualization` 等）。
- **Perf 埋点**：使用 `utils/perf.js` 的 `Perf.timeAsync()` 包裹关键路径。

---

## 11) 参考文档

- `project-docs/reference/A_Data_Model_Assessment.md`
- `project-docs/reference/B_Code_Architecture_Review.md`
- `project-docs/reference/C_Business_Process_Flows.md`
- `project-docs/reference/D_UI_Design.md`
- `project-docs/reference/E_Implementation_Tutorial.md`


