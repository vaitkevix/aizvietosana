/**
 * DARBU SADALE — API (Google Apps Script, piesaistīts Google Sheets tabulai)
 * Dati: lapas "Lietotaji", "Darbi", "Tokeni", "Darbinieki", "Sastavs", "Objekti", "DarbuVeidi".
 * Paziņojumi: Firebase Cloud Messaging (Script property FCM_SERVICE_ACCOUNT).
 *
 * Pirmo reizi: palaid funkciju setup() → Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone).
 */

const SH_USERS = 'Lietotaji';
const SH_JOBS = 'Darbi';
const SH_TOKENS = 'Tokeni';
const SH_STAFF = 'Darbinieki';
const SH_CREW = 'Sastavs';
const SH_OBJ = 'Objekti';
const SH_TYPES = 'DarbuVeidi';
const JOB_COLS = ['ID', 'Datums', 'Adrese', 'Tips', 'Apraksts', 'Vaditajs', 'Brigade', 'Statuss', 'Publicets', 'Izpildits', 'Izveidots', 'Komentars', 'Foto', 'Iemesls', 'Lidz', 'Serija', 'Prombutne', 'Steidzami', 'Laiks', 'Parbaude', 'ParbaudesKomentars'];
const SH_PROB = 'Problemas';
const SH_STAND = 'Pastavigie';   // DNL/vakance bez beigu datuma — aktuāla, kamēr vadītājs atslēdz
const STAND_COLS = ['ID', 'Adrese', 'Tips', 'Apraksts', 'Vaditajs', 'Prombutne', 'No', 'Beigas', 'Brivdienas', 'Steidzami', 'Laiks', 'Foto', 'Izlaistas', 'Izveidots'];
const PROB_COLS = ['ID', 'Laiks', 'Adrese', 'Vaditajs', 'Vieniba', 'Apraksts', 'Foto', 'Statuss', 'Atrisinats'];
const TZ = 'Europe/Riga';
const PROMBUTNE = ['Atvaļinājums', 'DNL', 'Vakance'];   // aizvietošanas iemesls

/* ---------------- HTTP ---------------- */

