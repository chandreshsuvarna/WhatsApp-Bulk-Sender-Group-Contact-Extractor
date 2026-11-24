/* ---------- Injected: read WhatsApp Web's local database (IndexedDB) ---------- */
// These run inside the web.whatsapp.com tab, so they must be self-contained.
async function groupsFromStorage() {
  const idOf = v => typeof v === 'string' ? v : (v?._serialized || (v?.user && v?.server ? `${v.user}@${v.server}` : ''));
  try {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('model-storage'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const stores = [...db.objectStoreNames];
    const all = name => new Promise(res => {
      if (!stores.includes(name)) return res([]);
      try { const rq = db.transaction(name, 'readonly').objectStore(name).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); }
      catch (e) { res([]); }
    });
    const [chats, metas] = await Promise.all([all('chat'), all('group-metadata')]);
    db.close();
    const metaById = new Map(metas.map(m => [idOf(m.id), m]));
    const out = new Map();
    const add = (id, fallbackName) => {
      if (!id.endsWith('@g.us')) return;
      const m = metaById.get(id);
      if (m?.isParentGroup || m?.groupType === 'COMMUNITY') return;   // skip community parent shells
      const name = (m?.subject || fallbackName || '').trim();
      if (!name) return;
      out.set(id, { id, name, count: Array.isArray(m?.participants) ? m.participants.length : null });
    };
    chats.forEach(c => add(idOf(c.id), c.name || c.formattedTitle));
    if (!out.size) metas.forEach(m => add(idOf(m.id), m.subject));
    return { ok: out.size > 0, groups: [...out.values()], stores };
  } catch (e) { return { ok: false, groups: [], message: String(e) }; }
}

