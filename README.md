# CalenZoey

CalenZoey 是一个面向个人生活规划的 calendar-style 工具，目标是帮助用户规划每周活动、记录每日完成情况、管理运动和饮食，并用 LLM 生成温柔的复盘和月报。

当前仓库包含一版零外部依赖的本机 MVP：

- 周历/今日视图
- 周历内按早餐、上午工作、中午活动、午餐、下午工作、晚餐、晚上活动排序
- 活动和工作块添加、编辑、删除、完成、部分完成、跳过
- 周六周日默认不显示工作块，手动添加的周末工作/备忘仍会显示
- 日程卡片操作收纳在右上角更多菜单中
- 饮食文字和照片记录，直接显示在周历每天的餐次里
- 文字餐食可通过 Kimi Coding 估算热量和宏量营养素
- 手动 Apple Watch/运动消耗记录
- 300 kcal 热量缺口估算
- 本地规则周计划草案
- 右上角整月日历，用色块标记每天的活动类型
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

默认使用本机 PostgreSQL 保存应用数据；饮食图片仍会写入 `uploads/`。如果把
`STORAGE_DRIVER` 改成 `json`，应用会退回到旧的 `data/store.json` 文件存储。
`data/`、`uploads/` 和 `.env.local` 都已被 `.gitignore` 忽略。

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

## Configure storage

`.env.example` 默认配置为本机 PostgreSQL：

```env
STORAGE_DRIVER="postgres"
PGHOST="127.0.0.1"
PGPORT="5432"
PGDATABASE="playground"
PGUSER="playground"
PGPASSWORD="replace-with-your-postgres-password"
PGSCHEMA="calenzoey"
```

启动时应用会自动创建 `calenzoey.app_state`，并在第一次连接 PostgreSQL 时把
旧的 `data/store.json` 内容迁移进去。当前实现把完整应用状态存为一份 JSONB
文档，方便先稳定运行；后续如果需要更强的查询和分析能力，可以再拆成
`plan_items`、`meals`、`daily_reviews` 等结构化表。

## Apple Health sync over the same Wi-Fi

CalenZoey 提供了一个给 iPhone 快捷指令使用的同步入口：

```text
POST /api/health/apple-sync
```

今日页会显示完整的局域网 URL，例如：

```text
http://192.168.1.23:3000/api/health/apple-sync
```

iPhone 和 Mac 需要在同一个 Wi-Fi 下。快捷指令可以用「获取 URL 内容」发送
JSON：

```json
{
  "date": "2026-07-15",
  "activeEnergyKcal": 420,
  "exerciseMinutes": 55,
  "steps": 8200,
  "workouts": [
    {
      "type": "swimming",
      "startAt": "2026-07-15T12:10:00+08:00",
      "endAt": "2026-07-15T12:55:00+08:00",
      "durationMinutes": 45,
      "energyKcal": 260
    }
  ]
}
```

如果 `.env.local` 设置了 `CALENZOEY_SYNC_TOKEN`，请求需要额外带同名 token：

```json
{
  "token": "your-sync-token",
  "date": "2026-07-15",
  "activeEnergyKcal": 420,
  "exerciseMinutes": 55
}
```

设计文档：

- [PRD](./docs/PRD.md)
- [技术设计](./docs/TECHNICAL_DESIGN.md)
