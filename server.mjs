import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { networkInterfaces } from "node:os";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const uploadDir = join(root, "uploads");
const storePath = join(dataDir, "store.json");
const localEnvKeys = new Set();
const isVercel = Boolean(process.env.VERCEL);
let storageReadyPromise;
let postgresClientPromise;

loadDotEnv(join(root, ".env.local"));

const port = Number(process.env.PORT || 3000);
const storageDriver = process.env.STORAGE_DRIVER || (process.env.PGHOST ? "postgres" : "json");
const appToken = process.env.CALENZOEY_APP_TOKEN || "";

const categories = [
  { id: "work", label: "上班", color: "#6b7280", icon: "briefcase" },
  { id: "workout", label: "运动", color: "#0f9f8f", icon: "activity" },
  { id: "learning", label: "知识汲取", color: "#3b6eea", icon: "book-open" },
  { id: "inner_peace", label: "Inner peace", color: "#c05a8a", icon: "moon" },
  { id: "social", label: "社交活动", color: "#d4822b", icon: "map" }
];

const activityTemplates = {
  workout: ["无氧-臀腿", "无氧-肩背", "舞蹈-hiphop", "舞蹈-jazz", "舞蹈-urban", "舞蹈-locking", "舞蹈-popping", "游泳", "攀岩", "有氧"],
  learning: ["前沿 LLM 进展", "开发知识", "金融行业/美股", "照片处理", "产品思维/vibe coding"],
  inner_peace: ["深度小说", "工具类书籍", "电影", "电视剧"],
  social: ["吃饭", "北京市内短行", "宿外长途"],
  work: ["上午工作", "下午工作"]
};

const defaultProfile = {
  displayName: "Zoey",
  timezone: "Asia/Shanghai",
  dailyDeficitTargetKcal: 300,
  estimatedDailyExpenditureKcal: 1850,
  workBlocks: [
    { label: "上午工作", start: "08:30", end: "11:30" },
    { label: "下午工作", start: "14:00", end: "17:00" }
  ],
  planningTone: "gentle"
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/api/healthz") {
      sendJson(res, 200, { ok: true, runtime: isVercel ? "vercel" : "node" });
      return;
    }
    if (appToken && !isAuthorized(req, url)) {
      if (url.pathname.startsWith("/api/")) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
      } else {
        // 直接 200 返回登录页，避免 302 被 CDN/浏览器缓存后挡住登录后的资源加载
        serveLoginPage(res);
      }
      return;
    }
    if (url.pathname === "/login") {
      serveLoginPage(res);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "SERVER_ERROR", message: error.message });
  }
}

