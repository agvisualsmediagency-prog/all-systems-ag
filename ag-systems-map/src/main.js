import { createClient } from "@supabase/supabase-js";
import SEED from "./seed.json";

/* ================= data ================= */
const FREQS = [
  { id: "daily", name: "Daily", color: "#e0453a" },
  { id: "weekly", name: "Weekly", color: "#2b47e6" },
  { id: "15days", name: "Every 15 days", color: "#7a4de8" },
  { id: "monthly", name: "Monthly", color: "#0f8f86" },
  { id: "quarterly", name: "Quarterly", color: "#9a6b00" },
  { id: "event", name: "Per event", color: "#5d6372" },
  { id: "setup", name: "One-time setup", color: "#8a8f9c" }
];
const MODES = { auto: "Automated", hybrid: "AI + human check", manual: "Manual" };
const AV_COLORS = ["#2b47e6", "#c2367a", "#129b4d", "#e2700f", "#7a4de8", "#0f8f86", "#9a6b00", "#d13b3b", "#5d6372"];
const DEFAULT = SEED;

/* ================= state ================= */
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const rid = p => p + "-" + Math.random().toString(36).slice(2, 8);
let doc = clone(DEFAULT), db = null, canWrite = true, dirty = false, saving = false, queued = false, saveTimer = null, loaded = false, undoStack = [];
const ui = { dept: null, owner: null, freq: null, mode: null, view: "map", drawer: null, armed: null, hoverSys: null, calMonth: defaultMonth(), calDaily: false };
function defaultMonth() { const d = new Date(), m = d.getDate() > 20 ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : new Date(d.getFullYear(), d.getMonth(), 1); return m.getFullYear() + "-" + String(m.getMonth() + 1).padStart(2, "0"); }
const DOC_PATH = "company/main";

const dept = id => doc.departments.find(d => d.id === id) || { name: "—", color: "#888", code: "?" };
const person = id => doc.people.find(p => p.id === id) || { id, name: "Unassigned", role: "" };
const freqOf = id => FREQS.find(f => f.id === id) || { id: "", name: "No frequency", color: "#999" };
const sysSteps = s => s.stages.flatMap(st => st.steps);
const allSteps = () => doc.systems.flatMap(sysSteps);
function locate(id) {
  for (const sys of doc.systems) for (let si = 0; si < sys.stages.length; si++) {
    const stage = sys.stages[si], idx = stage.steps.findIndex(s => s.id === id);
    if (idx >= 0) return { sys, stage, si, idx, step: stage.steps[idx] };
  }
  return null;
}
function label(sys, si, i) { return sys.code + (sys.stages.length > 1 ? String.fromCharCode(65 + si) : "") + "." + (i + 1); }
function labelOf(id) { const l = locate(id); return l ? label(l.sys, l.si, l.idx) : ""; }
function av(id) {
  const i = Math.max(0, doc.people.findIndex(p => p.id === id)), p = person(id);
  const ini = p.name.replace(/\(.*\)/, "").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return `<span class="av" style="background:${AV_COLORS[i % AV_COLORS.length]}" title="${esc(p.name)}">${esc(ini)}</span>`;
}
const avs = (ids, big) => `<span class="avs ${big ? "big" : ""}">${(ids || []).map(av).join("")}</span>`;
const names = ids => (ids || []).map(id => person(id).name).join(", ") || "Unassigned";
const counts = st => ({ auto: st.filter(s => s.mode === "auto").length, hybrid: st.filter(s => s.mode === "hybrid").length, manual: st.filter(s => s.mode === "manual").length });
const sysPeople = sys => [...new Set(sysSteps(sys).flatMap(s => s.owners || []).concat((sys.sub || []).flatMap(x => x.owners || [])))];
const visibleSystems = () => doc.systems.filter(s => !ui.dept || s.dept === ui.dept);
function matches(s) {
  return (!ui.owner || (s.owners || []).includes(ui.owner)) && (!ui.freq || s.freq === ui.freq) && (!ui.mode || s.mode === ui.mode);
}

/* ================= persistence (Supabase) ================= */
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL, SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null;
const TABLE = "company_maps", ROW_ID = "main";
let userEmail = "", channel = null, dirtyAfter = false;
function setStatus(text, s) { const el = $("#status"); el.textContent = text; el.dataset.s = s || ""; }
function edit(fn, opts = {}) {
  if (!opts.noUndo) { undoStack.push(JSON.stringify(doc)); if (undoStack.length > 50) undoStack.shift(); }
  fn(doc); dirty = true; if (saving) dirtyAfter = true; render(opts); scheduleSave();
}
function scheduleSave() {
  $("#undoBtn").disabled = !undoStack.length;
  if (!db) { setStatus(supabase ? "Sign in to save changes" : "Demo mode — add Supabase keys to save", "warn"); return; }
  if (!canWrite) { setStatus("View only — your email isn't on the team list", "warn"); return; }
  setStatus("Saving…", "saving");
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
}
async function save() {
  if (!db || !canWrite) return;
  if (saving) { queued = true; return; }
  saving = true;
  doc.rev = (doc.rev || 0) + 1; doc.updatedAt = Math.max(Date.now(), (doc.updatedAt || 0) + 1);
  const { error } = await db.from(TABLE).upsert({ id: ROW_ID, data: clone(doc), updated_at: new Date().toISOString(), updated_by: userEmail });
  if (!error) setStatus("Saved for your team", "saved");
  else if (error.code === "42501") { canWrite = false; setStatus("View only — your email isn't on the team list", "warn"); }
  else setStatus("Couldn't save — will retry on your next edit", "warn");
  saving = false;
  if (queued || dirtyAfter) { queued = false; dirtyAfter = false; save(); } else dirty = false;
}
function undo() { if (!undoStack.length) return; doc = JSON.parse(undoStack.pop()); dirty = true; render(); scheduleSave(); }

/* ----- login ----- */
function showLogin(msg) { $("#login").classList.remove("hidden"); if (msg) $("#loginMsg").textContent = msg; }
function hideLogin() { $("#login").classList.add("hidden"); }
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim(), password = $("#loginPass").value;
  if (!email || !password) return;
  $("#loginBtn").disabled = true; $("#loginMsg").textContent = "Signing in…";
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  $("#loginBtn").disabled = false;
  if (error) { $("#loginMsg").textContent = /invalid/i.test(error.message) ? "Wrong email or password." : "Couldn't sign in: " + error.message; return; }
  $("#loginMsg").textContent = "";
  if (data && data.session) start(data.session);
});
$("#signout").addEventListener("click", async () => { await supabase.auth.signOut(); location.reload(); });
$("#demoBtn").addEventListener("click", () => { hideLogin(); setStatus("Browsing without signing in — changes aren't saved", "warn"); });

