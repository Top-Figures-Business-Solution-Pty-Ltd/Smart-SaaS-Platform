# Smart Board - UI 组件架构

> 当前这份文档属于前端实现参考。若需要统一查看项目文档入口，请先看：
> - `../../../../project-docs/README.md`
> - `../../../../project-docs/reference-library.md`
> - `../../../../project-docs/document-map.md`

## 📁 目录结构

```
smart_accounting/public/
├── js/
│   ├── project.js                         # Project表单脚本（已有）
│   └── smart_board/                       # Smart Board UI
│       ├── index.js                       # 入口文件
│       ├── app.js                         # 主应用组件
│       ├── components/                    # UI组件
│       │   ├── Layout/
│       │   │   ├── Sidebar.js            # 左侧导航栏
│       │   │   ├── Header.js             # 顶部工具栏
│       │   │   └── MainContent.js        # 主内容区
│       │   ├── BoardView/
│       │   │   ├── BoardTable.js         # 表格组件
│       │   │   ├── BoardRow.js           # 行组件
│       │   │   ├── BoardCell.js          # 单元格组件
│       │   │   └── BoardFilters.js       # 筛选器（占位符）
│       │   ├── Common/                    # 通用组件
│       │   │   ├── StatusSelect.js       # 状态选择
│       │   │   ├── UserPicker.js         # 用户选择
│       │   │   ├── DatePicker.js         # 日期选择
│       │   │   └── Button.js             # 按钮
│       │   └── DetailPanel/               # 详情面板
│       │       ├── ProjectDetail.js      # 项目详情
│       │       └── UpdatesPanel.js       # 更新/评论
│       ├── services/                      # 数据服务层
│       │   ├── api.js                    # API基础封装
│       │   ├── projectService.js         # Project API
│       │   └── viewService.js            # Saved View API
│       ├── store/                         # 状态管理
│       │   ├── store.js                  # Store主文件
│       │   └── modules/
│       │       ├── projects.js           # Projects模块
│       │       ├── filters.js            # Filters模块
│       │       └── views.js              # Views模块
│       └── utils/                         # 工具函数
│           ├── constants.js              # 常量配置
│           └── helpers.js                # 辅助函数
└── css/
    └── smart_board/                       # 样式文件
        ├── main.css                      # 主样式
        ├── layout.css                    # 布局样式
        ├── board.css                     # 表格样式
        └── components.css                # 组件样式
```

## 🏗️ 架构设计

### 1. **组件化架构**
- 采用模块化设计，每个组件独立封装
- 清晰的职责划分，便于维护和扩展
- 支持组件复用

### 2. **数据流管理**
- 使用类Redux的Store模式管理全局状态
- 单向数据流，状态可预测
- 支持异步操作（Actions）和同步更新（Mutations）

### 3. **服务层抽象**
- API调用统一封装在Service层
- 与Frappe后端无缝集成
- 便于单元测试

### 4. **样式系统**
- CSS变量统一管理主题
- 响应式设计，支持移动端
- 类Monday.com的现代化UI

## 🎯 核心功能模块

### Layout 组件
- **Sidebar**: 左侧导航，按project_type分类
- **Header**: 顶部工具栏，搜索、筛选、新建等操作
- **MainContent**: 主内容区，承载表格视图

### BoardView 组件
- **BoardTable**: 类Monday.com的表格视图
  - 可调整列宽
  - 支持列管理（显示/隐藏/拖拽排序）
  - 支持虚拟滚动（大量项目）
  - 支持无限滚动分页（infinite scrolling）
  - ✅ 行内编辑（已落地：text/select/date/link/multi-link/attachment）
  - ✅ 展开项目查看 Tasks，并支持 Tasks 行内编辑（含人员/Monthly Status）
- **BoardRow**: 表格行渲染
- **BoardCell**: 单元格格式化显示

### Service 层
- **ProjectService**: Project CRUD操作
- **ViewService**: Saved View管理
- **ApiService**: 通用API封装
- **fileUploadService**: 使用 Frappe 原生 `/api/method/upload_file` 上传并绑定 Attach 字段

### Store 状态管理
- **projects**: 项目数据管理
- **filters**: 筛选条件管理
- **views**: 视图配置管理

## 📝 使用方式

### 通过路由访问
在 Desk 中（或通过自定义 Page/Workspace）使用 `smart_board/index.js` 触发：
- `smart_accounting.show_smart_board()`（显示）
- `smart_accounting.hide_smart_board()`（隐藏）

