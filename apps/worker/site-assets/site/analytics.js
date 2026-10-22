// Optional, explicit counts. No SDK, replay, DOM text, form values, URLs or IP forwarding.
(() => {
  const root = document.querySelector(".approved-home");
  if (!root) return;
  const key = "vela.analytics.v1";
  const language = document.documentElement.lang === "zh-TW" ? "zh-TW" : "en";
  const zh = language === "zh-TW";
  let choice = null;
  try {
    choice = JSON.parse(localStorage.getItem(key));
  } catch {
    /* Private browsing is fine. */
  }
  const blocked = navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  let enabled = false;
  let id = null;
  let lastActivity = Date.now();
  const seconds = new Map();
  const seen = new Set();
  const sections = [...root.querySelectorAll("main > section")]
    .map((node, i) => ({ node, name: ["hero", "idea", "exchange", "care", "faq", "join"][i] }))
    .filter((item) => item.name);
  const visible = new Set();
  const sourceValue = new URLSearchParams(location.search).get("utm_source");
  const source = ["instagram", "facebook", "google", "university"].includes(sourceValue)
    ? sourceValue
    : sourceValue
      ? "other"
      : document.referrer
        ? "other"
        : "direct";
  function capture(event, properties = {}) {
    if (!enabled || !id || blocked) return;
    void fetch("/analytics/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      keepalive: true,
      body: JSON.stringify({ id, event, language, ...properties }),
    }).catch(() => {});
  }
  function flush() {
    for (const [section, value] of seconds)
      if (value) capture("section_active_time", { section, seconds: Math.min(60, value) });
    seconds.clear();
  }
  function start() {
    enabled = true;
    id = choice.id;
    capture("site_viewed", { source });
    for (const section of visible) {
      seen.add(section);
      capture("section_viewed", { section });
    }
  }
  const panel = document.createElement("div");
  panel.className = "analytics-choice";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", zh ? "使用情況隱私" : "Usage privacy");
  const explanation = document.createElement("p");
  explanation.textContent = zh
    ? "允許選用的使用統計嗎？PostHog 會收到隨機識別碼、瀏覽區塊、停留時間和操作次數。沒有錄影或表單內容。您可以隨時關閉。"
    : "Allow optional usage counts? PostHog receives a random ID, sections viewed, active viewing time and action counts. No recordings or form contents. You can turn this off anytime.";
  const link = document.createElement("a");
  link.href = language === "en" ? "/website-privacy" : "/zh-TW/website-privacy";
  link.textContent = zh ? "隱私詳情" : "Privacy details";
  panel.append(explanation, link);
  function button(label, run) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", run);
    panel.append(node);
  }
  function save(allow) {
    if (!allow) {
      enabled = false;
      id = null;
      seconds.clear();
      seen.clear();
    }
    choice = allow
      ? { allowed: true, id: choice?.allowed ? choice.id : crypto.randomUUID() }
      : { allowed: false };
    try {
      localStorage.setItem(key, JSON.stringify(choice));
    } catch {
      /* Consent lasts this page only. */
    }
    panel.hidden = true;
    if (allow) start();
  }
  button(zh ? "允許統計" : "Allow counts", () => save(true));
  button(zh ? "不用，謝謝" : "No thanks", () => save(false));
  const control = document.createElement("button");
  control.type = "button";
  control.className = "analytics-settings";
  control.textContent = zh ? "使用情況隱私" : "Usage privacy";
  const identifier = document.createElement("p");
  panel.append(identifier);
  control.addEventListener("click", () => {
    identifier.textContent = choice?.allowed
      ? `${zh ? "查閱或刪除用識別碼" : "ID for access or deletion"}: ${choice.id}`
      : "";
    panel.hidden = false;
  });
  panel.hidden = true;
  if (blocked) return;
  void fetch("/analytics/config", { credentials: "omit" })
    .then((r) => r.json())
    .then((config) => {
      if (!config.enabled) return;
      const region = document.createElement("p");
      region.textContent =
        config.region === "eu"
          ? zh
            ? "資料儲存地區：歐盟。"
            : "Storage region: European Union."
          : zh
            ? "資料儲存地區：美國。"
            : "Storage region: United States.";
      panel.prepend(region);
      document.body.append(panel, control);
      if (choice?.allowed === true && /^[a-f0-9-]{36}$/.test(choice.id)) start();
      else if (!choice) panel.hidden = false;
    })
    .catch(() => {});
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const section = sections.find((item) => item.node === entry.target)?.name;
        if (!section) continue;
        if (entry.isIntersecting) {
          visible.add(section);
          if (enabled && !seen.has(section)) {
            seen.add(section);
            capture("section_viewed", { section });
          }
        } else visible.delete(section);
      }
    },
    { rootMargin: "-20% 0px -20% 0px", threshold: 0 },
  );
  for (const { node } of sections) observer.observe(node);
  for (const event of ["pointerdown", "keydown", "scroll", "touchstart"])
    document.addEventListener(
      event,
      () => {
        lastActivity = Date.now();
      },
      { passive: true },
    );
  setInterval(() => {
    if (!enabled || !panel.hidden || document.hidden || Date.now() - lastActivity > 30000) return;
    for (const section of visible) seconds.set(section, (seconds.get(section) ?? 0) + 1);
  }, 1000);
  setInterval(flush, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
    else lastActivity = Date.now();
  });
  window.addEventListener("pagehide", flush);
  root.querySelectorAll("[data-waitlist]").forEach((node) => {
    node.addEventListener("click", () => capture("waitlist_opened"));
  });
  root.querySelectorAll("[data-step]").forEach((node, step) => {
    node.addEventListener("click", () => capture("demo_step_viewed", { step }));
  });
  root.querySelectorAll("[data-waitlist-form]").forEach((form) => {
    form.addEventListener("submit", () => {
      if (form.checkValidity()) capture("waitlist_submitted");
    });
    let acknowledged = false;
    new MutationObserver(() => {
      if (form.classList.contains("waitlist-success") && !acknowledged) {
        acknowledged = true;
        capture("waitlist_acknowledged");
      }
      if (form.querySelector('.form-status[role="alert"]')) capture("waitlist_failed");
    }).observe(form, { attributes: true, subtree: true, attributeFilter: ["class", "role"] });
  });
})();