async function membersFromStorage(groupId) {
  const idOf = v => typeof v === 'string' ? v : (v?._serialized || (v?.user && v?.server ? `${v.user}@${v.server}` : ''));
  const toPhone = id => { const m = /^(\d{6,16})(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(id || ''); return m ? '+' + m[1] : ''; };
  try {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('model-storage'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const stores = [...db.objectStoreNames];
    const all = name => new Promise(res => {
      if (!stores.includes(name)) return res([]);
      try { const rq = db.transaction(name, 'readonly').objectStore(name).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); }
      catch (e) { res([]); }
    });
    const [metas, parts, contactsRaw] = await Promise.all([all('group-metadata'), all('participant'), all('contact')]);
    const lidStores = await Promise.all(stores.filter(s => /lid/i.test(s)).map(all));
    db.close();

    // participants of this group (stored inline or in a separate store depending on version)
    let members = [];
    const meta = metas.find(m => idOf(m.id) === groupId);
    if (Array.isArray(meta?.participants)) members = meta.participants;
    if (!members.length) for (const p of parts) if ((idOf(p.groupId) || idOf(p.id)) === groupId && Array.isArray(p.participants)) members = p.participants;
    if (!members.length) return { ok: false, message: 'Member list not found in local data.' };

    // id -> contact record, plus LID <-> phone-number mapping (in both directions)
    const contactById = new Map(), lidToPn = new Map(), pnToLid = new Map();
    const link = (lid, pn) => { if (lid && pn && lid.endsWith('@lid')) { lidToPn.set(lid, pn); pnToLid.set(pn, lid); } };
    for (const c of contactsRaw) {
      const id = idOf(c.id); contactById.set(id, c);
      link(id, idOf(c.phoneNumber || c.pn));
      link(idOf(c.lid), id.endsWith('@c.us') ? id : '');
    }
    for (const rows of lidStores) for (const r of rows) link(idOf(r.lid || r.lidJid || r.id), idOf(r.pn || r.phoneNumber || r.pnJid));

    const clean = v => (v == null ? '' : String(v)).replace(/^[~\u200e\u200f\s]+/, '').trim();
    const out = [], seen = new Set(); let hidden = 0, noName = 0;
    for (const p of members) {
      const id = idOf(p.id || p);
      const pnId = toPhone(id) ? id : (idOf(p.phoneNumber || p.pn) || lidToPn.get(id) || '');
      const number = toPhone(pnId);
      if (!number) { hidden++; continue; }
      if (seen.has(number)) continue; seen.add(number);
      // every record that might describe this person
      const lidId = id.endsWith('@lid') ? id : (pnToLid.get(pnId) || idOf(p.lid) || '');
      const recs = [contactById.get(pnId), contactById.get(lidId), contactById.get(id)].filter(Boolean);
      const pick = fields => { for (const r of recs) for (const f of fields) { const v = clean(r[f]); if (v) return v; } return ''; };
      // WhatsApp profile name first (what the person set themselves), then the name you saved them as
      const name = pick(['pushname', 'notify', 'pushName']) || pick(['name', 'shortName', 'verifiedName', 'businessName']) || clean(p.pushname || p.name);
      if (!name) noName++;
      out.push({ name: name || 'Unknown', number });
    }
    return { ok: true, contacts: out, hidden, noName };
  } catch (e) { return { ok: false, message: 'Could not read WhatsApp local data: ' + e }; }
}

/* ---------- Fallback: read the visible page (DOM) ---------- */
// WhatsApp changes its DOM frequently. Look for known chat-row containers and
// title-bearing chat elements with nearby row ancestors; accept explicit group
// icons/ARIA hints OR the sender:message preview used for group messages.
function findWhatsAppGroups(){
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const rows=new Set(document.querySelectorAll('[data-testid*="cell-frame"], [role="listitem"], [role="row"]'));
  for(const title of document.querySelectorAll('span[title], [data-testid*="cell-frame"] [title]')){
    let parent=title;for(let i=0;i<9&&parent;i++,parent=parent.parentElement){if(parent.matches?.('[data-testid*="cell-frame"], [role="listitem"], [role="row"]'))rows.add(parent);}
  }
  const output=[],seen=new Set();
  for(const row of rows){
    if(!visible(row))continue;
    const titles=[...row.querySelectorAll('[title]')].map(e=>(e.getAttribute('title')||'').trim()).filter(Boolean);
    let name=titles.find(t=>t&&!/^\+?\d[\d\s().-]{6,}\d$/.test(t))||'';
    if(!name){const spans=[...row.querySelectorAll('span')].map(e=>(e.textContent||'').trim()).filter(t=>t&&!/^\+?\d[\d\s().-]{6,}\d$/.test(t));name=spans[0]||'';}
    if(!name||/^(chats|archived|status|channels|communities|search|unread|favourites)$/i.test(name))continue;
    const evidence=[row.getAttribute('aria-label')||'',...titles,...[...row.querySelectorAll('[data-icon],[data-testid],[aria-label]')].map(e=>[e.getAttribute('data-icon'),e.getAttribute('data-testid'),e.getAttribute('aria-label')].filter(Boolean).join(' '))].join(' ');
    const iconCue=/group|community|default-group/i.test(evidence);
    const text=(row.innerText||'').replace(/\u200e|\u200f/g,' ').trim();
    const senderCue=/(?:^|\n)\s*[\p{L}\p{N}][^\n:]{0,45}:\s*\S/u.test(text);
    if(!iconCue&&!senderCue)continue;
    const key=name.toLocaleLowerCase();if(seen.has(key))continue;seen.add(key);output.push({name});
  }
  return output;
}

async function openGroupAndGetMembers(groupName){
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let target=null;
  const possible=[...document.querySelectorAll('[data-testid*="cell-frame"], [role="listitem"], [role="row"]')];
  for(const el of document.querySelectorAll('span[title], [data-testid*="cell-frame"] [title]')){let p=el;for(let i=0;i<9&&p;i++,p=p.parentElement){if(p.matches?.('[data-testid*="cell-frame"], [role="listitem"], [role="row"]'))possible.push(p);}}
  target=possible.find(row=>visible(row)&&[...row.querySelectorAll('[title]')].some(e=>(e.getAttribute('title')||'').trim()===groupName));
  if(!target)return{ok:false,message:'The selected group row is not visible now. Load the group list again and select it.'};
  target.click();await sleep(850);
  const header=[...document.querySelectorAll('header [title],header [role="button"],header span')].find(e=>visible(e)&&((e.getAttribute('title')||e.textContent||'').trim()===groupName));
  if(header){(header.closest('[role="button"]')||header).click();await sleep(700);}
  let dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
  if(!dialogs.length){const info=[...document.querySelectorAll('[role="button"],button,[title]')].find(e=>visible(e)&&/group info|participants|participant/i.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')+' '+(e.innerText||'')));if(info){info.click();await sleep(700);dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);}}
  if(!dialogs.length)return{ok:false,message:'The group opened, but its info panel was not detected. Open the group name and participant list, then retry.'};
  const phone=/(?:\+\s?)?(?:\d[\d\s().-]{6,}\d)/;let result=[];
  for(const dialog of dialogs)for(const el of [...dialog.querySelectorAll('[role="listitem"],[role="button"],[data-testid*="cell-frame"]')].filter(visible)){
    const text=(el.innerText||'').trim(),match=text.match(phone);if(!match)continue;
    const number=match[0].replace(/\s+/g,' ').trim();const title=[...el.querySelectorAll('[title]')].map(n=>(n.getAttribute('title')||'').trim()).find(v=>v&&!phone.test(v))||'';
    result.push({name:(title||text.replace(match[0],'').replace(/[\n\r]+/g,' ').trim()||'Unknown').slice(0,160),number});
  }
  const seen=new Set();result=result.filter(c=>{const key=c.number.replace(/\D/g,'');if(!key||seen.has(key))return false;seen.add(key);return true;});
  return{ok:true,groupName,contacts:result};
}

(() => {
const $ = id => document.getElementById(id);
let groups = [];      // [{id, name, count}]
let contacts = [];    // [{name, number}]
let selectedGroup = '';

/* ---------- Tabs ---------- */
document.querySelectorAll('.tabBtn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabBtn').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tabPane').forEach(p => p.hidden = p.id !== b.dataset.pane);
}));

/* ---------- 1. Load groups ---------- */
$('exLoadGroups').addEventListener('click', async () => {
  $('exLoadGroups').disabled = true;
  $('exGroupSelect').disabled = $('exGroupFilter').disabled = true;
  $('exScan').disabled = true;
  $('exDetails').hidden = true;
  try {
    const tab = await getWhatsAppTab();
    if (!tab) return;
    setStatus('Reading your WhatsApp groups…');
    let list = [];
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: groupsFromStorage });
      if (r?.result?.ok) list = r.result.groups;
    } catch (e) { /* fall through to DOM */ }
    if (!list.length) {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: findWhatsAppGroups });
      list = (r?.result || []).map(g => ({ id: '', name: g.name, count: null }));
    }
    groups = list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    $('exGroupFilter').value = '';
    renderGroupOptions();
    if (!groups.length) { setStatus('No groups found. Make sure WhatsApp Web has finished loading, then try again.'); return; }
    $('exGroupSelect').disabled = $('exGroupFilter').disabled = false;
    setStatus(`${groups.length} group${groups.length === 1 ? '' : 's'} found.`);
  } catch (e) {
    setStatus(e?.message || 'Could not read WhatsApp Web. Refresh the tab and try again.');
  } finally { $('exLoadGroups').disabled = false; }
});