> 备注：当前代码采用 ES Module（`import/export`）的组织方式，后续需要通过 Frappe 的前端构建产物（bundle）来加载，避免浏览器直接加载未打包模块导致报错。

### 编程方式调用
```javascript
// 显示Smart Board
smart_accounting.show_smart_board();

// 隐藏Smart Board
smart_accounting.hide_smart_board();
```

## 🔧 配置说明

### hooks.py 配置
```python
# 全局加载JS
app_include_js = [
    "smart_board/index.js"
]

# 全局加载CSS
app_include_css = [
    "smart_board/main.css",
    "smart_board/layout.css",
    "smart_board/board.css",
    "smart_board/components.css"
]
```

### 常量配置 (constants.js)
- **PROJECT_TYPE_ICONS**: Project Type 的 icon 映射（仅展示层）
- **STATUS_COLORS**: Status → 颜色映射（仅展示层；未知 status 走默认灰色）
- **STATUS_OPTIONS（DEPRECATED）**: 历史遗留的“按业务类型写死状态列表”，运行时不再使用
- **DEFAULT_COLUMNS**: 各业务类型的默认列配置

> ✅ **Status 选项的单一真相（Source of Truth）**  
> Smart Board 的 Status 可选值来自后端 **DocType meta**（`Project.status` 的 options，包含 Property Setter / Customize Form），并支持按 Board（Project Type）配置允许的子集：  
> - 前端：`services/boardStatusService.js`  
> - 后端：`smart_accounting/api/board_settings.py` (`get_project_type_status_config`)

## 🚀 下一步开发

### 高优先级
1. ✅ 完成基础架构搭建
2. ✅ 实现数据加载和显示（Project + Task）
3. 🟡 筛选功能（已有基础 filter/search + Saved View filters；高级 groups 持续完善）
4. ✅ 实现行内编辑（Project/Task）
5. 🟡 Updates/Comments（目前是 website-safe placeholder，后续对接 Frappe Comment）

### 中优先级
1. ✅ 实现Saved View保存/加载（默认 Shared View + columns/filters）
2. ✅ 实现列管理（显示/隐藏/排序/宽度持久化）
3. 🔲 实现看板视图
4. ✅ 性能优化（虚拟滚动 + 分页 + 动态 fields）

### 低优先级
1. 🔲 移动端优化
2. 🔲 深色模式
3. 🔲 导出功能
4. 🔲 批量操作

## 🔍 常见问题 / 排错

### 1) Engagement Letter 上传后表格显示了，但 Project 表单没保存？
- 原因：如果只做“本地状态更新”而没有触发后端 `set_value`，表单字段会是空。
- 现状：已修复为**强制落库**（该列有自定义 `commit`，最终走 `projects/updateProjectField`）。

### 2) 切换 Board 越切越慢？
- 已做的保护：
  - Saved View 默认视图有缓存 + 服务端过滤
  - `fetchProjects` 做了并发回写保护（旧请求不会覆盖新视图）
  - task counts 预取做了 in-flight 去重（避免重复请求）

## 💡 设计原则

### 1. **保持灵活性**
- 使用可配置的方式而非硬编码
- Status、Project Type等通过配置管理
- 支持用户自定义视图

### 2. **模块化优先**
- 组件职责单一，边界清晰
- 高内聚，低耦合
- 便于测试和维护

### 3. **性能考虑**
- 大数据量使用虚拟滚动
- 防抖/节流优化用户交互
- 懒加载非关键组件

### 4. **用户体验**
- 类Monday.com的现代化界面
- 快速响应，流畅交互
- 清晰的视觉反馈

## 📚 相关文档
- [数据模型设计](../../../../project-docs/reference/A_Data_Model_Assessment.md)
- [UI设计文档](../../../../project-docs/reference/D_UI_Design.md)
- [实施教程](../../../../project-docs/reference/E_Implementation_Tutorial.md)

## 🔍 技术栈
- **前端**: 原生JavaScript（ES6+）
- **状态管理**: 自定义Store（类Redux）
- **样式**: CSS3 + CSS Variables
- **后端**: Frappe Framework
- **数据**: ERPNext原生DocTypes + 扩展

---

**创建日期**: 2026-01-04  
**版本**: 1.0  
**状态**: ✅ 架构搭建完成，待实现具体功能

