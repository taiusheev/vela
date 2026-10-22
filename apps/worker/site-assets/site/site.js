// Progressive enhancements. The same-origin waitlist remains usable without JavaScript.
(() => {
  const root = document.querySelector(".approved-home.afterglow");
  const dataNode = document.getElementById("vela-demo");
  if (!root || !dataNode) return;
  let c;
  try {
    c = JSON.parse(dataNode.textContent);
  } catch {
    return;
  }
  const steps = [...root.querySelectorAll("[data-morning]")];
  for (const button of steps) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const state = c.steps?.[Number(button.dataset.morning)];
      if (!state) return;
      for (const choice of steps) choice.setAttribute("aria-pressed", String(choice === button));
      for (const key of ["time", "label", "message", "status", "outcome"]) {
        const node = root.querySelector(`#morning-${key}`);
        if (node) node.textContent = state[key];
      }
    });
  }
  const dialog = root.querySelector("#waitlist-dialog");
  if (dialog && typeof dialog.showModal === "function") {
    let opener;
    root.querySelectorAll("[data-waitlist]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        opener = link;
        dialog.showModal();
        document.documentElement.classList.add("waitlist-open");
        dialog.querySelector('input[type="email"]')?.focus();
      });
    });
    root.querySelector(".dialog-close")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      document.documentElement.classList.remove("waitlist-open");
      opener?.focus({ preventScroll: true });
    });
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
  }
  root.querySelectorAll("[data-waitlist-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (
        form.getAttribute("aria-busy") === "true" ||
        form.classList.contains("waitlist-success") ||
        !form.reportValidity()
      )
        return;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector(".form-status");
      const email = form.querySelector('input[type="email"]');
      const original = [...button.childNodes].map((node) => node.cloneNode(true));
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form)) body.set(key, String(value));
      button.disabled = true;
      email.readOnly = true;
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
        form.classList.add("waitlist-success");
      } catch (error) {
        status.setAttribute("role", "alert");
        status.textContent = error instanceof TypeError ? c.failed : error.message;
        button.disabled = false;
        email.readOnly = false;
        button.replaceChildren(...original);
      } finally {
        form.removeAttribute("aria-busy");
      }
    });
  });
})();
