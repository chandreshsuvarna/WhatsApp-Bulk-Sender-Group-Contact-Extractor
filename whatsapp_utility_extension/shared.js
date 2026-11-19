(function (g) {
  const normKey = (k) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // Replace {field} tokens with values from the CSV row
  function merge(tpl, fields) {
    return String(tpl)
      .replace(/\{\s*([^{}]+?)\s*\}/g, (m, k) => {
        const v = fields[normKey(k)];
        return v === undefined ? "" : v;
      })
      .replace(/[ \t]+([,!.?:;])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    const first = text.split(/\r?\n/)[0] || "";
    const delims = [",", ";", "\t"];
    const delim = delims.map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(c => c.trim() !== "")) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur);
    if (row.some(c => c.trim() !== "")) rows.push(row);
    return rows;
  }

  function normPhone(raw, cc) {
    raw = String(raw || "").trim();
    if (!raw || /e\+/i.test(raw)) return "";          // Excel scientific notation = broken number
    let d = raw.replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (cc) {
      if (d.length === 10) d = cc + d;
      else if (d.length === 11 && d.startsWith("0")) d = cc + d.slice(1);
    }
    return d.length >= 8 && d.length <= 15 ? d : "";
  }

  function buildContacts(rows, cc) {
    if (rows.length < 2) return { contacts: [], skipped: 0, keys: [] };
    const keys = rows[0].map(normKey);
    let pi = keys.findIndex(k => /phone|mobile|number|whatsapp|contact|cell/.test(k));
    if (pi < 0) pi = keys.length > 1 ? 1 : 0;
    let ni = keys.findIndex(k => /name/.test(k));
    if (ni < 0) ni = pi === 0 ? -1 : 0;
    const contacts = [], seen = new Set();
    let skipped = 0;
    for (const r of rows.slice(1)) {
      const phone = normPhone(r[pi], cc);
      if (!phone || seen.has(phone)) { skipped++; continue; }
      seen.add(phone);
      const fields = {};
      keys.forEach((k, i) => { if (k) fields[k] = (r[i] || "").trim(); });
      fields.phone = phone;
      if (ni >= 0 && fields.name === undefined) fields.name = (r[ni] || "").trim();
      contacts.push({ phone, fields });
    }
    const tokens = Array.from(new Set(keys.filter(Boolean).concat(["phone"], ni >= 0 ? ["name"] : [])));
    return { contacts, skipped, keys: tokens };
  }

  // Parse numbers pasted into a text box.
  // Accepts: one number per line, "number,name" or "name,number" lines, several numbers separated by
  // commas/semicolons/tabs, "+91 98765 43210" style, or a pasted table with a header row (name,phone,city)
  function parseNumbersText(text, cc) {
    const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { contacts: [], skipped: 0, keys: [] };
    const splitParts = (l) => l.split(/[,;\t]+/).map(p => p.trim()).filter(Boolean);

    // Header row with no phone in it -> treat the paste like a CSV so {city} etc. work in the message
    const firstParts = splitParts(lines[0]);
    if (firstParts.length > 1 && !firstParts.some(p => normPhone(p, cc))) {
      return buildContacts(parseCSV(lines.join("\n")), cc);
    }

    const contacts = [], seen = new Set();
    let skipped = 0;
    for (const line of lines) {
      let parts = splitParts(line);
      let found = parts.map(p => normPhone(p, cc));
      if (!found.some(Boolean) && parts.length === 1) {        // "9876543210 9812345678" separated by spaces
        parts = line.split(/\s+/);
        found = parts.map(p => normPhone(p, cc));
      }
      const phones = [], others = [];
      parts.forEach((p, i) => {
        if (found[i]) {
          phones.push(found[i]);
          // "Rahul 9876543210" -> keep "Rahul" as the name
          const inlineName = p.replace(/[+\d()\-.]/g, " ").replace(/\s+/g, " ").trim();
          if (/[a-z]/i.test(inlineName)) others.push(inlineName);
        } else others.push(p);
      });
      if (!phones.length) { skipped++; continue; }
      const name = phones.length === 1 ? (others[0] || "") : "";
      for (const phone of phones) {
        if (seen.has(phone)) { skipped++; continue; }
        seen.add(phone);
        contacts.push({ phone, fields: { phone, name } });
      }
    }
    return { contacts, skipped, keys: ["name", "phone"] };
  }

  g.WAShared = { merge, parseCSV, buildContacts, parseNumbersText, normKey };
})(typeof window !== "undefined" ? window : globalThis);
