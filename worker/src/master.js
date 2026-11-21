/* SH | Pamatdati — viens saraksts visām lietotnēm: objekti, cilvēki, uzņēmumi, saraksti. © VAITKEVIX, SIA
 * Galvenais ir portāls (D1). Vecās lietotņu lapas (Adreses, Cilveki, SIA, Pasutitaji, Kurjeri, Materiali, Objekti, DarbuVeidi)
 * tiek atjaunotas automātiski, lai lietotnes strādā kā līdz šim. */
import { people, peopleStmts, usersStmts, cleanPerms } from './portal.js';

export const LIST_KINDS = { materiali: 'Materiāli', bankas: 'Bankas', atv_veidi: 'Atvaļinājuma veidi', amati: 'Amati', tel_kodi: 'Tālruņa kodi' };
export const KINDS = { izvedejs: 'Izvedējs', kurjers: 'Kurjers', darba_devejs: 'Darba devējs' };
export const normA = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
export const normN = (s) => normA(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const anorm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // kā Aizvietošanā
const stripPfx = (s) => normN(s).replace(/^(kk|ir|ee) /, '').replace(/^(j|vni) ?\| ?/, '');
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const kvSet = (db, k, v) => db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, String(v));

export async function master(db) {
  const [objects, types, companies, lists, ppl, review] = await Promise.all([
    all(db, 'SELECT adrese, vaditajs, grupa, piekluve FROM objects ORDER BY ord, adrese'),
    all(db, 'SELECT name, grp FROM types ORDER BY ord, name'),
    all(db, 'SELECT name, kinds, pass, phone, active FROM companies ORDER BY ord, name'),
    all(db, 'SELECT kind, value FROM lists ORDER BY kind, ord, value'),
    people(db), kvGet(db, 'masterReview')]);
  const L = {}; Object.keys(LIST_KINDS).forEach(k => L[k] = []); lists.forEach(r => (L[r.kind] = L[r.kind] || []).push(r.value));
  return { objects, types: types.map(t => ({ name: t.name, group: t.grp })), companies: companies.map(c => ({ name: c.name, kinds: c.kinds ? c.kinds.split(',') : [], pass: c.pass, phone: c.phone, active: !!c.active })),
    lists: L, people: ppl, review: review ? JSON.parse(review) : [], mode: (await kvGet(db, 'masterMode')) === '1' };
}

/* ---------- Saglabāšana ---------- */
export function objectsStmts(db, list) {
  const st = [db.prepare('DELETE FROM objects')];
  const seen = new Set();
  list.forEach((o, i) => { const a = String(o.adrese || '').replace(/\s+/g, ' ').trim(); const k = anorm(a); if (!a || seen.has(k)) return; seen.add(k);
    st.push(db.prepare('INSERT INTO objects (anorm, adrese, vaditajs, grupa, piekluve, ord) VALUES (?, ?, ?, ?, ?, ?)').bind(k, a, o.vaditajs || '', o.grupa || 'SH objekti', o.piekluve || '', i)); });
  return st;
}
export function companiesStmts(db, list) {
  const st = [db.prepare('DELETE FROM companies')];
  const seen = new Set();
  list.forEach((c, i) => { const n = String(c.name || '').replace(/\s+/g, ' ').trim(); if (!n || seen.has(normN(n))) return; seen.add(normN(n));
    const kinds = (c.kinds || []).filter(k => KINDS[k]);
    st.push(db.prepare('INSERT INTO companies (name, kinds, pass, phone, ord, active) VALUES (?, ?, ?, ?, ?, ?)').bind(n, kinds.join(','), String(c.pass || '').trim().toUpperCase(), c.phone || '', i, c.active === false ? 0 : 1)); });
  return st;
}
export function listsStmts(db, L) {
  const st = [db.prepare('DELETE FROM lists')];
  Object.keys(LIST_KINDS).forEach(k => { const seen = new Set(); (L[k] || []).forEach((v, i) => { v = String(v || '').trim(); if (!v || seen.has(normA(v))) return; seen.add(normA(v));
    st.push(db.prepare('INSERT INTO lists (kind, value, ord) VALUES (?, ?, ?)').bind(k, v, i)); }); });
  return st;
}
export function typesStmts(db, list) {
  const st = [db.prepare('DELETE FROM types')];
  list.forEach((t, i) => { if (t && t.name) st.push(db.prepare('INSERT OR REPLACE INTO types (name, grp, ord) VALUES (?, ?, ?)').bind(String(t.name).trim(), t.group || 'Papilddarbs', i)); });
  return st;
}