function doGet() {
  return json_({ ok: true, app: 'Darbu sadale', time: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Nederīgs pieprasījums' });
  }
  try {
    if (req.action === 'bridge') return json_(Object.assign({ ok: true }, bridge_(req)));
    if (req.action === 'teamView') return json_(Object.assign({ ok: true }, teamView_(req)));
    if (req.action === 'teamDone') return json_(Object.assign({ ok: true }, teamDone_(req)));
    if (req.action === 'teamCant') return json_(Object.assign({ ok: true }, teamCant_(req)));
    if (req.action === 'teamProblem') return json_(Object.assign({ ok: true }, teamProblem_(req)));
    const user = auth_(req.pin);
    if (!user) return json_({ ok: false, error: 'Nepareizs PIN' });
    const fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: 'Nezināma darbība' });
    return json_(Object.assign({ ok: true }, fn(user, req) || {}));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

const ACTIONS = {
  login: (u) => ({ user: publicUser_(u), meta: meta_() }),

  jobs: (u, r) => {
    ensureStanding_(r.date);
    const units = units_(r.date);
    return { jobs: visibleJobs_(u, r.date), units: units, crews: crews_(r.date), staff: staff_(), teamLink: u.role === 'admin' ? teamLink_() : '', problems: problems_(u), standing: standingFor_(u) };
  },

  /** Vienība dienai: izveidot, pārsaukt (oldName) vai mainīt cilvēkus */
  setUnit: (u, r) => withLock_(() => {
    requireAdmin_(u);
    const name = String(r.name || '').trim();
    const old = String(r.oldName || '').trim();
    if (!r.date || !name) throw new Error('Norādi vienības nosaukumu');
    const persons = (r.persons || []).map(p => String(p).trim()).filter(Boolean);
    const sh = crewSheet_();
    const data = sh.getDataRange().getValues();
    let row = 0;
    for (let i = 1; i < data.length; i++) {
      if (dateStr_(data[i][0]) !== r.date) continue;
      const n = String(data[i][1]);
      if (n === (old || name)) row = i + 1;
      else if (n === name) throw new Error('Vienība „' + name + '” jau ir');
    }
    // Cilvēks vienā dienā var būt tikai vienā vienībā
    for (let i = 1; i < data.length; i++) {
      if (dateStr_(data[i][0]) !== r.date || i + 1 === row) continue;
      const other = splitNames_(data[i][2]);
      const left = other.filter(p => persons.indexOf(p) === -1);
      if (left.length !== other.length) sh.getRange(i + 1, 3).setValue(left.join(', '));
    }
    if (row) sh.getRange(row, 2, 1, 2).setValues([[name, persons.join(', ')]]);
    else sh.appendRow([r.date, name, persons.join(', ')]);
    if (old && old !== name) {
      const js = sheet_(SH_JOBS);
      readJobs_().filter(j => j.datums === r.date && brigs_(j.brigade).indexOf(old) !== -1).forEach(j => {
        j.brigade = brigs_(j.brigade).map(b => b === old ? name : b).join(' | '); writeJob_(js, j);
      });
    }
    const known = staff_().map(s => s.name);
    const st = staffSheet_();
    persons.filter(p => known.indexOf(p) === -1).forEach(p => st.appendRow([p, '']));
    return { units: units_(r.date), crews: crews_(r.date), staff: staff_(), jobs: visibleJobs_(u, r.date) };
  }),

  deleteUnit: (u, r) => withLock_(() => {
    requireAdmin_(u);
    const sh = crewSheet_();
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (dateStr_(data[i][0]) === r.date && String(data[i][1]) === r.name) sh.deleteRow(i + 1);
    }
    const js = sheet_(SH_JOBS);
    readJobs_().filter(j => j.datums === r.date && brigs_(j.brigade).indexOf(r.name) !== -1).forEach(j => {
      j.brigade = brigs_(j.brigade).filter(b => b !== r.name).join(' | ');
      if (!j.brigade && j.statuss === 'piešķirts') j.statuss = 'jauns';
      writeJob_(js, j);
    });
    return { units: units_(r.date), crews: crews_(r.date), jobs: visibleJobs_(u, r.date) };
  }),

  /** Objektu saraksta ielāde: rows = [[adrese, vaditajs, grupa, piekluve]]; esošās adreses atjauno */
  importObjects: (u, r) => withLock_(() => {
    requireAdmin_(u);
    const sh = objSheet_();
    const last = sh.getLastRow();
    const cur = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
    const idx = {};
    cur.forEach((x, i) => idx[String(x[0]).trim().toLowerCase()] = i);
    let added = 0, updated = 0;
    (r.rows || []).forEach(x => {
      const a = String(x[0] || '').trim(); if (!a) return;
      const k = a.toLowerCase();
      if (idx[k] !== undefined) { const c = cur[idx[k]]; c[2] = x[2] || c[2]; c[3] = x[3] || c[3]; if (x[1]) c[1] = x[1]; updated++; }
      else { idx[k] = cur.length; cur.push([a, x[1] || '', x[2] || 'SH objekti', x[3] || '']); added++; }
    });
    if (cur.length) sh.getRange(2, 1, cur.length, 4).setValues(cur);
    return { added: added, updated: updated, objects: objects_() };
  }),

  /** Kopē vienības (nosaukumus un cilvēkus) no citas dienas */
  copyUnits: (u, r) => withLock_(() => {
    requireAdmin_(u);
    const have = units_(r.date).map(x => x.name);
    const src = units_(r.from).filter(x => have.indexOf(x.name) === -1);
    if (!src.length) throw new Error('Nav ko kopēt');
    const sh = crewSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, src.length, 3).setValues(src.map(x => [r.date, x.name, x.persons.join(', ')]));
    return { units: units_(r.date), crews: crews_(r.date), copied: src.length };
  }),

  saveJob: (u, r) => withLock_(() => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    const j = r.job || {};
    if (!j.adrese || !String(j.adrese).trim()) throw new Error('Norādi adresi');
    if (!j.datums) throw new Error('Norādi datumu');
    const sh = sheet_(SH_JOBS);
    if (j.id) {
      const job = findJob_(j.id);
      if (!job) throw new Error('Darbs nav atrasts');
      if (u.role !== 'admin' && (job.vaditajs !== u.name || job.brigade)) throw new Error('Darbu, kas jau piešķirts vienībai, var mainīt tikai admins');
      job.datums = j.datums; job.adrese = String(j.adrese).trim(); job.tips = j.tips || job.tips; job.apraksts = j.apraksts || '';
      if (j.vaditajs && u.role === 'admin') job.vaditajs = String(j.vaditajs);
      if (j.prombutne !== undefined) job.prombutne = PROMBUTNE.indexOf(j.prombutne) !== -1 ? j.prombutne : '';
      if (j.steidzami !== undefined) job.steidzami = j.steidzami ? '1' : '';
      if (j.laiks !== undefined) job.laiks = cleanTime_(j.laiks);
      addObjects_([job.adrese], job.vaditajs);
      writeJob_(sh, job);
      return { job: clean_(job) };
    }
    const job = {
      id: Utilities.getUuid().slice(0, 8), datums: j.datums, adrese: String(j.adrese).trim(), tips: j.tips || 'Sētnieks',
      apraksts: j.apraksts || '', vaditajs: j.vaditajs || u.name, brigade: j.brigade || '',
      statuss: j.brigade ? 'piešķirts' : 'jauns', publicets: '', izpildits: '', izveidots: now_()
    };
    sh.appendRow(toRow_(job));
    if (u.role !== 'admin') {
      notify_(namesByRole_('admin'), 'Jauns darbs · ' + lvDate_(job.datums), job.adrese + ' — ' + u.name);
    }
    return { job: clean_(job) };
  }),

  saveJobs: (u, r) => {
    // Bildes saglabā pirms bloķēšanas (augšupielāde var aizņemt dažas sekundes)
    (r.jobs || []).forEach(j => {
      j.fotoIds = j.photos && j.photos.length ? savePhotos_({ datums: r.date, adrese: String(j.adrese || '') }, j.photos).join(',') : '';
      delete j.photos;
    });
    return withLock_(() => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    const list = (r.jobs || []).filter(j => j && String(j.adrese || '').trim());
    if (!list.length) throw new Error('Pievieno vismaz vienu adresi');
    if (!r.date) throw new Error('Norādi datumu');
    const types = jobTypes_().map(t => t.name);
    const objMgr = objectManagers_();
    jobsSheet_();
    list.forEach(j => {
      if (groupOf_(j.tips) === 'Aizvietošana' && PROMBUTNE.indexOf(j.prombutne) === -1) throw new Error('Norādiet aizvietošanas iemeslu adresei ' + j.adrese + ': atvaļinājums, DNL vai vakance');
      if (j.prombutne === 'Atvaļinājums' && !j.lidz) throw new Error('Norādiet, līdz kuram datumam ilgst atvaļinājums (' + j.adrese + ')');
    });
    const rows = [];
    list.forEach(j => {
      if (types.indexOf(j.tips) === -1) throw new Error('Izvēlies darbu adresei ' + j.adrese);
      const dates = seriesDates_(r.date, j.lidz, j.brivdienas);
      let serija = dates.length > 1 ? Utilities.getUuid().slice(0, 8) : '';
      const mgr = u.role === 'admin' ? String(j.vaditajs || objMgr[normName_(j.adrese)] || r.vaditajs || u.name) : u.name;
      if (!j.lidz && !j.vienaDiena && STAND_PROMB.indexOf(j.prombutne) !== -1 && groupOf_(j.tips) === 'Aizvietošana') {
        serija = Utilities.getUuid().slice(0, 8);
        standSheet_().appendRow([serija, String(j.adrese).trim(), j.tips, String(j.apraksts || '').trim(), mgr, j.prombutne, r.date, '',
          j.brivdienas ? '1' : '', j.steidzami ? '1' : '', cleanTime_(j.laiks), j.fotoIds || '', '', now_()]);
      }
      dates.forEach(d => rows.push(toRow_({
        id: Utilities.getUuid().slice(0, 8), datums: d, adrese: String(j.adrese).trim(), tips: j.tips,
        apraksts: String(j.apraksts || '').trim(), vaditajs: mgr, brigade: '',
        statuss: 'jauns', publicets: '', izpildits: '', izveidots: now_(), lidz: j.lidz && dates.length > 1 ? j.lidz : '', serija: serija, foto: j.fotoIds || '', prombutne: PROMBUTNE.indexOf(j.prombutne) !== -1 ? j.prombutne : '',
        steidzami: j.steidzami ? '1' : '', laiks: cleanTime_(j.laiks)
      })));
    });
    const sh = sheet_(SH_JOBS);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, JOB_COLS.length).setValues(rows);
    addObjects_(list.map(j => String(j.adrese).trim()), u.role === 'admin' ? String(r.vaditajs || '') : u.name);
    if (u.role !== 'admin') {
      notify_(namesByRole_('admin'), 'Jauni darbi · ' + lvDate_(r.date) + ' · ' + u.name,
        list.length === 1 ? list[0].adrese + ' — ' + list[0].tips + (list[0].lidz ? ' (atvaļinājums līdz ' + lvDate_(list[0].lidz) + ')' : '')
          : list.length + ' adreses: ' + list.slice(0, 3).map(x => x.adrese).join(', ') + (list.length > 3 ? '…' : ''));
    }
    return { count: rows.length, objects: objects_() };
    });
  },

  aiNote: (u, r) => ({ text: aiWrite_(u, r) }),

  aiParse: (u, r) => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    return aiParse_(u, r);
  },

  stats: (u, r) => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    let list = readJobs_().filter(j => j.datums >= r.from && j.datums <= r.to);
    if (u.role === 'vaditajs') list = list.filter(j => j.vaditajs === u.name);
    return { jobs: list.map(j => ({ datums: j.datums, adrese: j.adrese, tips: j.tips, vaditajs: j.vaditajs, brigade: j.brigade, statuss: j.statuss, lidz: j.lidz, prombutne: j.prombutne, foto: j.foto ? 1 : 0, parbaude: j.parbaude, iemesls: j.iemesls, steidzami: j.steidzami })) };
  },

  deleteJob: (u, r) => withLock_(() => {
    const job = findJob_(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    const allowed = (j) => u.role === 'admin' || (u.role === 'vaditajs' && j.vaditajs === u.name && !j.brigade);
    let targets = [job];
    const st = job.serija ? readStanding_().find(x => x.id === job.serija) : null;
    if (st && !allowedStand_(u, st)) throw new Error('Nav atļauts');
    if (r.series && job.serija) targets = readJobs_().filter(j => j.serija === job.serija && j.datums >= job.datums);
    targets = targets.filter(allowed);
    if (!targets.length) throw new Error('Nav atļauts');
    if (st) {   // pastāvīgā aizvietošana: viena diena → neplānot to vairs; sērija → beigt pirms šīs dienas
      if (r.series) standSheet_().getRange(st._row, 8).setValue(addDays_(job.datums, -1));
      else standSheet_().getRange(st._row, 13).setValue(st.izlaistas.concat([job.datums]).join(','));
    }
    const sh = sheet_(SH_JOBS);
    targets.map(j => j._row).sort((a, b) => b - a).forEach(row => sh.deleteRow(row));
    return { deleted: targets.length };
  }),

  assign: (u, r) => withLock_(() => {
    requireAdmin_(u);
    const job = findJob_(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    const list = Array.isArray(r.brigades) ? r.brigades : (r.brigade ? [r.brigade] : []);
    const val = list.map(x => String(x).trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' | ');
    if (job.brigade !== val) {
      job.brigade = val;
      if (job.statuss !== 'izpildīts') job.statuss = job.brigade ? 'piešķirts' : 'jauns';
      writeJob_(sheet_(SH_JOBS), job);
    }
    return { job: clean_(job) };
  }),

  publish: (u, r) => withLock_(() => {
    requireAdmin_(u);
    const sh = sheet_(SH_JOBS);
    const jobs = readJobs_().filter(j => j.datums === r.date && j.brigade && !j.publicets);
    const byBrig = {};
    jobs.forEach(j => {
      j.publicets = now_();
      if (j.statuss === 'jauns') j.statuss = 'piešķirts';
      writeJob_(sh, j);
      (byBrig[j.brigade] = byBrig[j.brigade] || []).push(j);
    });
    let sent = 0;
    const crews = crews_(r.date);
    Object.keys(byBrig).forEach(b => {
      const list = byBrig[b];
      const body = list.slice(0, 3).map(j => j.adrese).join(', ') + (list.length > 3 ? ' +' + (list.length - 3) : '');
      const who = (crews[b] || []).join(', ');
      sent += notify_([b], 'Plāns ' + lvDate_(r.date) + ' · ' + list.length + ' obj.', (who ? who + ' — ' : '') + body);
    });
    return { published: jobs.length, sent: sent, whatsapp: whatsapp_(r.date) };
  }),

  whatsapp: (u, r) => { requireAdmin_(u); ensureStanding_(r.date); return { whatsapp: whatsapp_(r.date) }; },

  done: (u, r) => {
    let job = findJob_(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    canMark_(u, job);
    // Foto saglabā ārpus bloķēšanas (var aizņemt dažas sekundes)
    const ids = r.done ? savePhotos_(job, r.photos) : [];
    return withLock_(() => {
      job = findJob_(r.id);
      if (r.done) {
        job.statuss = 'izpildīts';
        job.izpildits = now_();
        job.komentars = String(r.komentars || '').trim();
        job.foto = splitNames_(job.foto).concat(ids).join(',');
        job.iemesls = ''; job.parbaude = '';
      } else {
        job.statuss = job.brigade ? 'piešķirts' : 'jauns';
        job.izpildits = '';
        job.iemesls = '';
      }
      writeJob_(sheet_(SH_JOBS), job);
      if (r.done && job.vaditajs && job.vaditajs !== u.name) {
        const extra = (job.komentars ? ' — ' + job.komentars : '') + (ids.length ? ' 📷' + ids.length : '');
        notify_([job.vaditajs], '✓ Izpildīts · ' + job.brigade, job.adrese + extra);
      }
      return { job: clean_(job) };
    });
  },

  cantDo: (u, r) => withLock_(() => {
    const job = findJob_(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    canMark_(u, job);
    const reason = String(r.iemesls || '').trim();
    if (!reason) throw new Error('Norādi iemeslu');
    job.statuss = 'nevar izpildīt';
    job.iemesls = reason;
    job.izpildits = now_();
    writeJob_(sheet_(SH_JOBS), job);
    const to = namesByRole_('admin');
    if (job.vaditajs && to.indexOf(job.vaditajs) === -1) to.push(job.vaditajs);
    notify_(to.filter(n => n !== u.name), '⚠ Nevar izpildīt · ' + job.brigade, job.adrese + ' — ' + reason);
    return { job: clean_(job) };
  }),

  saveToken: (u, r) => withLock_(() => {
    if (!r.token) throw new Error('Nav tokena');
    const sh = sheet_(SH_TOKENS);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === r.token) {
        sh.getRange(i + 1, 1, 1, 4).setValues([[u.name, r.token, r.device || '', now_()]]);
        return {};
      }
    }
    sh.appendRow([u.name, r.token, r.device || '', now_()]);
    return {};
  }),

  /** Vadītājs vai admins pieņem izpildītu darbu vai atgriež to brigādei ar komentāru */
  review: (u, r) => withLock_(() => {
    const job = findJob_(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    if (u.role !== 'admin' && job.vaditajs !== u.name) throw new Error('Nav atļauts');
    if (r.ok) {
      if (job.statuss !== 'izpildīts') throw new Error('Pieņemt var tikai izpildītu darbu');
      job.parbaude = 'pieņemts'; job.parbKom = '';
    } else if (r.undo) {
      job.parbaude = ''; job.parbKom = '';
    } else {
      const kom = String(r.komentars || '').trim();
      if (!kom) throw new Error('Uzrakstiet, kas jāizlabo');
      job.parbaude = 'atgriezts'; job.parbKom = kom + ' — ' + u.name;
      job.statuss = job.brigade ? 'piešķirts' : 'jauns'; job.izpildits = '';
    }
    writeJob_(sheet_(SH_JOBS), job);
    return { job: clean_(job) };
  }),

  /** Objekta vēsture: visi darbi un problēmas šajā adresē (jaunākie vispirms) */
  history: (u, r) => {
    const k = normName_(r.adrese);
    if (!k) throw new Error('Nav adreses');
    let list = readJobs_().filter(j => normName_(j.adrese) === k);
    if (u.role === 'vaditajs') list = list.filter(j => j.vaditajs === u.name);
    list.sort((a, b) => b.datums.localeCompare(a.datums) || b.izveidots.localeCompare(a.izveidots));
    const probs = readProblems_().filter(p => normName_(p.adrese) === k && (u.role === 'admin' || p.vaditajs === u.name || !p.vaditajs));
    return { total: list.length, jobs: list.slice(0, 60).map(clean_), problems: probs.reverse().slice(0, 20) };
  },

  problems: (u) => ({ problems: problems_(u) }),

  /** Beigt pastāvīgo aizvietošanu: last = pēdējā diena, kad vēl jāaizvieto */
  stopStanding: (u, r) => withLock_(() => {
    const st = readStanding_().find(x => x.id === String(r.serija));
    if (!st) throw new Error('Aizvietošana nav atrasta');
    if (!allowedStand_(u, st)) throw new Error('Nav atļauts');
    const last = String(r.last || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(last)) throw new Error('Norādiet pēdējo dienu');
    standSheet_().getRange(st._row, 8).setValue(last);
    const sh = sheet_(SH_JOBS);
    const del = readJobs_().filter(j => j.serija === st.id && j.datums > last && j.statuss !== 'izpildīts' && j.statuss !== 'nevar izpildīt');
    del.map(j => j._row).sort((a, b) => b - a).forEach(row => sh.deleteRow(row));
    return { deleted: del.length, standing: standingFor_(u) };
  }),

  problemDone: (u, r) => withLock_(() => {
    const p = readProblems_().find(x => x.id === String(r.id));
    if (!p) throw new Error('Ziņojums nav atrasts');
    if (u.role !== 'admin' && p.vaditajs && p.vaditajs !== u.name) throw new Error('Nav atļauts');
    probSheet_().getRange(p._row, 8, 1, 2).setValues([['atrisināts', now_() + ' ' + u.name]]);
    return { problems: problems_(u) };
  }),

  testPush: (u) => ({ sent: notify_([u.name], 'Darbu sadale', 'Paziņojumi strādā ✓') })
};

/* ---------------- Dati ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { return ss_().getSheetByName(name); }

function users_() {
  const data = sheet_(SH_USERS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const [name, role, pin, color] = data[i];
    if (!name) continue;
    out.push({ name: String(name).trim(), role: String(role).trim().toLowerCase(), pin: String(pin).trim(), color: String(color || '').trim() });
  }
  return out;
}

function auth_(pin) {
  if (!pin) return null;
  pin = String(pin).trim();
  return users_().find(x => x.pin === pin && (x.role === 'admin' || x.role === 'vaditajs')) || null;
}

function publicUser_(u) { return { name: u.name, role: u.role, color: u.color }; }

function meta_() {
  const us = users_();
  return {
    managers: us.filter(u => u.role === 'vaditajs').map(u => ({ name: u.name, color: u.color })),
    objects: objects_(),
    jobTypes: jobTypes_()
  };
}

function namesByRole_(role) { return users_().filter(u => u.role === role).map(u => u.name); }

function readJobs_() {
  const data = sheet_(SH_JOBS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    out.push({
      _row: i + 1, id: String(r[0]), datums: dateStr_(r[1]), adrese: String(r[2]), tips: String(r[3]), apraksts: String(r[4]),
      vaditajs: String(r[5]), brigade: String(r[6]), statuss: String(r[7]), publicets: str_(r[8]), izpildits: str_(r[9]), izveidots: str_(r[10]),
      komentars: String(r[11] || ''), foto: String(r[12] || ''), iemesls: String(r[13] || ''),
      lidz: dateStr_(r[14]), serija: String(r[15] || ''), prombutne: String(r[16] || ''),
      steidzami: String(r[17] || '') === '1' ? '1' : '', laiks: timeStr_(r[18]), parbaude: String(r[19] || ''), parbKom: String(r[20] || '')
    });
  }
  return out;
}

function findJob_(id) { return readJobs_().find(j => j.id === String(id)) || null; }

function toRow_(j) {
  return [j.id, j.datums, j.adrese, j.tips, j.apraksts, j.vaditajs, j.brigade, j.statuss, j.publicets, j.izpildits, j.izveidots, j.komentars || '', j.foto || '', j.iemesls || '', j.lidz || '', j.serija || '', j.prombutne || '',
    j.steidzami ? '1' : '', j.laiks ? "'" + j.laiks : '', j.parbaude || '', j.parbKom || ''];
}

function writeJob_(sh, j) { jobsSheet_(); sh.getRange(j._row, 1, 1, JOB_COLS.length).setValues([toRow_(j)]); }

/** Pārliecinās, ka lapā Darbi ir visas kolonnas (jaunās kolonnas pievieno automātiski) */
let JOB_COLS_OK = false;
function jobsSheet_() {
  const sh = sheet_(SH_JOBS);
  if (JOB_COLS_OK) return sh;
  if (sh.getMaxColumns() < JOB_COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), JOB_COLS.length - sh.getMaxColumns());
  const h = sh.getRange(1, 1, 1, JOB_COLS.length).getValues()[0];
  if (h.join('|') !== JOB_COLS.join('|')) sh.getRange(1, 1, 1, JOB_COLS.length).setValues([JOB_COLS]).setFontWeight('bold');
  JOB_COLS_OK = true;
  return sh;
}

/** „10:00” — laiks līdz kuram jāizdara */
function cleanTime_(v) { const m = String(v || '').trim().match(/^(\d{1,2})[:.](\d{2})$/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
function timeStr_(v) { return v instanceof Date ? Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'HH:mm') : cleanTime_(v); }

/* ---------------- Pastāvīgās aizvietošanas (DNL / vakance bez beigām) ---------------- */

const STAND_PROMB = ['DNL', 'Vakance'];

function standSheet_() {
  let sh = sheet_(SH_STAND);
  if (!sh) {
    sh = ss_().insertSheet(SH_STAND);
    sh.getRange(1, 1, 1, STAND_COLS.length).setValues([STAND_COLS]).setFontWeight('bold');
    sh.getRange('A:N').setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readStanding_() {
  const data = standSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r[0]) continue;
    out.push({ _row: i + 1, id: String(r[0]), adrese: String(r[1]), tips: String(r[2]), apraksts: String(r[3]), vaditajs: String(r[4]), prombutne: String(r[5]),
      no: dateStr_(r[6]).replace(/^'/, ''), beigas: dateStr_(r[7]).replace(/^'/, ''), brivdienas: String(r[8]) === '1', steidzami: String(r[9]) === '1' ? '1' : '', laiks: timeStr_(r[10]),
      foto: String(r[11] || ''), izlaistas: splitNames_(r[12]), izveidots: str_(r[13]) });
  }
  return out;
}

function allowedStand_(u, st) { return u.role === 'admin' || st.vaditajs === u.name; }

/** Aktīvās pastāvīgās aizvietošanas: adminam visas, vadītājam savas */
function standingFor_(u) {
  const t = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return readStanding_().filter(s => (!s.beigas || s.beigas >= t) && allowedStand_(u, s))
    .map(s => ({ id: s.id, adrese: s.adrese, tips: s.tips, prombutne: s.prombutne, vaditajs: s.vaditajs, no: s.no, beigas: s.beigas }));
}

function addDays_(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

/** Izveido dienas darbus pastāvīgajām aizvietošanām (tikai šodienai un nākotnei) */
function ensureStanding_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return;
  if (date < Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')) return;
  const wd = new Date(date + 'T12:00:00').getDay();
  const due = () => readStanding_().filter(s => s.no <= date && (!s.beigas || date <= s.beigas) && s.izlaistas.indexOf(date) === -1 && (s.brivdienas || (wd !== 0 && wd !== 6)));
  if (!due().length) return;
  const missing = (jobs) => due().filter(s => !jobs.some(j => j.serija === s.id && j.datums === date));
  if (!missing(readJobs_()).length) return;
  withLock_(() => {
    const jobs = readJobs_();
    const list = missing(jobs);
    if (!list.length) return;
    const unitNames = units_(date).map(x => x.name);
    const prevDay = (s) => jobs.filter(j => j.serija === s.id && j.datums < date).sort((a, b) => b.datums.localeCompare(a.datums))[0];
    const rows = list.map(s => {
      const prev = prevDay(s);
      const br = prev ? brigs_(prev.brigade).filter(b => unitNames.indexOf(b) !== -1).join(' | ') : '';   // tā pati vienība, ja tāda šai dienai ir
      return toRow_({ id: Utilities.getUuid().slice(0, 8), datums: date, adrese: s.adrese, tips: s.tips, apraksts: s.apraksts, vaditajs: s.vaditajs,
        brigade: br, statuss: br ? 'piešķirts' : 'jauns', publicets: '', izpildits: '', izveidots: now_(), lidz: '', serija: s.id, foto: s.foto,
        prombutne: s.prombutne, steidzami: s.steidzami, laiks: s.laiks });
    });
    const sh = jobsSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, JOB_COLS.length).setValues(rows);
  });
}

/* ---------------- Problēmas objektos (ziņo brigādes) ---------------- */

function probSheet_() {
  let sh = sheet_(SH_PROB);
  if (!sh) {
    sh = ss_().insertSheet(SH_PROB);
    sh.getRange(1, 1, 1, PROB_COLS.length).setValues([PROB_COLS]).setFontWeight('bold');
    sh.getRange('A:I').setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readProblems_() {
  const data = probSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r[0]) continue;
    out.push({ _row: i + 1, id: String(r[0]), laiks: str_(r[1]), adrese: String(r[2]), vaditajs: String(r[3]), vieniba: String(r[4]),
      apraksts: String(r[5]), foto: String(r[6] || ''), statuss: String(r[7] || 'jauns'), atrisinats: str_(r[8]) });
  }
  return out;
}

/** Neatrisinātās problēmas: adminam visas, vadītājam — viņa objektos */
function problems_(u) {
  return readProblems_().filter(p => p.statuss !== 'atrisināts' && (u.role === 'admin' || p.vaditajs === u.name))
    .reverse().map(p => { const c = Object.assign({}, p); delete c._row; return c; });
}

/** Brigāde (bez PIN) ziņo par problēmu objektā — bojājums, nav piekļuves u.c. */
function teamProblem_(r) {
  const adrese = String(r.adrese || '').trim(), teksts = String(r.teksts || '').trim();
  if (!adrese) throw new Error('Norādiet adresi');
  if (!teksts) throw new Error('Aprakstiet problēmu');
  const ids = savePhotos_({ datums: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), adrese: adrese + ' problēma' }, r.photos);
  return withLock_(() => {
    const mgr = objectManagers_()[normName_(adrese)] || '';
    probSheet_().appendRow([Utilities.getUuid().slice(0, 8), now_(), adrese, mgr, String(r.vieniba || '').slice(0, 120), teksts.slice(0, 2000), ids.join(','), 'jauns', '']);
    notify_(namesByRole_('admin').concat(mgr ? [mgr] : []), '⚠ Problēma · ' + adrese, teksts.slice(0, 140));
    return { saved: true };
  });
}

function clean_(j) { const c = Object.assign({}, j); delete c._row; return c; }

function visibleJobs_(u, date) {
  let jobs = readJobs_().filter(j => j.datums === date);
  if (u.role === 'vaditajs') jobs = jobs.filter(j => j.vaditajs === u.name);
  if (u.role === 'brigade') jobs = jobs.filter(j => j.brigade === u.name && j.publicets);
  return jobs.map(clean_);
}

function whatsapp_(date) {
  const jobs = readJobs_().filter(j => j.datums === date && j.brigade);
  const byBrig = {};
  jobs.forEach(j => brigs_(j.brigade).forEach(b => (byBrig[b] = byBrig[b] || []).push(j)));
  const crews = crews_(date);
  const lines = ['*Plāns ' + lvDate_(date) + '*'];
  const order = units_(date).map(x => x.name);
  Object.keys(byBrig).sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b)).forEach(b => {
    lines.push('', '*' + b + '*');
    if (crews[b] && crews[b].length) lines.push(crews[b].join(', '));
    byBrig[b].forEach(j => {
      const extra = groupOf_(j.tips) !== 'Aizvietošana';
      let what = extra ? (j.tips === 'Papilddarbs' || j.tips === 'Cits papilddarbs' ? (j.apraksts || 'papilddarbs') : j.tips) : j.tips.toLowerCase();
      if (j.apraksts && what !== j.apraksts) what += ' (' + j.apraksts + ')';
      if (j.prombutne) what += ' (' + j.prombutne.toLowerCase() + (j.lidz ? ' līdz ' + lvDate_(j.lidz) : '') + ')';
      else if (j.lidz) what += ' (līdz ' + lvDate_(j.lidz) + ')';
      if (j.laiks) what += ' (līdz plkst. ' + j.laiks + ')';
      lines.push((j.steidzami ? '🔥 ' : '') + j.adrese + ' - ' + what);
    });
  });
  const link = teamLink_();
  if (link) lines.push('', '🔗 Savi darbi: ' + link);
  return lines.join('\n');
}

