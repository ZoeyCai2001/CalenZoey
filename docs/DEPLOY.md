# 部署 CalenZoey 到云端

目标：app 和数据库都在云端永远在线。iPhone 快捷指令随时能推送（不再依赖 Mac 开机、不限同一 Wi-Fi，蜂窝网络也可以），平时用浏览器直接打开云端地址使用。

全部用免费档：**Neon**（PostgreSQL）+ **Render**（跑 server.mjs 的 Web Service）。

## 0. 前提

代码里有几个上云必需的保护，已经就绪：

- `CALENZOEY_APP_TOKEN`：整站访问口令。设置后，浏览器打开任何页面都会先跳到 `/login` 输入口令（口令存 cookie，一年有效）；API 无口令返回 401，前端自动跳登录页。
- `CALENZOEY_SYNC_TOKEN`：iPhone 同步接口的专用口令，拼在快捷指令 URL 里，免登录。
- `PGSSLMODE=require`：Neon 强制 SSL，`psql` 自动读取这个环境变量，代码无需改动。

## 1. 把代码推上 GitHub

仓库根目录已有 `.gitignore`（`data/`、`uploads/`、`.env.local` 都不会被提交）。

```bash
git init
git add .
git commit -m "CalenZoey: deploy-ready"
# 在 GitHub 建一个私有仓库（比如 calenzoey），然后：
git remote add origin git@github.com:<你的用户名>/calenzoey.git
git push -u origin main
```

## 2. Neon：建云端 Postgres

1. 注册 <https://neon.tech>，新建一个 project（区域选 Singapore 离你最近）。
2. 建好后在 Dashboard 拿到连接信息：`host`（形如 `ep-xxx.ap-southeast-1.aws.neon.tech`）、`user`、`password`、`database`。
3. 不用手动建表——app 首次启动会自动建 `calenzoey.app_state`。

## 3. Render：部署 Web Service

1. 注册 <https://render.com>，New → Web Service → 连接刚推的 GitHub 仓库。
2. 配置：
   - Runtime：Node
   - Build Command：留空（零依赖，不需要构建）
   - Start Command：`node server.mjs`
   - Instance Type：Free
3. Environment Variables 里填（一项项添加）：

   ```env
   STORAGE_DRIVER=postgres
   PGHOST=<Neon 的 host>
   PGPORT=5432
   PGDATABASE=<Neon 的 database>
   PGUSER=<Neon 的 user>
   PGPASSWORD=<Neon 的 password>
   PGSCHEMA=calenzoey
   PGSSLMODE=require
   KIMI_API_KEY=<你的 Kimi key>
   ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
   ANTHROPIC_MODEL=kimi-for-coding
   CALENZOEY_APP_TOKEN=<自己起一个强口令>
   CALENZOEY_SYNC_TOKEN=<再起一个不同的强口令>
   ```

   （`PORT` 由 Render 自动注入，不用设。）
4. Deploy。几分钟后得到地址 `https://<你的应用名>.onrender.com`，打开会先看到紫色登录页，输入 `CALENZOEY_APP_TOKEN` 进入。

## 4. 迁移现有数据

首次部署后云端是空数据。把本机 `calenzoey.app_state` 那一行迁过去：

```bash
# 1) 本机导出
PGPASSWORD='<本机密码>' psql -X -q -t -A -h localhost -U zoeycai -d playground \
  -c "SELECT data::text FROM calenzoey.app_state WHERE id='main';" > /tmp/calenzoey_backup.json

# 2) 生成导入 SQL（自动处理引号转义）
node -e '
const fs = require("fs");
const json = fs.readFileSync("/tmp/calenzoey_backup.json", "utf8").trim();
const tag = "calenzoey_restore_" + Date.now();
fs.writeFileSync("/tmp/calenzoey_restore.sql",
  `INSERT INTO calenzoey.app_state (id, data, updated_at)\nVALUES (\x27main\x27, \$${tag}\$${json}\$${tag}\$::jsonb, now())\nON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();\n`);
'

# 3) 写入 Neon
PGSSLMODE=require PGPASSWORD='<Neon 密码>' psql -X -q -h '<Neon host>' -U '<Neon user>' -d '<Neon database>' \
  -f /tmp/calenzoey_restore.sql
```

也可以拿到 Neon 连接信息后直接把 host/user/password 发我，我在本机帮你执行。

## 5. iPhone 快捷指令改地址

把 URL 的主机部分换成云端地址，并加上 `CALENZOEY_SYNC_TOKEN`：

```text
https://<你的应用名>.onrender.com/api/health/apple-sync?token=<SYNC_TOKEN>&date=[格式化日期]&activeEnergyKcal=[活动能量]&exerciseMinutes=[锻炼时间]&steps=[步数]&inactiveEnergyKcal=[静息能量]
```

定时任务（每天 2-3 次）不用改时间，云端随时在线。同一天重复推送仍会覆盖旧记录。

## 6. 日常使用

- **直接使用云端**：Mac / iPhone 浏览器打开 `https://<你的应用名>.onrender.com`，输入口令即可。本地不用再 `npm run dev`。
- **想继续用本地界面**：把 `.env.local` 里的 `PGHOST/PGPASSWORD/PGDATABASE/PGUSER` 换成 Neon 的、加一行 `PGSSLMODE=require`，本地 app 就会读写同一个云端数据库。

## 7. 注意事项

- Render 免费档闲置 15 分钟会休眠，下次访问冷启动约 30-60 秒——请求会等着直到实例醒来，所以同步不会丢，只是慢一点。介意的话 Render 付费档（$7/月）常醒，或接受这个延迟。
- 两个口令都要够长够随机（比如 `openssl rand -hex 24`），别复用别的密码。
- Neon 免费档 0.5GB 存储，这个应用一年也写不了几 MB，完全够用。
- 以后代码有更新：`git push` 后 Render 会自动重新部署。