if (!isVercel) {
  await mkdir(uploadDir, { recursive: true });
  await ensureStorageReady();
  const server = createServer(handleRequest);
  server.listen(port, "0.0.0.0", () => {
    console.log(`CalenZoey is running at http://localhost:${port}`);
  });
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";

  if (method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    if (appToken && body.token === appToken) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": `calenzoey_token=${appToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
      });
      res.end(JSON.stringify({ ok: true }));
    } else {
      sendJson(res, 401, { error: "UNAUTHORIZED", message: "口令不对。" });
    }
    return;
  }

  await ensureStorageReady();
  const store = await readStore();

  if (method === "GET" && url.pathname === "/api/state") {
    await autoCompletePastItems(store);
    sendJson(res, 200, {
      profile: store.profile,
      categories,
      activityTemplates,
      planItems: store.planItems,
      meals: store.meals,
      dailyReviews: store.dailyReviews,
      healthMetrics: store.healthMetrics,
      monthlyReports: store.monthlyReports,
      syncUrls: getLocalSyncUrls(),
      llmConfigured: hasLlmConfig()
    });
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/profile") {
    const body = await readJson(req);
    store.profile = { ...store.profile, ...body };
    await writeStore(store);
    sendJson(res, 200, { profile: store.profile });
    return;
  }

  if (method === "POST" && url.pathname === "/api/plan-items") {
    const body = await readJson(req);
    const item = normalizePlanItem(body);
    store.planItems.push(item);
    await writeStore(store);
    sendJson(res, 201, { item });
    return;
  }

  if (method === "PATCH" && url.pathname.startsWith("/api/plan-items/")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const body = await readJson(req);
    const item = store.planItems.find((entry) => entry.id === id);
    if (!item) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
    Object.assign(item, body, { updatedAt: new Date().toISOString() });
    await writeStore(store);
    sendJson(res, 200, { item });
    return;
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/plan-items/")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    store.planItems = store.planItems.filter((entry) => entry.id !== id);
    await writeStore(store);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/meals") {
    const body = await readJson(req, 16 * 1024 * 1024);
    const meal = await normalizeMealEntry(body);
    store.meals.push(meal);
    await writeStore(store);
    sendJson(res, 201, { meal });
    return;
  }

  if (method === "POST" && url.pathname === "/api/meals/estimate-text") {
    const body = await readJson(req);
    if (!hasLlmConfig()) {
      sendJson(res, 400, { error: "LLM_NOT_CONFIGURED", message: "Kimi Coding API key is not configured." });
      return;
    }
    const estimate = await estimateMealCalories({ mealType: body.mealType || "lunch", text: String(body.text || "") });
    sendJson(res, 200, { estimate: estimate.result });
    return;
  }

  if (method === "PATCH" && url.pathname.startsWith("/api/meals/")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const body = await readJson(req);
    const meal = store.meals.find((entry) => entry.id === id);
    if (!meal) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
    Object.assign(meal, body, { updatedAt: new Date().toISOString() });
    await writeStore(store);
    sendJson(res, 200, { meal });
    return;
  }

  if (method === "POST" && url.pathname.endsWith("/estimate") && url.pathname.startsWith("/api/meals/")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-2));
    const meal = store.meals.find((entry) => entry.id === id);
    if (!meal) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
    if (!hasLlmConfig()) {
      sendJson(res, 400, { error: "LLM_NOT_CONFIGURED", message: "Kimi Coding API key is not configured." });
      return;
    }
    const estimate = await estimateMealCalories(meal);
    Object.assign(meal, estimate.patch, { updatedAt: new Date().toISOString() });
    await writeStore(store);
    sendJson(res, 200, { meal, estimate: estimate.result });
    return;
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/meals/")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    store.meals = store.meals.filter((entry) => entry.id !== id);
    await writeStore(store);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/daily-review") {
    const body = await readJson(req);
    const review = {
      id: body.id || crypto.randomUUID(),
      date: body.date,
      mood: body.mood || "",
      note: body.note || "",
      enoughToday: Boolean(body.enoughToday),
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.dailyReviews = store.dailyReviews.filter((entry) => entry.date !== review.date);
    store.dailyReviews.push(review);
    await writeStore(store);
    sendJson(res, 201, { review });
    return;
  }

  if (method === "POST" && url.pathname === "/api/health/manual") {
    const body = await readJson(req);
    const metric = {
      id: body.id || crypto.randomUUID(),
      date: body.date,
      steps: Number(body.steps || 0),
      activeEnergyKcal: Number(body.activeEnergyKcal || 0),
      inactiveEnergyKcal: Number(body.inactiveEnergyKcal || 0),
      exerciseMinutes: Number(body.exerciseMinutes || 0),
      source: "manual",
      syncedAt: new Date().toISOString()
    };
    store.healthMetrics = store.healthMetrics.filter((entry) => entry.date !== metric.date);
    store.healthMetrics.push(metric);
    await writeStore(store);
    sendJson(res, 201, { metric });
    return;
  }

  if ((method === "GET" || method === "POST") && url.pathname === "/api/health/apple-sync") {
    const body = method === "POST" ? await readJson(req) : queryParamsToBody(url.searchParams);
    const expectedToken = process.env.CALENZOEY_SYNC_TOKEN;
    if (expectedToken && body.token !== expectedToken && req.headers["x-calenzoey-sync-token"] !== expectedToken) {
      sendJson(res, 401, { error: "Invalid sync token" });
      return;
    }

    const workouts = Array.isArray(body.workouts)
      ? body.workouts.map((workout) => ({
          type: String(workout.type || workout.workoutType || "workout"),
          startAt: workout.startAt || null,
          endAt: workout.endAt || null,
          durationMinutes: Number(workout.durationMinutes || 0),
          energyKcal: Number(workout.energyKcal || workout.activeEnergyKcal || 0),
          source: "apple_health"
        }))
      : [];

    const metric = {
      id: body.id || crypto.randomUUID(),
      date: normalizeDateInput(body.date) || todayDate(),
      steps: Number(body.steps || 0),
      activeEnergyKcal: Number(body.activeEnergyKcal || body.activeEnergy || 0),
      inactiveEnergyKcal: Number(body.inactiveEnergyKcal || body.restingEnergyKcal || 0),
      exerciseMinutes: Number(body.exerciseMinutes || body.exerciseTimeMinutes || 0),
      source: "apple_health",
      workouts,
      syncedAt: new Date().toISOString()
    };
    store.healthMetrics = store.healthMetrics.filter((entry) => entry.date !== metric.date);
    store.healthMetrics.push(metric);
    await writeStore(store);
    sendJson(res, 201, { ok: true, metric });
    return;
  }

  if (method === "POST" && url.pathname === "/api/llm/weekly-plan") {
    const body = await readJson(req);
    const result = await generateWeeklyPlan(body, store);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/api/llm/plan-chat") {
    const body = await readJson(req);
    if (!hasLlmConfig()) {
      sendJson(res, 400, { error: "LLM_NOT_CONFIGURED", message: "Kimi Coding API key is not configured." });
      return;
    }
    const result = await runPlanChat(body, store);
    if (result.applied.some((entry) => entry.ok)) await writeStore(store);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/api/reports/monthly/generate") {
    const body = await readJson(req);
    const report = await generateMonthlyReport(body.month, store);
    store.monthlyReports = store.monthlyReports.filter((entry) => entry.month !== report.month);
    store.monthlyReports.push(report);
    await writeStore(store);
    sendJson(res, 201, { report });
    return;
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}

function isAuthorized(req, url) {
  if (url.pathname === "/login" || url.pathname === "/api/login") return true;
  // apple-sync 由 CALENZOEY_SYNC_TOKEN 单独把守，方便 iPhone 快捷指令免登录推送
  if (url.pathname === "/api/health/apple-sync") return true;
  return getCookie(req, "calenzoey_token") === appToken;
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function serveLoginPage(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CalenZoey · 登录</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        background: radial-gradient(1100px 480px at 85% -10%, rgba(183, 157, 240, 0.28), transparent 60%), #f6f4fb;
        color: #2e2745;
      }
      .card {
        display: grid;
        gap: 14px;
        width: min(360px, calc(100vw - 40px));
        padding: 28px;
        border: 1px solid #e2dcf0;
        border-radius: 14px;
        background: white;
        box-shadow: 0 16px 38px rgba(95, 67, 178, 0.1);
      }
      h1 { margin: 0; font-size: 20px; }
      p { margin: 0; color: #837a9e; font-size: 13px; }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 11px;
        border: 1px solid #e2dcf0;
        border-radius: 10px;
        font: inherit;
      }
      input:focus { border-color: #7c5cd6; box-shadow: 0 0 0 3px rgba(124, 92, 214, 0.16); outline: none; }
      button {
        min-height: 42px;
        border: 0;
        border-radius: 10px;
        background: linear-gradient(135deg, #7c5cd6, #5f43b2);
        color: white;
        font: inherit;
        font-weight: 750;
        cursor: pointer;
      }
      .err { min-height: 18px; color: #b0404a; font-size: 12px; }
    </style>
  </head>
  <body>
    <form class="card">
      <h1>CalenZoey</h1>
      <p>输入访问口令进入你的日历。</p>
      <input type="password" autocomplete="current-password" placeholder="访问口令" autofocus />
      <button type="submit">进入</button>
      <span class="err"></span>
    </form>
    <script>
      document.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const token = document.querySelector("input").value.trim();
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token })
        });
        if (response.ok) {
          location.href = "/";
        } else {
          document.querySelector(".err").textContent = "口令不对，再试一次。";
        }
      });
    </script>
  </body>