async function start(session) {
  if (db) return;
  hideLogin();
  db = supabase; userEmail = (session.user && session.user.email) || "";
  $("#who").textContent = userEmail; $("#signout").classList.remove("hidden");
  setStatus("Loading…", "saving");
  const { data, error } = await db.from(TABLE).select("data").eq("id", ROW_ID).maybeSingle();
  if (error) { setStatus("Couldn't load the saved map — showing the default", "warn"); }
  else if (data && data.data) { doc = clone(data.data); loaded = true; render(); setStatus("Saved for your team", "saved"); }
  else {
    // First run: store the starting map so the whole team sees the same thing.
    doc.updatedAt = Date.now();
    const ins = await db.from(TABLE).insert({ id: ROW_ID, data: clone(doc), updated_at: new Date().toISOString(), updated_by: userEmail });
    if (ins.error && ins.error.code === "42501") { canWrite = false; setStatus("View only — your email isn't on the team list", "warn"); }
    else if (ins.error) setStatus("Couldn't create the map — check the setup steps", "warn");
    else setStatus("Map created for your team", "saved");
  }
  channel = db.channel("company-map")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE, filter: "id=eq." + ROW_ID }, payload => {
      const inc = payload.new && payload.new.data;
      if (inc && !dirty && !saving && (inc.updatedAt || 0) > (doc.updatedAt || 0)) {
        doc = clone(inc); render(); setStatus("Updated by " + (payload.new.updated_by || "your team"), "saved");
      }
    })
    .subscribe();
}
async function boot() {
  render();
  if (!supabase) { setStatus("Demo mode — add Supabase keys to save", "warn"); return; }
  supabase.auth.onAuthStateChange((event, session) => { if (session) start(session); });
  const { data: { session } } = await supabase.auth.getSession();
  if (session) start(session); else showLogin();
}

