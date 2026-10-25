# 免登录来源核查

核查日期：2026-10-25。以下是当次公开接口和项目资料的结果，不承诺第三方长期可用。没有对外部接口写入数据，也没有登录 X。

## 当前接入

[codex-reset.com/api/feed](https://codex-reset.com/api/feed) 当次返回 HTTP 200，包含 `profile.handle=thsottiaux`、`fetched_at`、34 条 `tweets`，声明 `source=x-api`、`stale=false`。这是上游自己的声明，本项目没有用官方 X API 独立验证其原文。只读取原帖文字、时间、链接和父帖关系，不导入其完成标签、操作员判断或预测。

## 未自动接入的候选

| 候选 | 核查结果 | 处理 |
| --- | --- | --- |
| [ResetRadar](https://github.com/Yang-bright/resetradar) / [resetradar.wiki](https://resetradar.wiki/) | README 和 `src/data/resets.ts` 说明种子资料来自 whenreset.dev、codex-reset.com；数据是前端静态资料，部分链接仅指向账号主页。 | 不能视为独立实时帖子源；不自动解析构建后的前端脚本来生成到账提醒。 |
| [whenreset.dev 归档](https://whenreset.dev/api/archive) / [RSS](https://whenreset.dev/api/reset-feed) | 当次接口均为 HTTP 200，但归档 `capturedAt=2026-10-25T07:10:12.074Z`。例如帖子 `2113492502355562875` 在归档中是 10-23 17:00 UTC 的完成陈述，在当前公共源中是 10-23 17:40:51 UTC 的未来预告。归档缺少完整回复关系。主页还包含 codexFeed 检查信息，独立性不能确认。 | 存在原文和时间冲突；未独立核验前不能作为自动确认的备用。接口返回 200 不等于证据合格。 |
| [Tibo Reset Radar](https://github.com/RZX00/tibo-reset-radar) | README 明确默认使用演示账号和示例数据；真实采集需用户自己的 X API 或本地采集器。 | 属于可自行部署的工具，不是现成的免登录公共接口。 |
| [WillTiboReset](https://github.com/EvanProgramming/willtiboreset) | README 以预测为目标；公开 `data/tweets.json` 包含大量社区 RSS 内容，`reset_history.json` 当次最新记录停在 8 月，缺少逐条可核对的原始凭据。 | 预测、讨论与历史时间表不作为新的到账观测证据。 |
| [Tibo, We Love You](https://github.com/Tiaivy/tibo-we-love-you) | `FeedEndpointProvider.swift` 需要单独配置服务地址，没有可据此验证的默认公共源。 | 是客户端/自部署方案，不当成独立公共来源。 |

目前没有找到同时满足“免登录、可持续检查、独立采集、原文/时间/回复关系可信”的备用帖子接口，也没有核实到适合默认启用的社区到账 JSON 接口。因此保持一个默认帖子源，备用和社区地址留空，不把多个网站转述当成多份独立证据。

## 后续接入条件

- 帖子接口提供 `profile.handle`、真实的 `fetched_at` 和 `tweets` 数组；逐条包含帖子 ID、X 原帖链接、原文、发布时间，回复包含父帖 ID。可使用 `.env` 的 `PUBLIC_FEED_FALLBACK_URLS` 接入与当前源相同结构的接口。
- 先抽查同一 ID 的原文、时间与回复关系，确认没有将摘要或运营者判断写成原文；有分歧先保留核查，不自动升级为完成。
- 社区接口使用 README 的 `observations` 格式，逐条保留来源链接、时间和适用范围。不得把 banked 重置卡、未来预告或预测当成已经恢复的额度。
- 同一采集服务的不同域名不计为独立来源。所有源都独立显示失败、成功时间与限流等待，不能用不可信来源掩盖主源故障。