function renderGroupOptions() {
  const q = $('exGroupFilter').value.trim().toLowerCase();
  const select = $('exGroupSelect');
  select.replaceChildren();
  const shown = groups.map((g, i) => ({ g, i })).filter(x => !q || x.g.name.toLowerCase().includes(q));
  if (!groups.length) { select.add(new Option('No groups found', '')); return; }
  select.add(new Option(shown.length ? `Choose from ${shown.length} group${shown.length === 1 ? '' : 's'}…` : 'No match', ''));
  shown.forEach(({ g, i }) => select.add(new Option(g.count ? `${g.name} (${g.count})` : g.name, String(i))));
  $('exScan').disabled = true;
}
$('exGroupFilter').addEventListener('input', renderGroupOptions);
$('exGroupSelect').addEventListener('change', () => {
  const g = groups[Number($('exGroupSelect').value)];
  selectedGroup = g?.name || '';
  $('exScan').disabled = !g || $('exGroupSelect').value === '';
  $('exDetails').hidden = true; contacts = [];
});

/* ---------- 2. Get members ---------- */
$('exScan').addEventListener('click', async () => {
  if ($('exGroupSelect').value === '') { setStatus('Select a group first.'); return; }
  const group = groups[Number($('exGroupSelect').value)];
  if (!group) { setStatus('Select a group first.'); return; }
  $('exScan').disabled = true;
  setExportButtons(false);
  $('exDetails').hidden = true;
  try {
    const tab = await getWhatsAppTab(); if (!tab) return;
    setStatus(`Reading members of “${group.name}”…`);
    let result = null;
    if (group.id) {
      try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: membersFromStorage, args: [group.id] });
        result = r?.result;
      } catch (e) { /* fall through */ }
    }
    if (!result?.ok || !result.contacts?.length) {
      if (await senderRunning()) { setStatus('Stop the bulk sender first: the fallback method clicks around in the WhatsApp tab.'); return; }
      setStatus(`Opening “${group.name}” and reading its participant list…`);
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: openGroupAndGetMembers, args: [group.name] });
      const dom = r?.result;
      if (dom?.ok && dom.contacts?.length) result = { ok: true, contacts: dom.contacts, hidden: 0 };
      else if (!result?.ok) result = dom;
    }
    if (!result?.ok) { setStatus(result?.message || 'Could not read the selected group.'); return; }

    contacts = result.contacts || [];
    $('exGroupName').textContent = group.name;
    $('exCount').textContent = `${contacts.length} member${contacts.length === 1 ? '' : 's'} with phone numbers` +
      (result.noName ? ` · ${result.noName} without a profile name` : '') +
      (result.hidden ? ` · ${result.hidden} skipped (number hidden by WhatsApp)` : '');
    const preview = $('exPreview'); preview.replaceChildren();
    contacts.slice(0, 40).forEach(c => {
      const row = document.createElement('div'); row.className = 'contact';
      const n = document.createElement('span'); n.textContent = c.name;
      const p = document.createElement('span'); p.textContent = c.number;
      row.append(n, p); preview.append(row);
    });
    $('exDetails').hidden = false;
    setExportButtons(contacts.length > 0);
    setStatus(contacts.length ? 'Ready — download, or send these contacts to the bulk sender.' : 'No phone numbers were available for this group.');
  } catch (e) {
    setStatus(e?.message || 'Could not read the group. Refresh WhatsApp Web and try again.');
  } finally { $('exScan').disabled = false; }
});

