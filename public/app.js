const state = {
  profile: null,
  categories: [],
  activityTemplates: {},
  planItems: [],
  meals: [],
  dailyReviews: [],
  healthMetrics: [],
  monthlyReports: [],
  llmConfigured: false,
  selectedDate: todayDate(),
  weekStart: formatDate(getMonday(new Date())),
  draft: null
};

const els = {
  llmStatus: document.querySelector("#llmStatus"),
  currentDateLabel: document.querySelector("#currentDateLabel"),
  viewTitle: document.querySelector("#viewTitle"),
  todayTimeline: document.querySelector("#todayTimeline"),
  calendarGrid: document.querySelector("#calendarGrid"),
  weekRangeLabel: document.querySelector("#weekRangeLabel"),
  todayIntake: document.querySelector("#todayIntake"),
  todayActiveEnergy: document.querySelector("#todayActiveEnergy"),
  todayDeficit: document.querySelector("#todayDeficit"),
  deficitFill: document.querySelector("#deficitFill"),
  deficitCopy: document.querySelector("#deficitCopy"),
  mealList: document.querySelector("#mealList"),
  statsStrip: document.querySelector("#statsStrip"),
  reportOutput: document.querySelector("#reportOutput"),
  planModal: document.querySelector("#planModal"),
  planForm: document.querySelector("#planForm"),
  categorySelect: document.querySelector("#categorySelect"),
  subtypeSelect: document.querySelector("#subtypeSelect"),
  saveDraftBtn: document.querySelector("#saveDraftBtn")
};

const statusLabel = {
  planned: "计划",
  done: "完成",
  partial: "部分",
  skipped: "跳过",
  imported: "导入"
};

const categoryBorder = {
  work: "#6b7280",
  workout: "#0f9f8f",
  learning: "#3b6eea",
  inner_peace: "#c05a8a",
  social: "#d4822b"
};

init();

async function init() {
  bindEvents();
  await loadState();
  renderAll();
}

function bindEvents() {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.querySelector("#todayBtn").addEventListener("click", () => {
    state.selectedDate = todayDate();
    state.weekStart = formatDate(getMonday(new Date()));
    renderAll();
  });

  document.querySelector("#prevWeekBtn").addEventListener("click", () => shiftWeek(-7));
  document.querySelector("#nextWeekBtn").addEventListener("click", () => shiftWeek(7));
  document.querySelector("#openPlanModalBtn").addEventListener("click", () => openPlanModal());
  document.querySelector("#closePlanModalBtn").addEventListener("click", () => els.planModal.close());
  document.querySelector("#categorySelect").addEventListener("change", updateSubtypeOptions);
  document.querySelector("#generateWeekBtn").addEventListener("click", generateWeeklyDraft);
  document.querySelector("#generateWeekBtn2").addEventListener("click", generateWeeklyDraft);
  document.querySelector("#saveDraftBtn").addEventListener("click", saveDraft);
  document.querySelector("#generateReportBtn").addEventListener("click", generateReport);

  els.planForm.addEventListener("submit", savePlanItem);
  document.querySelector("#mealForm").addEventListener("submit", saveMeal);
  document.querySelector("#reviewForm").addEventListener("submit", saveReview);
  document.querySelector("#healthForm").addEventListener("submit", saveHealth);
}

async function loadState() {
  const data = await api("/api/state");
  Object.assign(state, data);
}

function renderAll() {
  renderMeta();
  renderCategoryOptions();
  renderToday();
  renderWeek();
  renderMeals();
  renderStats();
}