/* ---------------- Brigāžu saite bez PIN ---------------- */

function linkSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('LINK_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('LINK_SECRET', s); }
  return s;
}

/** Kopīgā brigāžu saites atslēga (pastāvīga, neuzminama) */
function teamKey_() {
  const sig = Utilities.computeHmacSha256Signature('brigades', linkSecret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 16);
}

function teamLink_() {
  const app = PropertiesService.getScriptProperties().getProperty('APP_URL');
  return app || '';
}

/** Brigāžu skats (bez PIN): visas dienas vienības ar cilvēkiem un darbiem */
function teamView_(r) {
  const date = String(r.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Nav datuma');
  ensureStanding_(date);
  const units = units_(date);
  const jobs = readJobs_().filter(j => j.datums === date && j.brigade).map(j => ({
    id: j.id, datums: j.datums, adrese: j.adrese, tips: j.tips, apraksts: j.apraksts, vaditajs: j.vaditajs,
    brigade: j.brigade, statuss: j.statuss, lidz: j.lidz, prombutne: j.prombutne, foto: j.foto, komentars: j.komentars, iemesls: j.iemesls, izpildits: j.izpildits,
    steidzami: j.steidzami, laiks: j.laiks, parbaude: j.parbaude, parbKom: j.parbKom
  }));
  const addrs = jobs.map(j => normName_(j.adrese));
  const objects = objects_().filter(o => addrs.indexOf(normName_(o.adrese)) !== -1);
  const managers = users_().filter(x => x.role === 'vaditajs').map(x => ({ name: x.name, color: x.color }));
  return { date: date, units: units, jobs: jobs, meta: { objects: objects, managers: managers, jobTypes: jobTypes_() } };
}

/** Brigāde (bez PIN) atzīmē darbu kā izpildītu vai atceļ atzīmi; var pievienot bildes un komentāru */
function teamDone_(r) {
  let job = findJob_(r.id);
  if (!job || !job.brigade) throw new Error('Darbs nav atrasts vai nav piešķirts vienībai');
  const ids = r.done ? savePhotos_(job, r.photos) : [];
  return withLock_(() => {
    job = findJob_(r.id);
    if (r.done) {
      job.statuss = 'izpildīts'; job.izpildits = now_(); job.iemesls = ''; job.parbaude = '';
      job.komentars = String(r.komentars || '').trim();
      job.foto = splitNames_(job.foto).concat(ids).join(',');
    } else {
      job.statuss = 'piešķirts'; job.izpildits = ''; job.iemesls = '';
    }
    writeJob_(sheet_(SH_JOBS), job);
    if (r.done) notify_(namesByRole_('admin').concat(job.vaditajs ? [job.vaditajs] : []), '✓ Izpildīts · ' + job.brigade,
      job.adrese + (job.komentars ? ' — ' + job.komentars : '') + (ids.length ? ' 📷' + ids.length : ''));
    return { job: clean_(job) };
  });
}

/** Brigāde (bez PIN) ziņo, ka darbu nevar izpildīt */
function teamCant_(r) {
  return withLock_(() => {
    const job = findJob_(r.id);
    if (!job || !job.brigade) throw new Error('Darbs nav atrasts vai nav piešķirts vienībai');
    const reason = String(r.iemesls || '').trim();
    if (!reason) throw new Error('Norādiet iemeslu');
    job.statuss = 'nevar izpildīt'; job.iemesls = reason; job.izpildits = now_();
    writeJob_(sheet_(SH_JOBS), job);
    notify_(namesByRole_('admin').concat(job.vaditajs ? [job.vaditajs] : []), '⚠ Nevar izpildīt · ' + job.brigade, job.adrese + ' — ' + reason);
    return { job: clean_(job) };
  });
}

/* ---------------- Atvaļinājuma sērija ---------------- */

/** Datumi no start līdz lidz (ieskaitot), bez sestdienām/svētdienām, ja brivdienas=false. Max 62 dienas. */
function seriesDates_(start, lidz, brivdienas) {
  if (!lidz || lidz <= start) return [start];
  const out = [];
  const d = new Date(start + 'T12:00:00');
  const end = new Date(lidz + 'T12:00:00');
  while (d <= end && out.length < 62) {
    const wd = d.getDay();
    if (brivdienas || (wd !== 0 && wd !== 6) || out.length === 0) out.push(Utilities.formatDate(d, TZ, 'yyyy-MM-dd'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/* ---------------- AI piezīmes ---------------- */

const AI_SYSTEM = 'Tu palīdzi apsaimniekošanas uzņēmuma darbiniekiem uzrakstīt īsas darba piezīmes latviešu valodā. ' +
  'Pārraksti lietotāja tekstu skaidrā, pieklājīgā, lietišķā latviešu valodā ar pareizu gramatiku un garumzīmēm. ' +
  'Saglabā visus faktus (vārdus, laikus, numurus, vietas), neko neizdomā un nepievieno jaunas detaļas. ' +
  'Ja teksts ir tukšs, sagatavo piezīmi TIKAI no piekļuves informācijas (kodi, iezvani, vārti) — bez vispārīgiem norādījumiem un bez izdomātām detaļām. ' +
  'Piekļuves kodus, tālruņu numurus un simbolus (#, *) pārraksti precīzi, neko nemainot. Neizdomā informāciju, kuras nav. ' +
  'Pārbaudi locījumus (piem. „pie dežuranta”, nevis „pie dežurantā”). ' +
  'Neatkārto adresi un darba nosaukumu — tie jau redzami blakus piezīmei. ' +
  'Garums: 1–3 teikumi, ne vairāk kā 300 rakstzīmes. Atbildē raksti TIKAI gatavo piezīmi, bez pēdiņām un paskaidrojumiem.';

function aiPrompt_(r) {
  const kind = { note: 'Darbu vadītāja piezīme brigādei pie pieteiktā darba', done: 'Brigādes komentārs pēc darba izpildes',
    cant: 'Brigādes paskaidrojums, kāpēc darbu nevar izpildīt' }[r.kind] || 'Darba piezīme';
  let piekluve = String(r.piekluve || '');
  if (!piekluve && r.adrese) {
    const o = objects_().find(x => normName_(x.adrese) === normName_(r.adrese));
    if (o) piekluve = o.piekluve;
  }
  return 'Situācija: ' + kind + '\nAdrese: ' + (r.adrese || '—') + '\nDarbs: ' + (r.tips || '—') +
    (piekluve ? '\nPiekļuve: ' + piekluve : '') +
    '\n\nLietotāja teksts:\n' + (String(r.text || '').trim() ? String(r.text).slice(0, 1000) : '(tukšs — sagatavo piezīmi)');
}

function aiWrite_(u, r) {
  if (!String(r.text || '').trim() && r.kind === 'note') {
    const o = objects_().find(x => normName_(x.adrese) === normName_(r.adrese));
    if (!o || !o.piekluve) throw new Error('Šai adresei nav piekļuves informācijas — uzrakstiet dažus vārdus, un AI tos noformēs');
  }
  const text = aiCall_(AI_SYSTEM, aiPrompt_(r), 2000);
  return String(text || '').trim().replace(/^["„“]|["”“]$/g, '');
}

/** AI pieteikums: no brīva teksta (WhatsApp ziņas) izveido formas rindas */
function aiParse_(u, r) {
  const msg = String(r.text || '').trim();
  if (!msg) throw new Error('Ielīmē vai uzraksti ziņu');
  const objs = objects_();
  const mine = objs.filter(o => o.vaditajs === u.name).concat(objs.filter(o => o.vaditajs !== u.name)).slice(0, 400).map(o => o.adrese);
  const types = jobTypes_();
  const system = 'Tu no apsaimniekošanas darbu vadītāja ziņas izveido darbu pieteikumus. Atbildi TIKAI ar JSON, bez paskaidrojumiem.';
  const mgrs = users_().filter(x => x.role === 'vaditajs').map(x => x.name);
  const prompt = 'Šodien: ' + r.today + ' (' + r.weekday + ').\n' +
    (u.role === 'admin' ? 'Darbu vadītāji: ' + mgrs.join(', ') + '. Ja ziņā minēts, kurš vadītājs piesaka, norādi "vaditajs".\n' : '') +
    'Darbu veidi (tips jāizvēlas TIKAI no šiem): ' + types.map(t => t.name + ' [' + t.group + ']').join('; ') + '\n' +
    'Zināmās adreses (ja ziņā minēta līdzīga, izmanto precīzi šo rakstību): ' + mine.join('; ') + '\n\n' +
    'Ziņa:\n' + msg.slice(0, 3000) + '\n\n' +
    'Atgriez JSON: {"datums":"YYYY-MM-DD vai null","vaditajs":"vārds vai null","rindas":[{"adrese":"...","tips":"...","apraksts":"īsa piezīme latviski vai tukšs","prombutne":"Atvaļinājums|DNL|Vakance vai null","lidz":"YYYY-MM-DD vai null"}]}. ' +
    '"prombutne" — kāpēc jāaizvieto: atvaļinājums, DNL (slimības lapa, darba nespējas lapa, slims) vai vakance (nav darbinieka); tikai aizvietošanas darbiem. ' +
    '"datums" = diena, uz kuru attiecas darbi (piem. "rīt" → rītdienas datums); ja nav minēts, null. ' +
    '"lidz" aizpildi tikai, ja aizvietojamais ir atvaļinājumā/prombūtnē līdz konkrētam datumam. ' +
    '"aizvietot sētnieku" → tips "Sētnieks"; "abus"/"sētnieku un apkopēju" → "Abi". Neizdomā adreses.';
  const raw = aiCall_(system, prompt, 8000);
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI neatgrieza pieteikumu');
  const data = JSON.parse(m[0]);
  const names = types.map(t => t.name);
  const rows = (data.rindas || []).filter(x => x && x.adrese).map(x => ({
    adrese: String(x.adrese).trim(), tips: names.indexOf(x.tips) !== -1 ? x.tips : '',
    apraksts: String(x.apraksts || '').trim(), lidz: /^\d{4}-\d{2}-\d{2}$/.test(x.lidz || '') ? x.lidz : '',
    prombutne: PROMBUTNE.indexOf(x.prombutne) !== -1 ? x.prombutne : ''
  }));
  return { datums: /^\d{4}-\d{2}-\d{2}$/.test(data.datums || '') ? data.datums : '', vaditajs: mgrs.indexOf(data.vaditajs) !== -1 ? data.vaditajs : '', rows: rows };
}

function aiCall_(system, prompt, maxTokens) {
  const props = PropertiesService.getScriptProperties();
  const model = props.getProperty('AI_MODEL');
  const claudeKey = props.getProperty('ANTHROPIC_API_KEY');
  const geminiKey = props.getProperty('GEMINI_API_KEY');
  if (claudeKey) {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: model || 'claude-haiku-5-5', max_tokens: maxTokens, system: system, messages: [{ role: 'user', content: prompt }] })
    });
    const j = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) throw new Error('AI kļūda: ' + (j.error && j.error.message || res.getResponseCode()));
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  }
  if (geminiKey) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + (model || 'gemini-2.5-flash') + ':generateContent?key=' + encodeURIComponent(geminiKey);
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens }
      })
    });
    const j = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) throw new Error('AI kļūda: ' + (j.error && j.error.message || res.getResponseCode()));
    return (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
  }
  throw new Error('AI nav iestatīts (Script properties: ANTHROPIC_API_KEY vai GEMINI_API_KEY)');
}

