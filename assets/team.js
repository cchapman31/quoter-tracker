/* Team dashboard: the old "Team Summary" tab, plus charts and the weekly bonus report. */
(function () {
  'use strict';
  const { h, $, clear, d: D, fmt, calc } = QT;
  let stats = null;
  let range = null;
  let rangeCtl = null;
  let showInactive = false;
  let sort = { key: 'rangeE', dir: 'desc' };

  function visibleQuoters() {
    const seen = new Set(stats.days.map(d => d[0]));
    return QT.quoters.filter(q => (showInactive || q.active) && (q.active || seen.has(q.code)));
  }

  function figure(label, value, foot) {
    return h('div', { class: 'figure' }, h('div', { class: 'label', text: label }),
      h('div', { class: 'value', text: value }), h('div', { class: 'foot' }, foot));
  }

  function render() {
    const s = QT.settings;
    const { from, to } = range;
    const quoters = visibleQuoters();
    const codes = new Set(quoters.map(q => q.code));
    const rows = stats.days.filter(d => codes.has(d[0]) && d[1] >= from && d[1] <= to);
    const sum = calc.sum(rows, s);
    const undated = quoters.reduce((a, q) => a + ((stats.undated || {})[q.code] || 0), 0);
    $('#sub').textContent = quoters.length + ' quoters, ' + (range.key === 'custom' ? D.full(from) + ' to ' + D.full(to) : rangeCtl.label().toLowerCase() + ' (' + D.short(from) + (from !== to ? ' to ' + D.short(to) : '') + ')') + '.';

    const f = clear($('#figures'));
    f.appendChild(figure('Eligible leads', fmt.int(sum.e), fmt.int(sum.i) + ' ineligible'));
    f.appendChild(figure('Eligible rate', fmt.pct(sum.pct), sum.pct === null ? '' :
      h('span', { class: sum.pct >= s.eligRateTarget ? 'ok-ink' : 'low-ink', text: (sum.pct >= s.eligRateTarget ? '✓ ' : '↓ ') + 'target ' + fmt.pct(s.eligRateTarget, 0) })));
    f.appendChild(figure('Eligible per quoter-day', fmt.dec(sum.avg), 'target ' + s.dailyTarget + ', ' + fmt.int(sum.activeDays) + ' quoter-days'));
    f.appendChild(figure('Bonus leads', fmt.int(sum.bonus), 'eligible above ' + s.bonusThreshold + ' a day'));
    f.appendChild(figure('Rows missing info', fmt.int(sum.m + undated), undated ? undated + ' have no date' : 'in this range'));

    renderSummary(quoters, from, to);
    const byDate = calc.byDate(rows, s);
    QT.charts.columns($('#team-chart'), {
      dates: D.days(from, to).filter(dt => !D.isWeekend(dt) || byDate.has(dt)),
      rows: byDate, label: 'Team eligible and ineligible leads per day',
      series: [{ key: 'e', name: 'Eligible', color: 'var(--elig)' }, { key: 'i', name: 'Ineligible', color: 'var(--inelig)' }],
      extra: r => {
        const t = (r.e || 0) + (r.i || 0);
        return t ? [['Eligible rate', fmt.pct(r.e / t)], ['Quoters working', fmt.int(r.quoters)], ['Bonus', fmt.int(r.bonus)]] : [];
      },
    });

    const avgItems = quoters.map(q => {
      const x = calc.sum(calc.rows(stats.days, q.code, from, to), s);
      return { label: q.name, value: x.avg || 0, text: fmt.dec(x.avg), has: x.activeDays > 0 };
    }).filter(i => i.has).sort((a, b) => b.value - a.value);
    QT.charts.hbars($('#avg-bars'), { items: avgItems, target: s.dailyTarget, targetLabel: 'Target ' + s.dailyTarget + ' eligible a day', color: 'var(--elig)' });

    const agg = {}; let total = 0;
    stats.reasons.forEach(r => {
      if (!codes.has(r[0]) || r[1] < from || r[1] > to) return;
      agg[r[2]] = (agg[r[2]] || 0) + r[3]; total += r[3];
    });
    QT.charts.hbars($('#reasons'), {
      color: 'var(--inelig)', empty: 'No ineligible leads in this range.',
      items: Object.keys(agg).map(k => ({ label: k, value: agg[k], text: fmt.int(agg[k]), sub: fmt.pct(agg[k] / total, 0) }))
        .sort((a, b) => b.value - a.value).slice(0, 12),
    });

    renderBonus(quoters, from, to);
  }

  /* ---------------- team summary table ---------------- */

  const COLS = [
    { key: 'name', label: 'Quoter', group: '' },
    { key: 'todayE', label: 'Eligible', group: 'today', n: true },
    { key: 'todayI', label: 'Inelig.', group: 'today', n: true },
    { key: 'todayP', label: 'Elig %', group: 'today', n: true },
    { key: 'weekE', label: 'Eligible', group: 'week', n: true, sep: true },
    { key: 'weekP', label: 'Elig %', group: 'week', n: true },
    { key: 'weekA', label: 'Per day', group: 'week', n: true },
    { key: 'rangeE', label: 'Eligible', group: 'range', n: true, sep: true },
    { key: 'rangeI', label: 'Inelig.', group: 'range', n: true },
    { key: 'rangeP', label: 'Elig %', group: 'range', n: true },
    { key: 'rangeA', label: 'Per day', group: 'range', n: true },
    { key: 'bonus', label: 'Bonus', group: 'range', n: true },
    { key: 'missing', label: 'Missing info', group: '', n: true, sep: true },
    { key: 'last', label: 'Last logged', group: '', n: true },
  ];

  function renderSummary(quoters, from, to) {
    const s = QT.settings;
    const today = QT.today;
    const mon = D.monday(today);
    const data = quoters.map(q => {
      const t = calc.sum(calc.rows(stats.days, q.code, today, today), s);
      const w = calc.sum(calc.rows(stats.days, q.code, mon, today), s);
      const r = calc.sum(calc.rows(stats.days, q.code, from, to), s);
      return {
        q: q, name: q.name, todayE: t.e, todayI: t.i, todayP: t.pct, weekE: w.e, weekP: w.pct, weekA: w.avg,
        rangeE: r.e, rangeI: r.i, rangeP: r.pct, rangeA: r.avg, bonus: r.bonus,
        missing: r.m + ((stats.undated || {})[q.code] || 0), last: (stats.lastLogged || {})[q.code] || '',
      };
    });
    const k = sort.key, dir = sort.dir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x === y) return a.name.localeCompare(b.name);
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });

    const t = clear($('#summary'));
    const rangeName = range.key === 'start' ? 'Since ' + D.short(from) : range.key === 'custom' ? D.short(from) + ' to ' + D.short(to) : rangeCtl.label();
    const groups = { today: 'Today', week: 'This week', range: rangeName };
    const g = h('tr', { class: 'group' });
    let i = 0;
    while (i < COLS.length) {
      const grp = COLS[i].group;
      let span = 1;
      while (i + span < COLS.length && COLS[i + span].group === grp && grp) span++;
      g.appendChild(h('th', { colspan: span, class: COLS[i].sep ? 'sep' : '', text: groups[grp] || '' }));
      i += span;
    }
    const hr = h('tr', null, COLS.map(c => h('th', { class: (c.n ? 'n ' : '') + (c.sep ? 'sep' : ''), scope: 'col', 'aria-sort': sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null },
      h('button', { class: 'sort', type: 'button', 'data-dir': sort.key === c.key ? sort.dir : null, text: c.label, onclick: () => {
        sort = { key: c.key, dir: sort.key === c.key && sort.dir === 'desc' ? 'asc' : 'desc' };
        renderSummary(quoters, from, to);
      } }))));
    t.appendChild(h('thead', null, g, hr));

    const body = h('tbody');
    const pctCell = (p, sep) => h('td', { class: 'n' + (sep ? ' sep' : '') + (p !== null && p < s.eligRateTarget ? ' low-ink' : ''), text: fmt.pct(p) });
    data.forEach(r => {
      const go = () => { location.href = 'stats.html?quoter=' + encodeURIComponent(r.q.code) + '&' + (range.key === 'custom' ? 'from=' + from + '&to=' + to : 'range=' + range.key); };
      const canOpen = QT.ROLE_RANK[QT.user.role] > 1 || r.q.code === QT.user.quoter;
      const tr = h('tr', { class: canOpen ? 'clickable' : '' },
        h('td', null, canOpen ? h('a', { href: '#', class: 'link', text: r.name, onclick: e => { e.preventDefault(); go(); } }) : r.name,
          h('span', { class: 'muted', text: ' ' + r.q.code }), r.q.active ? null : [' ', h('span', { class: 'flag plain', text: 'inactive' })]),
        h('td', { class: 'n' }, h('span', { class: 'meter' + (r.todayE >= s.dailyTarget ? ' full' : ''), 'aria-hidden': 'true' },
          h('i', { style: 'width:' + Math.min(100, (r.todayE / s.dailyTarget) * 100) + '%' })), fmt.int(r.todayE)),
        h('td', { class: 'n', text: fmt.int(r.todayI) }),
        pctCell(r.todayP),
        h('td', { class: 'n sep', text: fmt.int(r.weekE) }),
        pctCell(r.weekP),
        h('td', { class: 'n', text: fmt.dec(r.weekA) }),
        h('td', { class: 'n sep', text: fmt.int(r.rangeE) }),
        h('td', { class: 'n', text: fmt.int(r.rangeI) }),
        pctCell(r.rangeP),
        h('td', { class: 'n' + (r.rangeA !== null && r.rangeA < s.dailyTarget ? ' low-ink' : ''), text: fmt.dec(r.rangeA) }),
        h('td', { class: 'n', text: fmt.int(r.bonus) }),
        h('td', { class: 'n sep' }, r.missing ? h('span', { class: 'flag', text: fmt.int(r.missing) }) : '0'),
        h('td', { class: 'n' + (r.last && r.last < D.add(QT.today, -3) ? ' muted' : ''), text: r.last ? D.short(r.last) : 'never' }));
      if (canOpen) tr.addEventListener('click', e => { if (e.target.tagName !== 'A') go(); });
      body.appendChild(tr);
    });
    t.appendChild(body);

    const codes = new Set(quoters.map(q => q.code));
    const all = (a, b) => calc.sum(stats.days.filter(d => codes.has(d[0]) && d[1] >= a && d[1] <= b), s);
    const T = all(today, today), W = all(mon, today), R = all(from, to);
    const miss = data.reduce((a, r) => a + r.missing, 0);
    t.appendChild(h('tfoot', null, h('tr', null,
      h('td', { text: 'Team total' }),
      h('td', { class: 'n', text: fmt.int(T.e) }), h('td', { class: 'n', text: fmt.int(T.i) }), h('td', { class: 'n', text: fmt.pct(T.pct) }),
      h('td', { class: 'n sep', text: fmt.int(W.e) }), h('td', { class: 'n', text: fmt.pct(W.pct) }), h('td', { class: 'n', text: fmt.dec(W.avg) }),
      h('td', { class: 'n sep', text: fmt.int(R.e) }), h('td', { class: 'n', text: fmt.int(R.i) }), h('td', { class: 'n', text: fmt.pct(R.pct) }),
      h('td', { class: 'n', text: fmt.dec(R.avg) }), h('td', { class: 'n', text: fmt.int(R.bonus) }),
      h('td', { class: 'n sep', text: fmt.int(miss) }), h('td'))));
  }

  /* ---------------- bonus report: by pay period or by week ---------------- */

  let bonusBy = 'pay';

  /** Groups (pay periods or Mon-Sun weeks) overlapping the range, newest first, clipped to the range. */
  function bonusTable(quoters, from, to) {
    const s = QT.settings;
    const groups = bonusBy === 'pay'
      ? QT.pay.list(s, from, to)
      : (() => { const w = []; for (let m = D.monday(from); m <= to; m = D.add(m, 7)) w.push({ from: m, to: D.add(m, 6) }); return w.reverse(); })();
    const cols = quoters.filter(q => stats.days.some(d => d[0] === q.code && d[1] >= from && d[1] <= to));
    const rows = groups.map(g => {
      const a = g.from > from ? g.from : from;
      const b = g.to < to ? g.to : to;
      const cells = cols.map(q => calc.sum(calc.rows(stats.days, q.code, a, b), s).bonus);
      return { group: g, partial: g.from < from || (g.to > to && to < QT.today), cells: cells, total: cells.reduce((x, y) => x + y, 0) };
    });
    return { rows: rows, cols: cols };
  }

  function groupLabel(r) {
    return bonusBy === 'pay' ? QT.pay.label(r.group) : D.short(r.group.from);
  }

  function renderBonus(quoters, from, to) {
    const s = QT.settings;
    $('#bonus-title').textContent = bonusBy === 'pay' ? 'Bonus leads by pay period' : 'Bonus leads by week';
    QT.$$('#bonus-by button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === bonusBy)));
    $('#bonus-rule').textContent = 'Bonus = eligible leads above ' + s.bonusThreshold + ' on a weekday, plus every eligible lead on a Saturday or Sunday. ' +
      (bonusBy === 'pay' ? 'Pay periods run Saturday to Friday, every ' + QT.pay.len(s) + ' days.' : 'Weeks run Monday to Sunday.');
    const b = bonusTable(quoters, from, to);
    const t = clear($('#bonus'));
    t.appendChild(h('thead', null, h('tr', null, h('th', { text: bonusBy === 'pay' ? 'Pay period' : 'Week of' }),
      b.cols.map(q => h('th', { class: 'n', title: q.name + ' (' + q.code + ')', text: q.name.split(' ')[0] })), h('th', { class: 'n sep', text: 'Total' }))));
    const body = h('tbody');
    b.rows.forEach(r => body.appendChild(h('tr', null,
      h('td', { style: 'white-space:nowrap' }, groupLabel(r),
        r.partial ? [' ', h('span', { class: 'flag plain', title: 'Only the days inside the selected date range are counted', text: 'partial' })] : null,
        r.group.from <= QT.today && QT.today <= r.group.to ? [' ', h('span', { class: 'flag plain', text: 'in progress' })] : null),
      r.cells.map(c => h('td', { class: 'n' + (c ? '' : ' muted'), text: fmt.int(c) })), h('td', { class: 'n sep', text: fmt.int(r.total) }))));
    t.appendChild(body);
    const colTotals = b.cols.map((_, i) => b.rows.reduce((a, r) => a + r.cells[i], 0));
    t.appendChild(h('tfoot', null, h('tr', null, h('td', { text: 'Total' }),
      colTotals.map(c => h('td', { class: 'n', text: fmt.int(c) })), h('td', { class: 'n sep', text: fmt.int(colTotals.reduce((a, c) => a + c, 0)) }))));
  }

  function exportBonus() {
    const { from, to } = range;
    const b = bonusTable(visibleQuoters(), from, to);
    const rows = [[bonusBy === 'pay' ? 'Pay period start' : 'Week of (Monday)', bonusBy === 'pay' ? 'Pay period end' : 'Week end (Sunday)', 'Partial']
      .concat(b.cols.map(q => q.code + ' ' + q.name), ['Total'])];
    b.rows.slice().reverse().forEach(r => rows.push([r.group.from, r.group.to, r.partial ? 'yes' : ''].concat(r.cells, [r.total])));
    QT.downloadCsv('bonus-leads-by-' + (bonusBy === 'pay' ? 'pay-period' : 'week') + '-' + from + '-to-' + to + '.csv', rows);
  }

  async function exportLeads(btn) {
    const { from, to } = range;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Preparing...';
    try {
      const res = await QT.api('leads', { quoter: 'ALL', from: from, to: to });
      const names = {};
      QT.quoters.forEach(q => { names[q.code] = q.name; });
      const rows = [['Date', 'Quoter code', 'Quoter', 'Prospect', 'Status', 'Email', 'Quote PDF link', 'Ineligible reason', 'Logged by', 'Logged at', 'Missing info']];
      res.leads.sort((a, b) => (a.date + a.quoter).localeCompare(b.date + b.quoter)).forEach(l =>
        rows.push([l.date, l.quoter, names[l.quoter] || '', l.name, l.status, l.email, l.pdf, l.reason, l.by, l.created, l.missing ? 'yes' : '']));
      QT.downloadCsv('leads-' + from + '-to-' + to + '.csv', rows);
    } catch (e) {
      QT.toast(e.message, { kind: 'error' });
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  QT.boot({
    page: 'team',
    title: 'Team',
    minRole: 'manager',
    async render() {
      stats = await QT.api('stats', { scope: 'team' });
      const filters = $('#filters');
      rangeCtl = QT.rangeFilter(filters, { keys: ['today', 'week', 'lastweek', 'month', 'start'], initial: 'start', onChange: r => { range = r; render(); } });
      range = rangeCtl.get();
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { showInactive = cb.checked; render(); });
      filters.appendChild(h('label', { class: 'check' }, cb, 'Show inactive quoters'));
      $('#export-bonus').addEventListener('click', exportBonus);
      QT.$$('#bonus-by button').forEach(b => b.addEventListener('click', () => { bonusBy = b.dataset.v; render(); }));
      if (QT.ROLE_RANK[QT.user.role] > 1) {
        const ex = $('#export-leads');
        ex.hidden = false;
        ex.addEventListener('click', () => exportLeads(ex));
      }
      render();
    },
  });
})();
