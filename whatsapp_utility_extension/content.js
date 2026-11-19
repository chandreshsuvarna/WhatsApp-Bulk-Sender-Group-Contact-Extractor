(() => {
  if (window.__waProSender) return;
  window.__waProSender = true;
  const { merge } = WAShared;

  // ---------- instant-stop support ----------
  // Any "stop" (button on this page, button in the app tab, or storage change) sets `aborted`.
  // sleep()/waitFor() check it every 100 ms and throw, so every in-flight step unwinds immediately.
  let aborted = false;
  let clicked = false;               // true between clicking Send and recording the result
  class Abort extends Error {}
  const checkAbort = () => { if (aborted) throw new Abort("stopped"); };

  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      checkAbort();
      await new Promise(r => setTimeout(r, Math.min(100, Math.max(0, end - Date.now()))));
    }
    checkAbort();
  }
  const get = (k) => new Promise(r => chrome.storage.local.get(k, x => r(x[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  const save = (s) => { checkAbort(); return set("campaign", s); };   // never overwrite a stop
  async function waitFor(fn, timeout = 10000, step = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { checkAbort(); const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.campaign) return;
    const n = ch.campaign.newValue;
    if (!n || !n.running) aborted = true;
  });

  // ---------- DOM helpers (several selectors because WhatsApp renames them) ----------
  const vis = (el) => el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const clickable = (el) => el.closest('button,[role="button"]') || el;
  function realClick(el) {
    el = clickable(el);
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  }
  const SEND_SEL = ['[data-icon="send"]', '[data-icon="wds-ic-send-filled"]', '[data-icon*="send"]',
    '[aria-label="Send"]', 'button[aria-label*="Send"]'];
  function sendButtons() {
    const out = new Set();
    SEND_SEL.forEach(s => document.querySelectorAll(s).forEach(e => { const c = clickable(e); if (vis(c)) out.add(c); }));
    return [...out];
  }
  const lastSend = () => { const b = sendButtons(); return b.length ? b[b.length - 1] : null; };
  const composer = () =>
    document.querySelector('footer div[contenteditable="true"]') ||
    document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
    document.querySelector('#main div[contenteditable="true"][role="textbox"]') ||
    document.querySelector('div[contenteditable="true"][aria-label*="essage" i]') ||
    document.querySelector('div[contenteditable="true"][aria-placeholder*="essage" i]') ||
    [...document.querySelectorAll('#main [contenteditable="true"]')].filter(vis).pop() || null;
  const composerText = () => ((composer() && composer().innerText) || "").replace(/\u200b/g, "").trim();
  const captionBox = () => {
    const all = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(e => vis(e) && !e.closest("#side"));
    return all[all.length - 1] || null;
  };
  // Types multi-line text into WhatsApp's caption box and VERIFIES the line breaks survived.
  // WhatsApp's editor ignores execCommand("insertLineBreak"), so we try, in order:
  //   1) paste a text/plain clipboard event (keeps \n as real line breaks)
  //   2) type each line, with Shift+Enter / beforeinput "insertLineBreak" between lines
  const boxText = (el) => (el.innerText || "").replace(/\u200b/g, "");
  const wipe = (el) => { el.focus(); document.execCommand("selectAll"); document.execCommand("delete"); };
  const textOk = (el, text) => {
    const got = boxText(el);
    const flat = (x) => x.replace(/\s+/g, "");
    return flat(got) === flat(text) && (!text.includes("\n") || got.includes("\n"));
  };
  function lineBreak(el) {
    const kd = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(kd);
    if (!kd.defaultPrevented) {
      el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertLineBreak", bubbles: true, cancelable: true }));
    }
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: true, bubbles: true }));
  }
  async function typeInto(el, text) {
    text = text.replace(/\r\n?/g, "\n");
    // 1) paste
    wipe(el); await sleep(150);
    const dt = new DataTransfer(); dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(500);
    if (textOk(el, text)) return;
    // 2) line by line with Shift+Enter
    wipe(el); await sleep(150);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) { lineBreak(el); await sleep(60); }
      if (lines[i]) document.execCommand("insertText", false, lines[i]);
    }
    await sleep(300);
  }
  function pressEnter(el) {
    el.focus();
    ["keydown", "keypress", "keyup"].forEach(t => el.dispatchEvent(new KeyboardEvent(t,
      { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })));
  }
  function dataUrlToFile(a) {
    const b64 = a.dataUrl.split(",")[1], bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], a.name, { type: a.type });
  }

  // ---------- badge with STOP button ----------
  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:99999;background:#075e54;color:#fff;padding:8px 10px 8px 12px;border-radius:8px;font:12px sans-serif;display:none;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,.3)";
  const msg = document.createElement("span");
  const stopBtn = document.createElement("button");
  stopBtn.textContent = "STOP";
  stopBtn.style.cssText = "background:#e53935;color:#fff;border:0;border-radius:6px;padding:6px 14px;font:bold 12px sans-serif;cursor:pointer";
  badge.append(msg, stopBtn);
  document.documentElement.appendChild(badge);
  const show = (t, live = true) => {
    badge.style.display = "flex";
    msg.textContent = "WA Bulk Sender: " + t;
    stopBtn.style.display = live ? "inline-block" : "none";
  };
  stopBtn.addEventListener("click", async () => {
    aborted = true;                                   // halts this page instantly
    show("stopping...", false);
    const s = await get("campaign");
    if (s) { s.running = false; s.note = "stopped by you"; await set("campaign", s); }
    show("stopped", false);
  });

  // ---------- sending ----------
  async function sendText(text) {
    if (!(await waitFor(() => composerText().length > 0, 12000))) {
      // WhatsApp did not pre-fill the text from the link - type it into the box ourselves
      const c = composer();
      if (!c) return "message box not found | " + diag();
      await typeInto(c, text);
      await sleep(500);
      if (composerText().length === 0) return "could not type message | " + diag();
    }
    await sleep(800 + Math.random() * 1000);
    checkAbort();
    clicked = true;
    const btn = lastSend();
    if (btn) realClick(btn); else pressEnter(composer());
    if (await waitFor(() => composerText().length === 0, 8000)) return "sent";
    pressEnter(composer());                                   // fallback
    if (await waitFor(() => composerText().length === 0, 6000)) return "sent";
    return "could not click send | " + diag();
  }

  // IMAGES: paste into the chat box. WhatsApp opens this as a normal photo preview (never a sticker).
  // Fallback: attach menu, but ONLY the "Photos & videos" input (its accept list includes video).
  // We never fall back to a plain image/* input because that is the sticker input.
  const isStickerInput = (i) => {
    const li = i.closest("li");
    return /sticker/i.test((li && li.textContent) || "") || /sticker/i.test(i.getAttribute("aria-label") || "");
  };
  const photoInput = () => [...document.querySelectorAll('input[type="file"]')]
    .find(i => /video/.test(i.accept || "") && /image/.test(i.accept || "") && !isStickerInput(i)) || null;
  const docInput = () => [...document.querySelectorAll('input[type="file"]')]
    .find(i => (!i.accept || i.accept === "*" || i.accept === "*/*") && !isStickerInput(i)) || null;
  // Preview is open if: a send button shows with an empty composer, OR two editors are visible
  // (main box + caption box), OR a large blob thumbnail sits outside the message list.
  const previewOpen = () => {
    if (lastSend() && composerText().length === 0) return true;
    const eds = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => vis(e) && !e.closest("#side"));
    if (eds.length >= 2) return true;
    return [...document.querySelectorAll('img[src^="blob:"]')].some(i => vis(i) &&
      !i.closest('[data-id],[role="row"],[role="listitem"],#side') && i.getBoundingClientRect().height > 60);
  };
  // If WhatsApp shows "Discard selection?", press Cancel so the preview stays open.
  function dismissDiscard() {
    const cancel = [...document.querySelectorAll('button,[role="button"]')].find(b => vis(b) &&
      /^cancel$/i.test((b.textContent || "").trim()) &&
      /discard/i.test(((b.closest('[role="dialog"]') || (b.parentElement && b.parentElement.parentElement && b.parentElement.parentElement.parentElement) || document.body).textContent) || ""));
    if (cancel) { realClick(cancel); return true; }
    return false;
  }

  async function pasteFile(file) {
    const c = composer(); if (!c) return false;
    const dt = new DataTransfer(); dt.items.add(file);
    c.focus();
    c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return !!(await waitFor(previewOpen, 8000));
  }

  // Finds the send button even if WhatsApp renamed its icon: anything labelled "send",
  // otherwise the round green button in the lower-right part of the screen.
  function sendHeuristic() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const all = [...document.querySelectorAll('button,[role="button"],div,span')];
    const labelled = all.filter(e => vis(e) && /send/i.test((e.getAttribute("aria-label") || "") +
      (e.getAttribute("data-icon") || "") + (e.getAttribute("title") || "") + (e.getAttribute("data-testid") || "")));
    if (labelled.length) return clickable(labelled[labelled.length - 1]);
    const green = all.filter(e => {
      if (!vis(e)) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 36 || r.width > 96 || Math.abs(r.width - r.height) > 8) return false;
      if (r.left < vw * 0.5 || r.bottom < vh * 0.5) return false;
      const m = (getComputedStyle(e).backgroundColor.match(/\d+/g) || []).map(Number);
      return m.length >= 3 && m[1] > m[0] + 40 && m[1] > m[2] + 15 && m[0] < 110;
    });
    return green.length ? clickable(green[green.length - 1]) : null;
  }
  function sendCandidates() {
    return [...document.querySelectorAll('button,[role="button"]')].filter(vis).slice(-8).map(e => {
      const r = e.getBoundingClientRect();
      const ic = e.querySelector("[data-icon]");
      return `${e.tagName}|${e.getAttribute("aria-label") || ""}|${(ic && ic.getAttribute("data-icon")) || e.getAttribute("data-icon") || ""}|${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`;
    }).join(" ; ");
  }

  // What the page offers right now - appended to the failure message so a layout change can be diagnosed.
  function diag() {
    const icons = [...new Set([...document.querySelectorAll('footer [data-icon],footer [aria-label]')]
      .map(e => e.getAttribute("data-icon") || e.getAttribute("aria-label")))].slice(0, 12);
    const inputs = [...document.querySelectorAll('input[type="file"]')].map(i => i.accept || "*");
    const editors = [...document.querySelectorAll('[contenteditable="true"]')].slice(0, 6).map(e =>
      e.tagName + (e.getAttribute("role") ? "[role=" + e.getAttribute("role") + "]" : "") +
      (e.closest("footer") ? "(footer)" : "") + (vis(e) ? "" : "(hidden)"));
    return `url=${location.pathname} composer=${!!composer()} preview=${previewOpen()} editors=[${editors.join(",")}] btns=[${sendCandidates()}] icons=[${icons.join(",")}] fileInputs=[${inputs.join(" | ")}]`;
  }

  const attachButton = () =>
    document.querySelector('footer [data-icon="plus"],footer [data-icon="plus-rounded"],footer [data-icon="attach-menu-plus"],footer [data-icon="clip"],footer [data-icon*="attach"],footer [data-icon*="plus"],footer [aria-label="Attach"],footer [title="Attach"]') ||
    document.querySelector('#main [aria-label*="ttach"],#main [title*="ttach"],#main [data-icon*="plus"]');

  const menuItem = (re) => [...document.querySelectorAll('li,[role="menuitem"],[role="button"],button')]
    .find(e => vis(e) && (e.textContent || "").trim().length < 40 && re.test((e.textContent || "").trim()));

  const escapeKey = () => document.dispatchEvent(new KeyboardEvent("keydown",
    { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));

  async function attachViaMenu(file, getInput, labelRe) {
    const dt = new DataTransfer(); dt.items.add(file);
    if (previewOpen()) return true;
    const attachBtn = attachButton();
    if (!attachBtn) return false;
    realClick(attachBtn);
    await sleep(900);
    let input = await waitFor(getInput, 3000);
    if (!input) {                                    // inputs may only be created once the menu item is clicked
      const item = menuItem(labelRe);
      if (item) { realClick(item); input = await waitFor(getInput, 3000); }
    }
    if (!input) { if (!previewOpen()) escapeKey(); dismissDiscard(); return false; }
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return !!(await waitFor(previewOpen, 6000));
  }

  // Layout-independent fallback: drop the file onto the chat panel (same as dragging a file into WhatsApp Web).
  async function dropFile(file) {
    if (previewOpen()) return true;
    const target = document.querySelector("#main") || (composer() && composer().closest("div"));
    if (!target) return false;
    const dt = new DataTransfer(); dt.items.add(file);
    for (const t of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      await sleep(150);
    }
    return !!(await waitFor(previewOpen, 8000));
  }

  async function attachFile(file) {
    const isImg = file.type.startsWith("image/");
    if (isImg && await pasteFile(file)) return true;
    if (previewOpen()) return true;                  // paste worked but was detected late - do not touch it
    if (await attachViaMenu(file, isImg ? photoInput : docInput, isImg ? /photo|video/i : /document/i)) return true;
    return dropFile(file);                           // photo preview / document preview, never a sticker
  }

  async function sendAttachment(caption) {
    const att = await get("attachment");
    if (!att) return "attachment missing";
    if (!(await waitFor(() => composer(), 20000))) return "chat did not load";
    await sleep(1000);
    if (!(await attachFile(dataUrlToFile(att)))) { const d = diag(); console.warn("WA Bulk Sender diag:", d); return "could not attach file | " + d; }
    dismissDiscard();
    if (!(await waitFor(previewOpen, 20000))) return "attachment preview did not open | " + diag();
    await sleep(1200);
    dismissDiscard();
    if (caption) {
      const cb = captionBox();
      if (cb) { await typeInto(cb, caption); await sleep(700); }
    }
    checkAbort();
    clicked = true;
    console.log("WA Bulk Sender: about to send, buttons:", sendCandidates());
    const first = lastSend() || sendHeuristic();
    if (first) realClick(first);
    if (await waitFor(() => !previewOpen(), 6000)) { await sleep(2000); return "sent"; }
    const second = sendHeuristic();                 // still open: try the green/labelled button with a plain click
    if (second) { second.click(); if (await waitFor(() => !previewOpen(), 5000)) { await sleep(2000); return "sent"; } }
    if (captionBox()) pressEnter(captionBox());     // last resort: Enter in the caption box
    if (await waitFor(() => !previewOpen(), 8000)) { await sleep(2000); return "sent"; }
    return "could not click send | " + diag();
  }

  async function waitForChat(timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (composer()) return "ok";
      const dlg = document.querySelector('[role="dialog"], div[data-animate-modal-popup="true"]');
      if (dlg && /invalid|not on whatsapp|isn.t on whatsapp|not registered/i.test(dlg.textContent)) return "invalid";
      await sleep(500);
    }
    return "timeout";
  }

  const urlFor = (s, c) => {
    const text = s.useAttachment ? "" : merge(s.message, c.fields);
    return `https://web.whatsapp.com/send?phone=${c.phone}${text ? "&text=" + encodeURIComponent(text) : ""}`;
  };

  async function runInner() {
    let s = await get("campaign");
    if (!s || !s.running) return;
    const finish = async (note) => { s.running = false; s.note = note; await set("campaign", s); show(note, false); };

    if (s.index >= s.contacts.length) return finish("finished");
    if (s.sentThisRun >= s.maxRun) return finish("run limit reached - click Start to continue");

    const c = s.contacts[s.index];
    const params = new URLSearchParams(location.search);
    if (!(location.pathname.startsWith("/send") && params.get("phone") === c.phone)) {
      location.href = urlFor(s, c);
      return;
    }

    show(`contact ${s.index + 1}/${s.contacts.length}: opening chat...`);
    const chat = await waitForChat(60000);
    s = await get("campaign");
    if (!s.running) return show("stopped", false);

    let status;
    clicked = false;
    if (chat === "invalid") status = "invalid number";
    else if (chat === "timeout") { status = "chat did not open | " + diag(); s.fails = 99; }
    else {
      show(`contact ${s.index + 1}/${s.contacts.length}: sending...`);
      status = s.useAttachment ? await sendAttachment(merge(s.message, c.fields)) : await sendText(merge(s.message, c.fields));
    }

    s = await get("campaign");
    if (!s.running) return show("stopped", false);
    if (status === "sent") { s.sentThisRun++; s.fails = 0; }
    else if (status !== "invalid number") s.fails = (s.fails || 0) + 1;

    s.results.push({ phone: c.phone, name: c.fields.name || "", status, time: new Date().toISOString() });
    s.index++;
    clicked = false;
    await save(s);

    if (s.fails >= 3) return finish(`stopped after repeated failures (last: ${status}). Is WhatsApp logged in / did the layout change?`);
    if (s.index >= s.contacts.length) return finish("finished");

    const wait = Math.round(s.minDelay + Math.random() * (s.maxDelay - s.minDelay));
    for (let left = wait; left > 0; left--) {
      const cur = await get("campaign");
      if (!cur || !cur.running) return show("stopped", false);
      show(`${cur.index}/${cur.contacts.length} done - next in ${left}s`);
      await sleep(1000);
    }
    const cur = await get("campaign");
    if (!cur || !cur.running) return show("stopped", false);
    location.href = urlFor(cur, cur.contacts[cur.index]);
  }

  async function run() {
    try {
      await runInner();
    } catch (e) {
      const cur = await get("campaign");
      if (e instanceof Abort) {
        show("stopped", false);
        if (cur && cur.contacts && cur.contacts[cur.index]) {
          if (clicked) {
            // Send had already been clicked - record it so Resume doesn't send it twice
            const c = cur.contacts[cur.index];
            cur.results.push({ phone: c.phone, name: c.fields.name || "", status: "sent (stopped while confirming)", time: new Date().toISOString() });
            cur.index++;
            await set("campaign", cur);
          } else if (cur.useAttachment) {
            // Close an attachment preview that was opened but not sent
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
          }
        }
      } else {
        console.error("WA Bulk Sender error", e);
        show("error: " + (e && e.message), false);
        if (cur) { cur.running = false; cur.note = "error: " + (e && e.message); await set("campaign", cur); }
      }
    }
  }

  run();
})();
