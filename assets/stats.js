/* Stats for one quoter: figures, daily chart, week-by-week, reasons, and day-by-day with notes. */
(function () {
  'use strict';
  const { h, $, clear, d: D, fmt, calc } = QT;
  let stats = null;
  let quoter = '';
  let range = null;

  function daysInRange(from, to, rowsByDate) {
    return D.days(from, to).filter(dt => !D.isWeekend(dt) || rowsByDate.has(dt));
  }

  function figure(label, value, foot) {
    return h('div', { class: 'figure' }, h('div', { class: 'label', text: label }),
      h('div', { class: 'value', text: value }), h('div', { class: 'foot' }, foot));
  }
  function status(ok, good, bad) {
    return h('span', { class: ok ? 'ok-ink' : 'low-ink', text: ok ? '✓ ' + good : '↓ ' + bad });
  }

  function render() {
    const s = QT.settings;
    const { from, to } = range;
    const rows = calc.rows(stats.days, quoter, from, to);
    const sum = calc.sum(rows, s);
    const byDate = calc.byDate(rows, s);
    const notes = {};
    stats.notes.forEach(n => { if (n[0] === quoter) notes[n[1]] = n[2]; });
    const undated = (stats.undated || {})[quoter] || 0;

    $('#title').textContent = QT.user.role === 'quoter' ? 'My stats' : QT.quoterName(quoter);
    const last = (stats.lastLogged || {})[quoter];
    $('#sub').textContent = (QT.user.role === 'quoter' ? QT.quoterName(quoter) + '. ' : '') +
      'Last lead logged ' + (last ? D.day(last) : 'never') + '.';

    // Figures
    const f = clear($('#figures'));
    f.appendChild(figure('Eligible leads', fmt.int(sum.e), fmt.int(sum.i) + ' ineligible, ' + fmt.int(sum.total) + ' total'));
    f.appendChild(figure('Eligible rate', fmt.pct(sum.pct),
      sum.pct === null ? 'target ' + fmt.pct(s.eligRateTarget, 0) : status(sum.pct >= s.eligRateTarget, 'target ' + fmt.pct(s.eligRateTarget, 0), 'target ' + fmt.pct(s.eligRateTarget, 0))));
    f.appendChild(figure('Eligible per day', fmt.dec(sum.avg),
      sum.avg === null ? 'target ' + s.dailyTarget : [status(sum.avg >= s.dailyTarget, 'target ' + s.dailyTarget, 'target ' + s.dailyTarget), ', ' + sum.activeDays + ' days worked']));
    f.appendChild(figure('Bonus leads', fmt.int(sum.bonus), 'eligible above ' + s.bonusThreshold + ' a day'));
    f.appendChild(figure('Rows missing info', fmt.int(sum.m + undated),
      sum.m + undated ? h('a', { href: 'index.html', text: 'Fix them on Log leads' }) : 'all complete'));

    // Daily chart
    const dates = daysInRange(from, to, byDate);
    QT.charts.columns($('#daily-chart'), {
      dates: dates, rows: byDate, label: 'Eligible and ineligible leads per day',
      series: [{ key: 'e', name: 'Eligible', color: 'var(--elig)' }, { key: 'i', name: 'Ineligible', color: 'var(--inelig)' }],
      target: s.dailyTarget, targetLabel: 'Target ' + s.dailyTarget + ' eligible',
      extra: (r, dt) => {
        const out = [];
        const t = (r.e || 0) + (r.i || 0);
        if (t) out.push(['Eligible rate', fmt.pct((r.e || 0) / t)]);
        if (r.bonus) out.push(['Bonus', fmt.int(r.bonus)]);
        if (notes[dt]) out.push(['Note', notes[dt].length > 40 ? notes[dt].slice(0, 40) + '...' : notes[dt]]);
        return out;
      },
    });
    $('#chart-note').textContent = range.key === 'custom' ? D.full(from) + ' to ' + D.full(to) : '';

    renderWeekly(from, to, byDate);
    renderReasons(from, to);
    renderDaily(dates, byDate, notes);
  }

  function renderWeekly(from, to, byDate) {
    const s = QT.settings;
    const t = clear($('#weekly'));
    t.appendChild(h('thead', null, h('tr', null,
      ['Week of', 'Eligible', 'Ineligible', 'Elig %', 'Per day', 'Bonus'].map((x, i) => h('th', { class: i ? 'n' : '', text: x })))));
    const body = h('tbody');
    const weeks = [];
    for (let m = D.monday(from); m <= to; m = D.add(m, 7)) weeks.push(m);
    weeks.reverse().forEach(m => {
      const wrows = [];
      byDate.forEach((v, dt) => { if (dt >= m && dt <= D.add(m, 6) && dt >= from && dt <= to) wrows.push([quoter, dt, v.e, v.i, v.o, v.m]); });
      const w = calc.sum(wrows, s);
      body.appendChild(h('tr', null,
        h('td', { text: D.short(m) }),
        h('td', { class: 'n', text: fmt.int(w.e) }),
        h('td', { class: 'n', text: fmt.int(w.i) }),
        h('td', { class: 'n ' + (w.pct === null ? '' : w.pct >= s.eligRateTarget ? '' : 'low-ink'), text: fmt.pct(w.pct) }),
        h('td', { class: 'n', text: fmt.dec(w.avg) }),
        h('td', { class: 'n', text: fmt.int(w.bonus) })));
    });
    t.appendChild(body);
  }

  function renderReasons(from, to) {
    const agg = {};
    let total = 0;
    stats.reasons.forEach(r => {
      if (r[0] !== quoter || r[1] < from || r[1] > to) return;
      agg[r[2]] = (agg[r[2]] || 0) + r[3];
      total += r[3];
    });
    const items = Object.keys(agg).map(k => ({ label: k, value: agg[k], text: fmt.int(agg[k]), sub: fmt.pct(agg[k] / total, 0) }))
      .sort((a, b) => b.value - a.value).slice(0, 12);
    QT.charts.hbars($('#reasons'), { items: items, color: 'var(--inelig)', empty: 'No ineligible leads in this range.' });
  }

  function renderDaily(dates, byDate, notes) {
    const s = QT.settings;
    const t = clear($('#daily'));
    t.appendChild(h('thead', null, h('tr', null,
      ['Date', 'Eligible', 'Ineligible', 'Total', 'Elig %', 'Bonus', 'Note'].map((x, i) => h('th', { class: i && i < 6 ? 'n' : '', text: x })))));
    const body = h('tbody');
    const canEdit = QT.user.role !== 'quoter' || QT.user.quoter === quoter;
    dates.slice().reverse().forEach(dt => {
      const r = byDate.get(dt) || { e: 0, i: 0, bonus: 0 };
      const total = r.e + r.i;
      const note = notes[dt] || '';
      const noteCell = h('td', { class: 'note-cell' }, note,
        canEdit ? h('button', { class: 'btn btn-quiet', type: 'button', text: note ? 'Edit' : 'Add note', onclick: () => editNote(dt, note) }) : null);
      body.appendChild(h('tr', null,
        h('td', { text: D.day(dt) }),
        h('td', { class: 'n' }, h('span', { class: 'meter' + (r.e >= s.dailyTarget ? ' full' : ''), 'aria-hidden': 'true' },
          h('i', { style: 'width:' + Math.min(100, (r.e / s.dailyTarget) * 100) + '%' })), fmt.int(r.e)),
        h('td', { class: 'n', text: fmt.int(r.i) }),
        h('td', { class: 'n', text: fmt.int(total) }),
        h('td', { class: 'n ' + (total && r.e / total < s.eligRateTarget ? 'low-ink' : ''), text: total ? fmt.pct(r.e / total) : '–' }),
        h('td', { class: 'n', text: r.bonus ? fmt.int(r.bonus) : '' }),
        noteCell));
    });
    if (!dates.length) body.appendChild(h('tr', null, h('td', { colspan: 7, class: 'empty', text: 'No days in this range.' })));
    t.appendChild(body);
  }

  function editNote(date, note) {
    const ta = h('textarea', { rows: 3, maxlength: 1000 });
    ta.value = note;
    QT.dialog({
      title: 'Note for ' + D.day(date),
      body: h('label', { class: 'field' }, h('span', { text: 'What happened this day?' }), ta),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save note', kind: 'btn-primary', fn: async () => {
            try {
              const res = await QT.api('saveNote', { quoter: quoter, date: date, note: ta.value });
              stats.notes = stats.notes.filter(n => !(n[0] === quoter && n[1] === date));
              if (res.note) stats.notes.push([quoter, date, res.note]);
              render();
            } catch (e) { QT.toast(e.message, { kind: 'error' }); return false; }
          },
        },
      ],
    });
  }

  QT.boot({
    page: 'stats',
    title: 'Stats',
    minRole: 'quoter',
    async render() {
      stats = await QT.api('stats', {});
      const u = QT.user;
      const filters = $('#filters');
      range = QT.rangeFilter(filters, { keys: ['week', 'lastweek', 'month', 'start'], initial: 'start', onChange: r => { range = r; render(); } }).get();
      if (u.role === 'quoter') {
        quoter = u.quoter;
      } else {
        const want = new URLSearchParams(location.search).get('quoter');
        const list = QT.quoters.slice().sort((a, b) => (b.active - a.active));
        quoter = (QT.quoters.some(q => q.code === want) && want) || (list[0] || {}).code;
        const sel = h('select', { 'aria-label': 'Quoter' }, list.map(q =>
          h('option', { value: q.code, text: q.name + ' (' + q.code + ')' + (q.active ? '' : ', inactive'), selected: q.code === quoter })));
        sel.addEventListener('change', () => { quoter = sel.value; QT.setParam('quoter', quoter); render(); });
        filters.insertBefore(sel, filters.firstChild);
        QT.setParam('quoter', quoter);
      }
      render();
    },
  });
})();