</html>`);
}

async function serveStatic(req, res, pathname) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = safePath.startsWith("/uploads/")
    ? join(root, safePath)
    : join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) && !filePath.startsWith(uploadDir)) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const lastModified = fileStat.mtime.toUTCString();
    if (req.headers["if-modified-since"] === lastModified) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "private, no-cache",
      "Last-Modified": lastModified
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function initStorage() {
  if (storageDriver === "postgres") {
    await initPostgresStore();
    return;
  }
  if (isVercel) {
    throw new Error("Vercel deployments require PostgreSQL storage");
  }
  await mkdir(dataDir, { recursive: true });
}

function ensureStorageReady() {
  storageReadyPromise ||= initStorage().catch((error) => {
    storageReadyPromise = undefined;
    throw error;
  });
  return storageReadyPromise;
}

async function readStore() {
  if (storageDriver === "postgres") return readPostgresStore();
  return readJsonStore();
}

async function writeStore(store) {
  if (storageDriver === "postgres") {
    await writePostgresStore(store);
    return;
  }
  await writeJsonStore(store);
}

async function readJsonStore() {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    const store = {
      profile: defaultProfile,
      planItems: [],
      meals: [],
      dailyReviews: [],
      healthMetrics: [],
      monthlyReports: []
    };
    await writeStore(store);
    return store;
  }
}

async function writeJsonStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

async function initPostgresStore() {
  const schema = getPgSchema();
  await runPsql(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)};`);
  await runPsql(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(schema)}.app_state (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`);

  const existing = await runPsql(`SELECT data::text FROM ${quoteIdentifier(schema)}.app_state WHERE id = 'main';`);
  if (existing.trim()) return;

  let initialStore;
  try {
    const raw = await readFile(storePath, "utf8");
    initialStore = normalizeStore(JSON.parse(raw));
  } catch {
    initialStore = normalizeStore({});
  }
  await writePostgresStore(initialStore);
}

async function readPostgresStore() {
  const schema = getPgSchema();
  const raw = await runPsql(`SELECT data::text FROM ${quoteIdentifier(schema)}.app_state WHERE id = 'main';`);
  if (!raw.trim()) {
    const store = normalizeStore({});
    await writePostgresStore(store);
    return store;
  }
  return normalizeStore(JSON.parse(raw));
}

async function writePostgresStore(store) {
  const schema = getPgSchema();
  const json = JSON.stringify(normalizeStore(store));
  const tag = `calenzoey_json_${crypto.randomUUID().replaceAll("-", "")}`;
  await runPsql(`
INSERT INTO ${quoteIdentifier(schema)}.app_state (id, data, updated_at)
VALUES ('main', $${tag}$${json}$${tag}$::jsonb, now())
ON CONFLICT (id)
DO UPDATE SET data = EXCLUDED.data, updated_at = now();
`);
}

function normalizeStore(parsed) {
  return {
    profile: { ...defaultProfile, ...(parsed.profile || {}) },
    planItems: parsed.planItems || [],
    meals: parsed.meals || [],
    dailyReviews: parsed.dailyReviews || [],
    healthMetrics: parsed.healthMetrics || [],
    monthlyReports: parsed.monthlyReports || []
  };
}

async function runPsql(sql) {
  if (isVercel || process.env.DATABASE_URL) {
    const client = await getPostgresClient();
    const rows = await client.unsafe(sql);
    return rows
      .map((row) =>
        Object.values(row)
          .map((value) => (value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")))
          .join("|")
      )
      .join("\n");
  }
  const { stdout } = await execFileAsync(
    "psql",
    [
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      process.env.PGHOST || "127.0.0.1",
      "-p",
      process.env.PGPORT || "5432",
      "-U",
      process.env.PGUSER || "playground",
      "-d",
      process.env.PGDATABASE || "playground",
      "-c",
      sql
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: process.env.PGPASSWORD || ""
      },
      maxBuffer: 16 * 1024 * 1024
    }
  );
  return stdout;
}

async function getPostgresClient() {
  postgresClientPromise ||= import("postgres").then(({ default: postgres }) =>
    postgres(getDatabaseUrl(), {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
      prepare: false
    })
  );
  return postgresClientPromise;
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.PGHOST;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  if (!host || !user || !password || !database) {
    throw new Error("Missing DATABASE_URL or PostgreSQL connection environment variables");
  }
  const portValue = process.env.PGPORT || "5432";
  const sslMode = process.env.PGSSLMODE || "require";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${portValue}/${encodeURIComponent(database)}?sslmode=${encodeURIComponent(sslMode)}`;
}

