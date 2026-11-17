/* Shared lead pieces used by Log leads and Quoter stats: status marks, validation,
 * the table row, and the edit / delete / duplicate-warning flows. */
(function () {
  'use strict';
  const { h, d: D } = QT;

  function statusMark(s) {
    return h('span', { class: 'st ' + (s === 'Eligible' ? 'elig' : s === 'Ineligible' ? 'inelig' : ''), text: s || 'No status' });
  }

  function fieldError(input, msg) {
    input.setAttribute('aria-invalid', 'true');
    (input.closest('.field') || input.parentNode).appendChild(h('p', { class: 'err-text', text: msg }));
  }

  /** Same rules the backend enforces; checked here so mistakes show instantly. inputs = {date,name,email,pdf,reason} elements. */
  function validate(lead, inputs) {
    const errs = [];
    if (!D.valid(lead.date)) errs.push([inputs.date, 'Pick the date you worked this lead.']);
    if (!lead.name) errs.push([inputs.name, "Enter the prospect's full name."]);
    if (lead.email && !/^[^@\s]+@[^@\s]+$/.test(lead.email)) errs.push([inputs.email, 'That email address looks incomplete.']);
    if (lead.status === 'Eligible') {
      if (!lead.email) errs.push([inputs.email, 'Eligible leads need an email.']);
      if (!/^https?:\/\//i.test(lead.pdf)) errs.push([inputs.pdf, 'Paste the quote PDF link (starts with https://).']);
    } else if (!lead.reason) {
      errs.push([inputs.reason, 'Pick or type a reason.']);
    }
    return errs;
  }

  function missingWhat(l) {
    const what = [];
    if (!l.date) what.push('date');
    if (!l.status) what.push('status');
    if (l.status === 'Eligible' && !l.email) what.push('email');
    if (l.status === 'Eligible' && !l.pdf) what.push('quote link');
    if (l.status === 'Ineligible' && !l.reason) what.push('reason');
    return what;
  }

  function ensureReasonList() {
    if (document.getElementById('reason-list')) return;
    document.body.appendChild(h('datalist', { id: 'reason-list' }, (QT.settings.reasons || []).map(r => h('option', { value: r }))));
  }

  /** Edit form for one lead: { body, read(), check() } */
  function fields(l, defaultQuoter) {
    ensureReasonList();
    const f = {
      date: h('input', { type: 'date', value: l.date || '', max: QT.today }),
      name: h('input', { type: 'text', value: l.name || '' }),
      status: h('select', null, ['Eligible', 'Ineligible'].map(s => h('option', { value: s, text: s, selected: l.status === s }))),
      email: h('input', { type: 'email', value: l.email || '' }),
      pdf: h('input', { type: 'url', value: l.pdf || '' }),
      reason: h('input', { type: 'text', value: l.reason || '', list: 'reason-list' }),
    };
    const pdfWrap = h('label', { class: 'field' }, h('span', { text: 'Quote PDF link' }), f.pdf);
    const reasonWrap = h('label', { class: 'field' }, h('span', { text: 'Ineligible reason' }), f.reason);
    const sync = () => { pdfWrap.hidden = f.status.value !== 'Eligible'; reasonWrap.hidden = f.status.value === 'Eligible'; };
    f.status.addEventListener('change', sync);
    if (!l.status) f.status.value = l.pdf ? 'Eligible' : 'Ineligible';
    sync();
    const body = h('div', null,
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', { text: 'Prospect full name' }), f.name),
        h('label', { class: 'field' }, h('span', { text: 'Date worked' }), f.date)),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', { text: 'Status' }), f.status),
        h('label', { class: 'field' }, h('span', { text: 'Email' }), f.email)),
      pdfWrap, reasonWrap);
    const read = () => ({
      quoter: l.quoter || defaultQuoter, date: f.date.value, name: f.name.value.trim().replace(/\s+/g, ' '), status: f.status.value,
      email: f.email.value.trim(), pdf: f.status.value === 'Eligible' ? f.pdf.value.trim() : '', reason: f.status.value === 'Ineligible' ? f.reason.value.trim() : '',
    });
    const check = () => {
      QT.$$('.err-text', body).forEach(p => p.remove());
      QT.$$('[aria-invalid]', body).forEach(i => i.removeAttribute('aria-invalid'));
      const errs = validate(read(), f);
      errs.forEach(e => fieldError(e[0], e[1]));
      if (errs.length) errs[0][0].focus();
      return !errs.length;
    };
    return { body: body, read: read, check: check };
  }

  function warnDuplicate(lead, dups, onUndo) {
    const d0 = dups[0];
    const who = d0.quoter === lead.quoter ? 'this quoter' : QT.quoterName(d0.quoter);
    const msg = 'Possible duplicate: ' + d0.name + ' was already logged by ' + who +
      (d0.date ? ' on ' + D.day(d0.date) : '') + (dups.length > 1 ? ' (and ' + (dups.length - 1) + ' more)' : '') + '.';
    QT.toast(msg, { kind: 'warn', timeout: 12000, action: onUndo ? { label: 'Undo', fn: onUndo } : null });
  }

  /** Opens the edit dialog. opts: { defaultQuoter, onSaved(lead, duplicates) } */
  function edit(l, opts) {
    const form = fields(l, opts.defaultQuoter);
    QT.dialog({
      title: 'Edit lead',
      body: form.body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save changes', kind: 'btn-primary', submit: true, fn: async () => {
            if (!form.check()) return false;
            try {
              const res = await QT.api('updateLead', { id: l.id, lead: form.read() });
              QT.toast('Saved changes to ' + res.lead.name + '.');
              opts.onSaved(res.lead, res.duplicates || []);
            } catch (e) { QT.toast(e.message, { kind: 'error' }); return false; }
          },
        },
      ],
    });
  }

  /** Deletes after confirming. opts: { skipConfirm, onDeleted(lead) } */
  async function remove(l, opts) {
    if (!opts.skipConfirm && !(await QT.confirm('Delete this lead?', l.name + ' (' + (l.status || 'no status') + ', ' +
      (l.date ? D.day(l.date) : 'no date') + ') will be deleted. The audit log keeps a copy.', 'Delete lead'))) return false;
    try {
      await QT.api('deleteLead', { id: l.id });
      QT.toast('Deleted ' + l.name + '.');
      opts.onDeleted(l);
      return true;
    } catch (e) { QT.toast(e.message, { kind: 'error' }); return false; }
  }

  /** One table row. opts: { showDate, fresh, onEdit, onDelete } */
  function row(l, opts) {
    return h('tr', { class: opts.fresh ? 'is-new' : '' },
      opts.showDate ? h('td', { class: 'num', text: l.date ? D.day(l.date) : 'No date' }) : null,
      h('td', { class: 'num muted', text: l.source === 'import' ? '' : D.time(l.created) }),
      h('td', null, l.name, l.missing ? [' ', h('span', { class: 'flag', text: 'Missing info' })] : null),
      h('td', null, statusMark(l.status)),
      h('td', { class: 'clip', text: l.email }),
      h('td', null, l.pdf ? h('a', { class: 'link', href: l.pdf, target: '_blank', rel: 'noopener noreferrer', text: 'Open PDF' }) : ''),
      h('td', { class: 'clip', text: l.reason, title: l.reason }),
      h('td', { class: 'actions' },
        h('button', { class: 'btn btn-quiet', type: 'button', text: 'Edit', onclick: () => opts.onEdit(l) }),
        h('button', { class: 'btn btn-quiet btn-danger', type: 'button', text: 'Delete', 'aria-label': 'Delete ' + l.name, onclick: () => opts.onDelete(l) })));
  }

  QT.leads = { statusMark, fieldError, validate, missingWhat, fields, edit, remove, warnDuplicate, row };
})();
