# ERP 报表管理后台

一个基于 React + Vite + Express + SQL Server + Electron 的 ERP 报表管理后台。系统用于连接 SQL Server 数据库，读取业务视图，配置报表筛选条件，并在前台查询、分页、排序、调整列宽、下穿和导出当前查询数据。

## 功能特性

- 数据库管理
  - 配置 SQL Server 连接参数。
  - 支持 SQL Server 2008 R2、2012、2016、2019、2022 版本选择。
  - 支持测试数据库连接。
  - 支持主机、端口、实例名、数据库名、账号、密码、加密连接和信任证书配置。
  - 数据库密码写入状态文件时会加密保存。

- 报表管理
  - 新增、编辑、删除报表。
  - 选择已配置的数据库连接。
  - 自动读取数据库视图。
  - 搜索并选择数据库视图。
  - 自动解析视图字段。
  - 选项控件可自动解析视图定义中的 `CASE ... THEN ... ELSE ... END` 文本选项。
  - 配置哪些字段作为筛选条件。
  - 自定义筛选条件名称和控件类型。
  - 日期控件会在查询页自动拆分为开始日期和结束日期。
  - 支持给字段配置下穿视图。

- 报表查询
  - 打开报表后默认不自动查询，需要用户点击查询按钮。
  - 筛选条件默认显示一行，多余条件可展开。
  - 支持保存当前查询条件，下次打开报表自动带出。
  - 日期筛选支持“今天”“本周”“本月”“本年”和自定义日期段。
  - 查询页筛选条件支持显示/隐藏和拖拽排序。
  - 查询结果默认显示行号。
  - 支持分页，每页条数可选。
  - 支持字段显示/隐藏。
  - 支持拖动字段排序。
  - 支持拖动列宽，并记忆用户调整后的列宽。
  - 未自定义列宽时，表格自动适配列宽。
  - 支持按字段排序、升序/降序切换。
  - 支持导出当前查询结果为 CSV。
  - 支持从已配置字段发起下穿查询。

- 页面体验
  - 默认隐藏“数据库管理”和“报表管理”入口。
  - 按 `Ctrl + Shift + M`，macOS 可用 `Cmd + Shift + M`，输入密码后才显示管理入口。
  - 顶部标签页展示已打开页面。
  - 标签页可关闭。
  - 多标签切换时保留每个标签页内已查询的数据和页面状态。
  - 桌面版使用 Electron 内置本地服务启动，无需单独部署前后端。

## 技术栈

- 前端：React 19、TypeScript、Vite
- 后端：Express
- 数据库驱动：mssql
- 图标：lucide-react
- 开发启动：concurrently

## 目录结构

```text
.
├── index.html
├── package.json
├── electron
│   └── main.cjs          # Electron 桌面入口
├── server
│   ├── index.js          # Express API 服务，负责连接 SQL Server 和查询视图
│   ├── state-security.cjs # 本地状态密码加密/解密
│   ├── view-options.js   # 视图 CASE 选项解析
│   └── view-options.test.js
├── scripts
│   └── prepare-default-state.cjs # 生成打包用默认配置
├── default-state          # 打包时可携带的默认配置目录
├── src
│   ├── App.tsx           # 前端主应用
│   ├── main.tsx          # React 入口
│   └── styles.css        # 全局样式
├── tsconfig.json
└── vite.config.ts
```

## 环境要求

- Node.js 18 或更高版本
- 可访问的 SQL Server 数据库
- 数据库账号需要具备读取系统视图和查询业务视图的权限

建议数据库账号至少具备：

- 读取 `sys.views`
- 读取 `sys.columns`
- 读取 `sys.schemas`
- 查询所选择的业务视图

## 安装依赖

```bash
npm install
```

## 本地开发启动

同时启动前端和后端：

```bash
npm run dev
```

启动后访问：

- 前端地址：http://localhost:5173/
- 后端地址：http://localhost:3001/

也可以分别启动：

```bash
npm run server
npm run client
```

## 构建

构建 Web 前端：

```bash
npm run build
```

构建产物会输出到 `dist/` 目录。

## 桌面版运行

先构建前端，再用 Electron 启动桌面程序：

```bash
npm run desktop
```