function renderMeta() {
  const selected = parseDate(state.selectedDate);
  els.currentDateLabel.textContent = selected.toLocaleDateString("zh-CN", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
  els.llmStatus.textContent = state.llmConfigured
    ? "已检测到 Kimi Coding 配置"
    : "未配置 API 时会使用本地规则";

  const weekEnd = addDays(parseDate(state.weekStart), 6);
  els.weekRangeLabel.textContent = `${state.weekStart} - ${formatDate(weekEnd)}`;
}

function renderCategoryOptions() {
  if (els.categorySelect.options.length) return;
  els.categorySelect.innerHTML = state.categories
    .filter((category) => category.id !== "work")
    .map((category) => `<option value="${category.id}">${escapeHtml(category.label)}</option>`)
    .join("");
  updateSubtypeOptions();
}

function updateSubtypeOptions() {
  const category = els.categorySelect.value;
  const options = state.activityTemplates[category] || [];
  els.subtypeSelect.innerHTML = options
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join("");
}

function renderToday() {
  const items = itemsForDate(state.selectedDate)
    .filter((item) => item.categoryId !== "work")
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  els.todayTimeline.innerHTML = "";

  if (!items.length) {
    els.todayTimeline.innerHTML = `<div class="empty-state">今天还没有计划。可以添加一个很小的活动，或者就让今天轻一点。</div>`;
  } else {
    items.forEach((item) => els.todayTimeline.appendChild(renderEventCard(item)));
  }

  const meals = mealsForDate(state.selectedDate);
  const intake = meals.reduce((sum, meal) => sum + Number(meal.confirmedCalories ?? meal.estimatedCalories ?? 0), 0);
  const health = healthForDate(state.selectedDate);
  const activeEnergy = health?.activeEnergyKcal || 0;
  const expenditure = state.profile?.estimatedDailyExpenditureKcal || 0;
  const deficit = expenditure + activeEnergy - intake;
  const target = state.profile?.dailyDeficitTargetKcal || 300;
  const fill = Math.max(0, Math.min(100, Math.round((deficit / target) * 100)));

  els.todayIntake.textContent = `${Math.round(intake)} kcal`;
  els.todayActiveEnergy.textContent = `${Math.round(activeEnergy)} kcal`;
  els.todayDeficit.textContent = `${Math.round(deficit)} kcal`;
  els.deficitFill.style.width = `${fill}%`;
  els.deficitCopy.textContent =
    deficit >= target
      ? "今天的估算缺口已经接近目标，晚上可以把注意力放回恢复。"
      : `距离 300 kcal 目标还差约 ${Math.max(0, Math.round(target - deficit))} kcal。`;
}

function renderWeek() {
  const start = parseDate(state.weekStart);
  const draftItems = state.draft?.items || [];
  const visibleItems = [
    ...state.planItems.filter((item) => isInWeek(item.startAt, state.weekStart)),
    ...draftItems.map((item) => ({ ...item, isDraft: true }))
  ];

  els.calendarGrid.innerHTML = "";
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(start, offset);
    const dateText = formatDate(date);
    const column = document.createElement("section");
    column.className = `day-column${dateText === todayDate() ? " today" : ""}`;
    column.innerHTML = `
      <div class="day-head">
        <h4>${weekdayName(date)}</h4>
        <p>${dateText}</p>
      </div>
      <div class="work-block">08:30-11:30 上午工作</div>
      <div class="work-block">14:00-17:00 下午工作</div>
    `;

    const dayItems = visibleItems
      .filter((item) => item.startAt?.startsWith(dateText) && item.categoryId !== "work")
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

    if (!dayItems.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "留白";
      column.appendChild(empty);
    } else {
      dayItems.forEach((item) => column.appendChild(renderEventCard(item)));
    }

    column.addEventListener("dblclick", () => openPlanModal(dateText));
    els.calendarGrid.appendChild(column);
  }
}

