const state = {
  profile: null,
  categories: [],
  activityTemplates: {},
  planItems: [],
  meals: [],
  dailyReviews: [],
  healthMetrics: [],
  monthlyReports: [],
  syncUrls: [],
  llmConfigured: false,
  selectedDate: todayDate(),
  weekStart: formatDate(getMonday(new Date())),
  monthCursor: todayDate().slice(0, 7),
  draft: null,
  planChat: [],
  currentView: "today"
};

const els = {
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
  healthSourceCopy: document.querySelector("#healthSourceCopy"),
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
  monthPopover: document.querySelector("#monthPopover"),
  moodEmojiBtn: document.querySelector("#moodEmojiBtn"),
  moodPicker: document.querySelector("#moodPicker"),
  mottoDisplay: document.querySelector("#mottoDisplay"),
  mottoInput: document.querySelector("#mottoInput"),
  chatLauncher: document.querySelector("#chatLauncher"),
  planChatPanel: document.querySelector("#planChatPanel"),
  closeChatBtn: document.querySelector("#closeChatBtn"),
  chatWeekLabel: document.querySelector("#chatWeekLabel"),
  chatLog: document.querySelector("#chatLog"),
  chatForm: document.querySelector("#chatForm"),
  estimateMealBtn: document.querySelector("#estimateMealBtn"),
  estimateHint: document.querySelector("#estimateHint")
};

const statusLabel = {
  planned: "计划",
  done: "完成",
  partial: "部分",
  skipped: "跳过",
  imported: "导入"
};

const categoryColor = {
  work: "#6f7691",
  workout: "#3fa8c9",
  learning: "#5b76d6",
  inner_peace: "#bd5e8a",
  social: "#cd8f57",
  meal: "#a678c9"
};

const MOOD_EMOJIS = ["😊", "🥰", "😌", "🤗", "😎", "🥳", "🥱", "😴", "🫠", "🤯", "😤", "🥲", "😭", "🤒", "✨", "🌧"];

const mealTime = {
  breakfast: "07:50",
  lunch: "13:10",
  dinner: "18:30",
  snack: "加餐"
};

const DEFAULT_ESTIMATE_HINT = "写好描述后点估算，结果会直接填进下面输入框，还能再改。";

init();

async function init() {
  bindEvents();
  buildMoodPicker();
  await loadState();
  renderAll();
}

function bindEvents() {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".action-menu")) closeActionMenus();
    if (!els.monthPopover.hidden && !event.target.closest("#monthPopover") && !event.target.closest("#monthToggleBtn")) {
      els.monthPopover.hidden = true;
    }
    if (!els.moodPicker.hidden && !event.target.closest("#moodPicker") && !event.target.closest("#moodEmojiBtn")) {
      els.moodPicker.hidden = true;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.monthPopover.hidden = true;
      els.moodPicker.hidden = true;
    }
  });

  document.querySelector("#todayBtn").addEventListener("click", () => {
    state.selectedDate = todayDate();
    state.weekStart = formatDate(getMonday(new Date()));
    state.monthCursor = state.selectedDate.slice(0, 7);
    state.draft = null;
    renderAll();
  });

  document.querySelector("#prevWeekBtn").addEventListener("click", () => shiftBy(-1));
  document.querySelector("#nextWeekBtn").addEventListener("click", () => shiftBy(1));
  document.querySelector("#prevMonthBtn").addEventListener("click", () => shiftMonth(-1));
  document.querySelector("#nextMonthBtn").addEventListener("click", () => shiftMonth(1));
  document.querySelector("#monthToggleBtn").addEventListener("click", (event) => {
    event.stopPropagation();
    els.monthPopover.hidden = !els.monthPopover.hidden;
  });
  els.moodEmojiBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    els.moodPicker.hidden = !els.moodPicker.hidden;
  });
  els.mottoDisplay.addEventListener("dblclick", () => {
    els.mottoInput.value = state.profile?.motto || "";
    els.mottoDisplay.hidden = true;
    els.mottoInput.hidden = false;
    els.mottoInput.focus();
    els.mottoInput.select();
  });
  els.mottoInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitMotto();
    } else if (event.key === "Escape") {
      cancelMottoEdit();
    }
  });
  els.mottoInput.addEventListener("blur", commitMotto);
  document.querySelector("#openPlanModalBtn").addEventListener("click", () => openPlanModal());
  document.querySelector("#closePlanModalBtn").addEventListener("click", () => els.planModal.close());
  document.querySelector("#closeMealModalBtn").addEventListener("click", () => els.mealModal.close());
  document.querySelector("#categorySelect").addEventListener("change", updateSubtypeOptions);
  document.querySelector("#generateReportBtn").addEventListener("click", generateReport);

  els.chatLauncher.addEventListener("click", () => {
    els.planChatPanel.hidden = !els.planChatPanel.hidden;
    if (!els.planChatPanel.hidden) renderChat();
  });
  els.closeChatBtn.addEventListener("click", () => {
    els.planChatPanel.hidden = true;
  });

  els.planForm.addEventListener("submit", savePlanItem);
  els.mealForm.addEventListener("submit", saveMeal);
  els.chatForm.addEventListener("submit", sendPlanChat);
  els.estimateMealBtn.addEventListener("click", estimateMealInModal);
  document.querySelector("#reviewForm").addEventListener("submit", saveReview);
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
  renderChat();
  renderMood();
  renderMotto();
}