/* ---------------- Atzīmes un foto ---------------- */

function canMark_(u, job) {
  const own = u.role === 'brigade' && job.brigade === u.name && job.publicets;
  if (!own && u.role !== 'admin') throw new Error('Nav atļauts');
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* mape izdzēsta — izveido jaunu */ }
  }
  const folder = DriveApp.createFolder('Darbu sadale — foto');
  props.setProperty('FOTO_FOLDER_ID', folder.getId());
  return folder;
}

/** Saglabā līdz 4 bildēm (data:image/...;base64) Drive mapē, atgriež failu ID */
function savePhotos_(job, photos) {
  if (!photos || !photos.length) return [];
  const folder = photoFolder_();
  const base = (job.datums + ' ' + job.adrese).replace(/[\\/:*?"<>|]/g, '-');
  return photos.slice(0, 4).map((d, i) => {
    const m = String(d).match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!m) return null;
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], base + ' ' + (i + 1) + '.jpg');
    const f = folder.createFile(blob);
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { console.warn('Koplietošana nav atļauta', e); }
    return f.getId();
  }).filter(Boolean);
}

/* ---------------- Objekti un darbu veidi ---------------- */

function objSheet_() {
  let sh = sheet_(SH_OBJ);
  if (!sh) {
    sh = ss_().insertSheet(SH_OBJ);
    sh.getRange(1, 1, 1, 4).setValues([['Adrese', 'Vaditajs', 'Grupa', 'Piekluve']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, 3).getValue() !== 'Grupa') {
    sh.getRange(1, 3, 1, 2).setValues([['Grupa', 'Piekluve']]).setFontWeight('bold');
  }
  return sh;
}

function typesSheet_() {
  let sh = sheet_(SH_TYPES);
  if (!sh) {
    sh = ss_().insertSheet(SH_TYPES);
    sh.getRange(1, 1, 1, 2).setValues([['Darbs', 'Grupa']]).setFontWeight('bold');
    sh.getRange(2, 1, 8, 2).setValues([
      ['Sētnieks', 'Aizvietošana'], ['Abi', 'Aizvietošana'], ['Uzkopēja', 'Aizvietošana'],
      ['Kāpņu telpas mazgāšana', 'Uzkopšana'], ['Logu mazgāšana', 'Uzkopšana'], ['Lifta kabīnes tīrīšana', 'Uzkopšana'],
      ['Ģenerālā uzkopšana', 'Uzkopšana'], ['Uzkopšana pēc remonta', 'Uzkopšana'], ['Pagraba / bēniņu sakopšana', 'Uzkopšana'],
      ['Pazemes stāvvietas uzkopšana', 'Uzkopšana'], ['Atkritumu novietnes sakopšana', 'Uzkopšana'], ['Grafiti / sludinājumu noņemšana', 'Uzkopšana'],
      ['Dezinfekcija', 'Uzkopšana'], ['Teritorijas sakopšana', 'Teritorija'], ['Rotaļu laukuma sakopšana', 'Teritorija'],
      ['Lielgabarīta atkritumu savākšana', 'Teritorija'], ['Notekrenu tīrīšana', 'Teritorija'], ['Lapu savākšana', 'Sezonālie darbi'],
      ['Sniega tīrīšana', 'Sezonālie darbi'], ['Pretslīdes kaisīšana (smilts / sāls)', 'Sezonālie darbi'], ['Ledus un lāsteku notīrīšana', 'Sezonālie darbi'],
      ['Pavasara sakopšana', 'Sezonālie darbi'], ['Zāles pļaušana', 'Sezonālie darbi'], ['Krūmu un dzīvžogu apgriešana', 'Sezonālie darbi'],
      ['Puķu dobju kopšana un ravēšana', 'Sezonālie darbi'], ['Laistīšana', 'Sezonālie darbi'], ['Cits papilddarbs', 'Papilddarbs']
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** [{adrese, vaditajs, grupa, piekluve}] — vaditajs tukšs = kopīgs objekts */
function objects_() {
  const sh = objSheet_();
  const data = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 4).getValues();
  const canon = {};
  users_().filter(x => x.role === 'vaditajs').forEach(m => canon[normName_(m.name)] = m.name);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const v = String(data[i][1] || '').trim();
    if (data[i][0]) out.push({ adrese: String(data[i][0]).trim(), vaditajs: canon[normName_(v)] || v,
      grupa: String(data[i][2] || 'SH objekti').trim(), piekluve: String(data[i][3] || '').trim() });
  }
  return out;
}

/** Vārdu salīdzināšanai: bez garumzīmēm, mazie burti */
/** Vienības, kurām piešķirts darbs (var būt vairākas, atdalītas ar „|”) */
function brigs_(s) { return String(s || '').split('|').map(x => x.trim()).filter(Boolean); }

function normName_(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

/** {normalizēta adrese: vadītāja vārds kā lapā Lietotaji} */
function objectManagers_() {
  const mgrs = users_().filter(x => x.role === 'vaditajs');
  const canon = {};
  mgrs.forEach(m => canon[normName_(m.name)] = m.name);
  const out = {};
  objects_().forEach(o => { if (o.vaditajs) out[normName_(o.adrese)] = canon[normName_(o.vaditajs)] || o.vaditajs; });
  return out;
}

function addObjects_(addrs, vaditajs) {
  const known = objects_().map(o => o.adrese.toLowerCase());
  const sh = objSheet_();
  const seen = {};
  addrs.forEach(a => {
    const k = a.toLowerCase();
    if (known.indexOf(k) === -1 && !seen[k]) { seen[k] = 1; sh.appendRow([a, vaditajs || '', 'SH objekti', '']); }
  });
}

/** [{name, group}] */
function jobTypes_() {
  const data = typesSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) out.push({ name: String(data[i][0]).trim(), group: String(data[i][1] || 'Papilddarbs').trim() });
  }
  return out;
}

function groupOf_(name) {
  const t = jobTypes_().find(x => x.name === name);
  if (t) return t.group;
  return name === 'Papilddarbs' ? 'Papilddarbs' : 'Aizvietošana';
}

/* ---------------- Brigāžu sastāvs ---------------- */

function staffSheet_() {
  let sh = sheet_(SH_STAFF);
  if (!sh) {
    sh = ss_().insertSheet(SH_STAFF);
    sh.getRange(1, 1, 1, 2).setValues([['Vards', 'Pamatbrigade']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function crewSheet_() {
  let sh = sheet_(SH_CREW);
  if (!sh) {
    sh = ss_().insertSheet(SH_CREW);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange(1, 1, 1, 3).setValues([['Datums', 'Brigade', 'Personas']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function splitNames_(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

/** Darbinieku saraksts: [{name, brigade}] (brigade = pamatbrigāde, var būt tukša) */
function staff_() {
  const data = staffSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) out.push({ name: String(data[i][0]).trim(), brigade: String(data[i][1] || '').trim() });
  }
  return out;
}

/** Sastāvs datumam: {brigāde: [vārdi]}. Ja dienai nav ievadīts, ņem pamatbrigādes. */
/** Dienas vienības secībā: [{name, persons}] */
function units_(date) {
  const out = [];
  const data = crewSheet_().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (dateStr_(data[i][0]) === date && data[i][1]) out.push({ name: String(data[i][1]), persons: splitNames_(data[i][2]) });
  }
  return out;
}

/** {vienība: [vārdi]} */
function crews_(date) {
  const out = {};
  units_(date).forEach(x => out[x.name] = x.persons);
  return out;
}

/* ---------------- Push (Firebase Cloud Messaging) ---------------- */

function notify_(names, title, body) {
  try {
    const props = PropertiesService.getScriptProperties();
    const saJson = props.getProperty('FCM_SERVICE_ACCOUNT');
    if (!saJson || !names || !names.length) return 0;
    const sa = JSON.parse(saJson);
    const appUrl = props.getProperty('APP_URL') || '';
    const sh = sheet_(SH_TOKENS);
    const data = sh.getDataRange().getValues();
    const targets = [];
    for (let i = 1; i < data.length; i++) {
      if (names.indexOf(String(data[i][0])) !== -1 && data[i][1]) targets.push({ row: i + 1, token: String(data[i][1]) });
    }
    if (!targets.length) return 0;
    const access = fcmAccessToken_(sa);
    const url = 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send';
    const reqs = targets.map(t => ({
      url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + access },
      payload: JSON.stringify({
        message: {
          token: t.token,
          notification: { title: title, body: body },
          webpush: appUrl ? { fcm_options: { link: appUrl }, notification: { icon: appUrl + 'icons/icon-192.png' } } : undefined
        }
      })
    }));
    const res = UrlFetchApp.fetchAll(reqs);
    let ok = 0;
    const dead = [];
    res.forEach((r, i) => {
      const code = r.getResponseCode();
      if (code === 200) ok++;
      else if (code === 404 || /UNREGISTERED|registration-token-not-registered/.test(r.getContentText())) dead.push(targets[i].row);
    });
    dead.sort((a, b) => b - a).forEach(row => sh.deleteRow(row));
    return ok;
  } catch (err) {
    console.error('notify_', err);
    return 0;
  }
}

function fcmAccessToken_(sa) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('fcm_access');
  if (cached) return cached;
  const now = Math.floor(Date.now() / 1000);
  const enc = o => Utilities.base64EncodeWebSafe(JSON.stringify(o), Utilities.Charset.UTF_8).replace(/=+$/, '');
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }
  });
  const token = JSON.parse(res.getContentText()).access_token;
  cache.put('fcm_access', token, 3300);
  return token;
}

/* ---------------- Palīgfunkcijas ---------------- */

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function str_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm') : String(v || ''); }
function dateStr_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || ''); }
function lvDate_(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' : iso; }
function requireAdmin_(u) { if (u.role !== 'admin') throw new Error('Tikai adminam'); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------------- Sākotnējā iestatīšana ---------------- */

function setup() {
  const ss = ss_();
  let u = ss.getSheetByName(SH_USERS);
  if (!u) {
    u = ss.insertSheet(SH_USERS);
    u.getRange('C:C').setNumberFormat('@');
    u.getRange(1, 1, 1, 4).setValues([['Vards', 'Loma', 'PIN', 'Krasa']]).setFontWeight('bold');
    u.getRange(2, 1, 7, 4).setValues([
      ['Admins', 'admin', '1000', '#1C1C1E'],
      ['Rostislavs', 'vaditajs', '2001', '#2E9E5B'],
      ['Silvestrs', 'vaditajs', '2002', '#8E5BD6'],
      ['Nikita', 'vaditajs', '2003', '#E6B800'],
      ['Kaspars', 'vaditajs', '2004', '#D0D0D5'],
      ['Lelde', 'vaditajs', '2005', '#E04848'],
      ['Raimonds', 'vaditajs', '2006', '#3478F6']
    ]);
    u.setFrozenRows(1);
  }
  let j = ss.getSheetByName(SH_JOBS);
  if (!j) {
    j = ss.insertSheet(SH_JOBS);
    j.getRange('A:Q').setNumberFormat('@');
    j.getRange(1, 1, 1, JOB_COLS.length).setValues([JOB_COLS]).setFontWeight('bold');
    j.setFrozenRows(1);
  }
  j.getRange(1, 1, 1, JOB_COLS.length).setValues([JOB_COLS]).setFontWeight('bold'); // jaunās kolonnas esošai lapai
  photoFolder_(); // pieprasa Drive atļauju foto saglabāšanai
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_URL')) props.setProperty('APP_URL', 'https://vaitkevix.github.io/aizvietosana/');
  let t = ss.getSheetByName(SH_TOKENS);
  if (!t) {
    t = ss.insertSheet(SH_TOKENS);
    t.getRange(1, 1, 1, 4).setValues([['Vards', 'Token', 'Ierice', 'Atjaunots']]).setFontWeight('bold');
    t.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SH_STAFF)) {
    staffSheet_().getRange(2, 1, 4, 2).setValues([['Jānis', ''], ['Pēteris', ''], ['Andris', ''], ['Ivars', '']]);
  }
  crewSheet_();
  objSheet_();
  typesSheet_();
  const first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' || first.getName() === 'Lapa1') {
    if (first.getLastRow() === 0) ss.deleteSheet(first);
  }
}

/** Palaid no redaktora, lai pārbaudītu Firebase iestatījumus (sūta visiem adminiem). */
function testPushAdmins() {
  Logger.log('Nosūtīti: ' + notify_(namesByRole_('admin'), 'Darbu sadale', 'Tests no Apps Script ✓'));
}

/* ---------------- Cloudflare tilts (© VAITKEVIX, SIA) ----------------
 * Ātrā versija strādā Cloudflare (Workers + D1). Šis skripts paliek kā „tilts” uz Google:
 * bildes Google Drive, AI, push paziņojumi, lietotāju/darbu veidu/objektu saraksts un nakts kopija tabulā.
 * Script properties: BRIDGE_KEY (tā pati, kas Cloudflare), CF_URL (Cloudflare Worker adrese).
 */

function bridge_(r) {
  const key = PropertiesService.getScriptProperties().getProperty('BRIDGE_KEY');
  if (!key || r.key !== key) throw new Error('Nav atļauts');
  switch (r.op) {
    case 'photos': return { ids: savePhotos_({ datums: r.datums, adrese: r.adrese }, r.photos) };
    case 'aiNote': {
      const text = aiCall_(AI_SYSTEM, aiPrompt_(r), 2000);
      return { text: String(text || '').trim().replace(/^["„“]|["”“]$/g, '') };
    }
    case 'aiParse': return aiParseBridge_(r);
    case 'push': return pushTokens_(r.tokens || [], r.title, r.body);
    case 'config': return { users: users_(), types: jobTypes_(), objects: objects_() };
    case 'people': return withLock_(() => peopleWrite_(r.people || []));
    case 'addObjects': return withLock_(() => {
      const known = objects_().map(o => normName_(o.adrese));
      const sh = objSheet_();
      (r.rows || []).forEach(x => { if (known.indexOf(normName_(x[0])) === -1) { known.push(normName_(x[0])); sh.appendRow(x); } });
      return {};
    });
    case 'importObjects': return withLock_(() => {
      const sh = objSheet_();
      const last = sh.getLastRow();
      const cur = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
      const idx = {};
      cur.forEach((x, i) => idx[normName_(x[0])] = i);
      (r.rows || []).forEach(x => { const k = normName_(x[0]); if (idx[k] !== undefined) cur[idx[k]] = x; else { idx[k] = cur.length; cur.push(x); } });
      if (cur.length) sh.getRange(2, 1, cur.length, 4).setValues(cur);
      return {};
    });
  }
  throw new Error('Nezināma tilta darbība');
}

/** Portāla pilnvaras → lapas «Pilnvaras» (viss) un «Lietotaji» (Aizvietošanas lomas). Mainīt tikai portālā. © VAITKEVIX, SIA */
function peopleWrite_(list) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const R = { '': '—', admin: 'Administrators', vaditajs: 'Darbu vadītājs', pieteicejs: 'Pieteicējs', 'gatavotājs': 'Gatavotājs', 'vadība': 'Vadība' };
  const head = ['Vārds', 'PIN', 'Krāsa', 'Aktīvs', 'Portāla admins', 'Aizvietošana', 'Izvešana', 'Kaisāmmateriāls', 'Personāls', 'Budžets'];
  let sh = ss.getSheetByName('Pilnvaras') || ss.insertSheet('Pilnvaras');
  sh.clearContents();
  const rows = list.map(p => { const q = p.perms || {}; return [p.name, String(p.pin), p.color || '', p.active ? 'Jā' : 'Nē', q.portal === 'admin' ? 'Jā' : '',
    R[q.aizv || ''] || q.aizv, R[q.izv || ''] || q.izv, R[q.kais || ''] || q.kais, R[q.pers || ''] || q.pers, R[q.budz || ''] || q.budz]; });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0f6b5c').setFontColor('#ffffff');
  if (rows.length) { sh.getRange(2, 2, rows.length, 1).setNumberFormat('@'); sh.getRange(2, 1, rows.length, head.length).setValues(rows); }
  sh.setFrozenRows(1);
  sh.getRange(rows.length + 3, 1).setValue('Mainīt tikai portālā vaitkevix.cloud/sh (Administrēšana). Šī lapa tiek pārrakstīta automātiski. © VAITKEVIX, SIA').setFontStyle('italic').setFontColor('#6b7270');
  const us = sheet_(SH_USERS), last = us.getLastRow();
  if (last > 1) us.getRange(2, 1, last - 1, 4).clearContent();
  const ur = list.filter(p => p.active && p.perms && p.perms.aizv).map(p => [p.name, p.perms.aizv, String(p.pin), p.color || '']);
  if (ur.length) { us.getRange(2, 3, ur.length, 1).setNumberFormat('@'); us.getRange(2, 1, ur.length, 4).setValues(ur); }
  return { written: rows.length };
}

