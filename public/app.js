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
  monthCursor: todayDate().slice(0, 7),
  draft: null
};

const els = {
  llmStatus: document.querySelector("#llmStatus"),
  currentDateLabel: document.querySelector("#currentDateLabel"),
  viewTitle: document.querySelector("#viewTitle"),
  todayTimeline: document.querySelector("#todayTimeline"),
  calendarGrid: document.querySelector("#calendarGrid"),
  weekRangeLabel: document.querySelector("#weekRangeLabel"),
  monthLabel: document.querySelector("#monthLabel"),
  miniCalendar: document.querySelector("#miniCalendar"),
  todayIntake: document.querySelector("#todayIntake"),
  todayActiveEnergy: document.querySelector("#todayActiveEnergy"),
  todayDeficit: document.querySelector("#todayDeficit"),
  deficitFill: document.querySelector("#deficitFill"),
  deficitCopy: document.querySelector("#deficitCopy"),
  statsStrip: document.querySelector("#statsStrip"),
  reportOutput: document.querySelector("#reportOutput"),
  planModal: document.querySelector("#planModal"),
  planForm: document.querySelector("#planForm"),
  planModalTitle: document.querySelector("#planModalTitle"),
  planSubmitBtn: document.querySelector("#planSubmitBtn"),
  categorySelect: document.querySelector("#categorySelect"),
  subtypeSelect: document.querySelector("#subtypeSelect"),
  mealModal: document.querySelector("#mealModal"),
  mealForm: document.querySelector("#mealForm"),
  mealModalTitle: document.querySelector("#mealModalTitle"),
  saveDraftBtn: document.querySelector("#saveDraftBtn")
};

const statusLabel = {
  planned: "计划",
  done: "完成",
  partial: "部分",
  skipped: "跳过",
  imported: "导入"
};

const categoryColor = {
  work: "#4b6570",
  workout: "#149985",
  learning: "#4d6fe8",
  inner_peace: "#bd5e8a",
  social: "#d2873a",
  meal: "#7f9b61"
};

const mealOrder = ["breakfast", "lunch", "dinner"];
const mealTime = {
  breakfast: "07:50",
  lunch: "13:10",
  dinner: "18:30",
  snack: "加餐"
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
    state.monthCursor = state.selectedDate.slice(0, 7);
    state.draft = null;
    els.saveDraftBtn.disabled = true;
    renderAll();
  });

  document.querySelector("#prevWeekBtn").addEventListener("click", () => shiftWeek(-7));
  document.querySelector("#nextWeekBtn").addEventListener("click", () => shiftWeek(7));
  document.querySelector("#prevMonthBtn").addEventListener("click", () => shiftMonth(-1));
  document.querySelector("#nextMonthBtn").addEventListener("click", () => shiftMonth(1));
  document.querySelector("#openPlanModalBtn").addEventListener("click", () => openPlanModal());
  document.querySelector("#closePlanModalBtn").addEventListener("click", () => els.planModal.close());
  document.querySelector("#closeMealModalBtn").addEventListener("click", () => els.mealModal.close());
  document.querySelector("#categorySelect").addEventListener("change", updateSubtypeOptions);
  document.querySelector("#generateWeekBtn").addEventListener("click", generateWeeklyDraft);
  document.querySelector("#generateWeekBtn2").addEventListener("click", generateWeeklyDraft);
  document.querySelector("#saveDraftBtn").addEventListener("click", saveDraft);
  document.querySelector("#generateReportBtn").addEventListener("click", generateReport);

  els.planForm.addEventListener("submit", savePlanItem);
  els.mealForm.addEventListener("submit", saveMeal);
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
  renderMiniCalendar();
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
  const [year, month] = state.monthCursor.split("-");
  els.monthLabel.textContent = `${year}年${Number(month)}月`;
}

function renderCategoryOptions() {
  const current = els.categorySelect.value;
  els.categorySelect.innerHTML = state.categories
    .map((category) => `<option value="${category.id}">${escapeHtml(category.label)}</option>`)
    .join("");
  if (current) els.categorySelect.value = current;
  updateSubtypeOptions();
}

function updateSubtypeOptions() {
  const category = els.categorySelect.value || "workout";
  const options = state.activityTemplates[category] || [];
  els.subtypeSelect.innerHTML = options
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join("");
}

