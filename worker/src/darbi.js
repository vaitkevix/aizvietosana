/* SH | Grafika darbi — Logu mazgāšana, Dārzniecība, Pazemes stāvvietu mazgāšana (grafiks pēc intervāla) un Sniega tīrīšana (izsaukums pēc prognozes / vadītāja).
 * Maršruti POST /logi /darz /stav /sniegs  { pin, action, … }.  Lomas portālā: perms[svc] = admin | vaditajs | izpilditajs; portāla admins = admin, citi = skatitajs.
 * Objekti un grupas — no portāla (objects, groups); savas tabulas sv_obj, sv_visit, sv_call, sv_log (kolonna svc). © VAITKEVIX, SIA */
import { personByPin, companyBy } from './portal.js';
import { groupsOf } from './master.js';

const TZ = 'Europe/Riga';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS) });
const fmtD = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtT = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const today = () => fmtD.format(new Date());
const nowStr = () => fmtT.format(new Date()).replace(',', '').slice(0, 16);
export const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const anorm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const lvD = (d) => { const [, m, dd] = d.split('-'); return +dd + '.' + m + '.'; };

/* Katras lietotnes iestatījumi. weather: rain = lietus dienas izlaiž, frost = salnas (t° min) izlaiž */
export const SVC = {
  logi: { name: 'Logu mazgāšana', mode: 'interval', weather: ['rain', 'frost'], maxInt: 400, kind: 'logu_mazg',
    def: { interval: 180, maxQty: 300, season: ['04-01', '10-31'], workdays: [1, 2, 3, 4, 5], rainMm: 2, wetDays: 0, frostC: 3, noticeDays: 0, photoReq: true, veidi: ['Logi', 'Rāmji', 'Palodzes', 'Kāpņu telpas logi'] } },
  darz: { name: 'Dārzniecība', mode: 'interval', weather: ['rain'], maxInt: 120, kind: 'darznieks',
    def: { interval: 14, maxQty: 4000, season: ['04-15', '10-15'], workdays: [1, 2, 3, 4, 5], rainMm: 4, wetDays: 0, frostC: -50, noticeDays: 0, photoReq: true, veidi: ['Ravēšana', 'Krūmu griešana', 'Stādīšana', 'Laistīšana', 'Lapu grābšana', 'Mulčēšana'] } },
  stav: { name: 'Pazemes stāvvietu mazgāšana', mode: 'interval', weather: [], maxInt: 400, kind: 'stav_mazg',
    def: { interval: 180, maxQty: 6000, season: ['01-01', '12-31'], workdays: [1, 2, 3, 4, 5], rainMm: 99, wetDays: 0, frostC: -50, noticeDays: 5, photoReq: true, veidi: ['Grīda nomazgāta', 'Notekas iztīrītas', 'Sienas / kolonnas', 'Atkritumi savākti'] } },
  sniegs: { name: 'Sniega tīrīšana', mode: 'snow', weather: ['snow'], maxInt: 1, kind: 'traktorists',
    def: { snowCm: 3, auto: true, approve: true, photoReq: true, workdays: [1, 2, 3, 4, 5, 6, 7], veidi: ['Brauktuve', 'Ietves', 'Stāvlaukums', 'Kaisīts'] } }
};
export const SVC_KEYS = Object.keys(SVC);

async function kv(db, k) { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); try { return r ? JSON.parse(r.v) : null; } catch (e) { return null; } }
const kvSet = (db, k, v) => db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, JSON.stringify(v));
async function cfgOf(db, svc) { return Object.assign({}, SVC[svc].def, (await kv(db, 'sv:' + svc + ':cfg')) || {}); }
const log = (db, svc, t) => db.prepare('INSERT INTO sv_log (svc, laiks, teksts) VALUES (?, ?, ?)').bind(svc, nowStr(), String(t).slice(0, 300));