function renderEventCard(item) {
  const template = document.querySelector("#eventTemplate").content.cloneNode(true);
  const card = template.querySelector(".event-card");
  const category = state.categories.find((entry) => entry.id === item.categoryId);
  card.style.borderLeftColor = categoryBorder[item.categoryId] || "#0f9f8f";
  card.dataset.id = item.id;
  if (item.isDraft) card.style.background = "#f4fbf9";

  template.querySelector(".event-time").textContent = `${timeOnly(item.startAt)}-${timeOnly(item.endAt)}`;
  template.querySelector(".event-status").textContent = item.isDraft ? "草案" : statusLabel[item.status] || "计划";
  template.querySelector("h4").textContent = item.title;
  template.querySelector("p").textContent = [category?.label, item.subtype, item.notes].filter(Boolean).join(" · ");

  template.querySelectorAll(".event-actions button").forEach((button) => {
    button.disabled = item.isDraft;
    button.addEventListener("click", async () => {
      await api(`/api/plan-items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: { status: button.dataset.status }
      });
      await loadState();
      renderAll();
    });
  });

  return template;
}

function renderMeals() {
  const meals = mealsForDate(state.selectedDate).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  els.mealList.innerHTML = "";
  if (!meals.length) {
    els.mealList.innerHTML = `<div class="empty-state">今天还没有饮食记录。可以先用文字记一餐，照片以后再补。</div>`;
    return;
  }

  for (const meal of meals) {
    const card = document.createElement("article");
    card.className = "meal-card";
    const calories = meal.confirmedCalories ?? meal.estimatedCalories ?? 0;
    card.innerHTML = `
      ${
        meal.imagePath
          ? `<img src="${escapeHtml(meal.imagePath)}" alt="餐食照片" />`
          : `<div class="meal-placeholder" aria-hidden="true"></div>`
      }
      <div>
        <h4>${mealTypeLabel(meal.mealType)} · ${Math.round(calories)} kcal</h4>
        <p>${escapeHtml(meal.text || "没有文字描述")}</p>
      </div>
    `;
    els.mealList.appendChild(card);
  }
}

function renderStats() {
  const month = state.selectedDate.slice(0, 7);
  const items = state.planItems.filter((item) => item.startAt?.startsWith(month));
  const completed = items.filter((item) => item.status === "done" || item.status === "partial");
  const workouts = completed.filter((item) => item.categoryId === "workout");
  const learning = completed.filter((item) => item.categoryId === "learning");
  const peace = completed.filter((item) => item.categoryId === "inner_peace");
  const meals = state.meals.filter((meal) => meal.date?.startsWith(month));

  els.statsStrip.innerHTML = [
    ["完成事项", `${completed.length}/${items.length}`],
    ["运动", `${workouts.length} 次`],
    ["知识汲取", `${learning.length} 次`],
    ["饮食记录", `${meals.length} 餐`],
    ["Inner peace", `${peace.length} 次`]
  ]
    .map(([label, value]) => `<div class="stat-tile"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  const latest = state.monthlyReports
    .filter((report) => report.month === month)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];

  if (latest) {
    els.reportOutput.innerHTML = markdownToHtml(latest.llmReportMarkdown);
  }
}

function switchView(view) {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `${view}View`);
  });
  const titles = {
    today: "今日计划",
    week: "周计划",
    food: "饮食记录",
    report: "月度总结"
  };
  els.viewTitle.textContent = titles[view] || "CalenZoey";
}

function shiftWeek(days) {
  const next = addDays(parseDate(state.weekStart), days);
  state.weekStart = formatDate(next);
  state.selectedDate = state.weekStart;
  state.draft = null;
  els.saveDraftBtn.disabled = true;
  renderAll();
}

function openPlanModal(dateText = state.selectedDate) {
  const start = `${dateText}T12:15`;
  const end = `${dateText}T13:00`;
  els.planForm.reset();
  els.planForm.elements.startAt.value = start;
  els.planForm.elements.endAt.value = end;
  renderCategoryOptions();
  els.planModal.showModal();
}

async function savePlanItem(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/plan-items", {
    method: "POST",
    body: Object.fromEntries(form.entries())
  });
  els.planModal.close();
  await loadState();
  renderAll();
}

async function generateWeeklyDraft() {
  setBusy(true, "正在生成");
  try {
    const result = await api("/api/llm/weekly-plan", {
      method: "POST",
      body: {
        weekStart: state.weekStart,
        intent: "请按减脂、运动恢复、开发知识补课和 inner peace 平衡生成本周计划。"
      }
    });
    state.draft = result.draft;
    els.saveDraftBtn.disabled = false;
    renderWeek();
    switchView("week");
    if (result.warning) notify(result.warning);
  } finally {
    setBusy(false);
  }
}

