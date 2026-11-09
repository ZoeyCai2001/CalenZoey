# 部署 CalenZoey 到 Vercel

Vercel 负责静态页面和 Node Functions，数据继续保存在现有 Neon PostgreSQL 中。Render 可以保留到 Vercel 验证完成后再停用。

## 1. 导入项目

1. 登录 <https://vercel.com>，选择 Add New -> Project。
2. 导入 GitHub 仓库 `ZoeyCai2001/CalenZoey`。
3. Framework Preset 选择 Other，项目根目录保持仓库根目录。

仓库里的 `vercel.json` 会选择新加坡函数区域，并把页面、静态资源和 API 路由交给同一个 Node Function。

## 2. 环境变量

在 Project Settings -> Environment Variables 中添加：

```env
STORAGE_DRIVER=postgres
DATABASE_URL=<Neon 控制台提供的 pooled connection string>
PGSCHEMA=calenzoey
KIMI_API_KEY=<现有 Kimi key>
CALENZOEY_APP_TOKEN=<现有网站访问口令>
CALENZOEY_SYNC_TOKEN=<现有 Apple Health 同步口令>
CALENZOEY_PUBLIC_URL=https://<项目名>.vercel.app
```

`DATABASE_URL` 应使用 Neon 控制台标有 pooled 的连接串，并保留 `sslmode=require`。如暂时没有连接串，也可以分别配置现有的 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PGSSLMODE`。

## 3. 验证

部署完成后依次检查：

```text
https://<项目名>.vercel.app/api/healthz
https://<项目名>.vercel.app/login
https://<项目名>.vercel.app/
```

`/api/healthz` 应返回 `{"ok":true,"runtime":"vercel"}`。登录后确认日程、饮食和运动数据仍在，再新增一条测试记录。

## 4. Apple Health 快捷指令

确认新站稳定后，把快捷指令中的 Render 主机名替换为 Vercel 主机名，路径和 `CALENZOEY_SYNC_TOKEN` 保持不变。

## 5. 回退

迁移不修改 Neon 中的数据，Render 也继续连接同一个数据库。Vercel 未验证完成前不要删除 Render 服务；需要回退时继续访问原 Render 地址即可。