function aiParseBridge_(r) {
  const msg = String(r.text || '').trim();
  if (!msg) throw new Error('Ielīmē vai uzraksti ziņu');
  const types = r.types || [];
  const mgrs = r.managers || [];
  const system = 'Tu no apsaimniekošanas darbu vadītāja ziņas izveido darbu pieteikumus. Atbildi TIKAI ar JSON, bez paskaidrojumiem.';
  const prompt = 'Šodien: ' + r.today + ' (' + r.weekday + ').\n' +
    (r.role === 'admin' ? 'Darbu vadītāji: ' + mgrs.join(', ') + '. Ja ziņā minēts, kurš vadītājs piesaka, norādi "vaditajs".\n' : '') +
    'Darbu veidi (tips jāizvēlas TIKAI no šiem): ' + types.map(t => t.name + ' [' + t.group + ']').join('; ') + '\n' +
    'Zināmās adreses (ja ziņā minēta līdzīga, izmanto precīzi šo rakstību): ' + (r.addresses || []).join('; ') + '\n\n' +
    'Ziņa:\n' + msg.slice(0, 3000) + '\n\n' +
    'Atgriez JSON: {"datums":"YYYY-MM-DD vai null","vaditajs":"vārds vai null","rindas":[{"adrese":"...","tips":"...","apraksts":"īsa piezīme latviski vai tukšs","prombutne":"Atvaļinājums|DNL|Vakance vai null","lidz":"YYYY-MM-DD vai null"}]}. ' +
    '"prombutne" — kāpēc jāaizvieto: atvaļinājums, DNL (slimības lapa, darba nespējas lapa, slims) vai vakance (nav darbinieka); tikai aizvietošanas darbiem. ' +
    '"datums" = diena, uz kuru attiecas darbi (piem. "rīt" → rītdienas datums); ja nav minēts, null. ' +
    '"lidz" aizpildi tikai, ja aizvietojamais ir atvaļinājumā/prombūtnē līdz konkrētam datumam. ' +
    '"aizvietot sētnieku" → tips "Sētnieks"; "abus"/"sētnieku un apkopēju" → "Abi". Neizdomā adreses.';
  const raw = aiCall_(system, prompt, 8000);
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI neatgrieza pieteikumu');
  const data = JSON.parse(m[0]);
  const names = types.map(t => t.name);
  const rows = (data.rindas || []).filter(x => x && x.adrese).map(x => ({
    adrese: String(x.adrese).trim(), tips: names.indexOf(x.tips) !== -1 ? x.tips : '',
    apraksts: String(x.apraksts || '').trim(), lidz: /^\d{4}-\d{2}-\d{2}$/.test(x.lidz || '') ? x.lidz : '',
    prombutne: PROMBUTNE.indexOf(x.prombutne) !== -1 ? x.prombutne : ''
  }));
  return { datums: /^\d{4}-\d{2}-\d{2}$/.test(data.datums || '') ? data.datums : '', vaditajs: mgrs.indexOf(data.vaditajs) !== -1 ? data.vaditajs : '', rows: rows };
}