async function saveDraft() {
  if (!state.draft?.items?.length) return;
  for (const item of state.draft.items) {
    const { isDraft, ...payload } = item;
    await api("/api/plan-items", {
      method: "POST",
      body: { ...payload, source: payload.source || "llm" }
    });
  }
  state.draft = null;
  els.saveDraftBtn.disabled = true;
  await loadState();
  renderAll();
}

async function saveMeal(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get("image");
  const payload = {
    date: state.selectedDate,
    mealType: form.get("mealType"),
    text: form.get("text"),
    estimatedCalories: form.get("estimatedCalories"),
    confirmedCalories: form.get("confirmedCalories")
  };

  if (file && file.size) {
    payload.imageData = await fileToDataUrl(file);
  }

  await api("/api/meals", { method: "POST", body: payload });
  event.currentTarget.reset();
  await loadState();
  renderAll();
}

async function saveReview(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/daily-review", {
    method: "POST",
    body: {
      date: state.selectedDate,
      mood: form.get("mood"),
      note: form.get("note"),
      enoughToday: form.get("enoughToday") === "on"
    }
  });
  await loadState();
  notify("复盘已保存");
}

async function saveHealth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/health/manual", {
    method: "POST",
    body: {
      date: state.selectedDate,
      activeEnergyKcal: form.get("activeEnergyKcal"),
      exerciseMinutes: form.get("exerciseMinutes")
    }
  });
  await loadState();
  renderAll();
}

async function generateReport() {
  const month = state.selectedDate.slice(0, 7);
  setBusy(true, "生成中");
  try {
    const { report } = await api("/api/reports/monthly/generate", {
      method: "POST",
      body: { month }
    });
    state.monthlyReports = state.monthlyReports.filter((item) => item.month !== month);
    state.monthlyReports.push(report);
    renderStats();
    switchView("report");
  } finally {
    setBusy(false);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

function itemsForDate(dateText) {
  return state.planItems.filter((item) => item.startAt?.startsWith(dateText));
}

function mealsForDate(dateText) {
  return state.meals.filter((meal) => meal.date === dateText);
}

function healthForDate(dateText) {
  return state.healthMetrics.find((metric) => metric.date === dateText);
}

function isInWeek(isoDateTime, weekStart) {
  if (!isoDateTime) return false;
  const date = parseDate(isoDateTime.slice(0, 10));
  const start = parseDate(weekStart);
  const end = addDays(start, 7);
  return date >= start && date < end;
}

function weekdayName(date) {
  return date.toLocaleDateString("zh-CN", { weekday: "long" });
}

function timeOnly(value) {
  return value?.slice(11, 16) || "";
}

function mealTypeLabel(value) {
  return {
    breakfast: "早餐",
    lunch: "午餐",
    dinner: "晚餐",
    snack: "加餐"
  }[value] || "餐食";
}

function todayDate() {
  return formatDate(new Date());
}

function getMonday(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, count) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + count);
  return copy;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown);
  return escaped
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    .replace(/<p><h/g, "<h")
    .replace(/<\/h([123])><\/p>/g, "</h$1>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setBusy(isBusy, label = "") {
  document.querySelectorAll("button").forEach((button) => {
    if (button.id === "closePlanModalBtn") return;
    button.dataset.originalText ||= button.textContent;
    button.disabled = isBusy || (button.id === "saveDraftBtn" && !state.draft);
    if (isBusy && button.classList.contains("primary-button")) button.textContent = label;
    if (!isBusy && button.dataset.originalText) button.textContent = button.dataset.originalText;
  });
}

function notify(message) {
  const notice = document.createElement("div");
  notice.className = "toast";
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    maxWidth: "360px",
    padding: "12px 14px",
    borderRadius: "8px",
    background: "#23424a",
    color: "white",
    boxShadow: "0 18px 50px rgba(35, 66, 74, 0.22)",
    zIndex: "10"
  });
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 4200);
}