function renderMeta() {
  const selected = parseDate(state.selectedDate);
  els.currentDateLabel.textContent = selected.toLocaleDateString("zh-CN", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

  const weekEnd = addDays(parseDate(state.weekStart), 6);
  els.weekRangeLabel.textContent = `${state.weekStart} - ${formatDate(weekEnd)}`;
  els.chatWeekLabel.textContent = `当前安排的是 ${state.weekStart} 这周`;
  const [year, month] = state.monthCursor.split("-");
  els.monthLabel.textContent = `${year}年${Number(month)}月`;
}

function buildMoodPicker() {
  for (const emoji of MOOD_EMOJIS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = emoji;
    button.setAttribute("aria-label", `心情 ${emoji}`);
    button.addEventListener("click", () => selectMood(emoji));
    els.moodPicker.appendChild(button);
  }
}

function renderMood() {
  const emoji = state.profile?.moodEmojis?.[todayDate()] || "😊";
  els.moodEmojiBtn.textContent = emoji;
  setFavicon(emoji);
}

function setFavicon(emoji) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.font = "54px serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(emoji, 32, 36);
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = canvas.toDataURL("image/png");
}

async function selectMood(emoji) {
  const moodEmojis = { ...(state.profile?.moodEmojis || {}), [todayDate()]: emoji };
  els.moodEmojiBtn.textContent = emoji;
  setFavicon(emoji);
  els.moodPicker.hidden = true;
  try {
    const { profile } = await api("/api/profile", { method: "PATCH", body: { moodEmojis } });
    state.profile = profile;
  } catch {
    notify("心情暂时没有存上，稍后再点一次试试。");
  }
}

function renderMotto() {
  const motto = state.profile?.motto || "";
  els.mottoDisplay.textContent = motto || "写一句想经常看到的话";
  els.mottoDisplay.classList.toggle("empty", !motto);
}

function cancelMottoEdit() {
  els.mottoInput.hidden = true;
  els.mottoDisplay.hidden = false;
  renderMotto();
}

async function commitMotto() {
  if (els.mottoInput.hidden) return;
  const motto = els.mottoInput.value.trim();
  els.mottoInput.hidden = true;
  els.mottoDisplay.hidden = false;
  if (motto === (state.profile?.motto || "")) {
    renderMotto();
    return;
  }
  try {
    const { profile } = await api("/api/profile", { method: "PATCH", body: { motto } });
    state.profile = profile;
  } catch {
    notify("座右铭没有保存成功。");
  }
  renderMotto();
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
  const resting = Number(health?.inactiveEnergyKcal || 0);
  const baseExpenditure = resting > 0 ? resting : state.profile?.estimatedDailyExpenditureKcal || 0;
  const deficit = baseExpenditure + activeEnergy - intake;
  const target = state.profile?.dailyDeficitTargetKcal || 300;
  const fill = Math.max(0, Math.min(100, Math.round((deficit / target) * 100)));

  els.todayIntake.textContent = `${Math.round(intake)} kcal`;
  els.todayActiveEnergy.textContent = `${Math.round(activeEnergy)} kcal`;
  els.todayDeficit.textContent = `${Math.round(deficit)} kcal`;
  els.deficitFill.style.width = `${fill}%`;
  els.healthSourceCopy.textContent = formatHealthSource(health);
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
      renderAll();
    });
    els.miniCalendar.appendChild(button);
  });
}

