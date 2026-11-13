/* Shared code for every page: sign-in, API calls, top bar, date + stats math, dialogs, toasts. */
(function () {
  'use strict';

  const cfg = window.QT_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = !cfg.API_URL || params.has('demo');
  const QT = (window.QT = { cfg: cfg, DEMO: DEMO });
  const ROLE_RANK = { quoter: 1, manager: 2, admin: 3 };
  QT.ROLE_RANK = ROLE_RANK;

  /* ---------------- DOM helpers (data always goes in as text, never HTML) ---------------- */

  function append(el, kids) {
    kids.flat(Infinity).forEach(k => {
      if (k === null || k === undefined || k === false) return;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    });
    return el;
  }
  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
  }
  QT.h = function (tag, attrs) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    return append(el, Array.prototype.slice.call(arguments, 2));
  };
  QT.s = function (tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    setAttrs(el, attrs);
    return append(el, Array.prototype.slice.call(arguments, 2));
  };
  QT.append = append;
  QT.$ = (sel, root) => (root || document).querySelector(sel);
  QT.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  QT.clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  /* ---------------- dates: ISO "YYYY-MM-DD" strings, calendar math in UTC ---------------- */

  const D = (QT.d = {
    toDate: iso => new Date(iso + 'T00:00:00Z'),
    iso: d => d.toISOString().slice(0, 10),
    add(iso, n) { const d = D.toDate(iso); d.setUTCDate(d.getUTCDate() + n); return D.iso(d); },
    dow: iso => D.toDate(iso).getUTCDay(),
    isWeekend(iso) { const w = D.dow(iso); return w === 0 || w === 6; },
    monday: iso => D.add(iso, -((D.dow(iso) + 6) % 7)),
    monthStart: iso => iso.slice(0, 8) + '01',
    days(from, to) { const out = []; for (let x = from; x <= to && out.length < 1200; x = D.add(x, 1)) out.push(x); return out; },
    fmt: (iso, opts) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'UTC' }, opts)).format(D.toDate(iso)),
    long: iso => D.fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' }),
    day: iso => D.fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' }),
    short: iso => D.fmt(iso, { month: 'short', day: 'numeric' }),
    full: iso => D.fmt(iso, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: ts => (ts ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''),
    valid: iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || ''),
  });

  /* ---------------- numbers ---------------- */

  const bad = x => x === null || x === undefined || isNaN(x);
  QT.fmt = {
    int: n => (bad(n) ? '–' : Math.round(n).toLocaleString('en-US')),
    pct: (x, dp) => (bad(x) ? '–' : (x * 100).toFixed(dp === undefined ? 1 : dp) + '%'),
    dec: (x, dp) => (bad(x) ? '–' : Number(x).toFixed(dp === undefined ? 1 : dp)),
  };

  /* ---------------- stats math (same rules as the old sheet) ----------------
   * days rows from the API: [quoter, date, eligible, ineligible, other, missingInfo]
   * Bonus: on a weekday, eligible above the bonus threshold; on a weekend, every
   * eligible lead (when the weekendBonus setting is on).
   * Avg eligible/day: eligible divided by days that had at least one lead.
   */
  QT.calc = {
    bonus(e, iso, s) {
      if (D.isWeekend(iso)) return s.weekendBonus ? e : 0;
      return Math.max(0, e - s.bonusThreshold);
    },
    rows(days, quoter, from, to) {
      return days.filter(d => (!quoter || d[0] === quoter) && d[1] >= from && d[1] <= to);
    },
    sum(rows, s) {
      let e = 0, i = 0, o = 0, m = 0, bonus = 0, active = 0;
      rows.forEach(d => {
        e += d[2]; i += d[3]; o += d[4]; m += d[5];
        bonus += QT.calc.bonus(d[2], d[1], s);
        if (d[2] + d[3] > 0) active++;
      });
      const total = e + i;
      return { e: e, i: i, o: o, m: m, total: total, bonus: bonus, activeDays: active,
        pct: total ? e / total : null, avg: active ? e / active : null };
    },
    /** Totals per date across the given rows: Map(date -> {e,i,o,m,bonus,quoters}) */
    byDate(rows, s) {
      const map = new Map();
      rows.forEach(d => {
        const x = map.get(d[1]) || { e: 0, i: 0, o: 0, m: 0, bonus: 0, quoters: 0 };
        x.e += d[2]; x.i += d[3]; x.o += d[4]; x.m += d[5];
        x.bonus += QT.calc.bonus(d[2], d[1], s);
        if (d[2] + d[3] > 0) x.quoters++;
        map.set(d[1], x);
      });
      return map;
    },
  };

  /** Date-range presets shared by the stats and team pages. */
  QT.ranges = function (today, settings) {
    const mon = D.monday(today);
    return {
      today: { label: 'Today', from: today, to: today },
      week: { label: 'This week', from: mon, to: today },
      lastweek: { label: 'Last week', from: D.add(mon, -7), to: D.add(mon, -3) },
      month: { label: 'This month', from: D.monthStart(today), to: today },
      start: { label: 'Since start', from: settings.trackingStart, to: today },
    };
  };

  QT.quoterName = function (code) {
    const q = (QT.quoters || []).filter(x => x.code === code)[0];
    return q ? q.name + ' (' + q.code + ')' : code;
  };

  /* ---------------- toasts + dialogs ---------------- */

  QT.toast = function (msg, opts) {
    opts = opts || {};
    let host = document.getElementById('toasts');
    if (!host) { host = QT.h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(host); }
    const t = QT.h('div', { class: 'toast ' + (opts.kind || ''), role: opts.kind === 'error' ? 'alert' : 'status' },
      QT.h('span', { class: 'msg', text: msg }));
    const close = () => t.remove();
    if (opts.action) {
      t.appendChild(QT.h('button', { type: 'button', text: opts.action.label, onclick: () => { close(); opts.action.fn(); } }));
    }
    host.appendChild(t);
    const ms = opts.timeout === undefined ? (opts.kind === 'error' ? 9000 : 4500) : opts.timeout;
    if (ms) setTimeout(close, ms);
    return close;
  };

  QT.dialog = function (o) {
    const dlg = QT.h('dialog', { 'aria-labelledby': 'dlg-title' },
      QT.h('div', { class: 'd-head' }, QT.h('h2', { id: 'dlg-title', text: o.title })),
      QT.h('div', { class: 'd-body' }, o.body || null),
      QT.h('div', { class: 'd-foot' }));
    const foot = dlg.querySelector('.d-foot');
    const close = () => { try { dlg.close(); } catch (e) { /* already closed */ } dlg.remove(); };
    (o.actions || []).forEach(a => {
      const b = QT.h('button', { type: a.submit ? 'submit' : 'button', class: 'btn ' + (a.kind || ''), text: a.label });
      b.addEventListener('click', async ev => {
        ev.preventDefault();
        if (!a.fn) return close();
        b.disabled = true;
        try { const keep = await a.fn(dlg); if (keep !== false) close(); } finally { b.disabled = false; }
      });
      foot.appendChild(b);
    });
    dlg.addEventListener('cancel', () => setTimeout(close, 0));
    document.body.appendChild(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea');
    if (first) first.focus();
    return { el: dlg, close: close };
  };

  QT.confirm = function (title, text, label, danger) {
    return new Promise(resolve => {
      let answered = false;
      const d = QT.dialog({
        title: title,
        body: QT.h('p', { text: text, style: 'margin:0' }),
        actions: [
          { label: 'Cancel', fn: () => { answered = true; resolve(false); } },
          { label: label || 'Confirm', kind: danger === false ? 'btn-primary' : 'btn-danger', fn: () => { answered = true; resolve(true); } },
        ],
      });
      d.el.addEventListener('close', () => { if (!answered) resolve(false); });
    });
  };

  QT.downloadCsv = function (filename, rows) {
    const esc = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s;
    };
    const text = rows.map(r => r.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = QT.h('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  /* ---------------- Google sign-in ---------------- */

  const TOKEN_KEY = 'qt.token';
  let gisReady = null;
  let waiting = [];

  function readToken() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.credential && t.exp - 120000 > Date.now()) return t;
    } catch (e) { /* storage blocked */ }
    return null;
  }
  function saveToken(credential) {
    const payload = JSON.parse(atob(credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const t = { credential: credential, exp: payload.exp * 1000, email: payload.email };
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch (e) { /* storage blocked */ }
    memToken = t;
    return t;
  }
  let memToken = null;
  function currentToken() {
    if (memToken && memToken.exp - 120000 > Date.now()) return memToken;
    memToken = readToken();
    return memToken;
  }
  function clearToken() {
    memToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
  }

  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((resolve, reject) => {
      if (!cfg.GOOGLE_CLIENT_ID) {
        reject(new Error('GOOGLE_CLIENT_ID is empty in assets/config.js.'));
        return;
      }
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.async = true;
      sc.onload = () => {
        google.accounts.id.initialize({
          client_id: cfg.GOOGLE_CLIENT_ID,
          callback: resp => {
            saveToken(resp.credential);
            const w = waiting; waiting = [];
            if (!w.length) { location.reload(); return; }
            hideSignIn();
            w.forEach(fn => fn());
          },
          auto_select: true,
          cancel_on_tap_outside: false,
          use_fedcm_for_prompt: true,
        });
        resolve();
      };
      sc.onerror = () => reject(new Error("Google sign-in couldn't load. Check your connection or ad blocker."));
      document.head.appendChild(sc);
    });
    return gisReady;
  }

  function signInNode(message, isError) {
    const card = QT.h('div', { class: 'signin-card' },
      punchArt(),
      QT.h('h1', { text: (QT.settings && QT.settings.appName) || 'Remote Quoter Tracker' }),
      QT.h('p', { text: 'Sign in with the Google account your manager added to the team list.' }),
      QT.h('div', { class: 'gbtn', id: 'gbtn' }),
      message ? QT.h('p', { class: isError ? 'error' : '', text: message }) : null);
    return QT.h('section', { class: 'signin', id: 'signin' }, card);
  }

  function punchArt() {
    const p = QT.h('div', { class: 'punch', 'aria-hidden': 'true' });
    for (let i = 0; i < 30; i++) p.appendChild(QT.h('i', { class: i < 19 ? 'on' : '' }));
    return p;
  }

  async function showSignIn(message, isError) {
    hideSignIn();
    const main = document.getElementById('app');
    if (main) main.hidden = true;
    const node = signInNode(message, isError);
    (main ? main.parentNode : document.body).insertBefore(node, main || null);
    try {
      await loadGis();
      google.accounts.id.renderButton(document.getElementById('gbtn'),
        { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280 });
      google.accounts.id.prompt();
    } catch (e) {
      node.querySelector('.signin-card').appendChild(QT.h('p', { class: 'error', text: e.message }));
    }
  }
  function hideSignIn() {
    const s = document.getElementById('signin');
    if (s) s.remove();
    const main = document.getElementById('app');
    if (main) main.hidden = false;
  }

  function getToken() {
    const t = currentToken();
    if (t) return Promise.resolve(t.credential);
    return new Promise(resolve => {
      waiting.push(() => resolve(currentToken().credential));
      if (waiting.length === 1) showSignIn(QT.user ? 'Your sign-in expired. Sign in again to keep going; nothing you typed is lost.' : '');
    });
  }

  QT.signOut = function () {
    clearToken();
    try { if (window.google) google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    if (DEMO) { try { sessionStorage.removeItem('qt.demoRole'); } catch (e) { /* ignore */ } }
    location.href = 'index.html';
  };

  /* ---------------- API ---------------- */

  function apiError(code, message) { const e = new Error(message); e.code = code; return e; }

  QT.api = async function (action, params, _retried) {
    if (DEMO) return QT.demo.call(action, params || {});
    const credential = await getToken();
    let res;
    try {
      res = await fetch(cfg.API_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action: action, token: credential }, params || {})),
      });
    } catch (e) {
      throw apiError('network', "Can't reach the server. Check your internet connection and try again.");
    }
    if (!res.ok) throw apiError('network', 'The server answered with error ' + res.status + '. Try again in a moment.');
    let json;
    try { json = await res.json(); } catch (e) {
      throw apiError('network', "The server's reply couldn't be read. Check API_URL in assets/config.js and that the web app is deployed for Anyone.");
    }
    if (!json.ok) {
      if (json.code === 'auth' && !_retried) { clearToken(); return QT.api(action, params, true); }
      throw apiError(json.code, json.error);
    }
    return json.data;
  };

  /* ---------------- top bar + boot ---------------- */

  function brand() {
    const mark = QT.h('span', { class: 'brand-mark', 'aria-hidden': 'true' });
    for (let i = 0; i < 10; i++) mark.appendChild(QT.h('i', { class: i < 7 ? 'on' : '' }));
    return QT.h('a', { class: 'brand', href: 'index.html' }, mark,
      QT.h('span', { text: (QT.settings && QT.settings.appName) || 'Remote Quoter Tracker' }));
  }

  function renderTopbar(page) {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    QT.clear(bar);
    const inner = QT.h('div', { class: 'topbar-in' }, brand());
    if (QT.user) {
      const u = QT.user;
      const rank = ROLE_RANK[u.role];
      const links = [['log', 'index.html', 'Log leads']];
      links.push(['stats', 'stats.html', rank > 1 ? 'Quoter stats' : 'My stats']);
      if (rank > 1 || QT.settings.quotersSeeTeam) links.push(['team', 'team.html', 'Team']);
      if (rank > 2) links.push(['admin', 'admin.html', 'Admin']);
      inner.appendChild(QT.h('nav', { class: 'nav', 'aria-label': 'Pages' },
        links.map(l => QT.h('a', { href: l[1], 'aria-current': l[0] === page ? 'page' : null, text: l[2] }))));
      const label = u.role === 'quoter' ? QT.quoterName(u.quoter) : (u.name || u.email);
      inner.appendChild(QT.h('div', { class: 'who' },
        u.picture ? QT.h('img', { src: u.picture, alt: '', referrerpolicy: 'no-referrer' }) : null,
        QT.h('span', { class: 'name-text' }, QT.h('strong', { text: label }),
          u.role !== 'quoter' ? QT.h('span', { text: ' ' + u.role }) : null),
        QT.h('button', { type: 'button', text: 'Sign out', onclick: QT.signOut })));
    }
    bar.appendChild(inner);
    if (DEMO && QT.demo) bar.after(demoBand());
  }

  function demoBand() {
    const old = document.querySelector('.demo-band');
    if (old) old.remove();
    const sel = QT.h('select', { 'aria-label': 'View the demo as' },
      [['quoter', 'Quoter (Ava, JS 1)'], ['manager', 'Manager'], ['admin', 'Admin']].map(o =>
        QT.h('option', { value: o[0], text: o[1], selected: QT.demo.role() === o[0] })));
    sel.addEventListener('change', () => { QT.demo.setRole(sel.value); location.reload(); });
    return QT.h('div', { class: 'demo-band' }, QT.h('div', { class: 'in' },
      QT.h('strong', { text: 'Demo mode.' }),
      QT.h('span', { text: 'Made-up data, nothing is saved. Add your API_URL to assets/config.js to go live.' }),
      QT.h('label', { class: 'check' }, 'View as', sel)));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = src; sc.onload = resolve; sc.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(sc);
    });
  }

  /**
   * Every page calls QT.boot({ page, title, minRole, render }).
   * It signs the person in, loads who they are + settings, draws the top bar,
   * checks their role, then calls render(me).
   */
  QT.boot = async function (opts) {
    const main = document.getElementById('app');
    renderTopbar(opts.page);
    if (main) main.classList.add('loading');
    try {
      if (DEMO) await loadScript('assets/demo.js');
      const me = await QT.api('me');
      QT.me = me; QT.user = me.user; QT.settings = me.settings; QT.quoters = me.quoters; QT.today = me.today;
      document.title = opts.title + ' | ' + me.settings.appName;
      renderTopbar(opts.page);
      const rank = ROLE_RANK[me.user.role];
      const allowed = rank >= ROLE_RANK[opts.minRole || 'quoter'] ||
        (opts.page === 'team' && me.settings.quotersSeeTeam);
      if (!allowed) {
        QT.clear(main).appendChild(QT.h('div', { class: 'panel panel-body' },
          QT.h('h1', { text: "This page isn't available to you" }),
          QT.h('p', { class: 'sub' }, 'Your role is ' + me.user.role + '. ', QT.h('a', { href: 'index.html', text: 'Go to Log leads' }))));
        return;
      }
      await opts.render(me);
    } catch (e) {
      if (e.code === 'not_allowed' || e.code === 'config') {
        clearToken();
        try { if (window.google) google.accounts.id.disableAutoSelect(); } catch (x) { /* ignore */ }
        showSignIn(e.message, true);
      } else {
        QT.clear(main).appendChild(QT.h('div', { class: 'panel panel-body' },
          QT.h('h1', { text: "The page couldn't load" }),
          QT.h('p', { class: 'sub', text: e.message }),
          QT.h('p', null, QT.h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => location.reload() }))));
      }
      console.error(e);
    } finally {
      if (main) main.classList.remove('loading');
    }
  };

  /**
   * Date range presets + custom range, kept in the page URL (?range=week or ?from=..&to=..).
   * rangeFilter(container, { keys, initial, onChange }) -> { get() }
   */
  QT.rangeFilter = function (container, o) {
    const presets = QT.ranges(QT.today, QT.settings);
    const url = new URLSearchParams(location.search);
    let cur;
    if (D.valid(url.get('from')) && D.valid(url.get('to'))) cur = { key: 'custom', from: url.get('from'), to: url.get('to') };
    else {
      const k = presets[url.get('range')] && o.keys.indexOf(url.get('range')) >= 0 ? url.get('range') : o.initial;
      cur = { key: k, from: presets[k].from, to: presets[k].to };
    }
    const seg = QT.h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' });
    const from = QT.h('input', { type: 'date', 'aria-label': 'From', max: QT.today });
    const to = QT.h('input', { type: 'date', 'aria-label': 'To', max: QT.today });
    o.keys.forEach(k => {
      seg.appendChild(QT.h('button', { type: 'button', dataset: { k: k }, text: presets[k].label, onclick: () => {
        cur = { key: k, from: presets[k].from, to: presets[k].to };
        apply();
      } }));
    });
    const onCustom = () => {
      if (!D.valid(from.value) || !D.valid(to.value)) return;
      cur = { key: 'custom', from: from.value <= to.value ? from.value : to.value, to: from.value <= to.value ? to.value : from.value };
      apply();
    };
    from.addEventListener('change', onCustom);
    to.addEventListener('change', onCustom);
    function sync() {
      QT.$$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === cur.key)));
      from.value = cur.from; to.value = cur.to;
      const p = new URLSearchParams(location.search);
      p.delete('range'); p.delete('from'); p.delete('to');
      if (cur.key === 'custom') { p.set('from', cur.from); p.set('to', cur.to); } else p.set('range', cur.key);
      history.replaceState(null, '', location.pathname + '?' + p.toString());
    }
    function apply() { sync(); o.onChange(cur); }
    container.appendChild(seg);
    container.appendChild(QT.h('span', { class: 'custom' }, from, QT.h('span', { class: 'muted', text: 'to' }), to));
    sync();
    return { get: () => cur, label: () => (cur.key === 'custom' ? D.short(cur.from) + ' to ' + D.short(cur.to) : presets[cur.key].label) };
  };

  QT.setParam = function (k, v) {
    const p = new URLSearchParams(location.search);
    if (v) p.set(k, v); else p.delete(k);
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  };

  /** Re-runs fn while showing the previous content dimmed (no layout jump). */
  QT.busy = async function (el, fn) {
    el.classList.add('loading');
    try { return await fn(); } finally { el.classList.remove('loading'); }
  };
})();