/* ---------- Pirmais imports no visām lietotnēm (dublikātus apvieno tikai, ja pilnīgi vienādi) ---------- */
const rowsOf = (raw) => { if (!raw || raw.length < 2) return { head: (raw && raw[0]) || [], rows: [] }; return { head: raw[0].map(h => String(h).trim()), rows: raw.slice(1).filter(r => String(r[0] || '').trim()) }; };
const colOf = (head, re) => head.findIndex(h => re.test(h));

export async function importAll(db, src) {
  const review = [];
  const M = await master(db);
  // --- Objekti ---
  const objs = M.objects.map(o => Object.assign({}, o)), oIdx = {};
  objs.forEach(o => oIdx[normA(o.adrese)] = o);
  const addObj = (a, piekluve, from) => {
    a = String(a || '').replace(/\s+/g, ' ').trim(); if (!a) return;
    const k = normA(a);
    if (oIdx[k]) { if (piekluve && !oIdx[k].piekluve) oIdx[k].piekluve = piekluve; return; }
    const sim = objs.find(o => stripPfx(o.adrese) === stripPfx(a));
    if (sim) review.push(['Objekts', a + '  ↔  ' + sim.adrese, 'Atstāti abi', 'Vai tā ir viena adrese? Ja jā — izdzēsiet lieko portālā']);
    const o = { adrese: a, vaditajs: '', grupa: 'SH objekti', piekluve: piekluve || '' }; objs.push(o); oIdx[k] = o;
    if (from) o._from = from;
  };
  const izv = src.izv || {}, kais = src.kais || {}, pers = src.pers || {};
  { const { head, rows } = rowsOf(izv.Adreses); const pc = colOf(head, /^piekļuve/i); rows.forEach(r => addObj(r[0], pc > 0 ? String(r[pc] || '').trim() : '', 'izv')); }
  { const { rows } = rowsOf(kais.Adreses); rows.forEach(r => addObj(r[0], '', 'kais')); }
  (pers.objekti || []).forEach(a => addObj(a, '', 'pers'));

  // --- Cilvēki ---
  const ppl = M.people.map(p => Object.assign({}, p, { perms: Object.assign({}, p.perms) })), pIdx = {};
  ppl.forEach(p => pIdx[normN(p.name)] = p);
  const pins = new Set(ppl.map(p => String(p.pin)));
  const newPin = () => { let x; do { x = String(100000 + Math.floor(Math.random() * 900000)); } while (pins.has(x)); pins.add(x); return x; };
  const addReq = (name, app, pass, phone) => {
    name = String(name || '').replace(/\s+/g, ' ').trim(); if (!name) return;
    let p = pIdx[normN(name)];
    if (!p) {
      const first = normN(name).split(' ')[0];
      const sim = ppl.find(x => normN(x.name).split(' ')[0] === first);
      if (sim) review.push(['Cilvēks', name + '  ↔  ' + sim.name, 'Atstāti abi', 'Vai tas ir viens cilvēks? Ja jā — izdzēsiet lieko un piešķiriet tiesības otram']);
      pass = String(pass || '').trim();
      const pin = pass && !pins.has(pass) ? (pins.add(pass), pass) : newPin();
      p = { name, pin, color: '', phone: '', email: '', active: true, perms: {} }; ppl.push(p); pIdx[normN(name)] = p;
    } else if (pass && String(pass).trim() !== String(p.pin)) {
      review.push(['Cilvēks', name, 'Parole no ' + (app === 'izv' ? 'Izvešanas' : 'Kaisāmmateriāla') + ' nomainīta uz vienoto PIN', 'Pasakiet viņam jauno PIN (redzams Pilnvarās)']);
    }
    if (!p.perms[app]) p.perms[app] = 'pieteicejs';
    if (phone && !p.phone) p.phone = String(phone).trim();
  };
  { const { head, rows } = rowsOf(izv.Cilveki); const pc = colOf(head, /^parole/i); rows.forEach(r => addReq(r[0], 'izv', pc > 0 ? r[pc] : '', '')); }
  { const { head, rows } = rowsOf(kais.Pasutitaji); const pc = colOf(head, /^parole/i), tc = colOf(head, /^tālrunis|^talrunis|^telefons/i); rows.forEach(r => addReq(r[0], 'kais', pc > 0 ? r[pc] : '', tc > 0 ? r[tc] : '')); }

  // --- Uzņēmumi ---
  const comps = M.companies.map(c => Object.assign({}, c, { kinds: c.kinds.slice() })), cIdx = {};
  comps.forEach(c => cIdx[normN(c.name)] = c);
  const addComp = (name, kind, pass) => {
    name = String(name || '').replace(/\s+/g, ' ').trim(); if (!name) return;
    let c = cIdx[normN(name)]; pass = String(pass || '').trim().toUpperCase();
    if (!c) { c = { name, kinds: [], pass: '', phone: '', active: true }; comps.push(c); cIdx[normN(name)] = c; }
    if (c.kinds.indexOf(kind) === -1) c.kinds.push(kind);
    if (pass) { if (!c.pass) c.pass = pass; else if (c.pass !== pass) review.push(['Uzņēmums', name, 'Bija divas paroles — paturēta Izvešanas parole', 'Kurjeram jāpasaka vienotā parole (redzama Uzņēmumos)']); }
  };
  { const { head, rows } = rowsOf(izv.SIA); const pc = colOf(head, /^parole/i); rows.forEach(r => addComp(r[0], 'izvedejs', pc > 0 ? r[pc] : '')); }
  { const { head, rows } = rowsOf(kais.Kurjeri); const pc = colOf(head, /^parole/i); rows.forEach(r => addComp(r[0], 'kurjers', pc > 0 ? r[pc] : '')); }
  (pers.sia || []).forEach(n => addComp(n, 'darba_devejs', ''));

  // --- Saraksti ---
  const L = M.lists;
  const addL = (k, arr) => (arr || []).forEach(v => { v = String(v || '').trim(); if (v && !L[k].some(x => normA(x) === normA(v))) L[k].push(v); });
  { const { rows } = rowsOf(kais.Materiali); addL('materiali', rows.map(r => r[0])); }
  addL('bankas', pers.bankas); addL('atv_veidi', pers.veidi); addL('amati', pers.amati); addL('tel_kodi', pers.kodi);

  objs.forEach(o => delete o._from);
  await db.batch([...objectsStmts(db, objs), ...peopleStmts(db, ppl), ...usersStmts(db, ppl), ...companiesStmts(db, comps), ...listsStmts(db, L),
    kvSet(db, 'masterReview', JSON.stringify(review)), kvSet(db, 'masterMode', '1'), kvSet(db, 'masterDirty', '1'), kvSet(db, 'peopleDirty', '1')]);
  return { objects: objs.length, people: ppl.length, companies: comps.length, review: review.length };
}