function buildDayBlocks(dateText, { includeDraft }) {
  const savedItems = state.planItems.filter((item) => item.startAt?.startsWith(dateText));
  const draftItems = includeDraft ? (state.draft?.items || []).filter((item) => item.startAt?.startsWith(dateText)) : [];
  const items = [...savedItems, ...draftItems.map((item) => ({ ...item, isDraft: true }))];
  const isWeekendDay = isWeekend(dateText);

  const morningWork = findWorkItem(items, dateText, "上午工作", "morning-work", "08:30", "11:30", {
    before: "12:00",
    createDefault: !isWeekendDay
  });
  const afternoonWork = findWorkItem(items, dateText, "下午工作", "afternoon-work", "14:00", "17:00", {
    after: "12:00",
    before: "17:00",
    createDefault: !isWeekendDay
  });
  const workIds = new Set([morningWork, afternoonWork].filter(Boolean).map((item) => item.id));
  const nonWork = items.filter((item) => !workIds.has(item.id) && item.workSlot !== "morning-work" && item.workSlot !== "afternoon-work");
  const morningExtra = nonWork.filter((item) => timeOnly(item.startAt) < "11:30");
  const noon = nonWork.filter((item) => timeOnly(item.startAt) >= "11:30" && timeOnly(item.startAt) < "14:00");
  const afternoon = nonWork.filter((item) => timeOnly(item.startAt) >= "14:00" && timeOnly(item.startAt) < "17:00");
  const evening = nonWork.filter((item) => timeOnly(item.startAt) >= "17:00");

  const blocks = [
    { type: "meal", mealType: "breakfast", date: dateText },
    morningWork ? { type: "work", item: morningWork, slot: "morning", date: dateText } : null,
    ...sortItems(morningExtra).map((item) => ({ type: "event", item })),
    ...sortItems(noon).map((item) => ({ type: "event", item })),
    { type: "meal", mealType: "lunch", date: dateText },
    afternoonWork ? { type: "work", item: afternoonWork, slot: "afternoon", date: dateText } : null,
    ...sortItems(afternoon).map((item) => ({ type: "event", item })),
    { type: "meal", mealType: "dinner", date: dateText },
    ...sortItems(evening).map((item) => ({ type: "event", item })),
    { type: "meal", mealType: "snack", date: dateText }
  ];
  return blocks.filter(Boolean);
}