启动后 Electron 会自动拉起内置本地服务，并打开桌面窗口，无需再单独执行 `npm run server` 或 `npm run client`。

## Windows 安装包

生成适用于大多数 Windows 电脑的 `x64` 安装包：

```bash
npm run pack:win
```

打包完成后，安装包会输出到 `release/` 目录。

如果需要把当前已配置好的数据库连接和报表配置一起打进安装包，先在开发模式完成配置，然后执行：

```bash
npm run pack:win:configured
```

该命令会先读取 `.app-state/`，生成加密后的 `default-state/`，再构建 Windows 安装包。桌面版 exe 首次启动时，如果用户配置目录里还没有对应配置文件，会自动把 `default-state/` 中的配置复制过去。

如果你只想先看未封装安装程序的目录版产物，可以执行：

```bash
npm run pack:dir
```

## 卸载清理

Windows NSIS 安装包已配置卸载时清理 Electron 用户数据目录。卸载新版安装包时，会删除：

```text
%APPDATA%\ERP报表管理后台\
```

这个目录包含数据库连接配置、加密后的数据库密码、报表配置和界面偏好。

注意：

- 该行为只对使用新版安装包安装后的卸载生效。
- 如果电脑上之前安装的是旧版安装包，旧版卸载程序可能不会删除 `%APPDATA%\ERP报表管理后台\`。
- 旧版残留可以手动删除：

  ```text
  %APPDATA%\ERP报表管理后台\
  ```

- 删除后再次启动带默认配置的新版 exe，会重新从安装包内的 `default-state/` 初始化配置。

## 可用脚本

```bash
npm run dev       # 同时启动后端 API 和前端开发服务
npm run server    # 启动 Express API 服务
npm run client    # 启动 Vite 前端开发服务
npm run build     # TypeScript 检查并构建前端
npm run prepare:default-state # 从 .app-state 生成加密后的 default-state
npm run desktop   # 构建前端并启动 Electron 桌面版
npm run pack:win  # 构建 Windows x64 NSIS 安装包
npm run pack:win:configured # 生成默认配置并构建 Windows 安装包
npm run pack:dir  # 构建未安装版桌面目录产物
npm run preview   # 预览构建后的前端页面
```

## 使用流程

1. 打开系统。
2. 按 `Ctrl + Shift + M`，macOS 可用 `Cmd + Shift + M`。
3. 输入管理密码，显示“数据库管理”和“报表管理”入口。
4. 进入“数据库管理”。
5. 新增 SQL Server 数据库连接。
6. 点击“测试连接”，确认连接可用。
7. 进入“报表管理”。
8. 点击“新增报表”。
9. 选择数据库连接。
10. 搜索并选择数据库视图。
11. 在字段配置中勾选需要作为筛选条件的字段。
12. 配置筛选名称和控件类型。
13. 如控件类型为“选项”，系统会优先解析视图中对应字段的 `CASE` 文本选项。
14. 保存报表。
15. 在左侧报表菜单中打开报表。
16. 输入筛选条件并点击“查询”。
17. 可进行分页、排序、字段显示、拖动列宽、下穿和导出。

## 日期筛选说明

当字段配置中的控件类型选择为“日期”时，报表查询页会自动生成日期段筛选框。

日期段支持：

- 自定义开始日期和结束日期。
- `今天`：今天到今天。
- `本周`：本周一到本周日。
- `本月`：本月 1 日到本月最后一天。
- `本年`：当年 1 月 1 日到当年 12 月 31 日。

查询逻辑：

- 只填开始日期：查询大于等于开始日期的数据。
- 只填结束日期：查询小于结束日期下一天的数据。
- 同时填写开始和结束日期：查询日期区间内的数据，结束日期包含当天。

## 数据导出说明

报表查询页提供“导出”按钮。

导出规则：

- 导出当前已查询的数据。
- 导出当前排序后的数据。
- 只导出当前显示的字段。
- 导出格式为 CSV。
- 文件名默认为报表名称。

## 数据存储说明

开发模式下，后端状态文件默认保存在项目目录：

```text
.app-state/
├── erp-real-report-databases.json
└── erp-view-report-configs.json
```

桌面版 exe 运行时，状态文件保存在 Electron 用户数据目录：

```text
%APPDATA%\ERP报表管理后台\state\
├── erp-real-report-databases.json
└── erp-view-report-configs.json
```

说明：

- `erp-real-report-databases.json` 保存数据库连接配置。
- `erp-view-report-configs.json` 保存报表配置。
- 数据库密码写入 JSON 时会使用 AES-256-GCM 加密，密文前缀为 `enc:v1:`。
- 前端不会再把数据库连接配置写入浏览器 `localStorage`。
- 报表配置、侧栏宽度、部分界面偏好仍会使用本地状态保存。

默认加密密钥内置在程序中，适合避免本地配置文件直接明文暴露。如果需要更高安全性，可以通过环境变量 `ERP_STATE_SECRET` 或 `APP_STATE_SECRET` 指定自己的密钥。注意：换密钥后，旧密钥加密的密码无法被新密钥解密，需要重新生成配置。

## 打包默认配置

如果希望安装后的 exe 首次启动就带出已经配置好的数据库和报表：

1. 本地启动开发环境：

   ```bash
   npm run dev
   ```

2. 在界面里完成数据库连接和报表配置。
3. 确认项目目录下生成了 `.app-state/erp-real-report-databases.json` 和 `.app-state/erp-view-report-configs.json`。
4. 执行带配置打包：

   ```bash
   npm run pack:win:configured
   ```

该命令等价于：

```bash
npm run prepare:default-state
npm run pack:win
```

`prepare:default-state` 会把 `.app-state/` 里的配置转换到 `default-state/`，并加密数据库密码。`default-state/` 会被打进安装包。

注意：

- exe 首次启动时只会复制目标用户目录中不存在的配置文件，不会覆盖用户已有配置。
- 如果目标电脑已运行过旧版本，需要重新使用默认配置，请先删除 `%APPDATA%\ERP报表管理后台\state\` 下的对应 JSON 文件。
- `default-state/` 中的数据库密码是加密后的，但仍属于随安装包分发的敏感配置，应控制安装包分发范围。

## API 接口

后端 API 默认运行在 `http://localhost:3001`。

