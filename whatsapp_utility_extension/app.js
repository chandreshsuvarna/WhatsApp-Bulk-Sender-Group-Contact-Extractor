(() => {
  const $ = (id) => document.getElementById(id);
  const get = (k) => new Promise(r => chrome.storage.local.get(k, x => r(x[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  let contacts = [], tokens = [];
  let source = { type: "none", csvText: "" };        // where the current contact list came from
  const DEFAULT_INFO = 'Paste numbers above, or upload a CSV with a header row, e.g. <code>name,phone,city</code>. Every CSV column can be used in your message as <code>{name}</code>, <code>{city}</code>, etc. Pasted lines like <code>9876543210, Rahul</code> also set {name}.';

  const saveForm = () => set("form", {
    message: $("message").value, cc: $("cc").value,
    minDelay: $("minDelay").value, maxDelay: $("maxDelay").value, maxRun: $("maxRun").value,
    numbers: $("numbers").value
  });
  ["message", "cc", "minDelay", "maxDelay", "maxRun"].forEach(id => $(id).addEventListener("input", () => {
    saveForm();
    if (id === "cc") loadContacts();
    updatePreview();
  }));

  // Build the contact list from whichever source (pasted text or CSV) was used last
  function loadContacts() {
    const cc = $("cc").value.replace(/\D/g, "");
    let res;
    if (source.type === "csv") res = WAShared.buildContacts(WAShared.parseCSV(source.csvText), cc);
    else if (source.type === "paste") res = WAShared.parseNumbersText($("numbers").value, cc);
    else return;
    contacts = res.contacts; tokens = res.keys;
    $("csvInfo").innerHTML = contacts.length
      ? `<b>${contacts.length} valid contacts</b> loaded from ${source.type === "csv" ? "CSV" : "pasted numbers"} (${res.skipped} skipped: invalid or duplicate). Merge fields: ${tokens.map(t => `<code>{${t}}</code>`).join(" ")}`
      : (source.type === "paste" && !$("numbers").value.trim() ? DEFAULT_INFO
         : "No valid contacts found. Numbers need 8-15 digits; a CSV needs a header row and a phone column.");
    updatePreview();
  }

  $("numbers").addEventListener("input", () => {
    source = { type: "paste", csvText: "" };
    $("csv").value = "";
    saveForm();
    loadContacts();
  });

  function updatePreview() {
    $("preview").textContent = contacts.length
      ? WAShared.merge($("message").value, contacts[0].fields)
      : $("message").value;
  }

  async function init() {
    const f = await get("form");
    if (f) { $("message").value = f.message || ""; $("cc").value = f.cc ?? "91"; $("minDelay").value = f.minDelay || 20; $("maxDelay").value = f.maxDelay || 45; $("maxRun").value = f.maxRun || 50; }
    $("csvInfo").innerHTML = DEFAULT_INFO;
    if (f && f.numbers) { $("numbers").value = f.numbers; source = { type: "paste", csvText: "" }; loadContacts(); }
    const c = await get("campaign");
    if (source.type === "none" && c && c.contacts) { contacts = c.contacts; $("csvInfo").textContent = `${contacts.length} contacts loaded from your last session. Paste or upload new numbers to replace them.`; }
    await showAtt();
    updatePreview(); refresh();
  }

  $("csv").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    source = { type: "csv", csvText: await file.text() };
    $("numbers").value = ""; saveForm();
    loadContacts();
  });

  async function showAtt() {
    const a = await get("attachment");
    $("attInfo").textContent = a ? `Attached: ${a.name} (${(a.size / 1024).toFixed(0)} KB)` : "No attachment. If attached, your message is sent as the caption.";
    $("rmAtt").style.display = a ? "inline-block" : "none";
  }
  $("att").addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 16 * 1024 * 1024) { $("attInfo").textContent = "File is over 16 MB - WhatsApp may reject it. Use a smaller file."; return; }
    const fr = new FileReader();
    fr.onload = async () => {
      const type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      await set("attachment", { name: file.name, type, size: file.size, dataUrl: fr.result });
      showAtt();
    };
    fr.readAsDataURL(file);
  });
  $("rmAtt").addEventListener("click", async () => { await set("attachment", null); $("att").value = ""; showAtt(); });

  async function refresh() {
    const s = await get("campaign");
    if (!s) return $("status").textContent = "Ready.";
    const sent = (s.results || []).filter(r => String(r.status).startsWith("sent")).length;
    const failed = (s.results || []).length - sent;
    $("status").textContent = `${s.running ? "RUNNING" : "Stopped"} - ${s.index}/${s.contacts.length} processed, ${sent} sent, ${failed} failed${s.note ? " - " + s.note : ""}`;
  }
  setInterval(refresh, 1500);

  $("startBtn").addEventListener("click", async () => {
    if (!contacts.length) return $("status").textContent = "Paste numbers or upload a CSV first.";
    const message = $("message").value;
    const att = await get("attachment");
    if (!message.trim() && !att) return $("status").textContent = "Write a message or attach a file.";
    const minDelay = Math.max(5, +$("minDelay").value || 20);
    const maxDelay = Math.max(minDelay, +$("maxDelay").value || 45);
    const maxRun = Math.max(1, +$("maxRun").value || 50);
    const sig = [contacts.length, contacts[0].phone, message, att ? att.name : ""].join("|");
    const prev = await get("campaign");
    const resume = prev && prev.sig === sig && prev.index < contacts.length;
    const state = {
      running: true, sig, contacts, message, useAttachment: !!att, minDelay, maxDelay, maxRun,
      index: resume ? prev.index : 0, results: resume ? prev.results : [],
      sentThisRun: 0, fails: 0, note: ""
    };
    await set("campaign", state);
    const c = contacts[state.index];
    const text = state.useAttachment ? "" : WAShared.merge(message, c.fields);
    const url = `https://web.whatsapp.com/send?phone=${c.phone}${text ? "&text=" + encodeURIComponent(text) : ""}`;
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { url, active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else await chrome.tabs.create({ url });
    $("status").textContent = "Started - switch to the WhatsApp tab.";
  });

  const stopNow = async () => {
    const s = await get("campaign");
    if (s) { s.running = false; s.note = "stopped by you"; await set("campaign", s); }
    refresh();
  };
  $("stopBtn").addEventListener("click", stopNow);
  $("stopFab").addEventListener("click", stopNow);
  $("resetBtn").addEventListener("click", async () => {
    const s = await get("campaign");
    if (s) { Object.assign(s, { running: false, index: 0, results: [], sentThisRun: 0, fails: 0, note: "" }); await set("campaign", s); }
    refresh();
  });
  $("dlBtn").addEventListener("click", async () => {
    const s = await get("campaign");
    if (!s || !s.results || !s.results.length) return $("status").textContent = "No results yet.";
    const rows = [["phone", "name", "status", "time"]].concat(s.results.map(r => [r.phone, r.name, r.status, r.time]));
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "wa_sender_report.csv"; a.click();
  });

  init();
})();
