/* SH | Portāls — vienota ieeja, pilnvaras un kopsavilkums visām lietotnēm. © VAITKEVIX, SIA */
export const APPS_P = ['aizv', 'izv', 'kais', 'pers', 'budz'];
export const ROLES = {
  portal: ['', 'admin'],
  aizv: ['', 'admin', 'vaditajs'],
  izv: ['', 'admin', 'pieteicejs'],
  kais: ['', 'admin', 'pieteicejs'],
  pers: ['', 'admin', 'vaditajs'],
  budz: ['', 'admin', 'gatavotājs', 'vadība']
};
const P_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const pj = (o) => new Response(JSON.stringify(o), { headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, P_CORS) });
async function h(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('portal|' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 40); }
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
export function cleanPerms(p) { const o = {}; for (const k in ROLES) { const v = String((p || {})[k] || ''); if (v && ROLES[k].indexOf(v) > 0) o[k] = v; } return o; }

export async function people(db) { return ((await db.prepare('SELECT name, pin, color, ord, active, perms FROM people ORDER BY ord, name').all()).results || []).map(r => ({ name: r.name, pin: r.pin, color: r.color, ord: r.ord, active: !!r.active, perms: parse(r.perms) })); }
export async function personByPin(db, pin) { pin = String(pin || '').trim(); if (!pin) return null; return (await people(db)).find(p => p.active && p.pin === pin) || null; }

/** Pirmā reize: pilnvaras no Aizvietošanas lietotājiem */
export function seedFrom(users) {
  return users.map((u, i) => {
    const a = u.role === 'admin';
    return { name: u.name, pin: u.pin, color: u.color || '', ord: i, active: true,
      perms: cleanPerms({ portal: a ? 'admin' : '', aizv: u.role, izv: a ? 'admin' : 'pieteicejs', kais: a ? 'admin' : 'pieteicejs', pers: a ? 'admin' : 'vaditajs', budz: a ? 'admin' : '' }) };
  });
}
export function peopleStmts(db, list) {
  const st = [db.prepare('DELETE FROM people')];
  list.forEach((p, i) => st.push(db.prepare('INSERT INTO people (name, pin, color, ord, active, perms) VALUES (?, ?, ?, ?, ?, ?)').bind(p.name, p.pin, p.color || '', i, p.active ? 1 : 0, JSON.stringify(cleanPerms(p.perms)))));
  return st;
}
/** Aizvietošanas lietotāji = cilvēki ar Aizvietošanas lomu */
export function usersStmts(db, list) {
  const st = [db.prepare('DELETE FROM users')];
  list.filter(p => p.active && p.perms.aizv).forEach((p, i) => st.push(db.prepare('INSERT OR REPLACE INTO users (name, role, pin, color, ord) VALUES (?, ?, ?, ?, ?)').bind(p.name, p.perms.aizv, p.pin, p.color || '', i)));
  return st;
}

/** Ja pilnvaru vēl nav — izveido no Aizvietošanas lietotājiem (vienreiz) */
async function ensureSeed(db) {
  const n = await db.prepare('SELECT COUNT(*) n FROM people').first();
  if (n && n.n) return;
  const us = (await db.prepare('SELECT name, role, pin, color FROM users ORDER BY ord, name').all()).results || [];
  if (!us.length) return;
  await db.batch([...peopleStmts(db, seedFrom(us)), db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('peopleDirty', '1')")]);
}
async function session(env, t) {
  if (!t) return null;
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('sess:' + await h(t)).first();
  const s = r && parse(r.v); if (!s || !s.name || s.exp < Date.now()) return null;
  return (await people(env.DB)).find(p => p.active && p.name === s.name) || null;
}
const pub = (p) => ({ name: p.name, color: p.color, perms: p.perms, admin: p.perms.portal === 'admin' });

async function dash(env, me) {
  const out = {}, P = me.perms, kv = async (k) => { const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? parse(r.v) : null; };
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }), td = fmt.format(new Date()), tm = fmt.format(new Date(Date.now() + 864e5));
  if (P.aizv) {
    const mine = P.aizv === 'admin' ? '' : ' AND vaditajs = ?', args = P.aizv === 'admin' ? [] : [me.name];
    const q = async (d, extra) => (await env.DB.prepare('SELECT COUNT(*) n FROM jobs WHERE datums = ?' + mine + (extra || '')).bind(d, ...args).first()).n;
    out.aizv = { today: await q(td), open: await q(td, " AND statuss NOT IN ('izpildīts')"), tomorrow: await q(tm), unassigned: P.aizv === 'admin' ? await q(tm, " AND brigade = ''") : null };
  }
  if (P.izv) {
    const b = await kv('izv:getBoot'), t = (b && b.result && b.result.tasks) || [];
    const open = t.filter(x => x.status === 'Neizpildīts');
    out.izv = { open: open.length, urgent: open.filter(x => x.urgent).length, mine: P.izv === 'admin' ? null : open.filter(x => String(x.requester || '').toLowerCase().indexOf(me.name.toLowerCase()) === 0).length };
  }
  if (P.kais) {
    const b = await kv('kais:getTasks'), t = (b && b.result) || [];
    const open = t.filter(x => !/piegād[aā]ts|atcelts/i.test(String(x.status || '')));
    out.kais = { open: open.length };
  }
  if (P.pers) out.pers = {};
  if (P.budz) out.budz = {};
  return out;
}