function renderToday() {
  const blocks = buildDayBlocks(state.selectedDate, { includeDraft: false }).filter(
    (block) => block.type !== "empty"
  );
  els.todayTimeline.innerHTML = "";

  if (!blocks.length) {
    els.todayTimeline.innerHTML = `<div class="empty-state">今天还没有记录。可以先从一餐饭或一件小事开始。</div>`;
  } else {
    blocks.forEach((block) => els.todayTimeline.appendChild(renderTimelineBlock(block)));
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
  els.calendarGrid.innerHTML = "";

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(start, offset);
    const dateText = formatDate(date);
    const column = document.createElement("section");
    column.className = `day-column${dateText === state.selectedDate ? " selected" : ""}${dateText === todayDate() ? " today" : ""}`;
    column.innerHTML = `
      <button class="day-head" type="button" data-date="${dateText}">
        <span>${weekdayName(date)}</span>
        <strong>${dateText.slice(5)}</strong>
      </button>
    `;

    buildDayBlocks(dateText, { includeDraft: true }).forEach((block) => {
      column.appendChild(renderCalendarBlock(block));
    });

    column.querySelector(".day-head").addEventListener("click", () => {
      state.selectedDate = dateText;
      state.monthCursor = dateText.slice(0, 7);
      renderAll();
    });

    els.calendarGrid.appendChild(column);
  }
}

function renderMiniCalendar() {
  const [year, month] = state.monthCursor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = getMonday(first);
  const days = [];
  for (let index = 0; index < 42; index += 1) days.push(addDays(start, index));

  els.miniCalendar.innerHTML = `
    ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span class="mini-weekday">${day}</span>`).join("")}
  `;

  days.forEach((date) => {
    const dateText = formatDate(date);
    const button = document.createElement("button");
    button.className = [
      "mini-day",
      date.getMonth() === month - 1 ? "" : "muted",
      dateText === state.selectedDate ? "selected" : "",
      dateText === todayDate() ? "today" : ""
    ]
      .filter(Boolean)
      .join(" ");
    const dots = colorsForDate(dateText)
      .slice(0, 5)
      .map((color) => `<i style="background:${color}"></i>`)
      .join("");
    button.innerHTML = `<span>${date.getDate()}</span><div class="mini-dots">${dots}</div>`;
    button.addEventListener("click", () => {
      state.selectedDate = dateText;
      state.weekStart = formatDate(getMonday(date));
      state.monthCursor = dateText.slice(0, 7);
      state.draft = null;
      els.saveDraftBtn.disabled = true;
      renderAll();
    });
    els.miniCalendar.appendChild(button);
  });
}

function buildDayBlocks(dateText, { includeDraft }) {
  const savedItems = state.planItems.filter((item) => item.startAt?.startsWith(dateText));
  const draftItems = includeDraft ? (state.draft?.items || []).filter((item) => item.startAt?.startsWith(dateText)) : [];
  const items = [...savedItems, ...draftItems.map((item) => ({ ...item, isDraft: true }))];

  const morningWork = findWorkItem(items, dateText, "上午工作", "morning-work", "08:30", "11:30");
  const afternoonWork = findWorkItem(items, dateText, "下午工作", "afternoon-work", "14:00", "17:00");
  const workIds = new Set([morningWork.id, afternoonWork.id]);
  const nonWork = items.filter((item) => !workIds.has(item.id) && item.workSlot !== "morning-work" && item.workSlot !== "afternoon-work");
  const noon = nonWork.filter((item) => timeOnly(item.startAt) >= "11:30" && timeOnly(item.startAt) < "14:00");
  const evening = nonWork.filter((item) => timeOnly(item.startAt) >= "17:00");
  const flexible = nonWork.filter((item) => timeOnly(item.startAt) < "11:30" || (timeOnly(item.startAt) >= "14:00" && timeOnly(item.startAt) < "17:00"));

  return [
    { type: "meal", mealType: "breakfast", date: dateText },
    { type: "work", item: morningWork, slot: "morning", date: dateText },
    ...sortItems(noon).map((item) => ({ type: "event", item })),
    { type: "meal", mealType: "lunch", date: dateText },
    { type: "work", item: afternoonWork, slot: "afternoon", date: dateText },
    { type: "meal", mealType: "dinner", date: dateText },
    ...sortItems(evening).map((item) => ({ type: "event", item })),
    ...sortItems(flexible).map((item) => ({ type: "event", item }))
  ];
}

function findWorkItem(items, dateText, subtype, workSlot, start, end) {
  const existing = items.find(
    (item) =>
      item.workSlot === workSlot ||
      (item.categoryId === "work" && (item.subtype === subtype || item.title.includes(subtype)))
  );
  if (existing) return existing;
  return {
    id: `default-${dateText}-${subtype}`,
    title: subtype,
    categoryId: "work",
    subtype,
    workSlot,
    startAt: `${dateText}T${start}:00`,
    endAt: `${dateText}T${end}:00`,
    status: "planned",
    source: "system",
    notes: "点击编辑，可写工作记录、请假或改成其他安排。",
    isDefaultWork: true
  };
}

function renderCalendarBlock(block) {
  if (block.type === "meal") return renderMealSlot(block, "calendar");
  if (block.type === "work" || block.type === "event") return renderEventCard(block.item, { compact: true });
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = "留白";
  return empty;
}

function renderTimelineBlock(block) {
  if (block.type === "meal") return renderMealSlot(block, "timeline");
  if (block.type === "work" || block.type === "event") return renderEventCard(block.item, { compact: false });
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = "留白";
  return empty;
}

function renderMealSlot(block, mode) {
  const meals = mealsForDate(block.date).filter((meal) => meal.mealType === block.mealType);
  const card = document.createElement("article");
  card.className = `meal-slot ${meals.length ? "filled" : ""} ${mode}`;
  const total = meals.reduce((sum, meal) => sum + Number(meal.confirmedCalories ?? meal.estimatedCalories ?? 0), 0);
  card.innerHTML = `
    <div class="slot-head">
      <span>${mealTime[block.mealType]}</span>
      <strong>${mealTypeLabel(block.mealType)}</strong>
    </div>
    <div class="meal-slot-body">
      ${
        meals.length
          ? meals
              .map(
                (meal) => `
                  <div class="meal-line">
                    ${meal.imagePath ? `<img src="${escapeHtml(meal.imagePath)}" alt="餐食照片" />` : ""}
                    <span>${escapeHtml(meal.text || "已记录")}</span>
                    <b>${Math.round(meal.confirmedCalories ?? meal.estimatedCalories ?? 0)} kcal</b>
                    <button type="button" data-meal-delete="${meal.id}" aria-label="删除餐食">×</button>
                  </div>`
              )
              .join("")
          : `<span class="empty-meal">还没记录</span>`
      }
    </div>
    <button class="tiny-action" type="button" data-meal-add="${block.date}" data-meal-type="${block.mealType}">
      ${meals.length ? `追加 · ${Math.round(total)} kcal` : "记录"}
    </button>
  `;

  card.querySelector("[data-meal-add]").addEventListener("click", () => openMealModal(block.date, block.mealType));
  card.querySelectorAll("[data-meal-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/meals/${encodeURIComponent(button.dataset.mealDelete)}`, { method: "DELETE" });
      await loadState();
      renderAll();
    });
  });
  return card;
}