/** Ko ierakstīt katras lietotnes vecajās lapās */
export function legacyPayload(M) {
  const has = (c, k) => c.active && c.kinds.indexOf(k) !== -1;
  return {
    aizv: { objects: M.objects.map(o => [o.adrese, o.vaditajs, o.grupa, o.piekluve]), types: M.types.map(t => [t.name, t.group]),
      companies: M.companies.map(c => [c.name, c.kinds.map(k => KINDS[k]).join(', '), c.pass, c.phone, c.active ? 'Jā' : 'Nē']),
      lists: Object.keys(LIST_KINDS).flatMap(k => (M.lists[k] || []).map(v => [LIST_KINDS[k], v])), review: M.review },
    izv: { Adreses: { cols: ['Adrese', 'Piekļuve'], rows: M.objects.map(o => [o.adrese, o.piekluve]) },
      Cilveki: { cols: ['Vārds', 'Parole'], rows: M.people.filter(p => p.active && p.perms.izv).map(p => [p.name, p.pin]) },
      SIA: { cols: ['SIA', 'Parole'], rows: M.companies.filter(c => has(c, 'izvedejs')).map(c => [c.name, c.pass]) } },
    kais: { Adreses: { cols: ['Adrese'], rows: M.objects.map(o => [o.adrese]) },
      Pasutitaji: { cols: ['Pasūtītājs', 'Tālrunis', 'Parole'], rows: M.people.filter(p => p.active && p.perms.kais).map(p => [p.name, p.phone, p.pin]) },
      Kurjeri: { cols: ['Kurjera uzņēmums', 'Parole'], rows: M.companies.filter(c => has(c, 'kurjers')).map(c => [c.name, c.pass]) },
      Materiali: { cols: ['Materiāls'], rows: (M.lists.materiali || []).map(v => [v]) } }
  };
}
/** Personālam un citām lietotnēm: publiskie saraksti (bez parolēm) */
export function publicLists(M) {
  return { sia: M.companies.filter(c => c.active && c.kinds.indexOf('darba_devejs') !== -1).map(c => c.name), bankas: M.lists.bankas, veidi: M.lists.atv_veidi,
    amati: M.lists.amati, kodi: M.lists.tel_kodi, materiali: M.lists.materiali, objekti: M.objects.map(o => o.adrese), types: M.types };
}
export { kvGet, kvSet, cleanPerms };
