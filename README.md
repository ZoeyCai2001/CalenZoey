# CalenZoey

CalenZoey 是一个面向个人生活规划的 calendar-style 工具，目标是帮助用户规划每周活动、记录每日完成情况、管理运动和饮食，并用 LLM 生成温柔的复盘和月报。

当前仓库包含一版零外部依赖的本机 MVP：

- 周历/今日视图
- 活动添加、完成、部分完成、跳过
- 饮食文字和照片记录
- 手动 Apple Watch/运动消耗记录
- 300 kcal 热量缺口估算
- 本地规则周计划草案
- 月度统计和可爱月报 fallback
- Kimi Coding / Anthropic-compatible LLM 接入层

## Run locally

```bash
npm run dev
```

然后打开：

```text
http://localhost:3000
```

本机数据会写入 `data/`，饮食图片会写入 `uploads/`。这两个目录都已被 `.gitignore` 忽略。

## Configure Kimi

复制 `.env.example` 为 `.env.local`，填入你的 Kimi Coding key：

```bash
cp .env.example .env.local
```

`.env.local` 不会提交到 GitHub。

支持的 key 名称：

- `CALENZOEY_KIMI_API_KEY`
- `KIMI_CODING_API_KEY`
- `KIMI_API_KEY`
- 写在 `.env.local` 里的 `ANTHROPIC_API_KEY`
- 写在 `.env.local` 里的 `ANTHROPIC_AUTH_TOKEN`

设计文档：

- [PRD](./docs/PRD.md)
- [技术设计](./docs/TECHNICAL_DESIGN.md)
