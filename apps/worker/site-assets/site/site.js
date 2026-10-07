// Vela website: demos and small enhancements. Everything on the page works and reads without it.
(() => {
  const data = JSON.parse(document.getElementById("vela-demo")?.textContent || "null");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? Math.min(ms, 120) : ms));

  // Header shadow once the page has moved.
  const top = document.querySelector(".top");
  const onScroll = () => top?.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Reveal sections as they come into view.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const node of document.querySelectorAll(".reveal")) io.observe(node);

  // A slow drift on the full-width photograph.
  const bleed = document.querySelector(".bleed img");
  if (bleed && !reduced) {
    const drift = () => {
      const box = bleed.parentElement.getBoundingClientRect();
      const t = (innerHeight - box.top) / (innerHeight + box.height);
      if (t > -0.2 && t < 1.2) bleed.style.transform = `translateY(${(-t * 12).toFixed(2)}%)`;
    };
    addEventListener("scroll", drift, { passive: true });
    drift();
  }

  if (!data) return;

  // ---- Phone rendering -------------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** One chat message: {from: "ask"|"her"|"vela"|"family"|"time", who, text, chips, voice, photo}. */
  function bubble(m) {
    if (m.from === "time") return el("div", "time", m.text);
    const b = el(
      "div",
      `msg${m.from === "her" ? " me" : ""}${m.from === "vela" ? " vela" : ""}${m.photo ? " photo" : ""}`,
    );
    if (m.who) b.append(el("span", "who", m.who));
    if (m.photo) {
      const img = el("img");
      img.src = m.photo;
      img.alt = m.alt || "";
      img.loading = "lazy";
      b.append(img);
    }
    if (m.voice) {
      const v = el("div", "voice");
      v.append(el("span", "", "▶"));
      const w = el("span", "wave");
      for (let i = 0; i < 14; i += 1) {
        const bar = el("i");
        bar.style.height = `${30 + ((i * 37) % 70)}%`;
        w.append(bar);
      }
      v.append(w, el("span", "", m.voice));
      b.append(v);
    }
    if (m.text) b.append(document.createTextNode(m.text));
    if (m.chips) {
      const c = el("div", "chips");
      for (const label of m.chips) c.append(el("span", "chip", label));
      b.append(c);
    }
    return b;
  }

  function phone(node) {
    const chat = node.querySelector(".chat");
    const title = node.querySelector(".bar b");
    const sub = node.querySelector(".bar small");
    return {
      clear() {
        chat.replaceChildren();
      },
      head(h) {
        if (h) {
          title.textContent = h.title;
          sub.textContent = h.sub;
        }
      },
      add(m) {
        const b = bubble(m);
        b.classList.add("pop");
        chat.append(b);
        while (chat.children.length > 7) chat.firstChild.remove();
        return b;
      },
      tap(label) {
        const chips = [...chat.querySelectorAll(".chip")];
        const chip = chips.reverse().find((c) => c.textContent === label);
        chip?.classList.add("tapped");
      },
      typing() {
        const t = el("div", "msg");
        t.append(el("span", "typing"));
        t.firstChild.append(el("i"), el("i"), el("i"));
        chat.append(t);
        return t;
      },
    };
  }

  // ---- Hero: a morning on a loop ---------------------------------------------------------------
  const heroNode = document.querySelector(".stage .phone");
  const badge = document.querySelector(".badge-light");
  if (heroNode) {
    const p = phone(heroNode);
    let visible = true;
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    }).observe(heroNode);
    (async function loop() {
      for (;;) {
        p.clear();
        badge?.classList.remove("lit");
        for (const step of data.hero) {
          while (!visible) await wait(400);
          if (step.wait) await wait(step.wait);
          if (step.typing) {
            const t = p.typing();
            await wait(step.typing);
            t.remove();
          }
          if (step.tap) {
            p.tap(step.tap);
            await wait(500);
          }
          if (step.lit) {
            badge?.classList.add("lit");
            continue;
          }
          if (step.msg) p.add(step.msg);
        }
        await wait(4200);
        if (reduced) return;
      }
    })();
  }

  // ---- One morning: the sticky phone follows the steps ----------------------------------------
  const sticky = document.querySelector(".morning .sticky .phone");
  const steps = [...document.querySelectorAll(".step")];
  const showStep = (p, i) => {
    const scene = data.morning[i];
    p.head(scene.head);
    p.clear();
    for (const m of scene.messages) p.add(m);
    if (scene.tap) setTimeout(() => p.tap(scene.tap), 450);
  };
  if (sticky && steps.length) {
    const p = phone(sticky);
    let current = -1;
    const pick = () => {
      let best = 0,
        bestDist = Infinity;
      steps.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - innerHeight / 2);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best !== current) {
        current = best;
        for (const [i, s] of steps.entries()) s.classList.toggle("on", i === best);
        showStep(p, best);
      }
    };
    addEventListener("scroll", pick, { passive: true });
    addEventListener("resize", pick);
    pick();
  }
  // Small screens: each step shows its own little phone, drawn once.
  for (const [i, node] of [...document.querySelectorAll(".step .mini")].entries())
    showStep(phone(node), i);

  // ---- Try it ----------------------------------------------------------------------------------
  const tryNode = document.querySelector(".try .phone");
  const asks = document.querySelector("#try-asks");
  const answers = document.querySelector("#try-answers");
  const result = document.querySelector(".try-result");
  const again = document.querySelector(".try-again");
  if (tryNode && asks && answers && result) {
    const p = phone(tryNode);
    // On a narrow screen the buttons sit below the phone: bring it back into view to show the tap.
    const showPhone = () => {
      const box = tryNode.getBoundingClientRect();
      if (box.top < 60 || box.bottom > innerHeight) {
        tryNode.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }
    };
    let chosen = null;
    let busy = false;
    const reset = () => {
      chosen = null;
      p.head(data.try.head);
      p.clear();
      p.add({ from: "time", text: data.try.time });
      for (const b of asks.querySelectorAll("button")) {
        b.disabled = false;
        b.setAttribute("aria-pressed", "false");
      }
      answers.replaceChildren(el("p", "nojs-hint", data.try.pickFirst));
      result.classList.remove("lit");
      result.querySelector("span").textContent = data.try.waiting;
      if (again) again.hidden = true;
    };
    data.try.asks.forEach((ask, i) => {
      const b = el("button", "", ask.label);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        chosen = ask;
        for (const x of asks.querySelectorAll("button")) {
          x.disabled = x !== b;
          x.setAttribute("aria-pressed", String(x === b));
        }
        p.clear();
        p.head(data.try.head);
        p.add({ from: "time", text: data.try.time });
        showPhone();
        const t = p.typing();
        await wait(700);
        t.remove();
        p.add(ask.message);
        answers.replaceChildren();
        for (const a of ask.answers) {
          const ab = el("button", "", a.label);
          ab.type = "button";
          ab.addEventListener("click", async () => {
            if (busy || !chosen) return;
            busy = true;
            showPhone();
            for (const x of answers.querySelectorAll("button")) {
              x.disabled = x !== ab;
              x.setAttribute("aria-pressed", String(x === ab));
            }
            if (a.chip) {
              p.tap(a.chip);
              await wait(450);
            }
            p.add(a.message);
            await wait(800);
            p.add(data.try.ack);
            result.classList.add("lit");
            result.querySelector("span").textContent = data.try.lit;
            await wait(1300);
            p.add({ from: "time", text: data.try.tomorrow });
            await wait(500);
            p.add(a.readback);
            if (again) again.hidden = false;
            busy = false;
          });
          answers.append(ab);
        }
        busy = false;
      });
      asks.append(b);
      if (i === 0) b.dataset.first = "1";
    });
    again?.addEventListener("click", reset);
    reset();
  }

  // ---- Waitlist: send without leaving the page -------------------------------------------------
  const form = document.querySelector("form.waitlist");
  if (form && window.fetch) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      const flash = form.querySelector(".flash") || el("div", "flash");
      flash.setAttribute("role", "status");
      button.disabled = true;
      try {
        const response = await fetch(form.action, {
          method: "POST",
          headers: { accept: "application/json" },
          body: new URLSearchParams(new FormData(form)),
        });
        const body = await response.json().catch(() => ({}));
        flash.className = `flash ${response.ok ? "ok" : "err"}`;
        flash.textContent = response.ok
          ? data.join.ok
          : body.error === "email"
            ? data.join.badEmail
            : data.join.failed;
        if (response.ok) form.querySelector("input[type=email]").value = "";
      } catch {
        flash.className = "flash err";
        flash.textContent = data.join.failed;
      } finally {
        button.disabled = false;
        if (!flash.isConnected) form.append(flash);
        flash.focus?.();
      }
    });
  }
})();