function getPgSchema() {
  return process.env.PGSCHEMA || "calenzoey";
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizePlanItem(body) {
  return {
    id: body.id || crypto.randomUUID(),
    title: String(body.title || "").trim() || "未命名活动",
    categoryId: body.categoryId || "learning",
    subtype: body.subtype || "",
    startAt: normalizeDateTimeInput(body.startAt),
    endAt: normalizeDateTimeInput(body.endAt),
    status: body.status || "planned",
    locked: Boolean(body.locked),
    source: body.source || "manual",
    notes: body.notes || "",
    energyCost: body.energyCost || "neutral",
    workSlot: body.workSlot || "",
    createdAt: body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function normalizeMealEntry(body) {
  const meal = {
    id: body.id || crypto.randomUUID(),
    date: body.date,
    mealType: body.mealType || "lunch",
    text: body.text || "",
    estimatedCalories: numberOrNull(body.estimatedCalories),
    confirmedCalories: numberOrNull(body.confirmedCalories),
    proteinG: numberOrNull(body.proteinG),
    carbsG: numberOrNull(body.carbsG),
    fatG: numberOrNull(body.fatG),
    confidence: numberOrNull(body.confidence),
    imagePath: "",
    llmRawResult: body.llmRawResult || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (body.imageData && String(body.imageData).startsWith("data:image/")) {
    const match = String(body.imageData).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      if (isVercel) {
        meal.imagePath = String(body.imageData);
      } else {
        const ext = match[1].includes("png") ? "png" : "jpg";
        const filename = `${meal.id}.${ext}`;
        await writeFile(join(uploadDir, filename), Buffer.from(match[2], "base64"));
        meal.imagePath = `/uploads/${filename}`;
      }
    }
  }

  return meal;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function runPlanChat(body, store) {
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(String(body.weekStart || ""))
    ? body.weekStart
    : formatDate(getMonday(new Date()));
  const weekEnd = formatDate(addDays(parseDateOnly(weekStart), 7));
  const weekItems = store.planItems.filter(
    (item) => item.startAt >= `${weekStart}T00:00` && item.startAt < `${weekEnd}T00:00`
  );
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-12)
    .map((entry) => ({
      role: entry && entry.role === "assistant" ? "assistant" : "user",
      content: String((entry && entry.content) || "").slice(0, 3000)
    }))
    .filter((entry) => entry.content.trim());
  if (!history.length) {
    return { reply: "先告诉我你这周想调整什么，比如添加、挪动或删除某个安排。", applied: [] };
  }

  // 和前端一致的默认工作块：工作日没有真实工作块时合成虚拟块，
  // 让 agent 可以直接 update（applyPlanActions 会把它物化成真实条目）
  const defaultWorkItems = [];
  for (let index = 0; index < 7; index += 1) {
    const date = formatDate(addDays(parseDateOnly(weekStart), index));
    if (isWeekendDate(date)) continue;
    for (const slot of [
      { subtype: "上午工作", workSlot: "morning-work", start: "08:30", end: "11:30" },
      { subtype: "下午工作", workSlot: "afternoon-work", start: "14:00", end: "17:00" }
    ]) {
      const exists = weekItems.some(
        (item) =>
          item.startAt?.startsWith(date) &&
          (item.workSlot === slot.workSlot ||
            (item.categoryId === "work" && (item.subtype === slot.subtype || String(item.title).includes(slot.subtype))))
      );
      if (!exists) {
        defaultWorkItems.push({
          id: `default-${date}-${slot.workSlot}`,
          title: slot.subtype,
          categoryId: "work",
          subtype: slot.subtype,
          workSlot: slot.workSlot,
          startAt: `${date}T${slot.start}:00`,
          endAt: `${date}T${slot.end}:00`,
          status: date < todayDate() ? "done" : "planned",
          locked: false,
          notes: "",
          isDefaultWork: true
        });
      }
    }
  }

  const context = {
    today: todayDate(),
    timezone: store.profile.timezone || "Asia/Shanghai",
    weekStart,
    weekDates: Array.from({ length: 7 }, (_, index) => ({
      date: formatDate(addDays(parseDateOnly(weekStart), index)),
      weekday: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index]
    })),
    categories: categories.map((category) => ({ id: category.id, label: category.label })),
    activityTemplates,
    rules: [
      "用户说周几时，日期一律以 weekDates 的对照表为准，不要自己推算",
      "update/delete 的 id 必须来自 currentWeekItems，且该条目的 weekday 必须和用户说的周几一致；用户说的时间段没有真实条目时，选择对应的 isDefaultWork 条目",
      "用户要求整体规划这一周时，可以一次生成多个 add，批量排出整周计划",
      "work 类日程的 subtype 按开始时间填：上午（12:00 前）开始用「上午工作」，下午开始用「下午工作」，会议等具体事项可以不填 subtype",
      "给已有时间段补充内容（写工作内容、加备注、补一条安排）时，用 update 修改原有条目，保留原 id 和原有内容（title/notes 可以在原内容基础上追加），不要 delete 后再 add",
      "currentWeekItems 里 isDefaultWork=true 的是自动生成的默认工作块，可以直接 update，系统会把它转成真实条目",
      "只有用户明确要求替换、取消或改期时，才用 delete 删掉被覆盖的现有日程（locked 的除外）",
      "locked 的日程不要改动，涉及时在 reply 里说明",
      "工作日 08:30-11:30 和 14:00-17:00 是工作块，用户没提就不要动",
      "中午尽量安排运动，不安排学习类活动",
      "日程时间一律用本地时间，格式 YYYY-MM-DDTHH:mm"
    ],
    currentWeekItems: [...weekItems, ...defaultWorkItems].map((item) => ({
      id: item.id,
      title: item.title,
      categoryId: item.categoryId,
      subtype: item.subtype,
      startAt: item.startAt,
      endAt: item.endAt,
      weekday: item.startAt
        ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][parseDateOnly(item.startAt.slice(0, 10)).getDay()]
        : "",
      status: item.status,
      locked: item.locked,
      notes: item.notes,
      isDefaultWork: Boolean(item.isDefaultWork)
    }))
  };

  const transcript = history
    .map((entry) => `${entry.role === "assistant" ? "助手" : "用户"}: ${entry.content}`)
    .join("\n");

  const text = await callAnthropicCompatible([
    {
      role: "user",
      content: `你是 CalenZoey 里的周计划助手，帮 Zoey 调整这一周的日程和饮食记录。不要输出思考过程。必须只输出 JSON，不要 markdown。JSON shape:
{"reply":"给用户的中文回复，语气温和简洁，说明做了什么","actions":[{"op":"add","item":{"title":"","categoryId":"work|workout|learning|inner_peace|social","subtype":"","startAt":"YYYY-MM-DDTHH:mm","endAt":"YYYY-MM-DDTHH:mm","notes":""}},{"op":"update","id":"现有日程id","patch":{"title":"","startAt":"","endAt":"","notes":"","status":""}},{"op":"delete","id":"现有日程id"},{"op":"addMeal","item":{"date":"YYYY-MM-DD","mealType":"breakfast|lunch|dinner|snack","text":"吃了什么","estimatedCalories":0}}]}

要求：
- 只处理本周（weekStart 起 7 天）的内容，add/update/addMeal 的日期必须落在本周内。
- 用户给出的安排用 add；与现有日程时间重叠时，用 delete 删掉被覆盖的现有日程（locked 除外）。
- 课程、老师、地点等细节写进 notes。
- 用户汇报吃了什么（正餐或加餐）时，用 addMeal 记成餐食，不要当成日程 add；estimatedCalories 有把握就估一个整数，没把握就不填。
- update 的 patch 只放需要修改的字段。
- 没有日程或餐食变更时 actions 输出空数组，reply 正常回复即可。
- reply 里简要说明做了什么；如果有 locked 冲突或其他问题，也在 reply 里告诉用户。

示例（id 均为示意，实际要从 currentWeekItems 里选）：
用户说「下周二上午工作帮我写上：写部署总结」，currentWeekItems 里有 {"id":"default-2026-07-28-morning-work","weekday":"周二","isDefaultWork":true} 和 {"id":"abc","weekday":"周一","title":"准备党小组会议","isDefaultWork":false}：
正确 actions：[{"op":"update","id":"default-2026-07-28-morning-work","patch":{"title":"写部署总结"}}]——选 weekday=周二 的默认工作块，不要动周一的真实条目。
用户说「下周一上午再加一项：写周报」，周一已有真实工作块 {"id":"abc","weekday":"周一","title":"准备党小组会议","notes":""}：
正确 actions：[{"op":"update","id":"abc","patch":{"notes":"准备党小组会议；写周报"}}]——在原有内容基础上追加，不要替换 title，不要 delete。

上下文：
${JSON.stringify(context, null, 2)}

对话记录：
${transcript}`
    }
  ], { maxTokens: 4096 });

  const parsed = parseJsonFromText(text);
  const applied = await applyPlanActions(store, Array.isArray(parsed.actions) ? parsed.actions : [], defaultWorkItems);
  return {
    reply: typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : "好的，已处理。",
    applied
  };
}

async function applyPlanActions(store, actions, defaultWorkItems = []) {
  const applied = [];
  for (const action of actions.slice(0, 30)) {
    if (!action || typeof action !== "object") continue;
    if (action.op === "add" && action.item) {
      const item = normalizePlanItem({
        ...action.item,
        id: crypto.randomUUID(),
        status: action.item.status || "planned",
        source: "agent"
      });
      if (!item.startAt || !item.endAt) {
        applied.push({ op: "add", ok: false, title: item.title, reason: "缺少时间，未添加" });
        continue;
      }
      store.planItems.push(item);
      applied.push({ op: "add", ok: true, title: item.title, startAt: item.startAt, endAt: item.endAt });
    } else if (action.op === "update" && action.id) {
      const defaultItem = defaultWorkItems.find((entry) => entry.id === action.id);
      if (defaultItem) {
        // 默认工作块是虚拟的，update 时先物化成真实条目再应用补丁
        const patch = { ...(action.patch || {}) };
        for (const key of ["id", "createdAt", "source", "isDefaultWork"]) delete patch[key];
        if (patch.startAt) patch.startAt = normalizeDateTimeInput(patch.startAt);
        if (patch.endAt) patch.endAt = normalizeDateTimeInput(patch.endAt);
        const item = normalizePlanItem({
          ...defaultItem,
          ...patch,
          id: crypto.randomUUID(),
          source: "agent"
        });
        store.planItems.push(item);
        applied.push({ op: "update", ok: true, title: item.title, startAt: item.startAt, endAt: item.endAt });
        continue;
      }
      const item = store.planItems.find((entry) => entry.id === action.id);
      if (!item) {
        applied.push({ op: "update", ok: false, id: action.id, reason: "没有找到对应日程" });
        continue;
      }
      const patch = { ...(action.patch || {}) };
      for (const key of ["id", "createdAt", "source"]) delete patch[key];
      if (patch.startAt) patch.startAt = normalizeDateTimeInput(patch.startAt);
      if (patch.endAt) patch.endAt = normalizeDateTimeInput(patch.endAt);
      Object.assign(item, patch, { updatedAt: new Date().toISOString() });
      applied.push({ op: "update", ok: true, title: item.title, startAt: item.startAt, endAt: item.endAt });
    } else if (action.op === "addMeal" && action.item) {
      const input = action.item;
      const date = String(input.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !String(input.text || "").trim()) {
        applied.push({ op: "addMeal", ok: false, title: String(input.text || "餐食"), reason: "日期或描述无效，未记录" });
        continue;
      }
      const meal = {
        id: crypto.randomUUID(),
        date,
        mealType: ["breakfast", "lunch", "dinner", "snack"].includes(input.mealType) ? input.mealType : "snack",
        text: String(input.text || "").trim().slice(0, 500),
        estimatedCalories: numberOrNull(input.estimatedCalories),
        confirmedCalories: null,
        proteinG: numberOrNull(input.proteinG),
        carbsG: numberOrNull(input.carbsG),
        fatG: numberOrNull(input.fatG),
        confidence: null,
        imagePath: "",
        llmRawResult: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.meals.push(meal);
      // 记录后立刻自动估算热量并回填；估算失败不影响记录本身
      try {
        const estimate = await estimateMealCalories(meal);
        Object.assign(meal, estimate.patch, { updatedAt: new Date().toISOString() });
        applied.push({ op: "addMeal", ok: true, title: meal.text, startAt: meal.date, estimatedCalories: meal.estimatedCalories });
      } catch (error) {
        applied.push({ op: "addMeal", ok: true, title: meal.text, startAt: meal.date, estimatedCalories: meal.estimatedCalories, estimateWarning: error.message });
      }
    } else if (action.op === "delete" && action.id) {
      if (String(action.id).startsWith("default-")) {
        applied.push({ op: "delete", ok: false, id: action.id, reason: "默认工作块不能删除，要改内容或请假请用 update" });
        continue;
      }
      const item = store.planItems.find((entry) => entry.id === action.id);
      if (!item) {
        applied.push({ op: "delete", ok: false, id: action.id, reason: "没有找到对应日程" });
        continue;
      }
      store.planItems = store.planItems.filter((entry) => entry.id !== action.id);
      applied.push({ op: "delete", ok: true, title: item.title, startAt: item.startAt });
    }
  }
  return applied;
}

function todayDate() {
  return formatDate(new Date());
}

// 把快捷指令可能传来的各种日期格式（2026-07-25 / 2026年7月25日 / 2026/7/25）统一成 ISO
function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  const match =
    raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ||
    raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/) ||
    raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return raw;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

// 每天结束后，把早于今天、仍处于 planned 的日程自动置为完成，有变更就落库
async function autoCompletePastItems(store) {
  const today = todayDate();
  let changed = false;
  for (const item of store.planItems) {
    if (item.status === "planned" && typeof item.startAt === "string" && item.startAt.slice(0, 10) < today) {
      item.status = "done";
      item.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await writeStore(store);
}

async function generateWeeklyPlan(body, store) {
  const weekStart = body.weekStart || getMonday(new Date()).toISOString().slice(0, 10);
  const context = buildPlanningContext(weekStart, store, body);

  if (hasLlmConfig()) {
    try {
      const text = await callAnthropicCompatible([
        {
          role: "user",
          content: `请为 Zoey 生成下一周生活计划。不要输出思考过程。必须只输出 JSON，不要 markdown。JSON shape:
{"items":[{"title":"","categoryId":"workout|learning|inner_peace|social","subtype":"","startAt":"ISO datetime","endAt":"ISO datetime","reason":"","energyCost":"restorative|neutral|demanding"}],"warnings":[],"notes":""}

约束和上下文：
${JSON.stringify(context, null, 2)}`
        }
      ], { maxTokens: 8192 });
      const parsed = parseJsonFromText(text);
      return {
        source: "llm",
        draft: normalizeDraft(parsed, weekStart),
        raw: text
      };
    } catch (error) {
      return {
        source: "fallback",
        warning: `LLM 暂时不可用，已用本地规则生成：${error.message}`,
        draft: localWeeklyPlan(weekStart)
      };
    }
  }

  return {
    source: "fallback",
    warning: "未检测到 Kimi Coding 环境变量，已用本地规则生成。",
    draft: localWeeklyPlan(weekStart)
  };
}

async function generateMonthlyReport(month, store) {
  const stats = buildMonthStats(month, store);
  const fallbackMarkdown = localMonthlyReport(stats);

  let llmReportMarkdown = fallbackMarkdown;
  let source = "fallback";
  if (hasLlmConfig()) {
    try {
      const text = await callAnthropicCompatible([
        {
          role: "user",
          content: `请基于下面的个人生活数据，生成一份中文可爱月报。不要输出思考过程。语气温柔、具体、不要鸡血、不要制造愧疚。请用 markdown 输出。
${JSON.stringify(stats, null, 2)}`
        }
      ], { maxTokens: 4096 });
      llmReportMarkdown = stripCodeFences(text);
      source = "llm";
    } catch (error) {
      llmReportMarkdown = `${fallbackMarkdown}\n\n> LLM 月报暂时不可用：${error.message}`;
    }
  }

  return {
    id: crypto.randomUUID(),
    month,
    stats,
    source,
    llmReportMarkdown,
    generatedAt: new Date().toISOString()
  };
}

async function estimateMealCalories(meal) {
  const text = await callAnthropicCompatible([
    {
      role: "user",
      content: `请根据下面的餐食文字估算热量。不要输出思考过程。必须只输出 JSON，不要 markdown。JSON shape:
{"foods":[{"name":"","portion":"","calories":0}],"totalCalories":0,"proteinG":0,"carbsG":0,"fatG":0,"confidence":0.0,"notes":""}

餐次：${meal.mealType}
描述：${meal.text || "无文字描述"}

要求：
- 如果描述不完整，也要给保守估算，并在 notes 说明不确定性。
- confidence 在 0 到 1 之间。
- 不要给医疗建议。`
    }
  ], { maxTokens: 2048 });
  const parsed = parseJsonFromText(text);
  const result = {
    foods: Array.isArray(parsed.foods) ? parsed.foods : [],
    totalCalories: numberOrNull(parsed.totalCalories) ?? numberOrNull(parsed.calories) ?? null,
    proteinG: numberOrNull(parsed.proteinG),
    carbsG: numberOrNull(parsed.carbsG),
    fatG: numberOrNull(parsed.fatG),
    confidence: numberOrNull(parsed.confidence),
    notes: parsed.notes || ""
  };
  return {
    result,
    patch: {
      estimatedCalories: result.totalCalories,
      proteinG: result.proteinG,
      carbsG: result.carbsG,
      fatG: result.fatG,
      confidence: result.confidence,
      llmRawResult: result
    }
  };
}

async function callAnthropicCompatible(messages, options = {}) {
  const apiKey = getLlmApiKey();
  const model = getEnvValue("ANTHROPIC_MODEL", "kimi-for-coding");
  const baseUrl = getEnvValue("ANTHROPIC_BASE_URL", "https://api.kimi.com/coding/").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/v1/messages`;
  const maxTokens = options.maxTokens || 4096;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "authorization": `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.4,
      thinking: { type: "disabled" },
      messages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kimi Coding API ${response.status}: ${errorText.slice(0, 240)}`);
  }

  const json = await response.json();
  const text = extractAnthropicText(json).trim();
  if (!text) {
    const blockTypes = (json.content || []).map((part) => part.type).join(",") || "none";
    throw new Error(`Kimi Coding API returned no text content; stop_reason=${json.stop_reason || "unknown"}; blocks=${blockTypes}`);
  }
  return text;
}

function extractAnthropicText(json) {
  if (typeof json.content === "string") return json.content;
  if (!Array.isArray(json.content)) return "";
  return json.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function hasLlmConfig() {
  // Base URL and model fall back to Kimi defaults in callAnthropicCompatible,
  // so a key alone counts as configured.
  return Boolean(getLlmApiKey());
}

function getLlmApiKey() {
  const key =
    process.env.CALENZOEY_KIMI_API_KEY ||
    process.env.KIMI_CODING_API_KEY ||
    process.env.KIMI_API_KEY ||
    getLocalOnlyEnv("ANTHROPIC_API_KEY") ||
    getLocalOnlyEnv("ANTHROPIC_AUTH_TOKEN") ||
    "";
  if (!key || key.includes("replace-with") || key.includes("your-kimi")) return "";
  return key;
}

function getEnvValue(key, fallback = "") {
  if (key.startsWith("KIMI_") || key.startsWith("CALENZOEY_")) return process.env[key] || fallback;
  return getLocalOnlyEnv(key) || fallback;
}

function getLocalOnlyEnv(key) {
  return localEnvKeys.has(key) ? process.env[key] : "";
}

function buildPlanningContext(weekStart, store, body) {
  return {
    weekStart,
    profile: store.profile,
    rules: [
      "工作日 08:30-11:30 和 14:00-17:00 不安排非工作活动",
      "早上不额外安排事情",
      "每天安排 1-2 次运动",
      "工作日五天尽量两天双运动",
      "周一不安排双运动，因为倒时差",
      "双运动日通常为有氧 + 无氧",
      "中午尽量安排运动，不安排学习类活动",
      "中午运动后，晚上可以不安排运动",
      "晚上活动可以安排 2 小时",
      "周六晚上选择下周舞蹈课",
      "月报和复盘语气温柔，不制造愧疚"
    ],
    lockedItems: store.planItems.filter((item) => item.locked && item.startAt >= `${weekStart}T00:00`),
    userIntent: body.intent || ""
  };
}

function normalizeDraft(parsed, weekStart) {
  const fallback = localWeeklyPlan(weekStart);
  if (!parsed || !Array.isArray(parsed.items)) return fallback;
  const warnings = Array.isArray(parsed.warnings) ? [...parsed.warnings] : [];
  const items = [];
  for (const item of parsed.items) {
    const normalized = normalizePlanItem({
      ...item,
      id: crypto.randomUUID(),
      status: "planned",
      source: "llm"
    });
    const issue = validateGeneratedPlanItem(normalized);
    if (issue) {
      warnings.push(`${normalized.title}: ${issue}`);
      continue;
    }
    items.push(normalized);
  }
  return {
    items,
    warnings,
    notes: parsed.notes || ""
  };
}

function validateGeneratedPlanItem(item) {
  if (!item.startAt || !item.endAt) return "时间格式无效，已忽略";
  const startTime = item.startAt.slice(11, 16);
  const endTime = item.endAt.slice(11, 16);
  if (startTime < "11:30" && item.categoryId !== "work") return "早上不安排额外活动，已忽略";
  if (startTime >= "11:30" && startTime < "14:00" && item.categoryId === "learning") {
    return "中午不安排学习类活动，已忽略";
  }
  if (isWeekendDate(item.startAt.slice(0, 10)) && item.categoryId === "work") return "周末不安排工作，已忽略";
  if (item.endAt <= item.startAt || endTime <= startTime) return "结束时间不晚于开始时间，已忽略";
  return "";
}

function localWeeklyPlan(weekStart) {
  const start = parseDateOnly(weekStart);
  const item = (dayOffset, title, categoryId, subtype, startTime, endTime, energyCost = "neutral", notes = "") => {
    const day = addDays(start, dayOffset);
    return normalizePlanItem({
      title,
      categoryId,
      subtype,
      startAt: `${formatDate(day)}T${startTime}:00`,
      endAt: `${formatDate(day)}T${endTime}:00`,
      source: "system",
      energyCost,
      notes
    });
  };

  return {
    items: [
      item(0, "轻量恢复有氧", "workout", "有氧", "12:15", "12:55", "neutral", "周一不双练，给时差留空间"),
      item(0, "开发知识补课", "learning", "开发知识", "19:30", "21:30"),
      item(1, "无氧-臀腿", "workout", "无氧-臀腿", "12:15", "13:05", "demanding"),
      item(1, "深度小说与放松", "inner_peace", "深度小说", "20:30", "22:30", "restorative"),
      item(2, "游泳或有氧", "workout", "游泳", "12:15", "13:00"),
      item(2, "无氧-肩背", "workout", "无氧-肩背", "19:30", "21:30", "demanding"),
      item(3, "中午有氧快走/椭圆机", "workout", "有氧", "12:20", "13:00"),
      item(3, "前沿 LLM 进展", "learning", "前沿 LLM 进展", "19:30", "21:30"),
      item(4, "舞蹈课或攀岩", "workout", "舞蹈-urban", "19:30", "21:30", "demanding"),
      item(5, "选择下周舞蹈课", "workout", "舞蹈课规划", "19:30", "20:00"),
      item(5, "北京市内短行/吃饭", "social", "北京市内短行", "14:30", "18:00", "restorative"),
      item(6, "周计划：下周轻量编排", "learning", "产品思维/vibe coding", "19:30", "21:30")
    ],
    warnings: ["这是本地规则草案，保存前可以按真实舞蹈课时间调整。"],
    notes: "保留了周一恢复、两天双运动和周六选课。"
  };
}

function buildMonthStats(month, store) {
  const planItems = store.planItems.filter((item) => item.startAt?.startsWith(month));
  const meals = store.meals.filter((meal) => meal.date?.startsWith(month));
  const reviews = store.dailyReviews.filter((review) => review.date?.startsWith(month));
  const health = store.healthMetrics.filter((metric) => metric.date?.startsWith(month));

  const completed = planItems.filter((item) => item.status === "done" || item.status === "partial");
  const byCategory = {};
  for (const item of planItems) {
    byCategory[item.categoryId] ||= { planned: 0, completed: 0, minutes: 0 };
    byCategory[item.categoryId].planned += 1;
    if (item.status === "done" || item.status === "partial") byCategory[item.categoryId].completed += 1;
    byCategory[item.categoryId].minutes += diffMinutes(item.startAt, item.endAt);
  }

  const intake = meals.reduce((sum, meal) => sum + Number(meal.confirmedCalories ?? meal.estimatedCalories ?? 0), 0);
  const activeEnergy = health.reduce((sum, metric) => sum + Number(metric.activeEnergyKcal || 0), 0);
  const exerciseMinutes = health.reduce((sum, metric) => sum + Number(metric.exerciseMinutes || 0), 0);

  return {
    month,
    plannedCount: planItems.length,
    completedCount: completed.length,
    completionRate: planItems.length ? Math.round((completed.length / planItems.length) * 100) : 0,
    byCategory,
    mealsLogged: meals.length,
    estimatedIntakeKcal: Math.round(intake),
    activeEnergyKcal: Math.round(activeEnergy),
    exerciseMinutes,
    reviewDays: reviews.length,
    enoughTodayCount: reviews.filter((review) => review.enoughToday).length
  };
}

function localMonthlyReport(stats) {
  const workout = stats.byCategory.workout || { planned: 0, completed: 0, minutes: 0 };
  const learning = stats.byCategory.learning || { planned: 0, completed: 0, minutes: 0 };
  const peace = stats.byCategory.inner_peace || { planned: 0, completed: 0, minutes: 0 };
  return `# ${stats.month} 月度小结

这个月一共规划了 ${stats.plannedCount} 件事，完成或部分完成了 ${stats.completedCount} 件，完成率约 ${stats.completionRate}%。

## 运动

运动相关完成 ${workout.completed}/${workout.planned} 项，计划时长约 ${workout.minutes} 分钟。重点不是完美，而是身体已经在被认真照顾。

## 知识汲取

知识汲取完成 ${learning.completed}/${learning.planned} 项。开发、LLM、金融和产品思维这些小块积累，会慢慢长成你的底气。

## Inner peace

Inner peace 完成 ${peace.completed}/${peace.planned} 项。这个区域不是奖励，而是生活本身的一部分。

## 饮食与能量

记录饮食 ${stats.mealsLogged} 次，估算摄入 ${stats.estimatedIntakeKcal} kcal，记录运动消耗 ${stats.activeEnergyKcal} kcal。

## 给下个月的轻建议

保留周一轻量，继续把双运动放在更有能量的工作日。每天只要有一个选择是在照顾自己，这一天就不是空白。`;
}

function stripCodeFences(text) {
  return String(text || "")
    .replace(/^\s*```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

function parseJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM output did not include JSON");
    return JSON.parse(match[0]);
  }
}

async function readJson(req, limit = 1024 * 1024) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("Request body too large");
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function queryParamsToBody(searchParams) {
  return Object.fromEntries([...searchParams.entries()].map(([key, value]) => [key.trim(), value.trim()]));
}

function getLocalSyncUrls() {
  const publicUrl = process.env.CALENZOEY_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (publicUrl) return [`${publicUrl.replace(/\/$/, "")}/api/health/apple-sync`];
  const urls = [`http://localhost:${port}/api/health/apple-sync`];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/api/health/apple-sync`);
      }
    }
  }
  return [...new Set(urls)];
}

function loadDotEnv(path) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
      localEnvKeys.add(key);
      process.env[key] = value;
    }
  } catch {
    // Local env is optional; without it the app uses deterministic planning fallbacks.
  }
}

function getMonday(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function parseDateOnly(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function normalizeDateTimeInput(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return raw;
  return `${match[1]}T${match[2]}:${match[3]}:00`;
}

function isWeekendDate(value) {
  const day = parseDateOnly(value).getDay();
  return day === 0 || day === 6;
}

function addDays(date, count) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + count);
  return copy;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffMinutes(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const value = Math.round((end - start) / 60000);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