function findWorkItem(items, dateText, subtype, workSlot, start, end, options = {}) {
  const after = options.after || "00:00";
  const before = options.before || "23:59";
  const existing = items.find(
    (item) =>
      timeOnly(item.startAt) >= after &&
      timeOnly(item.startAt) < before &&
      (item.workSlot === workSlot ||
        (item.categoryId === "work" && (item.subtype === subtype || item.title.includes(subtype))))
  );
  if (existing) return existing;
  if (options.createDefault === false) return null;
  return {
    id: `default-${dateText}-${subtype}`,
    title: subtype,
    categoryId: "work",
    subtype,
    workSlot,
    startAt: `${dateText}T${start}:00`,
    endAt: `${dateText}T${end}:00`,
    status: dateText < todayDate() ? "done" : "planned",
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
    <div class="event-menu action-menu">
      <button class="more-button" type="button" aria-label="${mealTypeLabel(block.mealType)}更多操作">⋯</button>
      <div class="event-menu-popover meal-menu-popover" role="menu">
        <button type="button" data-meal-add="${block.date}" data-meal-type="${block.mealType}" role="menuitem">
          ${meals.length ? "追加记录" : "记录这餐"}
        </button>
        ${
          meals.length
            ? meals
                .map(
                  (meal) => `
                    <div class="meal-menu-detail">
                      <strong>${escapeHtml(meal.text || "已记录")}</strong>
                      <span>${Math.round(meal.confirmedCalories ?? meal.estimatedCalories ?? 0)} kcal${
                        meal.confidence ? ` · 置信度 ${Math.round(meal.confidence * 100)}%` : ""
                      }</span>
                      <button type="button" data-meal-edit="${meal.id}" role="menuitem">编辑</button>
                      <button type="button" data-meal-estimate="${meal.id}" role="menuitem">热量估算</button>
                      <button type="button" data-meal-delete="${meal.id}" role="menuitem">删除</button>
                    </div>`
                )
                .join("")
            : ""
        }
      </div>
    </div>
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
                  </div>`
              )
              .join("")
          : `<span class="empty-meal">还没记录</span>`
      }
    </div>
    ${meals.length ? `<div class="meal-total">合计 ${Math.round(total)} kcal</div>` : ""}
  `;

  bindActionMenu(card);
  card.querySelector("[data-meal-add]").addEventListener("click", () => {
    closeActionMenus();
    openMealModal(block.date, block.mealType);
  });
  card.querySelectorAll("[data-meal-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      closeActionMenus();
      const meal = state.meals.find((entry) => entry.id === button.dataset.mealEdit);
      if (meal) openMealModal(block.date, block.mealType, meal);
    });
  });
  card.querySelectorAll("[data-meal-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      closeActionMenus();
      await api(`/api/meals/${encodeURIComponent(button.dataset.mealDelete)}`, { method: "DELETE" });
      await loadState();
      renderAll();
    });
  });
  card.querySelectorAll("[data-meal-estimate]").forEach((button) => {
    button.addEventListener("click", async () => {
      closeActionMenus();
      button.textContent = "估算中";
      button.disabled = true;
      try {
        await api(`/api/meals/${encodeURIComponent(button.dataset.mealEstimate)}/estimate`, { method: "POST" });
        await loadState();
        renderAll();
        notify("餐食热量已估算，请按实际情况修正。");
      } catch (error) {
        notify(error.message || "暂时无法估算餐食热量");
        button.textContent = "热量估算";
        button.disabled = false;
      }
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
  card.style.borderLeftColor = categoryColor[item.categoryId] || "#7c5cd6";
  template.querySelector(".event-time").textContent = `${timeOnly(item.startAt)}-${timeOnly(item.endAt)}`;
  template.querySelector(".event-status").textContent = item.isDraft ? "草案" : statusLabel[item.status] || "计划";
  template.querySelector("h4").textContent = item.title;
  template.querySelector("p").textContent = [category?.label, item.subtype, item.notes].filter(Boolean).join(" · ");

  bindActionMenu(card);
  template.querySelectorAll("button").forEach((button) => {
    if (button.classList.contains("more-button")) return;
    if (item.isDraft) {
      button.disabled = true;
      return;
    }
    if (button.dataset.action === "edit") {
      button.addEventListener("click", () => {
        closeActionMenus();
        openPlanModalFromItem(item);
      });
      return;
    }
    if (button.dataset.action === "delete") {
      button.addEventListener("click", async () => {
        closeActionMenus();
        await deletePlanItem(item);
      });
      return;
    }
    if (button.dataset.status) {
      button.addEventListener("click", async () => {
        closeActionMenus();
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

function bindActionMenu(root) {
  const menu = root.querySelector(".action-menu");
  const button = root.querySelector(".more-button");
  if (!menu || !button) return;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const shouldOpen = !menu.classList.contains("is-open");
    closeActionMenus();
    menu.classList.toggle("is-open", shouldOpen);
    button.setAttribute("aria-expanded", String(shouldOpen));
  });
  menu.querySelector(".event-menu-popover")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}

function closeActionMenus() {
  document.querySelectorAll(".action-menu.is-open").forEach((menu) => {
    menu.classList.remove("is-open");
    menu.querySelector(".more-button")?.setAttribute("aria-expanded", "false");
  });
}

function switchView(view) {
  state.currentView = view;
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

function shiftBy(direction) {
  if (state.currentView === "week") {
    shiftWeek(direction * 7);
  } else {
    shiftDay(direction);
  }
}

function shiftDay(days) {
  const next = addDays(parseDate(state.selectedDate), days);
  state.selectedDate = formatDate(next);
  state.monthCursor = state.selectedDate.slice(0, 7);
  const monday = formatDate(getMonday(next));
  if (monday !== state.weekStart) {
    state.weekStart = monday;
    state.draft = null;
  }
  renderAll();
}

function shiftWeek(days) {
  const next = addDays(parseDate(state.weekStart), days);
  state.weekStart = formatDate(next);
  state.selectedDate = state.weekStart;
  state.monthCursor = state.selectedDate.slice(0, 7);
  state.draft = null;
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

function openMealModal(dateText, mealType, meal = null) {
  els.mealForm.reset();
  els.mealForm.dataset.macros = "";
  els.mealForm.dataset.editingId = meal?.id || "";
  els.estimateHint.textContent = DEFAULT_ESTIMATE_HINT;
  els.mealModalTitle.textContent = meal ? `编辑 · ${dateText} · ${mealTypeLabel(mealType)}` : `${dateText} · ${mealTypeLabel(mealType)}`;
  els.mealForm.elements.date.value = dateText;
  els.mealForm.elements.mealType.value = meal?.mealType || mealType;
  if (meal) {
    els.mealForm.elements.text.value = meal.text || "";
    els.mealForm.elements.estimatedCalories.value = meal.estimatedCalories ?? "";
    els.mealForm.elements.confirmedCalories.value = meal.confirmedCalories ?? "";
  }
  els.mealModal.showModal();
}

async function estimateMealInModal() {
  const text = els.mealForm.elements.text.value.trim();
  const mealType = els.mealForm.elements.mealType.value;
  if (!text) {
    els.estimateHint.textContent = "先写点文字描述，再来估算。";
    return;
  }
  els.estimateMealBtn.disabled = true;
  els.estimateMealBtn.textContent = "估算中…";
  try {
    const { estimate } = await api("/api/meals/estimate-text", {
      method: "POST",
      body: { mealType, text }
    });
    if (estimate.totalCalories != null) {
      els.mealForm.elements.estimatedCalories.value = Math.round(estimate.totalCalories);
    }
    const parts = [];
    if (estimate.proteinG != null) parts.push(`蛋白质 ${Math.round(estimate.proteinG)}g`);
    if (estimate.carbsG != null) parts.push(`碳水 ${Math.round(estimate.carbsG)}g`);
    if (estimate.fatG != null) parts.push(`脂肪 ${Math.round(estimate.fatG)}g`);
    if (estimate.confidence != null) parts.push(`置信度 ${Math.round(estimate.confidence * 100)}%`);
    els.estimateHint.textContent = `已填充，可以直接改。${parts.join(" · ")}${estimate.notes ? `（${estimate.notes}）` : ""}`;
    els.mealForm.dataset.macros = JSON.stringify({
      proteinG: estimate.proteinG,
      carbsG: estimate.carbsG,
      fatG: estimate.fatG,
      confidence: estimate.confidence
    });
  } catch (error) {
    els.estimateHint.textContent = error.message || "暂时无法估算，稍后再试。";
  } finally {
    els.estimateMealBtn.disabled = false;
    els.estimateMealBtn.textContent = "Kimi 估算热量";
  }
}

async function sendPlanChat(event) {
  event.preventDefault();
  const input = els.chatForm.elements.message;
  const content = input.value.trim();
  if (!content) return;
  state.planChat.push({ role: "user", content });
  input.value = "";
  const pending = { role: "assistant", content: "正在安排…" };
  state.planChat.push(pending);
  renderChat();

  try {
    const result = await api("/api/llm/plan-chat", {
      method: "POST",
      body: { weekStart: state.weekStart, messages: state.planChat.slice(0, -1).slice(-12) }
    });
    let reply = result.reply || "好的。";
    const appliedOk = (result.applied || []).filter((entry) => entry.ok);
    if (appliedOk.length) {
      const opLabel = { add: "新增", update: "调整", delete: "删除", addMeal: "记录餐食" };
      reply += `\n\n已执行：${appliedOk
        .map((entry) => {
          const kcal = entry.op === "addMeal" && entry.estimatedCalories ? `（约 ${Math.round(entry.estimatedCalories)} kcal）` : "";
          return `${opLabel[entry.op] || entry.op}「${entry.title}」${kcal}`;
        })
        .join("；")}`;
    }
    pending.content = reply;
    await loadState();
    renderAll();
  } catch (error) {
    pending.content = error.message || "助手暂时不可用，稍后再试。";
    renderChat();
  }
}

function renderChat() {
  if (!els.chatLog) return;
  els.chatLog.innerHTML = "";
  const messages = state.planChat.length
    ? state.planChat
    : [
        {
          role: "assistant",
          content:
            "我是你的周计划助手。可以让我整体规划这一周，也可以逐项排日程、改时间、处理冲突，比如「周三 18:00-20:00 去安贞门 gstep 上考拉老师的跳舞课」；吃了什么也可以告诉我，我会记到对应的餐次里。"
        }
      ];
  for (const msg of messages) {
    const bubble = document.createElement("div");
    bubble.className = `chat-msg ${msg.role}`;
    bubble.textContent = msg.content;
    els.chatLog.appendChild(bubble);
  }
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
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

async function saveMeal(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const macros = els.mealForm.dataset.macros ? JSON.parse(els.mealForm.dataset.macros) : {};
  const editingId = els.mealForm.dataset.editingId;
  const payload = {
    mealType: form.get("mealType"),
    text: form.get("text"),
    estimatedCalories: form.get("estimatedCalories") || null,
    confirmedCalories: form.get("confirmedCalories") || null,
    ...macros
  };

  if (editingId) {
    await api(`/api/meals/${encodeURIComponent(editingId)}`, { method: "PATCH", body: payload });
  } else {
    const file = form.get("image");
    payload.date = form.get("date") || state.selectedDate;
    if (file && file.size) payload.imageData = await fileToDataUrl(file);
    await api("/api/meals", { method: "POST", body: payload });
  }

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
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("UNAUTHORIZED");
  }
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
  return state.healthMetrics
    .filter((metric) => metric.date === dateText)
    .sort((a, b) => (b.syncedAt || "").localeCompare(a.syncedAt || ""))[0];
}

function formatHealthSource(health) {
  if (!health) return "健康数据还没有同步。";
  const source = health.source === "apple_health" ? "Apple Health 已同步" : "手动记录";
  const minutes = Number(health.exerciseMinutes || 0);
  const steps = Number(health.steps || 0);
  const details = [];
  if (minutes) details.push(`${Math.round(minutes)} 分钟运动`);
  if (steps) details.push(`${Math.round(steps)} 步`);
  if (Array.isArray(health.workouts) && health.workouts.length) details.push(`${health.workouts.length} 次运动记录`);
  const syncedAt = health.syncedAt ? `，${formatDateTimeLabel(health.syncedAt)}` : "";
  return `${source}${details.length ? `：${details.join("，")}` : ""}${syncedAt}`;
}

function formatDateTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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

function isWeekend(value) {
  const day = parseDate(value).getDay();
  return day === 0 || day === 6;
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
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = () => resolve(reader.result);
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const html = [];
  let index = 0;
  let listType = null;
  let paragraph = [];

  const inline = (text) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const splitRow = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const isSeparator = (line) => line.includes("-") && /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim());

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      closeParagraph();
      closeList();
      index += 1;
      continue;
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (trimmed.includes("|") && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      closeParagraph();
      closeList();
      const headers = splitRow(trimmed);
      const aligns = splitRow(lines[index + 1]).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left"
      );
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      const alignAttr = (i) => (aligns[i] && aligns[i] !== "left" ? ` style="text-align:${aligns[i]}"` : "");
      html.push(
        `<table><thead><tr>${headers.map((cell, i) => `<th${alignAttr(i)}>${inline(cell)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td${alignAttr(i)}>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeParagraph();
      closeList();
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      closeParagraph();
      closeList();
      html.push(`<blockquote>${inline(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      index += 1;
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.*)$/);
    if (unordered) {
      closeParagraph();
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inline(unordered[1])}</li>`);
      index += 1;
      continue;
    }

    const ordered = trimmed.match(/^\d+[.、]\s*(.*)$/);
    if (ordered) {
      closeParagraph();
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inline(ordered[1])}</li>`);
      index += 1;
      continue;
    }

    closeList();
    paragraph.push(trimmed);
    index += 1;
  }
  closeParagraph();
  closeList();
  return html.join("");
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
    borderRadius: "10px",
    background: "#5f43b2",
    color: "white",
    boxShadow: "0 18px 50px rgba(95, 67, 178, 0.28)",
    zIndex: "10"
  });
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 4200);
}
