# Tibo Reset Live · OpenAI Codex 额度重置追踪器

在自己的电脑上查看 **中文重置日历、Tibo 28 天计划和桌面提醒**。无需登录 X、提供 Cookies 或使用 Telegram，仓库作者也无需提供公共服务器。支持 Windows、macOS 和 Linux；Windows 启动器可自动准备 Node，其他系统需先安装。

> No-login OpenAI Codex usage-limit reset tracker and Tibo 28-day plan calendar, with local desktop notifications.

默认从第三方公共 JSON 接口定时收录 `@thsottiaux` 的帖子，由本项目区分重置预告、完成陈述、社区观测和功能更新。它不是秒级实时服务：第三方可能延迟、遗漏或中断。**已实现最多两个备用帖子源的故障切换、社区观测源接入和逐项来源状态；默认配置仅启用一个公共帖子源，备用与社区源地址留空，需另行配置经过核实的接口才会工作。**

## 界面预览

### 重置日历与人物五阶段

![中文重置月历、金色狂欢与人物状态](docs/images/reset-calendar.png)

重置预告持续显示“等待落地”；完成证据出现后庆祝 24 小时，人物再随等待时间进入 Day 1–Day 5。预告、发卡和功能发布不能冒充重置到账。

### Tibo 的 28 天计划

![28 天计划网格、分类、统计和来源](docs/images/plan-overview.png)

三个视图：**重置动态 / 28 天计划 / 全部动态**。计划按太平洋时间（PT），月历按北京时间；页面筛选和通知类别分别设置。

> 截图基于 2026-10-23 演示数据，不代表当前状态。时间进度不是完成率，官方陈述和社区观测也不代表你的账号已到账。人物图片的使用说明见 [素材说明](public/assets/README.md)。

## 三步开始

1. 从 GitHub 下载 ZIP 并解压，或克隆仓库。macOS/Linux 先安装 **Node.js 24.15+（24 LTS）或 26+**，不支持 Node 25。
2. 使用对应系统的启动入口：

   | 系统 | 启动日历与后台 | 停止后台 |
   | --- | --- | --- |
   | Windows | 双击根目录 `start.cmd` | 双击根目录 `stop.cmd` |
   | macOS | 双击根目录 `start.command` | 双击根目录 `stop.command` |
   | Linux | 项目目录运行 `sh start.sh` | 项目目录运行 `sh stop.sh` |

3. 页面打开后点击“开启本机桌面提醒”，选择类别，并在“数据来源与后台状态”发送测试通知。

首次启动需要联网安装依赖。Windows 没有兼容 Node 时会下载官方便携 Node 24 并校验 SHA256，不需要管理员安装。macOS 若双击被阻止，可右键选择“打开”，或在终端运行 `sh start.command`；ZIP 解压后也可先执行 `chmod +x *.command scripts/launchers/*.command`。

启动器自动选择 8788–8808 的空闲端口，打开本机日历。Windows 使用 Toast、macOS 使用通知中心、Linux 使用 `notify-send`；Debian/Ubuntu 缺少它时安装 `libnotify-bin`。Linux 无桌面环境无法显示本机弹窗。

**关闭网页后，后台仍可检查并发送系统通知；电脑必须保持唤醒、联网。** 关机和休眠期间不能监测，恢复后补查可见记录，仅提醒最近 6 小时的新动态。系统勿扰和通知权限会影响弹窗。

## 登录后自动启动

普通启动不会添加自启项。需要时打开 `scripts/launchers/`，使用对应入口：

| 系统 | 启动并开启登录自启 | 取消以后登录自启 |
| --- | --- | --- |
| Windows | 双击 `start-service.cmd` | 双击 `disable-autostart.cmd` |
| macOS | 双击 `start-service.command` | 双击 `disable-autostart.command` |
| Linux | `sh scripts/launchers/start-service.sh` | `sh scripts/launchers/disable-autostart.sh` |

Windows/macOS 表中的文件都位于 `scripts/launchers/`。这些是用户级自启，无需管理员服务；取消自启不停止当前后台，立即停止仍用根目录 `stop.*`。设置后保留源码目录，移动目录需重新配置。

旧版根目录的自启管理入口已移入该目录，**根目录启动/停止入口及系统自启实际调用的核心路径保持不变**。已有自启不会仅因这次入口归档就要求重装。

## 数据与来源