/* Diena nederīga darbam laikapstākļu dēļ. wx: { datums: { r: mm, s: cm sniega, t: min °C } } */
function badWx(svc, C, wx, d) {
  const W = SVC[svc].weather;
  for (let i = 0; i <= (C.wetDays || 0); i++) { const x = wx[addDays(d, -i)] || {}; if (W.indexOf('rain') !== -1 && (x.r || 0) >= C.rainMm) return 'lietus'; }
  const x = wx[d] || {};
  if (W.indexOf('frost') !== -1 && x.t != null && x.t < C.frostC) return 'sals';
  return '';
}
export function nextDay(svc, from, cfg, wx) {
  const C = Object.assign({}, SVC[svc].def, cfg || {});
  let d = from; for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (C.workdays.indexOf(dow(d)) !== -1 && !badWx(svc, C, wx, d)) return d;
  return from;
}

/* ---------- Grafika aprēķins (tīra funkcija) — intervāla lietotnēm ----------
 * objs: [{anorm, adrese, qty, intervals, brigade}], visits: [{id, anorm, datums, statuss, prio}] → { moves, adds } */
export function plan(svc, objs, visits, cfg, wx, t) {
  const C = Object.assign({}, SVC[svc].def, cfg || {});
  const inSeason = (d) => { const md = d.slice(5); return C.season[0] <= C.season[1] ? md >= C.season[0] && md <= C.season[1] : md >= C.season[0] || md <= C.season[1]; };
  const okDay = (d) => C.workdays.indexOf(dow(d)) !== -1 && !badWx(svc, C, wx, d);
  const qOf = {}; objs.forEach(o => qOf[o.anorm] = +o.qty || 0);
  const load = {}; const addLoad = (d, a) => { load[d] = (load[d] || 0) + (qOf[a] || 0); };
  const firstDay = (from, need) => { let d = from; for (let i = 0; i < 90; i++, d = addDays(d, 1)) if (okDay(d) && (load[d] || 0) + need <= C.maxQty) return d;
    d = from; for (let i = 0; i < 90; i++, d = addDays(d, 1)) if (okDay(d)) return d; return from; };
  const moves = [], adds = [];
  const plans = visits.filter(v => v.statuss === 'plan');
  plans.filter(v => v.datums < t).sort((a, b) => a.datums.localeCompare(b.datums)).forEach(v => {
    const d = firstDay(t, qOf[v.anorm] || 0); moves.push({ id: v.id, datums: d, why: 'nepaspēts ' + lvD(v.datums) }); v.datums = d; v.prio = 1; });
  plans.filter(v => v.datums >= t && v.datums <= addDays(t, 3) && C.workdays.indexOf(dow(v.datums)) !== -1 && badWx(svc, C, wx, v.datums)).forEach(v => {
    const why = badWx(svc, C, wx, v.datums), d = firstDay(addDays(v.datums, 1), qOf[v.anorm] || 0); moves.push({ id: v.id, datums: d, why: why + ' ' + lvD(v.datums) }); v.datums = d; v.prio = 1; });
  plans.filter(v => v.datums >= t).forEach(v => addLoad(v.datums, v.anorm));
  const lastDone = {}; visits.filter(v => v.statuss === 'done').forEach(v => { if (!lastDone[v.anorm] || v.datums > lastDone[v.anorm]) lastDone[v.anorm] = v.datums; });
  const hasPlan = new Set(plans.filter(v => v.datums >= t).map(v => v.anorm));
  const earliest = addDays(t, C.noticeDays || 0);   // stāvvietām — iedzīvotājiem jāpaziņo iepriekš
  objs.filter(o => (+o.qty > 0) && !hasPlan.has(o.anorm))
    .map(o => ({ o, due: lastDone[o.anorm] ? addDays(lastDone[o.anorm], +o.intervals || C.interval) : t }))
    .sort((a, b) => a.due.localeCompare(b.due))
    .forEach(({ o, due }) => {
      let from = due < earliest ? earliest : due;
      if (!inSeason(from)) { const y = +from.slice(0, 4), s = y + '-' + C.season[0]; from = from < s ? s : (y + 1) + '-' + C.season[0]; }
      if (from > addDays(t, 400)) return;
      const d = firstDay(from, +o.qty); adds.push({ anorm: o.anorm, adrese: o.adrese, datums: d, brigade: o.brigade || '' }); addLoad(d, o.anorm);
    });
  return { moves, adds };
}

