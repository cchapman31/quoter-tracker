/* Demo mode: a fake, in-memory copy of the Apps Script API with made-up people.
 * Loaded only while API_URL in config.js is empty (or the URL has ?demo).
 * Nothing here is saved anywhere; reloading the page starts fresh. */
(function () {
  'use strict';
  const D = QT.d;

  let seed = 20261006;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const normal = (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

  const now = new Date();
  const today = D.iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const start = D.add(D.monday(today), -35);

  const settings = {
    appName: 'Remote Quoter Tracker', dailyTarget: 50, eligRateTarget: 0.65, bonusThreshold: 50,
    weekendBonus: true, trackingStart: start, quotersSeeTeam: false,
    reasons: ['Mobile home', 'Existing customer', 'Fireline score', 'Wildfire exposure', 'Claims', 'Apartment',
      'Bad address', 'No home info', 'Condo / townhouse', 'Commercial property', 'Vacant land', 'Bad name',
      'Contact opt-out', 'Past due premium', 'DOB missing', 'Home condition', 'Coverage or zip limit', 'Duplicate', 'System error'],
  };
  const reasonWeights = [16, 14, 14, 5, 9, 4, 8, 5, 1, 2, 2, 2, 2, 1.5, 1, 2, 1, 1, 1.5];

  const quoters = [
    { code: 'JS 1', name: 'Ava Thompson', active: true, rate: 0.70, pace: 74 },
    { code: 'JS 2', name: 'Bilal Qureshi', active: true, rate: 0.72, pace: 78 },
    { code: 'JS 3', name: 'Chen Wei', active: true, rate: 0.66, pace: 69 },
    { code: 'JS 4', name: 'Divya Raman', active: true, rate: 0.75, pace: 72 },
    { code: 'JS 5', name: 'Elena Cruz', active: true, rate: 0.62, pace: 64 },
    { code: 'JS 6', name: 'Farah Haddad', active: true, rate: 0.69, pace: 80 },
    { code: 'JS 7', name: 'Gabe Moreno', active: false, rate: 0.58, pace: 30, stop: D.add(start, 7) },
    { code: 'JS 8', name: 'Hana Sato', active: false, rate: 0.77, pace: 28, stop: D.add(start, 8) },
  ];

  const first = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Barbara',
    'William', 'Susan', 'Richard', 'Jessica', 'Joseph', 'Sarah', 'Thomas', 'Karen', 'Carlos', 'Maria', 'Daniel',
    'Nancy', 'Paul', 'Lisa', 'Mark', 'Sandra', 'Donald', 'Ashley', 'Kevin', 'Donna', 'Brian', 'Carol', 'Luis', 'Rosa'];
  const last = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
    'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez',
    'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Scott', 'Nguyen'];

  function weightedReason() {
    const total = reasonWeights.reduce((a, b) => a + b, 0);
    let x = rnd() * total;
    for (let i = 0; i < reasonWeights.length; i++) { x -= reasonWeights[i]; if (x <= 0) return settings.reasons[i]; }
    return settings.reasons[0];
  }
  let idn = 1;
  function fakeLead(q, date, status, hour) {
    const fn = pick(first), ln = pick(last);
    const t = new Date(date + 'T' + String(hour).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':00Z');
    const lead = {
      id: 'D' + (idn++), date: date, quoter: q.code, name: fn + ' ' + ln, status: status,
      email: status === 'Eligible' || rnd() < 0.3 ? (fn + '.' + ln + Math.floor(rnd() * 90 + 10)).toLowerCase() + '@example.com' : '',
      pdf: status === 'Eligible' ? 'https://drive.google.com/file/d/demo' + idn + '/view' : '',
      reason: status === 'Ineligible' ? weightedReason() : '',
      by: q.code.toLowerCase().replace(' ', '') + '@example.com', created: t.toISOString(), updated: t.toISOString(), source: 'app',
    };
    if (rnd() < 0.002) { if (status === 'Eligible') lead.pdf = ''; else lead.reason = ''; }
    return lead;
  }

  const leads = [];
  const notes = [];
  const elapsed = Math.min(1, Math.max(0.15, (now.getHours() - 7) / 9));
  D.days(start, today).forEach(date => {
    if (D.isWeekend(date)) return;
    quoters.forEach(q => {
      if (q.stop && date > q.stop) return;
      let n = Math.max(0, Math.round(normal(q.pace, 11)));
      if (date === today) n = Math.round(n * elapsed);
      if (rnd() < 0.03 && date !== today) { n = Math.round(n * 0.3); notes.push([q.code, date, pick(['Internet outage in the afternoon', 'Not enough leads in the queue', 'Power cut for two hours'])]); }
      for (let k = 0; k < n; k++) {
        const lead = fakeLead(q, date, rnd() < q.rate ? 'Eligible' : 'Ineligible', 13 + Math.floor((k / Math.max(n, 1)) * 9));
        if (date === today) lead.created = lead.updated = new Date(now.getTime() - (n - k) * 6 * 60000).toISOString();
        leads.push(lead);
      }
    });
  });

  const users = [
    { email: 'admin@example.com', name: 'Jordan Lee', role: 'admin', quoter: '', active: true },
    { email: 'manager@example.com', name: 'Sam Rivera', role: 'manager', quoter: '', active: true },
  ].concat(quoters.map(q => ({ email: q.code.toLowerCase().replace(' ', '') + '@example.com', name: q.name, role: 'quoter', quoter: q.code, active: q.active })));

  const ROLE_KEY = 'qt.demoRole';
  function role() { try { return sessionStorage.getItem(ROLE_KEY) || 'quoter'; } catch (e) { return 'quoter'; } }
  function me() {
    const r = role();
    if (r === 'admin') return users[0];
    if (r === 'manager') return users[1];
    return users[2];
  }

  function isMissing(l) {
    if (!l.date || !l.status) return true;
    if (l.status === 'Eligible') return !l.email || !l.pdf;
    if (l.status === 'Ineligible') return !l.reason;
    return false;
  }
  const pub = l => Object.assign({}, l, { missing: isMissing(l) });
  const fail = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };
  const scope = (u, q, allowAll) => {
    if (u.role === 'quoter') return u.quoter;
    if (q === 'ALL' && allowAll) return 'ALL';
    if (!q) fail('bad_request', 'Pick a quoter.');
    return q;
  };
  function clean(input, u) {
    const l = {
      quoter: scope(u, input.quoter), date: input.date, name: String(input.name || '').trim().replace(/\s+/g, ' '),
      status: input.status, email: String(input.email || '').trim(), pdf: String(input.pdf || '').trim(), reason: String(input.reason || '').trim(),
    };
    if (!D.valid(l.date)) fail('bad_request', 'Pick the date you worked this lead.');
    if (!l.name) fail('bad_request', "Enter the prospect's full name.");
    if (l.status !== 'Eligible' && l.status !== 'Ineligible') fail('bad_request', 'Choose Eligible or Ineligible.');
    if (l.status === 'Eligible') {
      if (!l.email) fail('bad_request', 'Eligible leads need an email address.');
      if (!/^https?:\/\//i.test(l.pdf)) fail('bad_request', 'Eligible leads need the quote PDF link (starting with https://).');
      l.reason = '';
    } else {
      if (!l.reason) fail('bad_request', 'Ineligible leads need a reason.');
      l.pdf = '';
    }
    return l;
  }
  function dups(l, except) {
    const em = l.email.toLowerCase(), nm = l.name.toLowerCase();
    return leads.filter(x => x.id !== except && ((em && x.email.toLowerCase() === em) ||
      (x.quoter === l.quoter && x.date === l.date && x.name.toLowerCase() === nm)))
      .slice(0, 5).map(x => ({ quoter: x.quoter, date: x.date, name: x.name, status: x.status }));
  }
  function stats() {
    const days = {}, reasons = {}, last = {};
    leads.forEach(l => {
      const k = l.quoter + '|' + l.date;
      const d = days[k] || (days[k] = [l.quoter, l.date, 0, 0, 0, 0]);
      if (l.status === 'Eligible') d[2]++; else if (l.status === 'Ineligible') d[3]++; else d[4]++;
      if (isMissing(l)) d[5]++;
      if (l.status === 'Ineligible') { const rk = k + '|' + (l.reason || 'No reason given'); reasons[rk] = (reasons[rk] || 0) + 1; }
      if (!last[l.quoter] || l.date > last[l.quoter]) last[l.quoter] = l.date;
    });
    return {
      days: Object.values(days),
      reasons: Object.keys(reasons).map(k => { const p = k.split('|'); return [p[0], p[1], p[2], reasons[k]]; }),
      undated: {}, lastLogged: last, notes: notes.slice(),
    };
  }
  const own = (u, q) => u.role !== 'quoter' || u.quoter === q;
  const need = (u, r) => { if (QT.ROLE_RANK[u.role] < QT.ROLE_RANK[r]) fail('forbidden', "Your role can't do that."); };

  const actions = {
    me: u => ({ apiVersion: 1, user: Object.assign({ picture: '' }, u), settings: Object.assign({}, settings), quoters: quoters.map(q => ({ code: q.code, name: q.name, active: q.active })), today: today, timeZone: 'America/Los_Angeles' }),
    leads(u, p) {
      const q = scope(u, p.quoter, true);
      return { leads: leads.filter(l => (q === 'ALL' || l.quoter === q) &&
        (p.missingOnly ? isMissing(l) : l.date >= (p.from || '0000') && l.date <= (p.to || '9999'))).map(pub) };
    },
    addLead(u, p) {
      const l = clean(p.lead || {}, u);
      const d = dups(l);
      const t = new Date().toISOString();
      const lead = Object.assign({ id: 'D' + (idn++), by: u.email, created: t, updated: t, source: 'app' }, l);
      leads.push(lead);
      return { lead: pub(lead), duplicates: d };
    },
    updateLead(u, p) {
      const lead = leads.filter(l => l.id === p.id)[0];
      if (!lead) fail('not_found', 'That lead was already deleted.');
      if (!own(u, lead.quoter)) fail('forbidden', 'You can only edit your own leads.');
      Object.assign(lead, clean(Object.assign({ quoter: lead.quoter }, p.lead), u), { updated: new Date().toISOString() });
      return { lead: pub(lead), duplicates: dups(lead, lead.id) };
    },
    deleteLead(u, p) {
      const i = leads.findIndex(l => l.id === p.id);
      if (i < 0) fail('not_found', 'That lead was already deleted.');
      if (!own(u, leads[i].quoter)) fail('forbidden', 'You can only delete your own leads.');
      leads.splice(i, 1);
      return { deleted: p.id };
    },
    stats(u, p) {
      const all = stats();
      if (u.role !== 'quoter') return all;
      const mine = r => r[0] === u.quoter;
      if (settings.quotersSeeTeam && p.scope === 'team') return Object.assign(all, { notes: all.notes.filter(mine) });
      return { days: all.days.filter(mine), reasons: all.reasons.filter(mine), notes: all.notes.filter(mine), undated: {}, lastLogged: { [u.quoter]: all.lastLogged[u.quoter] } };
    },
    saveNote(u, p) {
      const q = scope(u, p.quoter);
      const i = notes.findIndex(n => n[0] === q && n[1] === p.date);
      const note = String(p.note || '').trim();
      if (i >= 0) notes.splice(i, 1);
      if (note) notes.push([q, p.date, note]);
      return { quoter: q, date: p.date, note: note };
    },
    adminData(u) {
      need(u, 'admin');
      return {
        users: users.slice(), quoters: quoters.map(q => ({ code: q.code, name: q.name, active: q.active })), settings: Object.assign({}, settings),
        settingHelp: {
          appName: 'Name shown at the top of the site', dailyTarget: 'Eligible leads each quoter should log per weekday',
          eligRateTarget: 'Target eligible rate. 0.65 means 65%', bonusThreshold: 'Eligible leads above this number on a weekday count as bonus leads',
          weekendBonus: 'Every eligible lead logged on a Saturday or Sunday counts as a bonus lead', trackingStart: 'First day of the "since start" totals',
          quotersSeeTeam: 'Quoters can open the team page (lead counts only, no prospect details)', reasons: 'Quick-pick ineligible reasons on the log form, one per line',
        },
        counts: { leads: leads.length, imported: 0, fromSite: leads.length, missing: leads.filter(isMissing).length },
        historySource: '',
        sheetUrl: 'https://docs.google.com/spreadsheets/',
      };
    },
    saveUser(u, p) {
      need(u, 'admin');
      const x = p.user || {};
      const email = String(x.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('bad_request', 'Enter a full Google email address.');
      const code = String(x.quoter || '').trim().replace(/\s+/g, ' ').toUpperCase();
      if (x.role === 'quoter' && !code) fail('bad_request', 'Enter the quoter code this person logs leads under, for example JS 1.');
      if (code && !quoters.some(q => q.code === code)) {
        if (!p.createQuoter) fail('bad_request', 'Quoter code ' + code + " doesn't exist.");
        quoters.push({ code: code, name: x.name || code, active: true, rate: 0.7, pace: 0 });
      }
      const i = users.findIndex(y => y.email === (p.originalEmail || email));
      const row = { email: email, name: x.name || '', role: x.role, quoter: code, active: x.active !== false };
      if (i >= 0) users[i] = row; else users.push(row);
      return { users: users.slice(), quoters: quoters.map(q => ({ code: q.code, name: q.name, active: q.active })) };
    },
    deleteUser(u, p) {
      need(u, 'admin');
      if (p.email === u.email) fail('bad_request', "You can't remove yourself.");
      const i = users.findIndex(y => y.email === p.email);
      if (i >= 0) users.splice(i, 1);
      return { users: users.slice() };
    },
    saveQuoter(u, p) {
      need(u, 'admin');
      const x = p.quoter || {};
      const code = String(x.code || '').trim().toUpperCase();
      if (!code || !x.name) fail('bad_request', 'Enter a code and a name.');
      const q = quoters.filter(y => y.code === code)[0];
      if (q) Object.assign(q, { name: x.name, active: x.active !== false });
      else quoters.push({ code: code, name: x.name, active: x.active !== false, rate: 0.7, pace: 0 });
      return { quoters: quoters.map(y => ({ code: y.code, name: y.name, active: y.active })) };
    },
    saveSettings(u, p) {
      need(u, 'admin');
      const s = p.settings || {};
      Object.keys(s).forEach(k => {
        if (!(k in settings)) return;
        let v = s[k];
        if (k === 'dailyTarget' || k === 'bonusThreshold') v = parseInt(v, 10);
        if (k === 'eligRateTarget') { v = parseFloat(String(v).replace('%', '')); if (v > 1) v = v / 100; }
        if (k === 'weekendBonus' || k === 'quotersSeeTeam') v = v === true || v === 'true';
        if (k === 'reasons' && typeof v === 'string') v = v.split('|');
        settings[k] = v;
      });
      return { settings: Object.assign({}, settings) };
    },
    importOld(u, p) {
      need(u, 'admin');
      if (!/\/d\/[\w-]{20,}/.test(p.url || '')) fail('bad_request', 'Paste the full link to the old Lead Log Google Sheet.');
      fail('bad_request', "Demo mode can't open real sheets. This works once the site is connected to your database.");
    },
  };

  QT.demo = {
    role: role,
    setRole(r) { try { sessionStorage.setItem(ROLE_KEY, r); } catch (e) { /* ignore */ } },
    call(action, params) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            if (!actions[action]) fail('bad_request', 'Unknown action ' + action);
            resolve(JSON.parse(JSON.stringify(actions[action](me(), params || {}))));
          } catch (e) { reject(e); }
        }, action === 'addLead' ? 350 : 220);
      });
    },
  };
})();