function renderEventCard(item, { compact }) {
  const template = document.querySelector("#eventTemplate").content.cloneNode(true);
  const card = template.querySelector(".event-card");
  const category = state.categories.find((entry) => entry.id === item.categoryId);
  card.classList.toggle("compact", compact);
  card.classList.toggle("work-card", item.categoryId === "work");
  card.classList.toggle("draft-card", Boolean(item.isDraft));
  card.style.borderLeftColor = categoryColor[item.categoryId] || "#149985";
  template.querySelector(".event-time").textContent = `${timeOnly(item.startAt)}-${timeOnly(item.endAt)}`;
  template.querySelector(".event-status").textContent = item.isDraft ? "草案" : statusLabel[item.status] || "计划";
  template.querySelector("h4").textContent = item.title;
  template.querySelector("p").textContent = [category?.label, item.subtype, item.notes].filter(Boolean).join(" · ");

  template.querySelectorAll("button").forEach((button) => {
    if (item.isDraft) {
      button.disabled = true;
      return;
    }
    if (button.dataset.action === "edit") {
      button.addEventListener("click", () => openPlanModalFromItem(item));
      return;
    }
    if (button.dataset.action === "delete") {
      button.addEventListener("click", async () => deletePlanItem(item));
      return;
    }
    if (button.dataset.status) {
      button.addEventListener("click", async () => {
        await saveDefaultWorkIfNeeded(item, { status: button.dataset.status });
        if (!item.isDefaultWork) {
          await api(`/api/plan-items/${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            body: { status: button.dataset.status }
          });
        }
        await loadState();
        renderAll();
      });
    }
  });

  return template;
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
    report: "月度总结"
  };
  els.viewTitle.textContent = titles[view] || "CalenZoey";
}

function shiftWeek(days) {
  const next = addDays(parseDate(state.weekStart), days);
  state.weekStart = formatDate(next);
  state.selectedDate = state.weekStart;
  state.monthCursor = state.selectedDate.slice(0, 7);
  state.draft = null;
  els.saveDraftBtn.disabled = true;
  renderAll();
}

function shiftMonth(delta) {
  const [year, month] = state.monthCursor.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  state.monthCursor = formatDate(next).slice(0, 7);
  renderMiniCalendar();
  renderMeta();
}

function openPlanModal(dateText = state.selectedDate) {
  els.planForm.reset();
  els.planForm.dataset.editingId = "";
  els.planForm.dataset.defaultWork = "";
  els.planModalTitle.textContent = "添加活动";
  els.planSubmitBtn.textContent = "保存活动";
  renderCategoryOptions();
  els.categorySelect.value = "workout";
  updateSubtypeOptions();
  els.planForm.elements.startAt.value = `${dateText}T12:15`;
  els.planForm.elements.endAt.value = `${dateText}T13:00`;
  els.planModal.showModal();
}

function openPlanModalFromItem(item) {
  els.planForm.reset();
  els.planForm.dataset.editingId = item.isDefaultWork ? "" : item.id;
  els.planForm.dataset.defaultWork = item.isDefaultWork ? JSON.stringify(item) : "";
  els.planModalTitle.textContent = item.categoryId === "work" ? "编辑工作块" : "编辑活动";
  els.planSubmitBtn.textContent = "保存修改";
  renderCategoryOptions();
  els.categorySelect.value = item.categoryId;
  updateSubtypeOptions();
  if (item.subtype && ![...els.subtypeSelect.options].some((option) => option.value === item.subtype)) {
    els.subtypeSelect.add(new Option(item.subtype, item.subtype));
  }
  els.subtypeSelect.value = item.subtype || "";
  els.planForm.elements.title.value = item.title || "";
  els.planForm.elements.startAt.value = toDatetimeLocal(item.startAt);
  els.planForm.elements.endAt.value = toDatetimeLocal(item.endAt);
  els.planForm.elements.notes.value = item.notes || "";
  els.planForm.elements.locked.checked = Boolean(item.locked);
  els.planModal.showModal();
}

function openMealModal(dateText, mealType) {
  els.mealForm.reset();
  els.mealModalTitle.textContent = `${dateText} · ${mealTypeLabel(mealType)}`;
  els.mealForm.elements.date.value = dateText;
  els.mealForm.elements.mealType.value = mealType;
  els.mealModal.showModal();
}

async function savePlanItem(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.locked = form.get("locked") === "on";
  const editingId = event.currentTarget.dataset.editingId;
  const defaultWork = event.currentTarget.dataset.defaultWork;

  if (editingId) {
    await api(`/api/plan-items/${encodeURIComponent(editingId)}`, { method: "PATCH", body: payload });
  } else if (defaultWork) {
    await api("/api/plan-items", {
      method: "POST",
      body: { ...JSON.parse(defaultWork), ...payload, id: undefined, source: "manual" }
    });
  } else {
    await api("/api/plan-items", { method: "POST", body: payload });
  }

  els.planModal.close();
  await loadState();
  renderAll();
}

async function deletePlanItem(item) {
  if (item.isDefaultWork) return;
  await api(`/api/plan-items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
  await loadState();
  renderAll();
}

async function saveDefaultWorkIfNeeded(item, patch) {
  if (!item.isDefaultWork) return;
  await api("/api/plan-items", {
    method: "POST",
    body: { ...item, ...patch, id: undefined, source: "manual" }
  });
}

async function generateWeeklyDraft() {
  setBusy(true, "正在生成");
  try {
    const result = await api("/api/llm/weekly-plan", {
      method: "POST",
      body: {
        weekStart: state.weekStart,
        intent: "请按减脂、运动恢复、开发知识补课和 inner peace 平衡生成本周计划。中午尽量安排运动，不安排学习类活动；晚上活动可以安排 2 小时。"
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
    date: form.get("date") || state.selectedDate,
    mealType: form.get("mealType"),
    text: form.get("text"),
    estimatedCalories: form.get("estimatedCalories"),
    confirmedCalories: form.get("confirmedCalories")
  };

  if (file && file.size) payload.imageData = await fileToDataUrl(file);

  await api("/api/meals", { method: "POST", body: payload });
  els.mealModal.close();
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

  if (latest) els.reportOutput.innerHTML = markdownToHtml(latest.llmReportMarkdown);
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

function sortItems(items) {
  return [...items].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function mealsForDate(dateText) {
  return state.meals.filter((meal) => meal.date === dateText);
}

function healthForDate(dateText) {
  return state.healthMetrics.find((metric) => metric.date === dateText);
}

function colorsForDate(dateText) {
  const colors = [];
  for (const item of state.planItems.filter((entry) => entry.startAt?.startsWith(dateText))) {
    colors.push(categoryColor[item.categoryId] || categoryColor.learning);
  }
  for (const meal of state.meals.filter((entry) => entry.date === dateText)) {
    colors.push(categoryColor.meal);
  }
  return [...new Set(colors)];
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

function toDatetimeLocal(value) {
  return value?.slice(0, 16) || "";
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
    if (button.id === "closePlanModalBtn" || button.id === "closeMealModalBtn") return;
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
    background: "#24403e",
    color: "white",
    boxShadow: "0 18px 50px rgba(36, 64, 62, 0.22)",
    zIndex: "10"
  });
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 4200);
}