/** Push uz konkrētiem tokeniem; atgriež nederīgos (tos Cloudflare izdzēš) */
function pushTokens_(tokens, title, body) {
  const props = PropertiesService.getScriptProperties();
  const saJson = props.getProperty('FCM_SERVICE_ACCOUNT');
  if (!saJson || !tokens.length) return { sent: 0, dead: [] };
  const sa = JSON.parse(saJson);
  const appUrl = props.getProperty('APP_URL') || '';
  const access = fcmAccessToken_(sa);
  const url = 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send';
  const res = UrlFetchApp.fetchAll(tokens.map(t => ({
    url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + access },
    payload: JSON.stringify({ message: { token: t, notification: { title: title, body: body },
      webpush: appUrl ? { fcm_options: { link: appUrl }, notification: { icon: appUrl + 'icons/icon-192.png' } } : undefined } })
  })));
  let sent = 0; const dead = [];
  res.forEach((x, i) => { const c = x.getResponseCode(); if (c === 200) sent++; else if (c === 404 || /UNREGISTERED|registration-token-not-registered/.test(x.getContentText())) dead.push(tokens[i]); });
  return { sent: sent, dead: dead };
}

function cfPost_(body) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('CF_URL'), key = props.getProperty('BRIDGE_KEY');
  if (!url || !key) throw new Error('Script properties: ielieciet CF_URL un BRIDGE_KEY');
  const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true, payload: JSON.stringify(Object.assign({ key: key }, body)) });
  const j = JSON.parse(res.getContentText());
  if (!j.ok) throw new Error(j.error || ('Cloudflare kļūda ' + res.getResponseCode()));
  return j;
}

