// Approved Vela website: progressive enhancements; ordinary forms work without JavaScript.
(() => {
  const root = document.querySelector(".approved-home");
  if (!root) return;
  const dataNode = document.getElementById("vela-demo");
  if (!dataNode) return;
  let c;
  try {
    c = JSON.parse(dataNode.textContent);
  } catch {
    return;
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const starters = [...root.querySelectorAll("[data-starter]")];
  for (const button of starters) {
    button.addEventListener("click", () => {
      const example = c.examples?.[Number(button.dataset.starter)];
      if (!example) return;
      for (const choice of starters) choice.setAttribute("aria-pressed", String(choice === button));
      for (const field of ["question", "answer", "reply"]) {
        const node = root.querySelector(`#starter-${field}`);
        if (node) node.textContent = example[field];
      }
    });
  }
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const phases = [
    {
      title: c.sendTitle,
      label: c.questionLabel,
      source: c.appSource,
      screen: "/site/img/app-current/ask.png",
      alt: c.askScreenAlt,
      caption: c.youApp,
      explanation: c.askExplanation,
      next: c.showAnswer,
    },
    {
      title: c.answerTitle,
      label: c.answerLabel,
      source: c.parentSource,
      caption: c.parentCaption,
      explanation: c.answerExplanation,
      next: c.replyTitle,
    },
    {
      title: c.replyTitle,
      label: c.replyLabel,
      source: c.appSource,
      screen: "/site/img/app-current/reply.png",
      alt: c.replyScreenAlt,
      caption: c.youApp,
      explanation: c.replyExplanation,
      next: c.replay,
    },
  ];
  const tabs = [...root.querySelectorAll("[data-step]")];
  const screen = root.querySelector("#app-screen");
  const screenShell = root.querySelector("#app-screen-shell");
  const parentExample = root.querySelector("#parent-example");
  const screenDialog = root.querySelector("#screen-dialog");
  const waitlistDialog = root.querySelector("#waitlist-dialog");
  let currentStep = 0;
  phases
    .filter((phase) => phase.screen)
    .forEach((phase) => {
      const image = new Image();
      image.src = phase.screen;
    });
  function parentConversation() {
    const content = root.querySelector("#phone-content");
    const question = el("div", "demo-message");
    question.append(
      el("span", "tiny-label", "VIA VELA"),
      el("p", "", c.parentQuestion),
      el("small", "", "8:00 AM"),
    );
    const answer = el("div", "demo-message demo-answer");
    answer.append(el("span", "tiny-label", c.voiceLabel));
    const voice = el("div", "demo-voice");
    const waveform = el("div", "waveform");
    waveform.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 21; i += 1) waveform.append(el("i"));
    voice.append(waveform, el("span", "", "0:18"));
    const button = el("button", "transcript-button", c.readAnswer);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "sample-transcript");
    const transcript = el("div", "transcript-text", c.parentAnswer);
    transcript.id = "sample-transcript";
    transcript.hidden = true;
    button.addEventListener("click", () => {
      transcript.hidden = !transcript.hidden;
      button.setAttribute("aria-expanded", String(!transcript.hidden));
      button.textContent = transcript.hidden ? c.readAnswer : c.hideAnswer;
    });
    answer.append(voice, button, transcript, el("small", "", "8:12 AM"));
    content.replaceChildren(
      el("p", "demo-date", c.parentSender),
      question,
      answer,
      el("p", "demo-status", c.noAudio),
    );
  }
  function setStep(index, focusTab = false) {
    currentStep = index;
    const phase = phases[index];
    tabs.forEach((tab, i) => {
      tab.disabled = false;
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    screenShell.hidden = !phase.screen;
    parentExample.hidden = Boolean(phase.screen);
    if (phase.screen) {
      screen.src = phase.screen;
      screen.alt = phase.alt;
    } else parentConversation();
    root.querySelector("#stage-step-label").textContent = phase.label;
    root.querySelector("#stage-source").textContent = phase.source;
    root.querySelector("#stage-explanation").textContent = phase.explanation;
    root.querySelector("#stage-caption").textContent = phase.caption;
    root.querySelector("#exchange-panel").setAttribute("aria-labelledby", `tab-${index}`);
    const next = root.querySelector("#next-step");
    next.setAttribute("aria-label", phase.next);
    const arrow = el("span", "", index === 2 ? "↩" : "→");
    arrow.setAttribute("aria-hidden", "true");
    next.replaceChildren(document.createTextNode(`${index === 2 ? c.replay : c.next} `), arrow);
    if (focusTab) tabs[index].focus({ preventScroll: true });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setStep(index));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        setStep(next, true);
      }
    });
  });
  root
    .querySelector("#next-step")
    .addEventListener("click", () => setStep((currentStep + 1) % phases.length));
  root.querySelector("#screen-expand").addEventListener("click", () => {
    const phase = phases[currentStep];
    const enlarged = root.querySelector("#enlarged-screen");
    enlarged.src = phase.screen;
    enlarged.alt = phase.alt;
    root.querySelector("#screen-dialog-title").textContent = phase.title;
    screenDialog.showModal();
  });
  root.querySelector(".screen-dialog-close").addEventListener("click", () => screenDialog.close());
  root.querySelectorAll("[data-waitlist]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      waitlistDialog.showModal();
    });
  });
  root.querySelector(".dialog-close").addEventListener("click", () => waitlistDialog.close());
  for (const dialog of [waitlistDialog, screenDialog])
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        dialog.close();
    });
  root.querySelectorAll("[data-waitlist-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.getAttribute("aria-busy") === "true" || !form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector(".form-status");
      const original = [...button.childNodes].map((node) => node.cloneNode(true));
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form)) body.set(key, String(value));
      button.disabled = true;
      button.textContent = c.joining;
      form.setAttribute("aria-busy", "true");
      status.textContent = "";
      status.setAttribute("role", "status");
      try {
        const response = await fetch(form.action, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });
        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error(c.failed);
        }
        if (!response.ok || result.joined !== true)
          throw new Error(
            response.status === 400
              ? c.badEmail
              : response.status === 429
                ? c.rateLimited
                : c.failed,
          );
        status.textContent = c.joined;
        button.textContent = c.onList;
        form.querySelector('input[type="email"]').readOnly = true;
        form.classList.add("waitlist-success");
      } catch (error) {
        status.setAttribute("role", "alert");
        status.textContent = error instanceof TypeError ? c.failed : error.message;
        button.disabled = false;
        button.replaceChildren(...original);
      } finally {
        form.removeAttribute("aria-busy");
      }
    });
  });
  const viewport = root.querySelector(".story-viewport");
  const track = root.querySelector(".story-track");
  const group = root.querySelector(".story-group");
  const duplicate = group.cloneNode(true);
  duplicate.setAttribute("aria-hidden", "true");
  duplicate.querySelectorAll("img").forEach((image) => {
    image.alt = "";
  });
  track.append(duplicate);
  let offset = 0;
  let paused = reduced.matches;
  let hovering = false;
  let focused = false;
  let inView = true;
  let lastFrame = 0;
  const pauseButton = root.querySelector("#photo-pause");
  const photoStatus = el("span", "visually-hidden");
  photoStatus.setAttribute("role", "status");
  root.querySelector(".gallery-controls").append(photoStatus);
  function paint() {
    const width = group.getBoundingClientRect().width;
    if (!width) return;
    offset = ((offset % width) + width) % width;
    track.style.transform = `translate3d(${-offset}px,0,0)`;
  }
  function pauseLabel() {
    pauseButton.setAttribute("aria-pressed", String(paused));
    const arrow = el("span", "", paused ? "▷" : "Ⅱ");
    arrow.setAttribute("aria-hidden", "true");
    pauseButton.replaceChildren(document.createTextNode(paused ? c.play : c.pause), arrow);
  }
  function move(direction) {
    paused = true;
    pauseLabel();
    const width = group.querySelector(".story-card").getBoundingClientRect().width + 18;
    offset += direction * width;
    paint();
    photoStatus.textContent = `${c.photoPosition} ${(Math.round(offset / width) % 4) + 1} / 4`;
  }
  function animate(now) {
    const elapsed = lastFrame ? Math.min(now - lastFrame, 80) : 0;
    lastFrame = now;
    if (!paused && !hovering && !focused && inView && !document.hidden) {
      offset += elapsed * 0.035;
      paint();
    }
    requestAnimationFrame(animate);
  }
  pauseButton.addEventListener("click", () => {
    paused = !paused;
    pauseLabel();
  });
  root.querySelector("#photo-previous").addEventListener("click", () => move(-1));
  root.querySelector("#photo-next").addEventListener("click", () => move(1));
  viewport.addEventListener("mouseenter", () => {
    hovering = true;
  });
  viewport.addEventListener("mouseleave", () => {
    hovering = false;
  });
  viewport.addEventListener("focusin", () => {
    focused = true;
  });
  viewport.addEventListener("focusout", () => {
    focused = false;
  });
  viewport.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowRight" ? 1 : -1);
    }
  });
  let swipeStart;
  viewport.addEventListener(
    "touchstart",
    (event) => {
      swipeStart = event.touches[0].clientX;
    },
    { passive: true },
  );
  viewport.addEventListener(
    "touchend",
    (event) => {
      if (swipeStart === undefined) return;
      const distance = swipeStart - event.changedTouches[0].clientX;
      if (Math.abs(distance) > 35) move(distance > 0 ? 1 : -1);
      swipeStart = undefined;
    },
    { passive: true },
  );
  reduced.addEventListener("change", (event) => {
    paused = event.matches;
    pauseLabel();
  });
  if ("IntersectionObserver" in window)
    new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? false;
    }).observe(viewport);
  setStep(0);
  pauseLabel();
  document.documentElement.classList.add("enhanced");
  requestAnimationFrame(animate);
})();
