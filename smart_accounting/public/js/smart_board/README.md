# Smart Board - 前端实现说明

> 当前这份文档属于 Smart Board 前端实现参考。项目级文档入口请先看：
> - `../../../../project-docs/README.md`
> - `../../../../project-docs/document-map.md`
> - `../../../../project-docs/reference-library.md`

## 定位

`smart_board/` 是 Smart Accounting 当前的核心前端产品壳。

- 它不只是单一 board 页面，而是一套 Website-safe 的 SPA。
- 它同时服务于 `/smart-accounting` 等 Website 入口，以及 `/app/project-management` 这类 Desk 内嵌入口。
- 它的职责包括：导航、Board、Clients、Dashboard、Activity、Automation Logs、Settings、Users、Report 占位页等产品视图。

## 当前加载方式

- 稳定入口：`index.js`
  - 导出 `smart_accounting.show_smart_board()`
  - 导出 `smart_accounting.hide_smart_board()`
- 主应用：`app.js`
  - 负责 URL state、视图切换、数据加载编排、模块限制和性能埋点
- 当前不是通过 `hooks.py` 的 `app_include_js/app_include_css` 全局注入到所有页面
- 当前口径是：
  - Desk Page `project_management` 按需加载 Smart Board
  - `/smart` 产品壳页面挂载同一前端模块

## 目录结构

```text
smart_accounting/public/
├── js/
│   ├── project.js
│   └── smart_board/
│       ├── index.js
│       ├── app.js
│       ├── columns/
│       ├── components/
│       ├── controllers/
│       ├── services/
│       ├── store/
│       └── utils/
└── css/
    └── smart_board/
```

## 模块职责

### `components/`

- UI 渲染与交互绑定
- 典型区域：
  - `Layout/`：Sidebar、Header、MainContent
  - `BoardView/`：BoardTable、各种 modal、编辑与渲染模块
  - `ClientsView/`、`ActivityLogView/`、`AutomationLogsView/`、`SettingsView/`、`UsersView/`、`ReportView/`

### `controllers/`

- 编排多步工作流
- 统一处理创建、弹窗、导航动作等跨组件逻辑

### `services/`

- 对后端 API 的稳定封装
- 当前主要通过 `projectService.js`、`viewService.js`、`clientsService.js`、`notificationsService.js` 等按领域组织

### `store/`

- 类 Redux 的状态管理
- 已拆出 `projects`、`filters`、`views`、`dashboard`、`clients` 等模块

### `columns/`

- 列注册表与列行为定义
- 目的是避免把字段特性继续堆进 `BoardTable.js`

### `utils/`

- 纯工具、兼容层、URL state、性能计时、常量与环境适配

## 当前已落地能力

### Board

- 动态列与列管理
- 虚拟滚动 + 分段加载
- 行内编辑
- Tasks 展开与任务级编辑
- 团队角色列与附件列
- Saved View 的列、过滤、排序和默认视图

### 产品视图

- `dashboard`
- `clients`
- `client-projects`
- `status-projects`
- `archived-clients`
- `activity`
- `automation-logs`
- `settings`
- `users`
- `report`

> 说明：`report` 视图当前已接入导航、路由和挂载，但业务内容仍是占位实现。

## 状态与配置口径

- Status 的单一真相来自后端 DocType meta
- Property Setter / Customize Form 决定全局状态池
- `api/board_settings.py` 负责 board 级 allowed subset
- 前端由 `services/boardStatusService.js` 统一消费

## 当前实现关注点

### 已完成

- Project / Task 主要编辑链路
- Monthly Status
- Engagement Letter 上传与落库
- URL state 与 scoped product views
- Clients / Activity / Automation Logs / Users 等产品页装配

### 仍需持续演进

- 更完整的 Updates / Comment 整合
- Report 页面真实数据化
- 更细的页面级职责收敛，避免 `app.js` 与 `MainContent.js` 继续膨胀

## 排错提示

### 上传后 UI 显示但表单没保存

- 这通常意味着只做了前端状态更新，没有触发真实后端写入
- 当前附件列已通过自定义 commit 走落库路径

### 频繁切换 Board 变慢

- 当前已有的保护包括：
  - 动态 fields 请求
  - 子表 hydration 按需加载
  - in-flight 去重
  - 请求回写保护

## 相关文档

- `../../../../project-docs/reference/architecture.md`
- `../../../../project-docs/reference/B_Code_Architecture_Review.md`
- `../../../../project-docs/reference/D_UI_Design.md`
- `../../../../project-docs/reference/E_Implementation_Tutorial.md`

---

**创建日期**: 2026-01-04  
**最后整理**: 2026-04-10  
**状态**: ✅ 当前实现说明；随产品继续迭代