function setExportButtons(on) { $('exCsv').disabled = $('exXlsx').disabled = $('exToSender').disabled = !on; }
async function senderRunning() {
  const s = await new Promise(r => chrome.storage.local.get('campaign', x => r(x.campaign)));
  return !!(s && s.running);
}

/* ---------- 3. Export / hand over to the sender ---------- */
$('exCsv').addEventListener('click', () => {
  if (!contacts.length) return;
  const rows = [['Name', 'Phone Number'], ...contacts.map(c => [csvText(c.name), csvPhone(c.number)])];
  const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeName(selectedGroup)}_contacts.csv`);
});
$('exXlsx').addEventListener('click', () => {
  if (!contacts.length) return;
  if (!window.XLSX) { setStatus('Excel export unavailable; use CSV instead.'); return; }
  const sheet = XLSX.utils.aoa_to_sheet([['Name', 'Phone Number'], ...contacts.map(c => [c.name, c.number])]);
  sheet['!cols'] = [{ wch: 30 }, { wch: 22 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Group Contacts');
  download(new Blob([XLSX.write(book, { bookType: 'xlsx', type: 'array' })],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(selectedGroup)}_contacts.xlsx`);
});
// Fill the bulk sender's contact box with the extracted members ("phone,name" per line)
$('exToSender').addEventListener('click', () => {
  if (!contacts.length) return;
  const lines = contacts.map(c => {
    const phone = String(c.number).replace(/\D/g, '');
    const name = (c.name && c.name !== 'Unknown' ? c.name : '').replace(/[,;\t\r\n]+/g, ' ').trim();
    return name ? `${phone},${name}` : phone;
  });
  const box = $('numbers');
  box.value = lines.join('\n');
  box.dispatchEvent(new Event('input', { bubbles: true }));   // lets app.js parse + save it
  document.querySelector('.tabBtn[data-pane="paneSender"]').click();
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// The app lives in its own tab, so look for the WhatsApp Web tab instead of the "active" tab.
async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tabs.length) { setStatus('Open web.whatsapp.com in a Chrome tab first, wait for chats to load, then try again.'); return null; }
  return tabs.find(t => t.active) || tabs[0];
}
function setStatus(t) { $('exStatus').textContent = t; }
function csvText(v) { let s = String(v ?? ''); if (/^\s*[=+@\-]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }
function csvPhone(v) { return `"=""${String(v ?? '').replace(/[^\d+]/g, '')}"""`; }
function safeName(s) { return String(s || 'group').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 90) || 'group'; }
function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1200); }
})();