export async function portal(request, env, ctx, hooks) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: P_CORS });
  if (request.method !== 'POST') return pj({ ok: true, app: 'SH | Portāls' });
  const b = parse(await request.text()), a = String(b.action || '');
  try {
    if (a === 'login' || a === 'check') await ensureSeed(env.DB);
    if (a === 'login') {
      const me = await personByPin(env.DB, b.pin);
      if (!me) { await new Promise(r => setTimeout(r, 700)); return pj({ ok: false, error: 'Nepareizs PIN' }); }
      const t = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('sess:' + await h(t), JSON.stringify({ name: me.name, exp: Date.now() + 60 * 864e5 })).run();
      return pj({ ok: true, token: t, me: pub(me), dash: await dash(env, me) });
    }
    if (a === 'check') {   // Personāls / Budžets pārbauda vienoto PIN
      const me = await personByPin(env.DB, b.pin), app = String(b.app || '');
      if (!me) return pj({ ok: true, known: false });
      return pj({ ok: true, known: true, name: me.name, role: me.perms[app] || '' });
    }
    const me = await session(env, b.t);
    if (!me) return pj({ ok: false, error: 'SESIJA', code: 'auth' });
    if (a === 'me') return pj({ ok: true, me: pub(me), dash: await dash(env, me) });
    if (a === 'logout') { await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('sess:' + await h(b.t)).run(); return pj({ ok: true }); }
    if (me.perms.portal !== 'admin') return pj({ ok: false, error: 'Tikai administratoram' });
    if (a === 'people') return pj({ ok: true, people: await people(env.DB), roles: ROLES });
    if (a === 'save') {
      const list = await people(env.DB), p = b.person || {};
      const name = String(p.name || '').replace(/\s+/g, ' ').trim(), pin = String(p.pin || '').trim(), old = String(p.oldName || '');
      if (!name) return pj({ ok: false, error: 'Ierakstiet vārdu' });
      if (!/^\d{4,8}$/.test(pin)) return pj({ ok: false, error: 'PIN — 4 līdz 8 cipari' });
      if (list.some(x => x.name !== old && x.name.toLowerCase() === name.toLowerCase())) return pj({ ok: false, error: 'Šāds vārds jau ir' });
      if (list.some(x => x.name !== old && x.pin === pin)) return pj({ ok: false, error: 'Šāds PIN jau ir citam — izvēlieties citu' });
      const rec = { name, pin, color: String(p.color || '').slice(0, 20), active: p.active !== false, perms: cleanPerms(p.perms) };
      if (old === me.name && rec.perms.portal !== 'admin') return pj({ ok: false, error: 'Sev administratora tiesības noņemt nevar' });
      const i = list.findIndex(x => x.name === old);
      if (i >= 0) list[i] = Object.assign(list[i], rec); else list.push(rec);
      await hooks.saved(list);
      return pj({ ok: true, people: await people(env.DB) });
    }
    if (a === 'del') {
      if (b.name === me.name) return pj({ ok: false, error: 'Sevi dzēst nevar' });
      const list = (await people(env.DB)).filter(x => x.name !== b.name);
      await hooks.saved(list);
      return pj({ ok: true, people: await people(env.DB) });
    }
    return pj({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return pj({ ok: false, error: String(e && e.message || e) }); }
}