/* ================= render ================= */
function render(opts = {}) {
  renderCtx(); renderStats(); renderFilterbar();
  $("#mapView").classList.toggle("hidden", ui.view !== "map");
  $("#rhythm").classList.toggle("hidden", ui.view !== "rhythm");
  document.querySelectorAll("[data-view]").forEach(b => { const on = b.dataset.view === ui.view; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  if (ui.view === "map") { renderMap(); renderLanes(); } else renderRhythm();
  if (ui.drawer && !opts.keepDrawer) renderDrawer();
  $("#undoBtn").disabled = !undoStack.length;
}
function renderCtx() {
  const d = ui.dept ? dept(ui.dept) : null;
  $("#ctx").innerHTML = d
    ? `<h2 style="color:${esc(d.color)}">${esc(d.name)}</h2><p>${esc(d.blurb)}</p><span class="tag">${visibleSystems().length} systems · ${visibleSystems().flatMap(sysSteps).length} steps · click the department again to see everything</span>`
    : `<h2>Everything AG runs</h2><p>Every department, system and step — with who owns it and how often it happens. Click any card to edit it. Use “Rhythm &amp; daily blocks” to see each person's morning and close block.</p><span class="tag">${doc.departments.length} departments · ${doc.systems.length} systems · ${allSteps().length} steps</span>`;
}
function renderStats() {
  const st = visibleSystems().flatMap(sysSteps);
  const n = id => st.filter(s => s.freq === id).length;
  const stat = (f, num, lbl) => `<button type="button" class="stat ${ui.freq === f ? "on" : ""}" data-freq="${f}" aria-pressed="${ui.freq === f}"><b style="color:${freqOf(f).color}">${num}</b><span>${lbl}</span></button>`;
  const longer = st.filter(s => ["monthly", "quarterly"].includes(s.freq)).length;
  $("#stats").innerHTML = `<div class="stat"><b>${st.length}</b><span>Steps${ui.dept ? " here" : " in total"}</span></div>` +
    stat("daily", n("daily"), "Daily") + stat("weekly", n("weekly"), "Weekly") + stat("15days", n("15days"), "Every 15 days") +
    `<button type="button" class="stat ${ui.freq === "monthly" ? "on" : ""}" data-freq="monthly"><b style="color:${freqOf("monthly").color}">${longer}</b><span>Monthly + quarterly</span></button>`;
  $("#people").innerHTML = `<span class="lbl">Highlight owner:</span>` + doc.people.map(p =>
    `<button type="button" class="pchip ${ui.owner === p.id ? "on" : ""}" data-owner="${esc(p.id)}" aria-pressed="${ui.owner === p.id}">${av(p.id)}${esc(p.name)} <span style="opacity:.6;font-weight:500">${st.filter(s => (s.owners || []).includes(p.id)).length}</span></button>`).join("") +
    `<button type="button" class="btn" style="padding:3px 10px;font-size:13px" data-act="team">Edit team</button>`;
}
function renderFilterbar() {
  const parts = [];
  if (ui.owner) parts.push("Owner: " + esc(person(ui.owner).name));
  if (ui.freq) parts.push("How often: " + esc(freqOf(ui.freq).name) + (ui.freq === "monthly" ? " + quarterly" : ""));
  if (ui.mode) parts.push("Type: " + esc(MODES[ui.mode]));
  const legend = `<span>Card color:</span> ${["auto", "hybrid", "manual"].map(m => `<button type="button" class="clear" data-mode="${m}" style="${ui.mode === m ? "background:var(--ink);color:var(--bg)" : ""}">${m === "auto" ? "● Automated" : m === "hybrid" ? "◐ AI + check" : "○ Manual"}</button>`).join("")}`;
  $("#filterbar").innerHTML = legend + (parts.length ? `<span style="margin-left:8px">Filtering — ${parts.join(" · ")}</span><button type="button" class="clear" data-act="clearf">Clear filters</button>` : "");
}
function freqMatch(s) { return ui.freq === "monthly" ? ["monthly", "quarterly"].includes(s.freq) : s.freq === ui.freq; }
function isDim(s) { return (ui.owner && !(s.owners || []).includes(ui.owner)) || (ui.freq && !freqMatch(s)) || (ui.mode && s.mode !== ui.mode); }
function bar(c, n) { return `<div class="minibar"><i class="a" style="width:${c.auto / n * 100}%"></i><i class="h" style="width:${c.hybrid / n * 100}%"></i><i class="m" style="width:${c.manual / n * 100}%"></i></div>`; }
function pencil() { return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>`; }
function bolt() { return `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>`; }
function arrow() { return `<svg viewBox="0 0 34 12" aria-hidden="true"><path d="M2 6h26" stroke="currentColor" stroke-width="1.6"/><path d="M26 1.5L32 6l-6 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`; }

function renderMap() {
  const map = $("#map");
  map.style.minWidth = (doc.departments.length * 212) + "px";
  map.innerHTML = `<div class="dgrid" style="--n:${doc.departments.length}">` + doc.departments.map(d => {
    const syss = doc.systems.filter(s => s.dept === d.id), dim = ui.dept && ui.dept !== d.id;
    return `<div class="dcol ${dim ? "dim" : ""}">
      <div class="dk ${ui.dept === d.id ? "on" : ""}" style="--pc:${esc(d.color)}">
        <button type="button" class="edit" data-editdept="${esc(d.id)}" aria-label="Edit ${esc(d.name)}">${pencil()}</button>
        <button type="button" class="sel" data-deptsel="${esc(d.id)}" aria-pressed="${ui.dept === d.id}"><h3>${esc(d.name)}</h3><p>${esc(d.blurb)}</p>
        <div class="cnt">${syss.length} system${syss.length === 1 ? "" : "s"} · ${syss.flatMap(sysSteps).length} steps</div></button>
      </div>
      ${syss.map(s => {
        const st = sysSteps(s), c = counts(st), n = st.length || 1;
        return `<button type="button" class="sn" style="--pc:${esc(d.color)}" data-sys="${esc(s.id)}">
          ${s.branch ? `<span class="branchtag">${esc(s.branch)}</span>` : ""}
          <div class="code">SYSTEM ${esc(s.code)}${s.sub ? ` · <span class="nest">${s.sub.length} systems inside</span>` : ""}</div><h3>${esc(s.name)}</h3>
          ${bar(c, n)}<div class="meta">${st.length} steps · ${esc(s.cadence)}</div>
          <div class="avs">${sysPeople(s).map(av).join("")}</div>
        </button>`;
      }).join("")}
      <button type="button" class="addcard" style="margin:0;min-height:44px;width:auto" data-addsys="${esc(d.id)}">+ System</button>
    </div>`;
  }).join("") + `</div><svg id="mapsvg" aria-hidden="true"><defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs></svg>`;
  requestAnimationFrame(drawLines);
}
function drawLines() {
  const map = $("#map"), svg = $("#mapsvg"); if (!map || !svg || ui.view !== "map") return;
  const box = map.getBoundingClientRect();
  const R = el => { const r = el.getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }; };
  let out = svg.querySelector("defs").outerHTML;
  (doc.flows || []).forEach(f => {
    const ea = map.querySelector(`[data-sys="${CSS.escape(f.from)}"]`), eb = map.querySelector(`[data-sys="${CSS.escape(f.to)}"]`);
    if (!ea || !eb) return;
    const a = R(ea), b = R(eb);
    const hot = ui.hoverSys && (ui.hoverSys === f.from || ui.hoverSys === f.to);
    let d, lx, ly;
    if (Math.abs(a.x - b.x) < 10) {
      const x = a.x + a.w, y1 = a.y + a.h / 2, y2 = b.y + b.h / 2, bulge = 26 + Math.abs(y2 - y1) * 0.12;
      d = `M${x},${y1} C${x + bulge},${y1} ${x + bulge},${y2} ${x + 2},${y2}`; lx = x + bulge * 0.8; ly = (y1 + y2) / 2;
    } else {
      const fwd = b.x > a.x;
      const x1 = fwd ? a.x + a.w : a.x, x2 = fwd ? b.x : b.x + b.w, y1 = a.y + a.h / 2, y2 = b.y + b.h / 2, dx = Math.abs(x2 - x1) * 0.5;
      d = `M${x1},${y1} C${x1 + (fwd ? dx : -dx)},${y1} ${x2 - (fwd ? dx : -dx)},${y2} ${x2 + (fwd ? -2 : 2)},${y2}`; lx = (x1 + x2) / 2; ly = (y1 + y2) / 2 - 4;
    }
    out += `<path class="flow ${hot ? "hot" : ""}" style="color:var(--${hot ? "ink" : "muted"});${ui.hoverSys && !hot ? "opacity:.12" : ""}" marker-end="url(#arr)" d="${d}"/>`;
    out += `<text class="flowlbl ${hot ? "hot" : ""}" x="${lx}" y="${ly}" text-anchor="middle">${esc(f.label)}</text>`;
  });
  svg.innerHTML = out;
}

function renderLanes() {
  const el = $("#lanes");
  const deps = doc.departments.filter(d => !ui.dept || d.id === ui.dept);
  el.innerHTML = deps.map(d => {
    const syss = doc.systems.filter(s => s.dept === d.id);
    return `<div class="depthead" style="--pc:${esc(d.color)}"><i></i><h2>${esc(d.name)}</h2><span>${esc(d.blurb)}</span></div>` +
      syss.map(sys => laneHTML(sys, d)).join("");
  }).join("");
}
function laneHTML(sys, d) {
  const st = sysSteps(sys), c = counts(st), n = st.length || 1;
  const sub = sys.sub ? `<div class="subwrap"><div class="subhead"><b>Systems inside ${esc(sys.name)}</b>${sys.link ? `<a class="btn" href="${esc(sys.link)}" target="_blank" rel="noopener" style="padding:5px 10px;font-size:13px">Open the full Retainer map ↗</a>` : ""}</div>
    <div class="subgrid">${sys.sub.map((x, i) => `<button type="button" class="subcard" data-editsub="${esc(sys.id)}|${i}"><span class="c">${esc(sys.code)}.${esc(x.code)}</span><b>${esc(x.name)}</b><span>${esc(x.short)}</span><div class="row"><span class="fpill" style="--fc:var(--muted)">${esc(x.cadence)}</span>${avs(x.owners)}</div></button>`).join("")}</div></div>` : "";
  return `<section class="lane" style="--pc:${esc(d.color)}" id="lane-${esc(sys.id)}" aria-label="System ${esc(sys.code)}">
    <div class="lanehead">
      <div class="syscode">${esc(sys.code)}</div>
      <div class="lanetitle"><button type="button" data-editsys="${esc(sys.id)}" title="Edit system">${esc(sys.name)}</button><span>${sys.branch ? `<b style="color:var(--pc)">${esc(sys.branch)}</b> · ` : ""}${esc(sys.short)}</span></div>
      <span class="chip">${esc(sys.cadence)}</span>
      <div class="lanepeople" title="People in this system">${avs(sysPeople(sys), true)}<small>${esc(names(sysPeople(sys)))}</small></div>
      <div class="lanebar">${bar(c, n)}<small>${c.auto} auto · ${c.hybrid} AI+check · ${c.manual} manual</small></div>
    </div>${sub}
    ${sys.stages.map((stg, si) => `<div class="stage">
      <div class="stagehead">${sys.stages.length > 1 ? `<span class="letter">${esc(sys.code + String.fromCharCode(65 + si))}</span>` : ""}<b>${esc(stg.name)}</b><span>${esc(stg.when)}</span></div>
      <div class="track">${stg.steps.map((s, i) => (i ? `<div class="conn">${arrow()}</div>` : "") + card(sys, si, i, s)).join("")}
        <button type="button" class="addcard" data-add="${esc(sys.id)}|${esc(stg.id)}">+ Add step</button></div>
    </div>`).join("")}
  </section>`;
}
function card(sys, si, i, s) {
  const f = freqOf(s.freq), dim = isDim(s);
  const cross = [...new Set((s.feeds || []).map(locate).filter(l => l && l.sys.id !== sys.id).map(l => l.sys.code))];
  const tool = s.mode !== "manual" && s.tool ? `<div class="tool">${bolt()}<span>${esc(s.tool)}</span></div>` : "";
  return `<button type="button" class="card ${s.mode} ${ui.drawer && ui.drawer.type === "step" && ui.drawer.id === s.id ? "sel" : ""} ${dim ? "dim" : ""}" data-step="${esc(s.id)}" aria-label="${esc(label(sys, si, i) + " " + s.title + ", " + f.name + ", " + names(s.owners))}">
    <div class="row1"><span class="num">${label(sys, si, i)}</span><span class="fpill" style="--fc:${f.color}">${esc(f.name)}</span></div>
    <div class="t">${esc(s.title)}</div>
    ${s.block ? `<div class="meta2"><span class="blk ${s.block}">${s.block === "morning" ? "☀ Morning block" : "☾ Close block"}</span></div>` : ""}
    <div class="who">${tool}<div class="owners">${avs(s.owners)}<span>${s.mode === "auto" ? "Watched by " : ""}${esc(names(s.owners))}</span></div>${cross.length ? `<span class="feedtag">→ feeds ${esc(cross.join(", "))}</span>` : ""}</div>
  </button>`;
}

/* ---------- Notion calendar prompt ---------- */
const CAL_DS = "collection://3133e319-a799-80ed-8834-000bf9648d9f";
const MAP_URL = window.location.origin;
const NOTION_OWNERS = ["ANDRES", "ESTEBAN", "ISABELLA"];
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function monthName(ym) { const [Y, M] = ym.split("-").map(Number); return new Date(Y, M - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
function datesFor(s, ym) {
  const [Y, M] = ym.split("-").map(Number), last = new Date(Y, M, 0).getDate();
  const D = d => new Date(Y, M - 1, d), iso = d => `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const w = (s.when || "").toLowerCase(), wd = WD.findIndex(x => w.includes(x));
  const days = n => { const o = []; for (let d = 1; d <= last; d++) if (D(d).getDay() === n) o.push(d); return o; };
  const biz = d => { let x = d; while (x > 1 && (D(x).getDay() === 0 || D(x).getDay() === 6)) x--; while (D(x).getDay() === 0 || D(x).getDay() === 6) x++; return x; };
  let out = [];
  if (s.freq === "weekly") out = days(wd >= 0 ? wd : 1);
  else if (s.freq === "15days") out = w.includes("every other") && wd >= 0 ? days(wd).filter((_, i) => i % 2 === 0) : [biz(15), biz(last)];
  else if (s.freq === "monthly") {
    const om = w.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
    if (om) { const k = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3 }[om[1]], a = days(WD.indexOf(om[2])); out = [a[Math.min(k, a.length - 1)]]; }
    else if (w.includes("last") && wd >= 0) { const a = days(wd); out = [a[a.length - 1]]; }
    else if (w.includes("month end") || w.includes("last day")) out = [biz(last)];
    else if (/1st\s*[–-]\s*2nd/.test(w)) out = [biz(2)];
    else if (/\b1st\b/.test(w)) out = [1];
    else if (w.includes("week 4")) out = [biz(22)];
    else if (w.includes("15th")) out = [biz(15)];
    else out = [days(wd >= 0 ? wd : 1)[0]];
  } else if (s.freq === "quarterly") { if ([1, 4, 7, 10].includes(M)) out = [days(1)[0]]; }
  return [...new Set(out)].sort((a, b) => a - b).map(iso);
}
function kindOf(sys, s) {
  if (/meeting/i.test(s.title)) return "Meeting";
  if (sys.id === "o2") return "Retainer";
  return { ms: "Sales & Marketing", ops: "Operations", pm: "Project", fin: "Operations", co: "Operations" }[sys.dept] || "Operations";
}
function splitOwners(ids) {
  const n = (ids || []).map(id => person(id).name);
  return { notion: n.map(x => x.toUpperCase()).filter(x => NOTION_OWNERS.includes(x)), also: n.filter(x => !NOTION_OWNERS.includes(x.toUpperCase())) };
}
function calEntries() {
  const ym = ui.calMonth || defaultMonth(), out = [];
  visibleSystems().forEach(sys => sys.stages.forEach((stg, si) => stg.steps.forEach((s, i) => {
    if (ui.owner && !(s.owners || []).includes(ui.owner)) return;
    datesFor(s, ym).forEach(date => {
      const o = splitOwners(s.owners);
      out.push({ date, name: `${label(sys, si, i)} · ${s.title}`, kind: kindOf(sys, s), owners: o.notion, also: o.also, freq: freqOf(s.freq).name,
        notes: [s.short, s.detail, s.when ? "When: " + s.when : "", s.tool ? "Tool: " + s.tool : "", "System: " + sys.code + " " + sys.name].filter(Boolean).join(" ") });
    });
  })));
  if (ui.calDaily) {
    const [Y, M] = ym.split("-").map(Number), last = new Date(Y, M, 0).getDate();
    const weekdays = []; for (let d = 1; d <= last; d++) { const g = new Date(Y, M - 1, d).getDay(); if (g && g < 6) weekdays.push(`${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`); }
    doc.people.filter(p => !ui.owner || p.id === ui.owner).forEach(p => ["morning", "close"].forEach(b => {
      const items = allSteps().filter(s => s.freq === "daily" && s.block === b && (s.owners || []).includes(p.id) && (!ui.dept || (locate(s.id) || {}).sys.dept === ui.dept));
      if (!items.length) return;
      const o = splitOwners([p.id]);
      weekdays.forEach(date => out.push({ date, name: `${b === "morning" ? "☀ Morning block" : "☾ Close block"} · ${p.name}`, kind: "Operations", owners: o.notion, also: o.also, freq: "Daily",
        notes: "Checklist: " + items.map(s => "[ ] " + s.title).join("; ") }));
    }));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
function calPrompt() {
  const ym = ui.calMonth || defaultMonth(), ents = calEntries(), mn = monthName(ym);
  const scope = [ui.dept ? "department: " + dept(ui.dept).name : "", ui.owner ? "person: " + person(ui.owner).name : ""].filter(Boolean).join(", ");
  return `Put AG's recurring tasks for ${mn} on the Notion GENERAL CALENDAR${scope ? " (" + scope + " only)" : ""}.

Calendar: the GENERAL CALENDAR database in Notion, data source ${CAL_DS}.
Create one page per line below, with these properties:
- Name: exactly as written in the line.
- Date: the line's date as an all-day date (date:Date:start = the date, date:Date:is_datetime = 0).
- Kind: as written (Project, Operations, Retainer, Sales & Marketing or Meeting).
- Owner: only the names listed under Owner (ANDRES, ESTEBAN, ISABELLA). Leave Owner empty if none are listed.
- Status: To do
- Link: ${MAP_URL}
- Page body: the Notes text, plus "Also involved: …" when the line lists other people (VA, editors, shooter, accounting).

Before creating anything, check the calendar for existing pages in ${mn} with the same Name and Date and skip those, so running this twice never duplicates. Create the pages in batches. When you're done, tell me how many you created and how many you skipped.

Entries (${ents.length}):
` + ents.map(e => `${e.date} | ${e.name} | Kind: ${e.kind} | Owner: ${e.owners.join(", ") || "—"} | Also involved: ${e.also.join(", ") || "—"} | ${e.freq} | Notes: ${e.notes}`).join("\n");
}
function calPanel() {
  const ents = calEntries(), by = {};
  ents.forEach(e => { by[e.freq] = (by[e.freq] || 0) + 1; });
  const skipped = visibleSystems().flatMap(sysSteps).filter(s => ["event", "setup"].includes(s.freq) && (!ui.owner || (s.owners || []).includes(ui.owner))).length;
  return `<section class="panel calpanel">
    <div><h2>Put this month on the Notion General Calendar</h2>
      <p>Builds a prompt with every recurring card for the month — its dates, owners and notes. Paste it to Claude and it creates the entries in AG's General Calendar, skipping any that already exist. It follows the filters above (person or department).</p>
      <div class="calsum" style="margin-top:10px">${Object.entries(by).map(([k, v]) => `<span class="chip">${v} ${esc(k.toLowerCase())}</span>`).join("") || `<span class="chip">Nothing recurring for this filter</span>`}${skipped ? `<span class="chip" title="Per-event and one-time cards have no fixed date">${skipped} per-event / setup cards not dated</span>` : ""}</div>
    </div>
    <div class="calctrl">
      <div class="row"><label for="calMonth" class="note" style="font-weight:700">Month</label><input class="inp" type="month" id="calMonth" value="${esc(ui.calMonth)}"></div>
      <label class="row" style="font-weight:600;font-size:13.5px"><input type="checkbox" id="calDaily" ${ui.calDaily ? "checked" : ""}> Also add daily morning &amp; close blocks (one entry per person per weekday)</label>
      <div class="row"><button type="button" class="btn primary" data-act="copycal" ${ents.length ? "" : "disabled"}>Copy calendar prompt · ${ents.length} entries</button><span class="note" id="calMsg"></span></div>
    </div>
    <details><summary>Preview the prompt</summary><pre>${esc(calPrompt())}</pre></details>
  </section>`;
}

/* ---------- rhythm view ---------- */
function renderRhythm() {
  const el = $("#rhythm");
  const pool = visibleSystems().flatMap(sys => sys.stages.flatMap((stg, si) => stg.steps.map((s, i) => ({ s, sys, lab: label(sys, si, i) }))));
  const ppl = doc.people.filter(p => !ui.owner || p.id === ui.owner);
  const item = x => `<button type="button" class="titem" data-step="${esc(x.s.id)}"><i class="${x.s.mode}"></i><b>${esc(x.s.title)}</b><span>${esc(x.sys.code)}</span></button>`;
  const blocks = ppl.map(p => {
    const mine = pool.filter(x => x.s.freq === "daily" && (x.s.owners || []).includes(p.id));
    if (!mine.length) return "";
    const sec = (cls, title, list, empty) => `<div class="bsec"><h4 class="${cls}">${title} <span style="opacity:.6">${list.length}</span></h4>${list.length ? list.map(item).join("") : `<div class="none">${empty}</div>`}</div>`;
    return `<div class="pblock"><header>${av(p.id)}<div><b>${esc(p.name)}</b><br><small>${esc(p.role)}</small></div><span class="tot">${mine.length} daily</span></header>
      ${sec("morning", "☀ Morning block", mine.filter(x => x.s.block === "morning"), "Nothing tagged yet — open a daily card and set its block.")}
      ${sec("day", "During the day", mine.filter(x => !x.s.block), "—")}
      ${sec("close", "☾ Close block", mine.filter(x => x.s.block === "close"), "Nothing tagged yet.")}</div>`;
  }).join("");
  const groups = FREQS.filter(f => f.id !== "daily" && (!ui.freq || freqMatch({ freq: f.id }))).map(f => {
    const rows = pool.filter(x => x.s.freq === f.id && (!ui.owner || (x.s.owners || []).includes(ui.owner)) && (!ui.mode || x.s.mode === ui.mode));
    if (!rows.length) return "";
    return `<section class="freqsec"><header><span class="fpill" style="--fc:${f.color}">${esc(f.name)}</span><h3>${rows.length} task${rows.length === 1 ? "" : "s"}</h3><small>${f.id === "event" ? "Triggered by something happening (a new client, an order, a meeting)" : f.id === "setup" ? "Done once, then it runs" : ""}</small></header>
      <table class="tbl"><tbody>${rows.map(x => `<tr data-step="${esc(x.s.id)}" tabindex="0"><td class="sys">${esc(x.lab)}</td><td><b>${esc(x.s.title)}</b><br><span class="when">${esc(x.sys.name)}</span></td><td class="when">${esc(x.s.when || "")}</td><td><div class="ownrow">${avs(x.s.owners)}${esc(names(x.s.owners))}</div></td></tr>`).join("")}</tbody></table></section>`;
  }).join("");
  const showDaily = !ui.freq || ui.freq === "daily";
  el.innerHTML = calPanel() + (showDaily ? `<div class="maphead"><h2>Daily blocks by person</h2><p>Every daily card, split into the morning block, during the day and the close block. Tag a card's block from its details.</p></div>
    <div class="blocks">${blocks || `<div class="panel">No daily tasks for this filter.</div>`}</div>` : "") +
    (ui.freq === "daily" ? "" : `<div class="maphead" style="margin-top:6px"><h2>Recurring calendar</h2><p>Everything that isn't daily, grouped by how often it happens. Click a row to edit it.</p></div>${groups || `<div class="panel">Nothing for this filter.</div>`}`);
}

/* ================= drawer ================= */
function openDrawer(d) { ui.drawer = d; ui.armed = null; renderDrawer(); $("#drawer").classList.add("on"); $("#drawer").setAttribute("aria-hidden", "false"); $("#scrim").classList.add("on"); if (ui.view === "map") renderLanes(); }
function closeDrawer() { ui.drawer = null; $("#drawer").classList.remove("on"); $("#drawer").setAttribute("aria-hidden", "true"); $("#scrim").classList.remove("on"); if (ui.view === "map") renderLanes(); }
function head(small, title) { return `<div class="dhead"><div><small>${esc(small)}</small><h2>${esc(title)}</h2></div><button type="button" class="x" data-act="close" aria-label="Close">×</button></div>`; }
function armBtn(key, text, armedText) { return `<button type="button" class="btn danger ${ui.armed === key ? "armed" : ""}" data-arm="${esc(key)}">${ui.armed === key ? armedText : text}</button>`; }
function renderDrawer() {
  const d = ui.drawer, el = $("#drawer"); if (!d) return;
  if (el.contains(document.activeElement) && document.activeElement.matches("input,textarea") && !d.force) return;
  d.force = false;
  const tools = new Set(); allSteps().forEach(s => s.tool && tools.add(s.tool));
  $("#toolList").innerHTML = [...tools].map(t => `<option value="${esc(t)}">`).join("");
  let html = "";
  if (d.type === "step") html = stepDrawer(d.id);
  else if (d.type === "sys") html = sysDrawer(d.id);
  else if (d.type === "dept") html = deptDrawer(d.id);
  else if (d.type === "sub") html = subDrawer(d.id);
  else if (d.type === "team") html = teamDrawer();
  else if (d.type === "prompt") html = head("CALENDAR PROMPT", monthName(ui.calMonth)) + `<div class="dbody"><p class="note">Copying was blocked here. Select all the text below (Ctrl/Cmd+A inside the box), copy it, and paste it to Claude.</p><textarea class="promptbox" readonly>${esc(calPrompt())}</textarea></div>`;
  if (!html) { closeDrawer(); return; }
  el.innerHTML = html;
}
function ownerPicker(owners) {
  return `<div class="ownpick">${doc.people.map(p => { const on = (owners || []).includes(p.id); return `<label class="${on ? "on" : ""}"><input type="checkbox" data-own="${esc(p.id)}" ${on ? "checked" : ""}>${av(p.id)}${esc(p.name)}</label>`; }).join("")}</div>`;
}
function stepDrawer(id) {
  const l = locate(id); if (!l) return "";
  const s = l.step, lab = label(l.sys, l.si, l.idx);
  const all = doc.systems.map(sys => `<optgroup label="${esc(sys.code)} · ${esc(sys.name)}">` + sys.stages.map((stg, si) => stg.steps.map((x, i) => x.id === id || (s.feeds || []).includes(x.id) ? "" : `<option value="${esc(x.id)}">${esc(label(sys, si, i) + " " + x.title)}</option>`).join("")).join("") + `</optgroup>`).join("");
  const into = allSteps().filter(x => (x.feeds || []).includes(id));
  return head(`STEP ${lab} · ${l.sys.name.toUpperCase()}`, s.title) + `<div class="dbody">
    <div class="field"><label for="f-title">Card name</label><input class="inp" id="f-title" data-f="title" value="${esc(s.title)}"></div>
    <div class="field"><label for="f-short">Short summary (shown on the card hover)</label><input class="inp" id="f-short" data-f="short" value="${esc(s.short)}"></div>
    <div class="field"><span class="lab">Who's in charge (1–3 people)</span>${ownerPicker(s.owners)}<p class="note">${(s.owners || []).length > 3 ? "Tip: more than 3 owners usually means nobody owns it." : "First person picked is the main owner."}</p></div>
    <div class="two">
      <div class="field"><label for="f-freq">How often</label><select class="inp" id="f-freq" data-fsel="freq">${FREQS.map(f => `<option value="${f.id}" ${f.id === s.freq ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="f-block">Daily block</label><select class="inp" id="f-block" data-fsel="block"><option value="" ${!s.block ? "selected" : ""}>During the day</option><option value="morning" ${s.block === "morning" ? "selected" : ""}>☀ Morning block</option><option value="close" ${s.block === "close" ? "selected" : ""}>☾ Close block</option></select></div>
    </div>
    <div class="field"><label for="f-when">When exactly / trigger</label><input class="inp" id="f-when" data-f="when" value="${esc(s.when)}" placeholder="e.g. Monday, 1st of the month, When a client signs"></div>
    <div class="field"><span class="lab">How it runs</span><div class="seg" role="radiogroup" aria-label="How it runs">
      ${["auto", "hybrid", "manual"].map(m => `<button type="button" role="radio" aria-checked="${s.mode === m}" class="${m} ${s.mode === m ? "on" : ""}" data-mode-set="${m}"><i style="background:${m === "hybrid" ? "linear-gradient(90deg,var(--auto) 50%,var(--manual) 50%)" : `var(--${m})`}"></i>${m === "auto" ? "Automated" : m === "hybrid" ? "AI + check" : "Manual"}</button>`).join("")}
    </div></div>
    <div class="field"><label for="f-tool">Tool / AI</label><input class="inp" id="f-tool" list="toolList" data-f="tool" value="${esc(s.tool)}" placeholder="e.g. HubSpot, Claude scheduled task"></div>
    <div class="field"><label for="f-detail">Description</label><textarea class="inp" id="f-detail" data-f="detail" placeholder="What exactly gets done, and what “done” looks like.">${esc(s.detail)}</textarea></div>
    <div class="field"><span class="lab">Feeds into</span><div class="feeds">
      ${(s.feeds || []).map(fid => { const fl = locate(fid); return fl ? `<span class="feed"><button type="button" class="go" data-goto="${esc(fid)}">${esc(label(fl.sys, fl.si, fl.idx))} ${esc(fl.step.title)}</button><button type="button" data-unfeed="${esc(fid)}" aria-label="Remove link">×</button></span>` : ""; }).join("") || `<span class="note">Nothing linked. The next card in the lane follows.</span>`}
    </div><select class="inp" id="f-feed" aria-label="Link to another card"><option value="">+ Link to a card in any system…</option>${all}</select></div>
    ${into.length ? `<div class="field"><span class="lab">Fed by</span><div class="feeds">${into.map(x => `<span class="feed" style="padding-right:10px"><button type="button" class="go" data-goto="${esc(x.id)}">${esc(labelOf(x.id))} ${esc(x.title)}</button></span>`).join("")}</div></div>` : ""}
    <div class="actions">
      <button type="button" class="btn" data-act="left">← Move</button>
      <button type="button" class="btn" data-act="right">Move →</button>
      <button type="button" class="btn" data-act="insert">+ Card after</button>
      <button type="button" class="btn" data-act="dup">Duplicate</button>
      ${armBtn("delstep", "Delete", "Click again to delete")}
    </div></div>`;
}
function sysDrawer(id) {
  const sys = doc.systems.find(s => s.id === id); if (!sys) return "";
  return head(`SYSTEM ${sys.code}`, sys.name) + `<div class="dbody">
    <div class="two"><div class="field"><label for="y-code">Code</label><input class="inp" id="y-code" data-y="code" value="${esc(sys.code)}"></div>
    <div class="field"><label for="y-cad">How often (summary)</label><input class="inp" id="y-cad" data-y="cadence" value="${esc(sys.cadence)}"></div></div>
    <div class="field"><label for="y-name">System name</label><input class="inp" id="y-name" data-y="name" value="${esc(sys.name)}"></div>
    <div class="field"><label for="y-short">What it does</label><input class="inp" id="y-short" data-y="short" value="${esc(sys.short)}"></div>
    <div class="two"><div class="field"><label for="y-dept">Department</label><select class="inp" id="y-dept" data-ysel="dept">${doc.departments.map(d => `<option value="${esc(d.id)}" ${d.id === sys.dept ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="y-branch">Branch label (optional)</label><input class="inp" id="y-branch" data-y="branch" value="${esc(sys.branch || "")}" placeholder="e.g. AG Visuals branch"></div></div>
    <div class="field"><label for="y-link">Link to its own map (optional)</label><input class="inp" id="y-link" data-y="link" value="${esc(sys.link || "")}" placeholder="https://…"></div>
    <div class="field"><span class="lab">Systems inside (optional)</span>${(sys.sub || []).map((x, i) => `<div class="stagerow"><input class="inp" aria-label="Inner system name" data-sub="${i}|name" value="${esc(x.name)}"><input class="inp" aria-label="How often" data-sub="${i}|cadence" value="${esc(x.cadence)}">${armBtn("delsub:" + i, "×", "Remove?")}</div>`).join("")}
      <button type="button" class="btn" data-act="addsub" style="align-self:flex-start">+ System inside</button></div>
    <div class="field"><span class="lab">Stages (name · when)</span>${sys.stages.map(st => `<div class="stagerow"><input class="inp" aria-label="Stage name" data-stg="${esc(st.id)}|name" value="${esc(st.name)}"><input class="inp" aria-label="Stage timing" data-stg="${esc(st.id)}|when" value="${esc(st.when)}">${sys.stages.length > 1 ? armBtn("delstage:" + st.id, "×", "Delete " + st.steps.length + " cards?") : "<span></span>"}</div>`).join("")}
      <button type="button" class="btn" data-act="addstage" style="align-self:flex-start">+ Add stage</button></div>
    <div class="actions">${armBtn("delsys", "Delete system", "Click again: delete " + sysSteps(sys).length + " cards")}</div></div>`;
}
function subDrawer(key) {
  const [sid, i] = key.split("|"), sys = doc.systems.find(s => s.id === sid), x = sys && sys.sub && sys.sub[+i]; if (!x) return "";
  return head(`INSIDE ${sys.code} · ${sys.name.toUpperCase()}`, x.name) + `<div class="dbody">
    <div class="field"><label for="u-name">Name</label><input class="inp" id="u-name" data-u="name" value="${esc(x.name)}"></div>
    <div class="field"><label for="u-short">What it does</label><input class="inp" id="u-short" data-u="short" value="${esc(x.short)}"></div>
    <div class="field"><label for="u-cad">How often</label><input class="inp" id="u-cad" data-u="cadence" value="${esc(x.cadence)}"></div>
    <div class="field"><span class="lab">Who's in charge</span>${ownerPicker(x.owners)}</div>
    ${sys.link ? `<a class="btn" href="${esc(sys.link)}" target="_blank" rel="noopener" style="align-self:flex-start">See every step in its own map ↗</a>` : ""}</div>`;
}
function deptDrawer(id) {
  const d = doc.departments.find(x => x.id === id); if (!d) return "";
  return head("DEPARTMENT", d.name) + `<div class="dbody">
    <div class="field"><label for="k-name">Name</label><input class="inp" id="k-name" data-k="name" value="${esc(d.name)}"></div>
    <div class="field"><label for="k-blurb">What it covers</label><textarea class="inp" id="k-blurb" data-k="blurb" style="min-height:80px">${esc(d.blurb)}</textarea></div>
    <div class="two"><div class="field"><label for="k-code">Letter</label><input class="inp" id="k-code" data-k="code" value="${esc(d.code)}"></div>
    <div class="field"><label for="k-color">Color</label><input class="inp" type="color" id="k-color" data-k="color" value="${esc(d.color)}" style="height:40px;padding:4px"></div></div></div>`;
}
function teamDrawer() {
  return head("TEAM", "People and roles") + `<div class="dbody"><p class="note">People you can put in charge of cards. Removing someone takes them off their cards.</p>
    ${doc.people.map(p => `<div class="stagerow"><input class="inp" aria-label="Name" data-pp="${esc(p.id)}|name" value="${esc(p.name)}"><input class="inp" aria-label="Role" data-pp="${esc(p.id)}|role" value="${esc(p.role)}">${armBtn("delperson:" + p.id, "×", "Remove?")}</div>`).join("")}
    <button type="button" class="btn" data-act="addperson" style="align-self:flex-start">+ Add person</button></div>`;
}

/* ================= events ================= */
document.addEventListener("click", e => {
  const t = e.target.closest("button, tr[data-step]"); if (!t) return;
  if (t.closest("#drawer") && t.matches("label *")) return;
  if (t.dataset.view) { ui.view = t.dataset.view; render({ keepDrawer: true }); return; }
  if (t.dataset.step && !t.closest("#drawer")) { hideTip(); openDrawer({ type: "step", id: t.dataset.step }); return; }
  if (t.dataset.add) { const [sid, stid] = t.dataset.add.split("|"); addStep(sid, stid, -1); return; }
  if (t.dataset.addsys) { addSystem(t.dataset.addsys); return; }
  if (t.dataset.editsys) { openDrawer({ type: "sys", id: t.dataset.editsys }); return; }
  if (t.dataset.editsub) { openDrawer({ type: "sub", id: t.dataset.editsub }); return; }
  if (t.dataset.editdept) { openDrawer({ type: "dept", id: t.dataset.editdept }); return; }
  if (t.dataset.deptsel) { ui.dept = ui.dept === t.dataset.deptsel ? null : t.dataset.deptsel; render({ keepDrawer: true }); return; }
  if (t.dataset.sys) { const id = t.dataset.sys, s = doc.systems.find(x => x.id === id); if (ui.dept && s && s.dept !== ui.dept) { ui.dept = null; render({ keepDrawer: true }); } const lane = document.getElementById("lane-" + id); lane && lane.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); return; }
  if (t.dataset.freq) { ui.freq = ui.freq === t.dataset.freq ? null : t.dataset.freq; render({ keepDrawer: true }); return; }
  if (t.dataset.mode) { ui.mode = ui.mode === t.dataset.mode ? null : t.dataset.mode; render({ keepDrawer: true }); return; }
  if (t.dataset.owner) { ui.owner = ui.owner === t.dataset.owner ? null : t.dataset.owner; render({ keepDrawer: true }); return; }
  if (t.dataset.goto) { openDrawer({ type: "step", id: t.dataset.goto }); const c = document.querySelector(`.card[data-step="${CSS.escape(t.dataset.goto)}"]`); c && c.scrollIntoView({ block: "center", inline: "center" }); return; }
  if (t.dataset.unfeed) { const id = ui.drawer.id; edit(() => { const s = locate(id).step; s.feeds = s.feeds.filter(f => f !== t.dataset.unfeed); }); return; }
  if (t.dataset.modeSet) { const id = ui.drawer.id; edit(() => { locate(id).step.mode = t.dataset.modeSet; }); return; }
  if (t.dataset.arm) { if (ui.armed !== t.dataset.arm) { ui.armed = t.dataset.arm; renderDrawer(); return; } doArmed(t.dataset.arm); return; }
  const act = t.dataset.act; if (!act) return;
  if (act === "close") closeDrawer();
  else if (act === "team") openDrawer({ type: "team" });
  else if (act === "clearf") { ui.owner = ui.freq = ui.mode = null; render({ keepDrawer: true }); }
  else if (act === "left" || act === "right") moveStep(ui.drawer.id, act === "left" ? -1 : 1);
  else if (act === "insert") { const l = locate(ui.drawer.id); addStep(l.sys.id, l.stage.id, l.idx + 1); }
  else if (act === "dup") { const l = locate(ui.drawer.id); const c = clone(l.step); c.id = rid("st"); c.title += " (copy)"; edit(() => l.stage.steps.splice(l.idx + 1, 0, c)); openDrawer({ type: "step", id: c.id }); }
  else if (act === "addstage") { const id = ui.drawer.id; edit(d => d.systems.find(s => s.id === id).stages.push({ id: rid("stg"), name: "New stage", when: "", steps: [] })); }
  else if (act === "addsub") { const id = ui.drawer.id; edit(d => { const s = d.systems.find(x => x.id === id); s.sub = s.sub || []; s.sub.push({ code: String(s.sub.length + 1), name: "New inner system", short: "", cadence: "Monthly", owners: [] }); }); }
  else if (act === "copycal") {
    const txt = calPrompt(), msg = $("#calMsg");
    const fallback = () => { openDrawer({ type: "prompt" }); setTimeout(() => { const b = document.querySelector(".promptbox"); if (b) { b.focus(); b.select(); } }, 250); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => { if (msg) msg.textContent = "Copied — paste it to Claude."; }).catch(fallback); else fallback();
  }
  else if (act === "addperson") edit(d => d.people.push({ id: rid("p"), name: "New person", role: "" }));
});
function doArmed(key) {
  ui.armed = null;
  if (key === "delstep") { const id = ui.drawer.id; closeDrawer(); edit(d => { const l = locate(id); l.stage.steps.splice(l.idx, 1); d.systems.forEach(s => sysSteps(s).forEach(x => x.feeds = (x.feeds || []).filter(f => f !== id))); }); }
  else if (key === "delsys") { const id = ui.drawer.id; closeDrawer(); edit(d => { d.systems = d.systems.filter(s => s.id !== id); d.flows = (d.flows || []).filter(f => f.from !== id && f.to !== id); }); }
  else if (key.startsWith("delstage:")) { const stid = key.slice(9), id = ui.drawer.id; edit(d => { const s = d.systems.find(s => s.id === id); s.stages = s.stages.filter(x => x.id !== stid); }); }
  else if (key.startsWith("delsub:")) { const i = +key.slice(7), id = ui.drawer.id; edit(d => { const s = d.systems.find(s => s.id === id); s.sub.splice(i, 1); if (!s.sub.length) delete s.sub; }); }
  else if (key.startsWith("delperson:")) { const pid = key.slice(10); edit(d => { d.people = d.people.filter(p => p.id !== pid); allSteps().forEach(x => { x.owners = (x.owners || []).filter(o => o !== pid); }); }); }
}
let lastField = null;
function coalesce(t) { const same = lastField === t; lastField = t; return same; }
document.addEventListener("input", e => {
  const t = e.target, d = ui.drawer; if (!d || !t.dataset) return;
  if (t.dataset.f) { const id = d.id; edit(() => { locate(id).step[t.dataset.f] = t.value; }, { keepDrawer: true, noUndo: coalesce(t) }); }
  else if (t.dataset.y) { const id = d.id; edit(dd => { const s = dd.systems.find(s => s.id === id); if (t.value || !["branch", "link"].includes(t.dataset.y)) s[t.dataset.y] = t.value; else delete s[t.dataset.y]; }, { keepDrawer: true, noUndo: coalesce(t) }); }
  else if (t.dataset.k) { const id = d.id; edit(dd => { dd.departments.find(x => x.id === id)[t.dataset.k] = t.value; }, { keepDrawer: true, noUndo: coalesce(t) }); }
  else if (t.dataset.u) { const [sid, i] = d.id.split("|"); edit(dd => { dd.systems.find(s => s.id === sid).sub[+i][t.dataset.u] = t.value; }, { keepDrawer: true, noUndo: coalesce(t) }); }
  else if (t.dataset.sub) { const [i, f] = t.dataset.sub.split("|"), id = d.id; edit(dd => { dd.systems.find(s => s.id === id).sub[+i][f] = t.value; }, { keepDrawer: true, noUndo: coalesce(t) }); }
  else if (t.dataset.stg) { const [stid, f] = t.dataset.stg.split("|"), id = d.id; edit(dd => { dd.systems.find(s => s.id === id).stages.find(x => x.id === stid)[f] = t.value; }, { keepDrawer: true, noUndo: coalesce(t) }); }
  else if (t.dataset.pp) { const [pid, f] = t.dataset.pp.split("|"); edit(dd => { dd.people.find(p => p.id === pid)[f] = t.value; }, { keepDrawer: true, noUndo: coalesce(t) }); }
});
document.addEventListener("change", e => {
  if (e.target.id === "calMonth") { ui.calMonth = e.target.value || defaultMonth(); renderRhythm(); return; }
  if (e.target.id === "calDaily") { ui.calDaily = e.target.checked; renderRhythm(); return; }
});
document.addEventListener("change", e => {
  const t = e.target, d = ui.drawer; if (!d || !t.dataset) return;
  if (t.dataset.own) {
    const pid = t.dataset.own, on = t.checked;
    const target = () => d.type === "sub" ? (() => { const [sid, i] = d.id.split("|"); return doc.systems.find(s => s.id === sid).sub[+i]; })() : locate(d.id).step;
    edit(() => { const o = target(); o.owners = on ? [...new Set([...(o.owners || []), pid])] : (o.owners || []).filter(x => x !== pid); }, { keepDrawer: true });
    d.force = true; renderDrawer();
  } else if (t.dataset.fsel) { const id = d.id; edit(() => { locate(id).step[t.dataset.fsel] = t.value; }, { keepDrawer: true }); d.force = true; renderDrawer(); }
  else if (t.dataset.ysel === "dept") { const id = d.id; edit(dd => { dd.systems.find(s => s.id === id).dept = t.value; }, { keepDrawer: true }); }
  else if (t.id === "f-feed" && t.value) { const id = d.id, v = t.value; edit(() => { const s = locate(id).step; s.feeds = [...(s.feeds || []), v]; }); }
});
document.addEventListener("focusout", e => { if (e.target.matches && e.target.matches("#drawer input, #drawer textarea")) { lastField = null; setTimeout(() => { if (ui.drawer && !$("#drawer").contains(document.activeElement)) { ui.drawer.force = true; renderDrawer(); } }, 0); } });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && ui.drawer) closeDrawer();
  if (e.key === "Enter" && e.target.matches && e.target.matches("tr[data-step]")) openDrawer({ type: "step", id: e.target.dataset.step });
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.target.matches("input,textarea")) { e.preventDefault(); undo(); }
});
$("#scrim").addEventListener("click", closeDrawer);
$("#undoBtn").addEventListener("click", undo);

/* hover */
const canHover = matchMedia("(hover: hover)").matches;
document.addEventListener("mouseover", e => {
  const c = e.target.closest(".card[data-step]"), sn = e.target.closest("[data-sys]");
  if (sn && ui.hoverSys !== sn.dataset.sys) { ui.hoverSys = sn.dataset.sys; drawLines(); }
  if (!sn && ui.hoverSys) { ui.hoverSys = null; drawLines(); }
  if (!canHover) return;
  if (c) showTip(c); else hideTip();
});
function showTip(c) {
  const l = locate(c.dataset.step); if (!l) return;
  const s = l.step, tip = $("#tip");
  tip.innerHTML = `<b>${esc(s.title)}</b>${esc(s.short || "No summary yet.")}<small>${esc(freqOf(s.freq).name)}${s.when ? " · " + esc(s.when) : ""} · ${esc(MODES[s.mode])} · click for details</small>`;
  const r = c.getBoundingClientRect();
  let x = r.left, y = r.bottom + 8;
  tip.classList.add("on");
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (x + tw > innerWidth - 12) x = innerWidth - tw - 12;
  if (y + th > innerHeight - 12) y = r.top - th - 8;
  tip.style.left = Math.max(12, x) + "px"; tip.style.top = y + "px";
}
function hideTip() { $("#tip").classList.remove("on"); }
addEventListener("scroll", hideTip, { passive: true });
new ResizeObserver(() => drawLines()).observe(document.getElementById("map"));

/* ================= mutations ================= */
function addStep(sid, stid, at) {
  const st = { id: rid("st"), title: "New card", short: "", detail: "", mode: "manual", owners: [], freq: "weekly", block: "", tool: "", when: "", feeds: [] };
  edit(d => { const stage = d.systems.find(s => s.id === sid).stages.find(x => x.id === stid); if (at < 0) stage.steps.push(st); else stage.steps.splice(at, 0, st); });
  openDrawer({ type: "step", id: st.id });
  setTimeout(() => { const f = $("#f-title"); if (f) { f.focus(); f.select(); } }, 230);
}
function moveStep(id, dir) {
  edit(() => {
    const l = locate(id), steps = l.stage.steps, j = l.idx + dir;
    if (j >= 0 && j < steps.length) { [steps[l.idx], steps[j]] = [steps[j], steps[l.idx]]; return; }
    const nsi = l.si + dir; if (nsi < 0 || nsi >= l.sys.stages.length) return;
    steps.splice(l.idx, 1);
    const ns = l.sys.stages[nsi].steps; dir < 0 ? ns.push(l.step) : ns.unshift(l.step);
  });
}
function addSystem(deptId) {
  const d = dept(deptId), n = doc.systems.filter(s => s.dept === deptId).length + 1;
  const sys = { id: rid("sys"), dept: deptId, code: d.code + n, name: "New system", short: "What this system does", cadence: "Weekly", stages: [{ id: rid("stg"), name: "Main flow", when: "", steps: [] }] };
  edit(dd => dd.systems.push(sys));
  openDrawer({ type: "sys", id: sys.id });
}

boot();
