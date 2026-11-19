document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const say = (t) => { $("status").textContent = t; };
  const get = () => new Promise(r => chrome.storage.local.get("campaign", x => r(x.campaign)));
  const set = (c) => new Promise(r => chrome.storage.local.set({ campaign: c }, r));

  function parseContacts() {
    return $("numbers").value.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const [num, ...rest] = l.split(",");
      return { phone: num.replace(/\D/g, ""), name: rest.join(",").trim() };
    }).filter(c => c.phone.length >= 8);
  }

  function buildUrl(c, tpl) {
    const text = tpl.replace(/\{name\}/gi, c.name || "").replace(/ +([,!.])/g, "$1").trim();
    return `https://web.whatsapp.com/send?phone=${c.phone}&text=${encodeURIComponent(text)}`;
  }

  async function refresh() {
    const s = await get();
    if (!s) return say("");
    const sent = (s.results || []).filter(r => r.status === "sent").length;
    const failed = (s.results || []).filter(r => r.status !== "sent").length;
    say(`${s.running ? "RUNNING" : "Stopped"} - ${s.index}/${s.contacts.length} processed, ${sent} sent, ${failed} failed${s.note ? " - " + s.note : ""}`);
  }

  get().then(s => {
    if (!s) return;
    $("numbers").value = s.rawNumbers || "";
    $("message").value = s.message || "";
    $("minDelay").value = s.minDelay; $("maxDelay").value = s.maxDelay; $("maxRun").value = s.maxRun;
    refresh();
  });
  setInterval(refresh, 1500);

  $("startBtn").addEventListener("click", async () => {
    const contacts = parseContacts();
    const message = $("message").value;
    if (!contacts.length) return say("Add at least one valid number.");
    if (!message.trim()) return say("Type a message first.");
    let minDelay = Math.max(5, +$("minDelay").value || 20);
    let maxDelay = Math.max(minDelay, +$("maxDelay").value || 45);
    const maxRun = Math.max(1, +$("maxRun").value || 50);

    let s = await get();
    const same = s && s.rawNumbers === $("numbers").value && s.message === message;
    const state = {
      running: true, contacts, message, minDelay, maxDelay, maxRun,
      rawNumbers: $("numbers").value,
      index: same ? s.index : 0,
      results: same ? s.results : [],
      sentThisRun: 0, note: ""
    };
    if (state.index >= contacts.length) { state.index = 0; state.results = []; }
    await set(state);

    const url = buildUrl(contacts[state.index], message);
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { url, active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
    say("Started...");
  });

  $("stopBtn").addEventListener("click", async () => {
    const s = await get();
    if (s) { s.running = false; s.note = "stopped by you"; await set(s); }
    refresh();
  });

  $("resetBtn").addEventListener("click", async () => {
    const s = await get();
    if (s) { s.running = false; s.index = 0; s.results = []; s.sentThisRun = 0; s.note = ""; await set(s); }
    refresh();
  });

  $("dlBtn").addEventListener("click", async () => {
    const s = await get();
    if (!s || !s.results || !s.results.length) return say("No results yet.");
    const rows = [["phone", "name", "status", "time"]].concat(
      s.results.map(r => [r.phone, r.name, r.status, r.time]));
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "wa_sender_report.csv";
    a.click();
  });
});