主要接口：

- `POST /api/databases/test`：测试 SQL Server 数据库连接。
- `POST /api/views/list`：读取数据库视图列表。
- `POST /api/views/metadata`：读取视图字段信息。
- `POST /api/views/query`：按筛选条件查询视图数据。

项目中仍保留部分存储过程相关接口：

- `POST /api/procedures/list`
- `POST /api/procedures/metadata`
- `POST /api/procedures/execute`

当前前端主要使用数据库视图作为报表数据源。

## 安装包体积说明

- 当前桌面版基于 Electron，安装包体积主要由 Electron 运行时决定。
- 前端构建和开发依赖已经移出运行时依赖，安装包只携带桌面运行真正需要的依赖。
- 如果需要进一步显著压缩安装包体积，需要评估更轻量的桌面壳方案，例如 Tauri。

## SQL Server 版本兼容

数据库版本选择会影响 TDS 协议版本：

- SQL Server 2008 R2：`7_3_A`
- SQL Server 2012 及以上：`7_4`

如果连接旧版本 SQL Server 出现握手或协议问题，请优先检查数据库版本选择、加密连接和信任证书配置。

## 常见问题

### 页面打开后没有自动查询

这是当前设计。报表打开后不会自动查询数据，需要用户点击“查询”按钮，避免误触发大数据量查询。

### 日期筛选报参数错误

日期控件会按日期类型参数提交给 SQL Server。如果仍出现参数错误，请检查视图字段真实类型，以及报表字段配置中的控件类型是否为“日期”。

### 连接失败

请检查：

- SQL Server 地址和端口是否正确。
- 实例名是否需要填写。
- 数据库账号密码是否正确。
- SQL Server 是否允许远程连接。
- 防火墙是否放行端口。
- 加密连接和信任证书配置是否符合当前数据库环境。

## 注意事项

- 当前项目适合内网报表后台场景。
- 查询接口默认最多返回 10000 条，后端硬限制最大 50000 条。
- 大数据量场景建议增加服务端分页、权限控制和审计日志。
- 数据库密码已避免浏览器本地明文保存，但随安装包分发默认数据库配置仍需谨慎控制权限。