/** VIENREIZ: pārnes visus datus no tabulas uz Cloudflare (var palaist atkārtoti — dati tiek aizvietoti) */
function exportToCloudflare() {
  const jobs = readJobs_().map(clean_);
  const crew = [];
  const cd = crewSheet_().getDataRange().getValues();
  for (let i = 1; i < cd.length; i++) if (cd[i][1]) crew.push({ datums: dateStr_(cd[i][0]), name: String(cd[i][1]), persons: splitNames_(cd[i][2]).join(', ') });
  const tokens = [];
  const td = sheet_(SH_TOKENS) ? sheet_(SH_TOKENS).getDataRange().getValues() : [];
  for (let i = 1; i < td.length; i++) if (td[i][1]) tokens.push({ name: String(td[i][0]), token: String(td[i][1]), device: String(td[i][2] || ''), updated: str_(td[i][3]) });
  const probs = readProblems_().map(p => { const c = Object.assign({}, p); delete c._row; return c; });
  const stand = readStanding_().map(s => { const c = Object.assign({}, s); delete c._row; return c; });
  cfPost_({ action: 'import', reset: true, data: { users: users_(), types: jobTypes_(), objects: objects_(), staff: staff_(), crew: crew, tokens: tokens, problems: probs, standing: stand } });
  for (let i = 0; i < jobs.length; i += 300) cfPost_({ action: 'import', data: { jobs: jobs.slice(i, i + 300) } });
  Logger.log('Pārnests: ' + jobs.length + ' darbi, ' + crew.length + ' vienību ieraksti, ' + probs.length + ' problēmas, ' + stand.length + ' pastāvīgās');
}

