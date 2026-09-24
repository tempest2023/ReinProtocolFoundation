# 网站开发指南

本文面向网站和社区应用的代码贡献者。组织使命及参与路径请参阅[项目介绍](./README-zh.md)。[English](./DEVELOPMENT.md)

## 架构

- Next.js App Router、React 19、TypeScript 和原生 CSS
- Supabase PostgreSQL、管理员魔法链接登录、RLS 和图片存储
- Resend 事务邮件
- OpenAI Responses API、Structured Outputs 和 `omni-moderation-latest`
- Vitest 单元及组件测试，Playwright 桌面及移动端流程测试

网站延续了之前 Vite 版本的暖纸色调、Newsreader/Manrope 字体、机构编辑式版面、原有 URL 和图片来源标注。

## 路由

机构页面包括 `/`、`/mission`、`/programs`、`/governance` 和 `/giving`。社区页面包括：

- `/community`
- `/community/people`
- `/community/learn`
- `/community/gather` 和 `/community/gather/[slug]`
- `/community/contribute`
- `/community/contribute/apply`
- `/community/contribute/resources/submit`
- `/community/code-of-conduct`
- `/privacy`

统一的私有管理后台位于 `/admin`。

## 本地开发

使用当前的 Node.js 22 或 24 运行环境。

```bash
npm install
cp .env.example .env.local
npm run dev
```

缺少外部服务凭据时，公开内容仍会展示真实的空状态和累计人数 0。表单始终可见并可操作；如果提交所需的后端不可用，提交时会显示服务错误。

## 数据库配置

按文件名顺序执行 [`supabase/migrations`](./supabase/migrations) 中的 SQL 迁移。迁移会建立数据实体、事务性注册及计数函数、重试函数、保留期清理、RLS 策略、受限的 `community-images` 存储桶、基于原始 IP 的限流，以及 Supabase Cron 保留期维护。

开发与生产共用同一个 Supabase 项目，但使用隔离的数据表。`DATABASE_ENVIRONMENT=dev|prod` 是优先级最高的选择器，在本地配置中默认为 `dev`。未设置时，本地运行、测试和 Vercel Preview 使用 `dev_*`，生产部署使用 `prod_*`。每个迁移都必须在同一事务中更新两套表。详见 [`supabase/README.md`](./supabase/README.md)。

迁移不会向匿名用户授予表单数据表的插入权限。经过验证的 Server Actions 使用仅限服务端的 Supabase Secret key；匿名访问仅限已发布的资源、活动、People 资料、活动场次及公开汇总指标。

## 运行配置

公开表单默认启用，无需上线开关。Supabase 是接受提交和使用管理后台的必要条件；Resend 用于验证及事务邮件；OpenAI 仅在管理员明确启动 Agent 审核时需要。

预约 URL、GitHub URL、受监控的公开联系邮箱、OpenAI 模型及推理强度在 `/admin/settings` 管理，不放入环境变量。OpenAI API key 仍是仅限服务端的环境密钥。Supabase Cron 在数据库内执行保留期维护，因此无需公开的 cron 路由或 cron 密钥。社区上线不会自动启用捐赠或募款。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Next.js 开发环境 |
| `npm run typecheck` | 执行严格的 TypeScript 检查 |
| `npm run lint` | 运行 Oxlint |
| `npm test` | 运行单元及组件测试 |
| `npm run test:e2e` | 运行 Playwright 桌面及移动端流程测试 |
| `npm run build` | 构建生产版本 |
| `npm start` | 在本地运行生产构建 |
| `npm run test:e2e:data` | 运行依赖数据的端到端流程 |
| `npm run test:e2e:all` | 运行两组端到端测试 |

## Agent 与隐私边界

Contributor 审核只向 OpenAI 发送申请理由、贡献兴趣、相关“其他”描述、大致地区及可选行业信息。系统不会发送邮箱或职业链接，也不会抓取这些链接。请求使用 `store: false`、哈希后的 `safety_identifier`、在 `/admin/settings` 中选定的推理强度，以及严格的 Zod 输出结构。会议不录音、不转录，也不交由 Agent 分析。

自动拒绝仅限有明确证据、置信度高的严重行为问题。管理员可以恢复申请，并关闭该申请的同一自动结案路径。OpenAI 故障不能回滚注册、验证、计数事件或可供人工审核的记录。

## 部署与运营

公开提交只会创建持久化的 Agent 任务，不会立即把内容发给 OpenAI。完成必要的邮箱验证后，管理员可以在后台明确启动或重试 Agent 审核。Agent 工作不会因公开提交或定时任务自动启动。每日保留期维护在 Supabase PostgreSQL 内执行。管理员可以在后台重发验证邮件、恢复自动拒绝的申请、导出防公式注入的 CSV、记录 Core Contributor 提名，并且只发布已获同意的个人资料。

不要填充虚构的课程、活动、人物、项目或成员记录。公开空状态是首个版本设计的一部分。

## 相关资料

- [本地后端配置](./配置后端.md)
- [数据库环境说明](./supabase/README.md)
- [端到端测试说明](./tests/e2e/README.md)
- [品牌素材及使用说明](./public/brand/README.md)
