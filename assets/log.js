/* Log leads page: fast entry form, today's punch card, the day's list, and rows that need fixing. */
(function () {
  'use strict';
  const { h, $, clear, d: D, fmt } = QT;
  const { statusMark, fieldError, validate } = QT.leads;

  const state = {
    quoter: '',
    recentFrom: '',    // earliest of this Monday and the start of this pay period
    weekLeads: [],     // this quoter's leads, recentFrom..today
    listLeads: null,   // leads for listDate when it's outside this week
    listDate: '',
    missing: [],
    notes: {},         // date -> note (this quoter)
    status: 'Eligible',
    freshIds: new Set(),
    outbox: [],
  };
  let flushing = false;
  let lastPunch = -1;

  /* ---------------- outbox: leads waiting to reach the database ---------------- */

  const outboxKey = () => 'qt.outbox.' + (QT.user ? QT.user.email : 'anon');
  function loadOutbox() {
    try { state.outbox = JSON.parse(localStorage.getItem(outboxKey()) || '[]'); } catch (e) { state.outbox = []; }
    state.outbox.forEach(i => { if (i.state === 'sending') i.state = 'pending'; });
  }
  function saveOutbox() {
    try { localStorage.setItem(outboxKey(), JSON.stringify(state.outbox)); } catch (e) { /* storage blocked */ }
  }
  const pendingFor = date => state.outbox.filter(i => i.lead.quoter === state.quoter && (!date || i.lead.date === date));

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      let item;
      while ((item = state.outbox.filter(i => i.state === 'pending')[0])) {
        item.state = 'sending';
        try {
          const res = await QT.api('addLead', { lead: item.lead, clientId: item.clientId });
          state.outbox = state.outbox.filter(i => i !== item);
          saveOutbox();
          addKnownLead(res.lead);
          state.freshIds.add(res.lead.id);
          if (res.duplicates && res.duplicates.length) warnDuplicate(res.lead, res.duplicates);
        } catch (err) {
          item.state = 'failed';
          item.error = err.message;
          saveOutbox();
          if (err.code === 'network') {
            QT.toast("Couldn't save. Your leads are kept on this computer and will retry.", {
              kind: 'error', timeout: 0, action: { label: 'Retry now', fn: retryAll },
            });
            break;
          }
        }
        render();
      }
    } finally {
      flushing = false;
      render();
    }
  }
  function retryAll() {
    state.outbox.forEach(i => { if (i.state === 'failed') { i.state = 'pending'; delete i.error; } });
    saveOutbox();
    render();
    flush();
  }
  window.addEventListener('online', retryAll);

  function addKnownLead(lead) {
    if (lead.quoter !== state.quoter) return;
    if (lead.date >= state.recentFrom && lead.date <= QT.today) state.weekLeads.push(lead);
    if (state.listLeads && lead.date === state.listDate) state.listLeads.push(lead);
    if (lead.missing) state.missing.push(lead);
  }
  function replaceKnownLead(lead) {
    removeKnownLead(lead.id);
    addKnownLead(lead);
  }
  function removeKnownLead(id) {
    state.weekLeads = state.weekLeads.filter(l => l.id !== id);
    if (state.listLeads) state.listLeads = state.listLeads.filter(l => l.id !== id);
    state.missing = state.missing.filter(l => l.id !== id);
  }

  function warnDuplicate(lead, dups) {
    QT.leads.warnDuplicate(lead, dups, () => deleteLead(lead, true));
  }

  /* ---------------- form ---------------- */

  const els = {};
  function setStatus(v) {
    state.status = v;
    QT.$$('#status-pick button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    const elig = v === 'Eligible';
    els.pdfField.hidden = !elig;
    els.reasonField.hidden = elig;
    els.emailHint.textContent = elig ? '' : '(optional)';
    clearErrors();
  }

  function clearErrors() {
    QT.$$('#lead-form [aria-invalid]').forEach(i => i.removeAttribute('aria-invalid'));
    QT.$$('#lead-form .field .err-text').forEach(p => p.remove());
    els.formError.hidden = true;
  }

  function readForm() {
    return {
      quoter: state.quoter,
      date: els.date.value,
      name: els.name.value.trim().replace(/\s+/g, ' '),
      status: state.status,
      email: els.email.value.trim(),
      pdf: state.status === 'Eligible' ? els.pdf.value.trim() : '',
      reason: state.status === 'Ineligible' ? els.reason.value.trim() : '',
    };
  }

  function onSubmit(ev) {
    ev.preventDefault();
    clearErrors();
    const lead = readForm();
    const errs = validate(lead, els);
    if (errs.length) {
      errs.forEach(e => fieldError(e[0], e[1]));
      errs[0][0].focus();
      return;
    }
    state.outbox.push({ clientId: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), lead: lead, state: 'pending', at: new Date().toISOString() });
    saveOutbox();
    els.name.value = ''; els.email.value = ''; els.pdf.value = ''; els.reason.value = '';
    QT.$$('#reason-chips .chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    if (state.listDate !== lead.date) setListDate(lead.date, true);
    render();
    els.name.focus();
    flush();
  }

  function setFormDate(v) {
    els.date.value = v;
    els.dateWrap.classList.toggle('not-today', v !== QT.today);
    els.dateWrap.title = v !== QT.today ? 'This is not today' : '';
  }

  /* ---------------- today panel ---------------- */

  function counts(date) {
    const e = { e: 0, i: 0 };
    state.weekLeads.forEach(l => { if (l.date === date) { if (l.status === 'Eligible') e.e++; else if (l.status === 'Ineligible') e.i++; } });
    pendingFor(date).forEach(p => { if (p.lead.status === 'Eligible') e.e++; else e.i++; });
    return e;
  }

  function renderToday() {
    const s = QT.settings;
    const today = QT.today;
    const c = counts(today);
    const weekend = D.isWeekend(today);
    const target = s.dailyTarget;
    const box = clear($('#today'));

    box.appendChild(h('div', { class: 'today-top' },
      h('h2', { text: 'Today' }),
      h('span', { class: 'today-date', text: D.long(today) })));

    box.appendChild(h('div', { class: 'tally' },
      h('span', { class: 'big num', text: String(c.e) }),
      h('span', { class: 'of', text: weekend ? 'eligible, all bonus on weekends' : 'of ' + target + ' eligible' })));

    const punch = h('div', { class: 'punch', role: 'img', 'aria-label': c.e + ' of ' + target + ' eligible leads logged today' });
    const filled = weekend ? 0 : Math.min(c.e, target);
    for (let k = 0; k < target; k++) {
      const on = k < filled;
      punch.appendChild(h('i', { class: (on ? 'on' : '') + (on && k >= lastPunch && lastPunch >= 0 ? ' fresh' : '') }));
    }
    box.appendChild(punch);
    lastPunch = filled;

    const bonus = QT.calc.bonus(c.e, today, s);
    if (bonus > 0) {
      const strip = h('div', { class: 'punch', 'aria-hidden': 'true' });
      for (let k = 0; k < Math.min(bonus, 30); k++) strip.appendChild(h('i', { class: 'bonus' }));
      box.appendChild(h('div', { class: 'bonus-row' },
        h('span', { class: 'bonus-label', text: '+' + bonus + ' bonus' }), strip));
    }

    const total = c.e + c.i;
    const rate = total ? c.e / total : null;
    const rateOk = rate !== null && rate >= s.eligRateTarget;
    const pp = QT.pay.of(today, s);
    const wk = { e: 0, bonus: 0 };
    D.days(pp.from, today).forEach(day => {
      const x = counts(day);
      wk.e += x.e;
      wk.bonus += QT.calc.bonus(x.e, day, s);
    });
    box.appendChild(h('div', { class: 'today-facts' },
      h('div', { class: 'fact' }, h('b', { class: 'num', text: String(c.i) }), h('span', { text: 'ineligible' })),
      h('div', { class: 'fact' }, h('b', { class: 'num', text: fmt.pct(rate, 0) }),
        h('span', null, 'eligible rate ',
          rate === null ? null : h('span', { class: rateOk ? 'ok' : 'low', text: rateOk ? '✓ on target' : '↓ under ' + fmt.pct(s.eligRateTarget, 0) }))),
      h('div', { class: 'fact', title: 'Pay period ' + QT.pay.label(pp) }, h('b', { class: 'num', text: String(wk.e) }),
        h('span', { text: 'this pay period, ' + wk.bonus + ' bonus' }))));

    // Note for the day
    const ta = h('textarea', { id: 'day-note', rows: 2, maxlength: 1000, placeholder: 'Anything that slowed you down? For example: not enough leads, internet outage.' });
    ta.value = state.notes[today] || '';
    const saved = h('span', { class: 'muted', 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn', type: 'button', text: 'Save note' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await QT.api('saveNote', { quoter: state.quoter, date: today, note: ta.value });
        state.notes[today] = ta.value.trim();
        saved.textContent = 'Note saved';
      } catch (e) { QT.toast(e.message, { kind: 'error' }); } finally { btn.disabled = false; }
    });
    box.appendChild(h('div', { class: 'note-box' },
      h('label', { class: 'field' }, h('span', { text: 'Note for today' }), ta),
      h('div', { class: 'row-end' }, saved, btn)));
  }

  /* ---------------- lists ---------------- */

  function setListDate(v, silent) {
    state.listDate = v;
    state.showAll = false;
    els.listDate.value = v;
    els.nextDay.disabled = v >= QT.today;
    const inWeek = v >= state.recentFrom && v <= QT.today;
    state.listLeads = inWeek ? null : [];
    if (!inWeek) {
      QT.busy($('#list-panel'), async () => {
        const res = await QT.api('leads', { quoter: state.quoter, from: v, to: v });
        if (state.listDate === v) state.listLeads = res.leads;
        renderList();
      }).catch(e => QT.toast(e.message, { kind: 'error' }));
    }
    if (!silent) renderList();
  }

  function renderList() {
    const date = state.listDate;
    $('#list-title').textContent = date === QT.today ? "Today's leads" : 'Leads for ' + D.day(date);
    const q = els.search.value.trim().toLowerCase();
    const match = l => !q || l.name.toLowerCase().indexOf(q) >= 0 || (l.email || '').toLowerCase().indexOf(q) >= 0;
    const saved = (state.listLeads || state.weekLeads.filter(l => l.date === date)).slice()
      .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    const pending = pendingFor(date).slice().reverse();
    const body = clear($('#lead-body'));

    pending.filter(p => match(p.lead)).forEach(p => {
      const l = p.lead;
      const failed = p.state === 'failed';
      body.appendChild(h('tr', { class: failed ? 'failed' : 'pending' },
        h('td', null, failed ? h('span', { class: 'flag err', text: 'Not saved' }) : h('span', { class: 'flag plain', text: 'Saving' })),
        h('td', { text: l.name }),
        h('td', null, statusMark(l.status)),
        h('td', { class: 'clip', text: l.email }),
        h('td', { text: l.pdf ? 'Link' : '' }),
        h('td', { class: 'clip', text: failed ? p.error : l.reason }),
        h('td', { class: 'actions' }, failed ? [
          h('button', { class: 'btn btn-quiet', type: 'button', text: 'Retry', onclick: retryAll }),
          h('button', { class: 'btn btn-quiet', type: 'button', text: 'Edit', onclick: () => editPending(p) }),
          h('button', { class: 'btn btn-quiet btn-danger', type: 'button', text: 'Remove', onclick: () => removePending(p) }),
        ] : null)));
    });

    const rows = saved.filter(match);
    const LIMIT = 40;
    rows.slice(0, state.showAll || q ? rows.length : LIMIT).forEach(l => body.appendChild(leadRow(l)));
    if (rows.length > LIMIT && !state.showAll && !q) {
      body.appendChild(h('tr', null, h('td', { colspan: 7, class: 'empty' },
        h('button', { class: 'btn', type: 'button', text: 'Show all ' + rows.length + ' leads', onclick: () => { state.showAll = true; renderList(); } }))));
    }
    if (!rows.length && !pending.length) {
      body.appendChild(h('tr', null, h('td', { colspan: 7, class: 'empty', text: state.listLeads === null || state.listLeads.length || q ?
        (q ? 'No leads match your search.' : 'No leads yet for this day. The first one you log shows up here.') : 'Loading...' })));
    }
    const e = saved.filter(l => l.status === 'Eligible').length + pending.filter(p => p.lead.status === 'Eligible').length;
    const n = saved.length + pending.length;
    $('#list-count').textContent = n ? n + ' leads, ' + e + ' eligible' : '';
  }

  function leadRow(l) {
    const tr = QT.leads.row(l, { fresh: state.freshIds.has(l.id), onEdit: editLead, onDelete: l2 => deleteLead(l2) });
    state.freshIds.delete(l.id);
    return tr;
  }

  function renderMissing() {
    const panel = $('#fix-panel');
    const rows = state.missing.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    panel.hidden = !rows.length;
    $('#fix-count').textContent = rows.length + (rows.length === 1 ? ' row' : ' rows');
    const body = clear($('#fix-body'));
    rows.slice(0, 200).forEach(l => {
      const what = QT.leads.missingWhat(l);
      body.appendChild(h('tr', null,
        h('td', { text: l.date ? D.day(l.date) : 'No date' }),
        h('td', { text: l.name }),
        h('td', null, statusMark(l.status)),
        h('td', { text: what.join(', ') }),
        h('td', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: 'Fix', onclick: () => editLead(l) }))));
    });
  }

  function render() {
    renderToday();
    renderList();
    renderMissing();
  }

  /* ---------------- edit / delete ---------------- */

  function editLead(l) {
    QT.leads.edit(l, {
      defaultQuoter: state.quoter,
      onSaved: (lead, dups) => {
        replaceKnownLead(lead);
        state.freshIds.add(lead.id);
        render();
        if (dups.length) warnDuplicate(lead, dups);
      },
    });
  }

  function editPending(p) {
    const form = QT.leads.fields(p.lead, state.quoter);
    QT.dialog({
      title: 'Fix and retry',
      body: form.body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save and retry', kind: 'btn-primary', submit: true, fn: () => {
            if (!form.check()) return false;
            p.lead = form.read(); p.state = 'pending'; delete p.error;
            saveOutbox(); render(); flush();
          },
        },
      ],
    });
  }

  async function removePending(p) {
    if (!(await QT.confirm('Remove this unsaved lead?', p.lead.name + " was never saved. Removing it can't be undone.", 'Remove'))) return;
    state.outbox = state.outbox.filter(i => i !== p);
    saveOutbox(); render();
  }

  function deleteLead(l, skipConfirm) {
    return QT.leads.remove(l, {
      skipConfirm: skipConfirm,
      onDeleted: () => { removeKnownLead(l.id); lastPunch = -1; render(); },
    });
  }

  /* ---------------- load ---------------- */

  async function loadQuoter(code) {
    state.quoter = code;
    lastPunch = -1;
    const today = QT.today;
    const payStart = QT.pay.startOf(today, QT.settings);
    state.recentFrom = payStart < D.monday(today) ? payStart : D.monday(today);
    const [week, missing, stats] = await Promise.all([
      QT.api('leads', { quoter: code, from: state.recentFrom, to: today }),
      QT.api('leads', { quoter: code, missingOnly: true }),
      QT.api('stats', {}),
    ]);
    state.weekLeads = week.leads;
    state.missing = missing.leads;
    state.notes = {};
    stats.notes.forEach(n => { if (n[0] === code) state.notes[n[1]] = n[2]; });
    setListDate(state.listDate || today, true);
    render();
    lastPunch = Math.min(counts(today).e, QT.settings.dailyTarget);
  }

  QT.boot({
    page: 'log',
    title: 'Log leads',
    minRole: 'quoter',
    async render() {
      Object.assign(els, {
        form: $('#lead-form'), name: $('#f-name'), email: $('#f-email'), pdf: $('#f-pdf'), reason: $('#f-reason'),
        date: $('#f-date'), dateWrap: $('#date-wrap'), pdfField: $('#pdf-field'), reasonField: $('#reason-field'),
        emailHint: $('#email-hint'), formError: $('#form-error'), listDate: $('#list-date'), search: $('#list-search'),
        nextDay: $('#next-day'),
      });
      const u = QT.user;
      let code = u.quoter;
      if (u.role !== 'quoter') {
        const active = QT.quoters.filter(q => q.active);
        let saved = '';
        try { saved = localStorage.getItem('qt.logFor') || ''; } catch (e) { /* ignore */ }
        code = (QT.quoters.some(q => q.code === saved) && saved) || (active[0] || QT.quoters[0] || {}).code;
        const pick = $('#quoter-pick');
        QT.quoters.forEach(q => pick.appendChild(h('option', { value: q.code, text: q.name + ' (' + q.code + ')' + (q.active ? '' : ', inactive'), selected: q.code === code })));
        $('#quoter-pick-wrap').hidden = false;
        $('#page-sub').textContent = 'You are logging and fixing leads on behalf of a quoter.';
        pick.addEventListener('change', () => {
          try { localStorage.setItem('qt.logFor', pick.value); } catch (e) { /* ignore */ }
          QT.busy($('#app'), () => loadQuoter(pick.value)).catch(e => QT.toast(e.message, { kind: 'error' }));
        });
      } else {
        $('#page-sub').textContent = 'Log every lead you work, eligible or not. Press Enter to save and start the next one.';
      }
      if (!code) throw new Error('No quoters exist yet. An admin can add them on the Admin page.');

      // Reasons
      const reasons = QT.settings.reasons || [];
      reasons.forEach(r => $('#reason-list').appendChild(h('option', { value: r })));
      reasons.slice(0, 10).forEach(r => {
        const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: r });
        chip.addEventListener('click', () => {
          els.reason.value = r;
          QT.$$('#reason-chips .chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
          els.reason.focus();
        });
        $('#reason-chips').appendChild(chip);
      });
      els.reason.addEventListener('input', () => {
        QT.$$('#reason-chips .chip').forEach(c => c.setAttribute('aria-pressed', String(c.textContent === els.reason.value)));
      });

      // Status picker: click, arrow keys, Alt+1 / Alt+2 from anywhere in the form
      QT.$$('#status-pick button').forEach(b => {
        b.addEventListener('click', () => setStatus(b.dataset.v));
        b.addEventListener('keydown', e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = state.status === 'Eligible' ? 'Ineligible' : 'Eligible';
            setStatus(next);
            $('#status-pick button[data-v="' + next + '"]').focus();
          }
        });
      });
      document.addEventListener('keydown', e => {
        if (!e.altKey) return;
        if (e.code === 'Digit1') { e.preventDefault(); setStatus('Eligible'); }
        if (e.code === 'Digit2') { e.preventDefault(); setStatus('Ineligible'); }
      });
      setStatus('Eligible');
      setFormDate(QT.today);
      els.date.max = QT.today;
      els.date.addEventListener('change', () => setFormDate(els.date.value || QT.today));
      els.form.addEventListener('submit', onSubmit);
      els.form.addEventListener('input', e => {
        if (e.target.getAttribute('aria-invalid')) {
          e.target.removeAttribute('aria-invalid');
          const p = e.target.closest('.field') && e.target.closest('.field').querySelector('.err-text');
          if (p) p.remove();
        }
      });

      // List controls
      els.listDate.max = QT.today;
      els.listDate.addEventListener('change', () => { if (D.valid(els.listDate.value)) setListDate(els.listDate.value); });
      $('#prev-day').addEventListener('click', () => setListDate(D.add(state.listDate, -1)));
      els.nextDay.addEventListener('click', () => { if (state.listDate < QT.today) setListDate(D.add(state.listDate, 1)); });
      els.search.addEventListener('input', renderList);

      loadOutbox();
      state.listDate = QT.today;
      await loadQuoter(code);
      els.name.focus();
      if (state.outbox.length) flush();
      window.addEventListener('beforeunload', e => {
        if (state.outbox.some(i => i.state !== 'failed')) { e.preventDefault(); e.returnValue = ''; }
      });
    },
  });
})();
