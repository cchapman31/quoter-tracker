/* Small SVG/HTML charts: stacked daily columns and ranked horizontal bars. */
(function () {
  'use strict';
  const { h, s, clear, d: D, fmt } = QT;

  function niceStep(max, ticks) {
    const raw = max / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  /** Rect with 4px rounded top corners and a square base. */
  function topRounded(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    if (hgt <= 0) return '';
    return 'M' + x + ',' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt) + 'Z';
  }

  function legend(series, target) {
    return h('div', { class: 'legend' },
      series.map(se => h('span', null, h('i', { style: 'background:' + se.color }), se.name)),
      target ? h('span', null, h('i', { class: 'line', style: 'background:var(--ink-2)' }), target) : null);
  }

  /**
   * columns(el, { dates, rows: Map(date -> obj), series: [{key, name, color}], target, targetLabel, extra(row, date) -> [[label, text]] })
   * Stacked columns, first series at the bottom.
   */
  function columns(el, o) {
    el.__chart = o;
    draw(el);
    if (!el.__ro && window.ResizeObserver) {
      let w = el.clientWidth;
      el.__ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 4) { w = el.clientWidth; draw(el); } });
      el.__ro.observe(el);
    }
  }

  function draw(el) {
    const o = el.__chart;
    clear(el);
    el.classList.add('chart');
    el.appendChild(legend(o.series, o.target ? o.targetLabel : null));
    const W = Math.max(280, el.clientWidth);
    const H = o.height || 240;
    const m = { l: 40, r: 8, t: 14, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const n = o.dates.length;
    if (!n) { el.appendChild(h('p', { class: 'empty', text: 'No leads in this date range.' })); return; }

    const totals = o.dates.map(dt => { const r = o.rows.get(dt) || {}; return o.series.reduce((a, se) => a + (r[se.key] || 0), 0); });
    let max = Math.max.apply(null, totals.concat([o.target || 0, 1]));
    const step = niceStep(max * 1.05, 4);
    max = Math.ceil((max * 1.05) / step) * step;
    const y = v => m.t + ph - (v / max) * ph;
    const band = pw / n;
    const bw = Math.max(2, Math.min(24, band * 0.64));

    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': o.label || 'Daily chart' });
    const grid = s('g', { class: 'grid' });
    const axis = s('g', { class: 'axis' });
    for (let v = 0; v <= max + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      (v === 0 ? axis : grid).appendChild(s('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy }));
      svg.appendChild(s('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', text: fmt.int(v) }));
    }
    svg.appendChild(grid);

    const short = n <= 12;
    const every = Math.max(1, Math.ceil(n / Math.floor(pw / (short ? 58 : 50))));
    const cols = s('g');
    o.dates.forEach((dt, i) => {
      const r = o.rows.get(dt) || {};
      const cx = m.l + band * i + band / 2;
      const g = s('g', { class: 'col', tabindex: '0', 'aria-label': D.day(dt) + ': ' + o.series.map(se => (r[se.key] || 0) + ' ' + se.name.toLowerCase()).join(', ') });
      g.appendChild(s('rect', { class: 'hit', x: m.l + band * i, y: m.t, width: band, height: ph, fill: 'transparent' }));
      let base = 0;
      const visible = o.series.filter(se => (r[se.key] || 0) > 0);
      visible.forEach((se, k) => {
        const v = r[se.key] || 0;
        const y0 = y(base), y1 = y(base + v);
        const gap = k > 0 ? 2 : 0;
        const top = k === visible.length - 1;
        const hgt = Math.max(0, y0 - y1 - gap);
        if (hgt > 0) {
          g.appendChild(top ?
            s('path', { class: 'seg', d: topRounded(cx - bw / 2, y1, bw, hgt, 4), fill: se.color }) :
            s('rect', { class: 'seg', x: cx - bw / 2, y: y1, width: bw, height: hgt, fill: se.color }));
        }
        base += v;
      });
      g.addEventListener('pointerenter', () => tip(el, o, dt, cx, W));
      g.addEventListener('focus', () => tip(el, o, dt, cx, W));
      g.addEventListener('pointerleave', () => untip(el));
      g.addEventListener('blur', () => untip(el));
      cols.appendChild(g);
      if (i % every === 0) {
        svg.appendChild(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle',
          text: short ? D.fmt(dt, { weekday: 'short', day: 'numeric' }) : D.short(dt) }));
      }
    });
    svg.appendChild(axis);
    svg.appendChild(cols);

    if (o.target) {
      const ty = Math.round(y(o.target)) + 0.5;
      const t = s('g', { class: 'target' });
      t.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: ty, y2: ty }));
      svg.appendChild(t);
    }
    el.appendChild(svg);
  }

  function tip(el, o, dt, cx, W) {
    untip(el);
    const r = o.rows.get(dt) || {};
    const box = h('div', { class: 'tip' }, h('div', { class: 't', text: D.day(dt) }),
      o.series.slice().reverse().map(se => h('div', { class: 'r' },
        h('span', null, h('i', { style: 'background:' + se.color }), se.name), h('b', { text: fmt.int(r[se.key] || 0) }))),
      (o.extra ? o.extra(r, dt) : []).map(x => h('div', { class: 'r' }, h('span', { text: x[0] }), h('b', { text: x[1] }))));
    el.appendChild(box);
    const scale = el.clientWidth / Math.max(280, el.clientWidth);
    const left = cx * scale;
    const bw = box.offsetWidth;
    box.style.left = Math.max(0, Math.min(el.clientWidth - bw, left + 14 + bw > el.clientWidth ? left - bw - 14 : left + 14)) + 'px';
    box.style.top = '34px';
  }
  function untip(el) { const t = el.querySelector('.tip'); if (t) t.remove(); }

  /**
   * hbars(el, { items: [{label, value, text}], max, target, targetLabel, color })
   * Ranked horizontal bars with the value at the tip and an optional target mark.
   */
  function hbars(el, o) {
    clear(el);
    if (!o.items.length) { el.appendChild(h('p', { class: 'empty', text: o.empty || 'Nothing to show for this range.' })); return; }
    const max = Math.max.apply(null, o.items.map(i => i.value).concat([o.target || 0, 1])) * 1.04;
    const grid = h('div', { class: 'hbars', role: 'list' });
    o.items.forEach(it => {
      grid.appendChild(h('div', { class: 'lab', title: it.label, text: it.label }));
      const track = h('div', { class: 'track', role: 'listitem', 'aria-label': it.label + ': ' + (it.text || it.value) });
      track.appendChild(h('div', { class: 'fill', style: 'width:' + ((it.value / max) * 100).toFixed(2) + '%;background:' + (o.color || 'var(--elig)') }));
      if (o.target) track.appendChild(h('div', { class: 'mark', style: 'left:' + ((o.target / max) * 100).toFixed(2) + '%' }));
      grid.appendChild(track);
      grid.appendChild(h('div', { class: 'val' }, h('b', { text: it.text || fmt.int(it.value) }), it.sub ? ' ' + it.sub : null));
    });
    el.appendChild(grid);
    if (o.target) el.appendChild(h('div', { class: 'hbars-foot' }, h('i'), o.targetLabel));
  }

  QT.charts = { columns: columns, hbars: hbars };
})();