const objsOf = async (db, svc) => (await db.prepare('SELECT s.anorm, o.adrese, s.qty, s.intervals, s.brigade, s.seq FROM sv_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.svc = ? AND s.aktivs = 1').bind(svc).all()).results || [];
export async function schedule(db, svc) {
  if (SVC[svc].mode !== 'interval') return { moved: 0, added: 0 };
  const C = await cfgOf(db, svc), t = today(), wx = (await kv(db, 'sv:wx')) || {};
  const objs = await objsOf(db, svc);
  const visits = (await db.prepare("SELECT id, anorm, datums, statuss, prio FROM sv_visit WHERE svc = ? AND (statuss = 'plan' OR (statuss = 'done' AND datums >= ?))").bind(svc, addDays(t, -800)).all()).results || [];
  const r = plan(svc, objs, visits, C, wx, t), st = [];
  const adrOf = {}; objs.forEach(o => adrOf[o.anorm] = o.adrese); const vOf = {}; visits.forEach(v => vOf[v.id] = v);
  r.moves.forEach(m => { st.push(db.prepare('UPDATE sv_visit SET datums = ?, prio = 1, parcelts = parcelts + 1 WHERE id = ?').bind(m.datums, m.id));
    st.push(log(db, svc, (adrOf[(vOf[m.id] || {}).anorm] || 'Adrese') + ' → ' + lvD(m.datums) + ' (' + m.why + ')')); });
  r.adds.forEach(a => st.push(db.prepare('INSERT INTO sv_visit (id, svc, anorm, adrese, datums, brigade, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(uid(), svc, a.anorm, a.adrese, a.datums, a.brigade, nowStr())));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  return { moved: r.moves.length, added: r.adds.length };
}

/* ---------- Sniegs: izsaukums ---------- */
async function callVisits(db, svc, call) {
  const objs = (await db.prepare('SELECT s.anorm, o.adrese, s.brigade, s.seq FROM sv_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.svc = ? AND s.aktivs = 1 ORDER BY s.brigade, s.seq, o.adrese').bind(svc).all()).results || [];
  const have = new Set(((await db.prepare('SELECT anorm FROM sv_visit WHERE izs = ?').bind(call.id).all()).results || []).map(r => r.anorm));
  const st = objs.filter(o => !have.has(o.anorm)).map(o => db.prepare('INSERT INTO sv_visit (id, svc, anorm, adrese, datums, brigade, izs, seq, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), svc, o.anorm, o.adrese, call.datums, o.brigade || '', call.id, +o.seq || 0, nowStr()));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  return st.length;
}
export async function snowCheck(db, svc) {
  const C = await cfgOf(db, svc), wx = (await kv(db, 'sv:wx')) || {}, t = today(); let made = 0;
  if (!C.auto) return 0;
  for (const d of [t, addDays(t, 1)]) {
    const cm = +((wx[d] || {}).s || 0); if (cm < C.snowCm) continue;
    if (await db.prepare('SELECT id FROM sv_call WHERE svc = ? AND datums = ?').bind(svc, d).first()) continue;
    const call = { id: uid(), datums: d, statuss: C.approve ? 'gaida' : 'aktivs' };
    await db.batch([db.prepare('INSERT INTO sv_call (id, svc, datums, statuss, cm, avots, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(call.id, svc, d, call.statuss, cm, 'prognoze', nowStr()),
      log(db, svc, 'Prognoze ' + cm.toFixed(1) + ' cm ' + lvD(d) + ' → izsaukums ' + (C.approve ? 'gaida apstiprinājumu' : 'aktīvs'))]);
    if (call.statuss === 'aktivs') await callVisits(db, svc, call);
    made++;
  }
  return made;
}

/* Laikapstākļi (Open-Meteo, bez atslēgas) — Rīga: lietus mm, sniegs cm, t° min */
export async function fetchWx(db) {
  const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11&daily=precipitation_sum,snowfall_sum,temperature_2m_min&timezone=Europe%2FRiga&past_days=2&forecast_days=6');
  if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  const j = await r.json(), m = {}, D = j.daily || {};
  (D.time || []).forEach((d, i) => m[d] = { r: +(D.precipitation_sum[i] || 0), s: +(D.snowfall_sum[i] || 0), t: D.temperature_2m_min[i] == null ? null : +D.temperature_2m_min[i] });
  await db.batch([kvSet(db, 'sv:wx', m), kvSet(db, 'sv:wxAt', Date.now())]);
  return m;
}
function geoQuery(adr) {
  let a = String(adr || '').trim(), city = 'Rīga';
  if (/^\s*j\s*\|/i.test(a)) city = 'Jūrmala';
  a = a.replace(/^\s*(j|vn[iī])\s*\|\s*/i, '').replace(/,?\s*latvija.*$/i, '').replace(/,?\s*lv-?\d{4}\b/i, '');
  a = a.replace(/(\d+[a-z]?)\s*,\s*\d+[a-z]?(\s*,\s*\d+[a-z]?)*/i, '$1').replace(/\s+k-\d+/i, '');
  if (!/r[iī]ga|j[uū]rmala|mārupe|marupe|ķekava|kekava|salaspils|ādaži|adazi/i.test(a)) a += ', ' + city;
  return a + ', Latvija';
}
/* Koordinātas: vispirms no pļaušanas / citām lietotnēm (tā pati adrese), tad Nominatim (≤ 1/s) */
export async function geocode(db, svc, max) {
  await db.prepare('UPDATE sv_obj SET lat = (SELECT p.lat FROM pl_obj p WHERE p.anorm = sv_obj.anorm AND p.lat IS NOT NULL), lng = (SELECT p.lng FROM pl_obj p WHERE p.anorm = sv_obj.anorm AND p.lat IS NOT NULL) WHERE svc = ? AND lat IS NULL AND EXISTS (SELECT 1 FROM pl_obj p WHERE p.anorm = sv_obj.anorm AND p.lat IS NOT NULL)').bind(svc).run().catch(() => 0);
  await db.prepare('UPDATE sv_obj SET lat = (SELECT x.lat FROM sv_obj x WHERE x.anorm = sv_obj.anorm AND x.lat IS NOT NULL LIMIT 1), lng = (SELECT x.lng FROM sv_obj x WHERE x.anorm = sv_obj.anorm AND x.lat IS NOT NULL LIMIT 1) WHERE svc = ? AND lat IS NULL AND EXISTS (SELECT 1 FROM sv_obj x WHERE x.anorm = sv_obj.anorm AND x.lat IS NOT NULL)').bind(svc).run().catch(() => 0);
  const L = (await db.prepare('SELECT s.anorm, o.adrese FROM sv_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.svc = ? AND s.aktivs = 1 AND s.lat IS NULL LIMIT ?').bind(svc, max || 10).all()).results || [];
  let ok = 0, miss = 0;
  for (const o of L) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=lv&q=' + encodeURIComponent(geoQuery(o.adrese)), { headers: { 'User-Agent': 'SH-darbi/1.0 (+https://vaitkevix.cloud/sh/)', 'Accept-Language': 'lv' } });
      const j = r.ok ? await r.json() : [];
      if (j && j[0]) { await db.prepare('UPDATE sv_obj SET lat = ?, lng = ? WHERE anorm = ? AND lat IS NULL').bind(+j[0].lat, +j[0].lon, o.anorm).run(); ok++; }
      else { await db.prepare('UPDATE sv_obj SET lat = 0, lng = 0 WHERE svc = ? AND anorm = ?').bind(svc, o.anorm).run(); miss++; }
    } catch (e) { break; }
    await new Promise(res => setTimeout(res, 1100));
  }
  const left = (await db.prepare('SELECT COUNT(*) n FROM sv_obj WHERE svc = ? AND aktivs = 1 AND lat IS NULL').bind(svc).first()).n;
  return { found: ok, notFound: miss, left };
}

/* Cron (ik 30 min): laikapstākļi ik 3 h + sniega pārbaude; intervāla grafiki reizi dienā no 05:00 */
export async function svCron(env) {
  const db = env.DB, t = today(), h = +fmtT.format(new Date()).slice(11, 13);
  const at = +((await kv(db, 'sv:wxAt')) || 0);
  if (Date.now() - at > 3 * 3600e3) await fetchWx(db).catch(e => console.error('sv wx', e));
  await snowCheck(db, 'sniegs').catch(e => console.error('sv snow', e));
  if (h < 5 || (await kv(db, 'sv:ran')) === t) return;
  await db.batch([kvSet(db, 'sv:ran', t)]);
  for (const s of SVC_KEYS) { await schedule(db, s).catch(e => console.error('sv sched ' + s, e)); await geocode(db, s, 5).catch(() => 0); }
}

/* ---------- API ---------- */
const ROLE_W = { admin: 3, vaditajs: 2, izpilditajs: 1, skatitajs: 0 };
export async function darbi(request, env, X, svc) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!SVC[svc]) return out({ ok: false, error: 'Nezināma lietotne' }, 404);
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB, S = SVC[svc];
  let me = await personByPin(db, b.pin);
  if (!me && b.pin) { const c = await companyBy(db, 'pass', b.pin); if (c && c.perms[svc]) me = c; }   // darbu izpildītājs (SIA) ar pilnvaru
  const role = me && (me.company ? me.perms[svc] : ((me.perms || {})[svc] || ((me.perms || {}).portal === 'admin' ? 'admin' : 'skatitajs')));
  if (!me || !role) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN vai nav piekļuves: ' + S.name, code: 'auth' }); }
  const need = (r) => { if ((ROLE_W[role] || 0) < ROLE_W[r]) throw new Error('Jums ir tikai skatīšanās tiesības'); };
  const a = b.action;
  try {
    if (a === 'boot') {
      const t = today(), from = b.from || addDays(t, -7), to = b.to || addDays(t, 21);
      const objects = (await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, o.piekluve, s.qty, s.intervals, s.aktivs, s.brigade, s.piezime, s.veidi, s.seq, s.lat, s.lng FROM objects o LEFT JOIN sv_obj s ON s.anorm = o.anorm AND s.svc = ? ORDER BY o.ord').bind(svc).all()).results || [];
      if (ROLE_W[role] < 1) objects.forEach(o => { o.piekluve = ''; });
      let visits, calls = [];
      if (S.mode === 'snow') {
        calls = (await db.prepare('SELECT * FROM sv_call WHERE svc = ? ORDER BY datums DESC, izveidots DESC LIMIT 12').bind(svc).all()).results || [];
        const ids = calls.slice(0, 6).map(c => c.id);
        visits = ids.length ? ((await db.prepare('SELECT * FROM sv_visit WHERE izs IN (' + ids.map(() => '?').join(',') + ') ORDER BY brigade, seq, adrese').bind(...ids).all()).results || []) : [];
      } else visits = (await db.prepare('SELECT * FROM sv_visit WHERE svc = ? AND datums >= ? AND datums <= ? ORDER BY datums, prio DESC, adrese').bind(svc, from, to).all()).results || [];
      if (role === 'izpilditajs' && me.company) visits = visits.filter(v => !v.brigade || v.brigade === me.name);   // SIA redz savu maršrutu
      const last = (await db.prepare("SELECT anorm, MAX(datums) d FROM sv_visit WHERE svc = ? AND statuss = 'done' GROUP BY anorm").bind(svc).all()).results || [];
      const logs = ROLE_W[role] < 2 ? [] : ((await db.prepare('SELECT laiks, teksts FROM sv_log WHERE svc = ? ORDER BY id DESC LIMIT 30').bind(svc).all()).results || []);
      const comps = ((await db.prepare("SELECT name, kinds FROM companies WHERE active = 1").all()).results || []).filter(c => String(c.kinds).split(',').indexOf(S.kind) !== -1).map(c => c.name);
      return out({ ok: true, svc, me: { name: me.name, role, company: !!me.company }, today: t, cfg: await cfgOf(db, svc), wx: (await kv(db, 'sv:wx')) || {}, objects, visits, calls, last, logs, crews: comps,
        groups: (await groupsOf(db).catch(() => [])).map(g => ({ name: g.name, adreses: g.adreses })) });
    }
    if (a === 'month') {
      const ym = String(b.ym || today().slice(0, 7)).slice(0, 7);
      const visits = (await db.prepare('SELECT id, anorm, adrese, datums, statuss, prio, parcelts, foto, izpilditajs, laiks, iemesls, pazinots, izs FROM sv_visit WHERE svc = ? AND substr(datums, 1, 7) = ? ORDER BY datums').bind(svc, ym).all()).results || [];
      return out({ ok: true, visits });
    }
    if (a === 'obj') {
      const k = anorm(b.anorm || b.adrese);
      const hist = (await db.prepare('SELECT id, datums, statuss, laiks, sakums, izpilditajs, foto, iemesls, piezime, parcelts FROM sv_visit WHERE svc = ? AND anorm = ? ORDER BY datums DESC LIMIT 40').bind(svc, k).all()).results || [];
      return out({ ok: true, hist });
    }
    if (a === 'geo') { need('vaditajs'); return out(Object.assign({ ok: true }, await geocode(db, svc, 12))); }
    if (a === 'saveObj') {
      need('vaditajs');
      const list = (Array.isArray(b.objs) ? b.objs : [b]).slice(0, 500), st = [], C = await cfgOf(db, svc);
      for (const o of list) {
        const k = anorm(o.adrese || o.anorm); if (!k) continue;
        const act = !(o.aktivs === false || o.aktivs === 0);
        st.push(db.prepare('INSERT INTO sv_obj (svc, anorm, qty, intervals, aktivs, brigade, piezime, veidi, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(svc, anorm) DO UPDATE SET qty = excluded.qty, intervals = excluded.intervals, aktivs = excluded.aktivs, brigade = excluded.brigade, piezime = excluded.piezime, veidi = excluded.veidi, seq = excluded.seq')
          .bind(svc, k, Math.max(0, Math.min(1e6, +o.qty || 0)), Math.max(0, Math.min(S.maxInt, Math.round(+o.intervals || 0))), act ? 1 : 0, String(o.brigade || '').slice(0, 80), String(o.piezime || '').slice(0, 300),
            (Array.isArray(o.veidi) ? o.veidi : String(o.veidi || '').split(',')).map(x => String(x).trim()).filter(x => C.veidi.indexOf(x) !== -1).join(','), Math.max(0, Math.min(9999, Math.round(+o.seq || 0)))));
        if (!act) st.push(db.prepare("DELETE FROM sv_visit WHERE svc = ? AND anorm = ? AND statuss = 'plan' AND izs = ''").bind(svc, k));
        else st.push(db.prepare("UPDATE sv_visit SET brigade = ? WHERE svc = ? AND anorm = ? AND statuss = 'plan'").bind(String(o.brigade || '').slice(0, 80), svc, k));
      }
      for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
      return out(Object.assign({ ok: true }, await schedule(db, svc)));
    }
    /* sniegs: izsaukt / apstiprināt / atcelt / pabeigt */
    if (a === 'callNow' || a === 'approve' || a === 'cancel' || a === 'finish') {
      need('vaditajs'); if (S.mode !== 'snow') throw new Error('Tikai sniega tīrīšanai');
      if (a === 'callNow') {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') ? b.datums : today();
        let c = await db.prepare("SELECT * FROM sv_call WHERE svc = ? AND datums = ? AND statuss IN ('gaida', 'aktivs')").bind(svc, d).first();
        if (!c) { c = { id: uid(), datums: d }; await db.batch([db.prepare("INSERT INTO sv_call (id, svc, datums, statuss, cm, avots, izveidots, apstiprinaja) VALUES (?, ?, ?, 'aktivs', ?, 'vaditajs', ?, ?)").bind(c.id, svc, d, +(((await kv(db, 'sv:wx')) || {})[d] || {}).s || 0, nowStr(), me.name), log(db, svc, me.name + ' izsauca tīrīšanu ' + lvD(d))]); }
        else await db.batch([db.prepare("UPDATE sv_call SET statuss = 'aktivs', apstiprinaja = ? WHERE id = ?").bind(me.name, c.id)]);
        return out({ ok: true, added: await callVisits(db, svc, c) });
      }
      const c = await db.prepare('SELECT * FROM sv_call WHERE id = ? AND svc = ?').bind(String(b.id || ''), svc).first(); if (!c) throw new Error('Izsaukums nav atrasts');
      if (a === 'approve') { await db.batch([db.prepare("UPDATE sv_call SET statuss = 'aktivs', apstiprinaja = ? WHERE id = ?").bind(me.name, c.id), log(db, svc, me.name + ' apstiprināja izsaukumu ' + lvD(c.datums))]); return out({ ok: true, added: await callVisits(db, svc, c) }); }
      if (a === 'cancel') { await db.batch([db.prepare("UPDATE sv_call SET statuss = 'atcelts', beigts = ? WHERE id = ?").bind(nowStr(), c.id), db.prepare("DELETE FROM sv_visit WHERE izs = ? AND statuss = 'plan' AND sakums = ''").bind(c.id), log(db, svc, me.name + ' atcēla izsaukumu ' + lvD(c.datums))]); return out({ ok: true }); }
      await db.batch([db.prepare("UPDATE sv_call SET statuss = 'beigts', beigts = ? WHERE id = ?").bind(nowStr(), c.id), log(db, svc, me.name + ' pabeidza izsaukumu ' + lvD(c.datums))]);
      return out({ ok: true });
    }
    if (a === 'start') {
      need('izpilditajs');
      const v = await db.prepare('SELECT * FROM sv_visit WHERE id = ? AND svc = ?').bind(String(b.id || ''), svc).first(); if (!v) throw new Error('Nav atrasts — atjaunojiet');
      if (!v.sakums) await db.batch([db.prepare('UPDATE sv_visit SET sakums = ?, izpilditajs = ? WHERE id = ?').bind(nowStr().slice(11), me.name, v.id)]);
      return out({ ok: true });
    }
    if (a === 'notice') {
      need('vaditajs');
      await db.batch([db.prepare("UPDATE sv_visit SET pazinots = ? WHERE id = ? AND svc = ?").bind(b.undo ? '' : today() + ' ' + me.name, String(b.id || ''), svc)]);
      return out({ ok: true });
    }
    if (a === 'done' || a === 'cant') {
      need('izpilditajs');
      const v = await db.prepare('SELECT * FROM sv_visit WHERE id = ? AND svc = ?').bind(String(b.id || ''), svc).first();
      if (!v) throw new Error('Nav atrasts — atjaunojiet');
      if (v.statuss === 'done') return out({ ok: true, already: true });
      if (a === 'done') {
        const C = await cfgOf(db, svc), photos = (b.photos || []).filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(String(p))).slice(0, 4);
        if (C.photoReq && !photos.length) throw new Error('Pievienojiet bildi pēc darba');
        const ids = photos.length ? await X.savePhotos({ datums: v.datums, adrese: S.name + ' · ' + v.adrese }, photos) : [];
        await db.batch([db.prepare("UPDATE sv_visit SET statuss = 'done', datums = ?, laiks = ?, izpilditajs = ?, foto = ?, piezime = ? WHERE id = ?")
          .bind(S.mode === 'snow' ? v.datums : today(), nowStr().slice(11), me.name, ids.join(','), String(b.piezime || '').slice(0, 300), v.id)]);
      } else if (S.mode === 'snow') {
        const why = String(b.iemesls || 'Nevar').slice(0, 60);
        await db.batch([db.prepare("UPDATE sv_visit SET statuss = 'cant', iemesls = ?, izpilditajs = ?, laiks = ? WHERE id = ?").bind(why, me.name, nowStr().slice(11), v.id), log(db, svc, v.adrese + ': ' + why.toLowerCase() + ' (' + me.name + ')')]);
      } else {
        const why = String(b.iemesls || 'Nepaspēja').slice(0, 60), C = await cfgOf(db, svc), wx = (await kv(db, 'sv:wx')) || {};
        const d = nextDay(svc, addDays(v.datums > today() ? v.datums : today(), 1), C, wx);
        await db.batch([db.prepare('UPDATE sv_visit SET datums = ?, prio = 1, parcelts = parcelts + 1, iemesls = ?, izpilditajs = ?, pazinots = ? WHERE id = ?').bind(d, why, me.name, svc === 'stav' ? '' : v.pazinots, v.id),
          log(db, svc, v.adrese + ' → ' + lvD(d) + ' (' + why.toLowerCase() + ', ' + me.name + ')')]);
      }
      return out(Object.assign({ ok: true }, await schedule(db, svc)));
    }
    if (a === 'reopen') {   // sniegs: atzīmēts «nevar» → atpakaļ maršrutā
      need('vaditajs');
      await db.batch([db.prepare("UPDATE sv_visit SET statuss = 'plan', iemesls = '' WHERE id = ? AND svc = ? AND statuss = 'cant'").bind(String(b.id || ''), svc)]);
      return out({ ok: true });
    }
    if (a === 'saveCfg') {
      need('admin'); const c = b.cfg || {}, C = await cfgOf(db, svc), n = Object.assign({}, C);
      const num = (k, lo, hi) => { if (c[k] != null && c[k] !== '' && !isNaN(+c[k])) n[k] = Math.max(lo, Math.min(hi, +c[k])); };
      num('rainMm', 0, 99); num('wetDays', 0, 3); num('maxQty', 1, 1e6); num('interval', 1, S.maxInt); num('frostC', -50, 20); num('noticeDays', 0, 30); num('snowCm', 0.5, 100);
      ['wetDays', 'interval', 'noticeDays'].forEach(k => n[k] = Math.round(n[k]));
      if (typeof c.photoReq === 'boolean') n.photoReq = c.photoReq;
      if (typeof c.auto === 'boolean') n.auto = c.auto;
      if (typeof c.approve === 'boolean') n.approve = c.approve;
      if (Array.isArray(c.workdays) && c.workdays.length) n.workdays = c.workdays.map(Number).filter(x => x >= 1 && x <= 7);
      if (Array.isArray(c.season) && /^\d\d-\d\d$/.test(c.season[0]) && /^\d\d-\d\d$/.test(c.season[1])) n.season = c.season;
      if (Array.isArray(c.veidi)) { const v = c.veidi.map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 12); if (v.length) n.veidi = v; }
      await db.batch([kvSet(db, 'sv:' + svc + ':cfg', n)]);
      return out(Object.assign({ ok: true, cfg: n }, await schedule(db, svc)));
    }
    if (a === 'replan') {
      need('vaditajs'); await fetchWx(db).catch(() => 0);
      if (S.mode === 'snow') return out({ ok: true, added: await snowCheck(db, svc), moved: 0 });
      return out(Object.assign({ ok: true }, await schedule(db, svc)));
    }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