/** Nakts kopija no Cloudflare atpakaļ uz tabulu (iestatiet laika trigeri, piem., katru nakti 2:00–3:00) */
function mirrorFromCloudflare() {
  const pull = (table) => { let rows = [], off = 0, more = true; while (more) { const r = cfPost_({ action: 'export', table: table, offset: off, limit: 1000 }); rows = rows.concat(r.rows); off += r.rows.length; more = r.more; } return rows; };
  const put = (sh, head, rows) => {
    sh.clearContents();
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setNumberFormat('@').setValues(rows.map(r => head.map((_, i) => r[i] == null ? '' : String(r[i]))));
  };
  withLock_(() => {
    put(jobsSheet_(), JOB_COLS, pull('jobs'));
    put(crewSheet_(), ['Datums', 'Brigade', 'Personas'], pull('crew'));
    put(staffSheet_(), ['Vards', 'Pamatbrigade'], pull('staff'));
    if (sheet_(SH_TOKENS)) put(sheet_(SH_TOKENS), ['Vards', 'Token', 'Ierice', 'Atjaunots'], pull('tokens'));
    put(probSheet_(), PROB_COLS, pull('problems'));
    put(standSheet_(), STAND_COLS, pull('standing'));
  });
}

/** Pēc lietotāju / PIN / darbu veidu / objektu maiņas tabulā — uzreiz nosūta uz Cloudflare (citādi ik pēc 30 min) */
function syncConfigNow() { Logger.log(JSON.stringify(cfPost_({ action: 'syncConfig' }))); }