日历、偏好、游标和成功通知去重记录保存在系统用户数据目录：

- Windows：`%LOCALAPPDATA%\TiboResetLive`
- macOS：`~/Library/Application Support/TiboResetLive`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/tibo-reset-live`

正常重启和更新源码不会清空记录。旧版升级先在旧目录停止后台；迁移保留旧库，不覆盖已有新库。自定义 `TIBO_DATA_DIR` 建议写入本机 `.env`，避免仅在终端设置后登录自启时丢失环境。

默认免登录检查：智能模式平时约 5 分钟、新预告后约 2 分钟，可在页面改为快速/标准/省流。页面列出主源、备用和社区源的配置状态、成功时间、限流与失败原因。备用切换机制已实现，默认备用地址仍为空；勾选社区提醒不会自动接入社区数据。详见 [来源与配置说明](docs/ADVANCED_ZH.md#免登录公共数据源) 和 [候选核查](docs/source-review.md)。

## 在页面配置来源

展开 **数据来源与后台状态 → 配置数据来源 · 免登录 / 官方 API**：

- **免登录模式**：填写主源、最多两个备用接口，以及可选社区观测接口（每行一个，最多五个）。需要 HTTPS JSON 接口，不能填写 X 主页或普通网页。
- **官方 API 模式**：填写有相应权限的 X 应用 Bearer Token。这是应用凭证配置，不是登录 X 账号；普通免登录使用无需填写。
- **测试连接**：只检测草稿的响应和格式，不保存、不写日历、不发提醒；账号查询成功不代表流和时间线权限已全部具备。
- **保存并立即应用**：切换后台采集器，关闭页面后继续使用，重启也会保留。失败提示不会把不合法草稿覆盖到当前配置。
- **恢复默认草稿**：点击保存后才生效，将回到默认公共源，停用备用与社区接口并清除本机保存的 Token。

Token 不回显，留空保留已配置值；可以勾选清除后在免登录模式保存。配置保存在用户数据目录 `local-sources.json`，优先于 `.env` 的来源设置；文件包含明文 Token，请勿分享或提交。浏览器不保存密钥，项目已忽略该文件。云部署仍用 `.env` 配置。

更新代码后，已运行的旧版后台需要停止并启动一次，才会提供这个新入口；之后保存来源不需要重启。

## 项目目录与文档

```text
tibo-reset-live/
├─ start.* / stop.*     三平台日常启动与停止
├─ src/                后台、分类、通知、SQLite
├─ public/             页面、样式与人物素材
├─ resources/          随项目分发的历史与计划资料
├─ scripts/            跨平台启动器、后台控制与自启实现
│  └─ launchers/        登录自启管理入口
├─ tests/              Node 与浏览器检查
└─ docs/               配置说明、开发交接与截图
```

根目录的 `package*.json`、`.env.example`、Docker、Git 和许可证文件属于工具链常用入口，继续保留。个人数据、`.env`、`.runtime/`、`node_modules/` 和 `.artifacts/` 不提交仓库。

- [详细配置、证据规则、社区接口、云部署与测试](docs/ADVANCED_ZH.md)
- [中文开发交接：架构、已复现问题和接手顺序](docs/DEVELOPMENT_HANDOFF_ZH.md)
- [公共来源候选核查](docs/source-review.md)
- [图片来源与使用限制](public/assets/README.md)

## 开发与当前验证边界

已有兼容 Node 时：

```sh
npm ci
npm run local
```

这是前台启动，关闭终端即停止；隐藏后台请用根目录启动文件。用 `npm run local:status` / `npm run local:stop` 查询或停止启动器管理的后台。本机服务只绑定 `127.0.0.1`。

基础验证运行 `npm test`。浏览器测试、隔离数据和可选 Docker / Web Push 部署见 [详细说明](docs/ADVANCED_ZH.md#验证)。GitHub Pages 无法运行后台。

Windows 启动流程已本地验证；macOS/Linux 的实际桌面通知、登录自启，以及官方 X API、公网 Web Push 仍需对应环境验收。**已知问题：跨日功能回复可能归错计划日，桌面通知临时失败尚无自动重试**；详情和修复建议见开发交接，不应把现有测试通过理解为这些问题已经修复。

独立社区工具，非 OpenAI 或 X 官方产品。代码许可证：MIT；图片权利另见素材说明。
