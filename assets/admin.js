/* Admin: people who can sign in, the quoter list, targets/settings, and importing the old tabs. */
(function () {
  'use strict';
  const { h, $, clear, fmt } = QT;
  let data = null;

  /* ---------------- people ---------------- */

  function renderUsers() {
    const t = clear($('#users'));
    t.appendChild(h('thead', null, h('tr', null, ['Google account', 'Role', 'Quoter', ''].map(x => h('th', { text: x })))));
    const body = h('tbody');
    const order = { admin: 0, manager: 1, quoter: 2 };
    data.users.slice().sort((a, b) => order[a.role] - order[b.role] || (a.quoter || '').localeCompare(b.quoter || '', undefined, { numeric: true }) || a.email.localeCompare(b.email))
      .forEach(u => {
        body.appendChild(h('tr', null,
          h('td', null, h('div', { text: u.name || u.email }), u.name ? h('div', { class: 'muted', style: 'font-size:13px', text: u.email }) : null),
          h('td', null, h('span', { class: 'role-tag ' + u.role, text: u.role }), u.active ? null : [' ', h('span', { class: 'flag plain', text: 'no access' })]),
          h('td', { text: u.quoter ? QT.quoterName(u.quoter) : '' }),
          h('td', { class: 'actions' },
            h('button', { class: 'btn btn-quiet', type: 'button', text: 'Edit', onclick: () => editUser(u) }),
            u.email === QT.user.email ? null : h('button', { class: 'btn btn-quiet btn-danger', type: 'button', text: 'Remove', onclick: () => removeUser(u) }))));
      });
    if (data.users.length < 2) {
      body.appendChild(h('tr', null, h('td', { colspan: 4, class: 'empty' },
        'Add each quoter with the Google account they\'ll sign in with. You can give them a new quoter code in the same step.')));
    }
    t.appendChild(body);
  }

  const NEW = '__new__';
  function nextCode() {
    return 'JS ' + (data.quoters.reduce((m, x) => Math.max(m, parseInt((x.code.match(/\d+/) || [0])[0], 10)), 0) + 1);
  }

  function editUser(u) {
    const isNew = !u;
    u = u || { email: '', name: '', role: 'quoter', quoter: '', active: true };
    const f = {
      email: h('input', { type: 'email', value: u.email, placeholder: 'name@gmail.com', autocomplete: 'off' }),
      name: h('input', { type: 'text', value: u.name }),
      role: h('select', null, [['quoter', 'Quoter: logs leads, sees own stats'], ['manager', 'Manager: sees and fixes everyone'], ['admin', 'Admin: manager + this page']]
        .map(r => h('option', { value: r[0], text: r[1], selected: u.role === r[0] }))),
      quoter: h('select', null,
        h('option', { value: NEW, text: 'New quoter code', selected: !u.quoter }),
        data.quoters.map(q => h('option', { value: q.code, text: q.code + ' (' + q.name + ')', selected: q.code === u.quoter }))),
      code: h('input', { type: 'text', value: nextCode() }),
      active: h('input', { type: 'checkbox', checked: u.active }),
    };
    const codeWrap = h('label', { class: 'field' }, h('span', { text: 'New code' }), f.code);
    const qWrap = h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', { text: 'Logs leads as' }), f.quoter), codeWrap);
    const sync = () => {
      qWrap.hidden = f.role.value !== 'quoter';
      codeWrap.hidden = f.quoter.value !== NEW;
    };
    f.role.addEventListener('change', sync);
    f.quoter.addEventListener('change', sync);
    sync();
    QT.dialog({
      title: isNew ? 'Add a person' : 'Edit ' + (u.name || u.email),
      body: h('div', null,
        h('label', { class: 'field' }, h('span', { text: 'Google account email' }), f.email),
        h('label', { class: 'field' }, h('span', { text: 'Name' }), f.name),
        h('label', { class: 'field' }, h('span', { text: 'Role' }), f.role),
        qWrap,
        h('label', { class: 'check' }, f.active, 'Can sign in')),
      actions: [
        { label: 'Cancel' },
        {
          label: isNew ? 'Add person' : 'Save changes', kind: 'btn-primary', fn: async () => {
            try {
              const isQuoter = f.role.value === 'quoter';
              const creating = isQuoter && f.quoter.value === NEW;
              const res = await QT.api('saveUser', {
                originalEmail: isNew ? '' : u.email,
                createQuoter: creating,
                user: { email: f.email.value, name: f.name.value, role: f.role.value, active: f.active.checked,
                  quoter: isQuoter ? (creating ? f.code.value : f.quoter.value) : '' },
              });
              data.users = res.users;
              if (res.quoters) { data.quoters = res.quoters; QT.quoters = res.quoters; renderQuoters(); }
              renderUsers();
              QT.toast(isNew ? 'Added ' + f.email.value.trim() + '. They can sign in now.' : 'Saved.');
            } catch (e) { QT.toast(e.message, { kind: 'error' }); return false; }
          },
        },
      ],
    });
  }

  async function removeUser(u) {
    if (!(await QT.confirm('Remove ' + (u.name || u.email) + '?', u.email + ' will no longer be able to sign in. Leads they logged are kept.', 'Remove access'))) return;
    try {
      const res = await QT.api('deleteUser', { email: u.email });
      data.users = res.users;
      renderUsers();
    } catch (e) { QT.toast(e.message, { kind: 'error' }); }
  }

  /* ---------------- quoters ---------------- */

  function renderQuoters() {
    const t = clear($('#quoters'));
    t.appendChild(h('thead', null, h('tr', null, ['Code', 'Name', 'Status', ''].map(x => h('th', { text: x })))));
    const body = h('tbody');
    data.quoters.forEach(q => body.appendChild(h('tr', null,
      h('td', { class: 'num', text: q.code }),
      h('td', { text: q.name }),
      h('td', null, q.active ? 'Active' : h('span', { class: 'flag plain', text: 'Inactive' })),
      h('td', { class: 'actions' }, h('button', { class: 'btn btn-quiet', type: 'button', text: 'Edit', onclick: () => editQuoter(q) })))));
    if (!data.quoters.length) body.appendChild(h('tr', null, h('td', { colspan: 4, class: 'empty', text: 'No quoters yet. They appear here when you add a person as a quoter, or import history.' })));
    t.appendChild(body);
  }

  function editQuoter(q) {
    const isNew = !q;
    q = q || { code: nextCode(), name: '', active: true };
    const f = {
      code: h('input', { type: 'text', value: q.code, disabled: !isNew }),
      name: h('input', { type: 'text', value: q.name }),
      active: h('input', { type: 'checkbox', checked: q.active }),
    };
    QT.dialog({
      title: isNew ? 'Add a quoter' : 'Edit ' + q.code,
      body: h('div', null,
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', { text: 'Code' }), f.code),
          h('label', { class: 'field' }, h('span', { text: 'Name' }), f.name)),
        h('label', { class: 'check' }, f.active, 'Active (shows on the team summary)'),
        isNew ? h('p', { class: 'muted', style: 'margin:12px 0 0', text: 'After adding the quoter, add their Google account under People so they can sign in.' }) : null),
      actions: [
        { label: 'Cancel' },
        {
          label: isNew ? 'Add quoter' : 'Save changes', kind: 'btn-primary', fn: async () => {
            try {
              const res = await QT.api('saveQuoter', { quoter: { code: f.code.value, name: f.name.value, active: f.active.checked } });
              data.quoters = res.quoters;
              QT.quoters = res.quoters;
              renderQuoters();
              renderUsers();
            } catch (e) { QT.toast(e.message, { kind: 'error' }); return false; }
          },
        },
      ],
    });
  }

  /* ---------------- settings ---------------- */

  function renderSettings() {
    const s = data.settings;
    const help = data.settingHelp || {};
    const form = clear($('#settings'));
    const f = {
      appName: h('input', { type: 'text', value: s.appName }),
      dailyTarget: h('input', { type: 'number', min: 1, step: 1, value: s.dailyTarget }),
      eligRateTarget: h('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round(s.eligRateTarget * 100) }),
      bonusThreshold: h('input', { type: 'number', min: 0, step: 1, value: s.bonusThreshold }),
      trackingStart: h('input', { type: 'date', value: s.trackingStart }),
      weekendBonus: h('input', { type: 'checkbox', checked: s.weekendBonus }),
      quotersSeeTeam: h('input', { type: 'checkbox', checked: s.quotersSeeTeam }),
      reasons: h('textarea', { rows: 7 }),
    };
    f.reasons.value = (s.reasons || []).join('\n');
    const row = (label, input, key) => h('label', { class: 'field' }, h('span', { text: label }), input, help[key] ? h('div', { class: 'help', text: help[key] }) : null);
    form.appendChild(h('div', { class: 'form-grid' },
      row('Eligible target per day', f.dailyTarget, 'dailyTarget'),
      row('Eligible rate target (%)', f.eligRateTarget, null),
      row('Bonus starts after', f.bonusThreshold, 'bonusThreshold'),
      row('Totals start on', f.trackingStart, 'trackingStart')));
    form.appendChild(h('label', { class: 'check' }, f.weekendBonus, 'Weekend eligible leads all count as bonus'));
    form.appendChild(h('label', { class: 'check' }, f.quotersSeeTeam, 'Quoters can see the team page (counts only)'));
    form.appendChild(row('Quick-pick ineligible reasons, one per line', f.reasons, null));
    form.appendChild(row('Site name', f.appName, 'appName'));
    const save = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Save settings' });
    form.appendChild(h('div', null, save));
    form.onsubmit = async ev => {
      ev.preventDefault();
      save.disabled = true;
      try {
        const res = await QT.api('saveSettings', { settings: {
          appName: f.appName.value, dailyTarget: f.dailyTarget.value, eligRateTarget: (Number(f.eligRateTarget.value) / 100),
          bonusThreshold: f.bonusThreshold.value, trackingStart: f.trackingStart.value,
          weekendBonus: f.weekendBonus.checked, quotersSeeTeam: f.quotersSeeTeam.checked,
          reasons: f.reasons.value.split('\n').map(x => x.trim()).filter(Boolean).join('|'),
        } });
        data.settings = res.settings;
        QT.settings = res.settings;
        renderSettings();
        QT.toast('Settings saved. Everyone sees the new targets on their next page load.');
      } catch (e) { QT.toast(e.message, { kind: 'error' }); } finally { save.disabled = false; }
    };
  }

  /* ---------------- data + import ---------------- */

  function renderData(result) {
    const c = data.counts;
    const box = clear($('#data'));
    box.appendChild(h('dl', { class: 'counts' },
      h('div', null, h('dt', { text: 'Leads in the database' }), h('dd', { text: fmt.int(c.leads) })),
      h('div', null, h('dt', { text: 'Logged on this site' }), h('dd', { text: fmt.int(c.fromSite) })),
      h('div', null, h('dt', { text: 'Copied from the old Lead Log' }), h('dd', { text: fmt.int(c.imported) })),
      h('div', null, h('dt', { text: 'Rows missing info' }), h('dd', { text: fmt.int(c.missing) }))));

    box.appendChild(h('h3', { text: 'Bring in history from the old Lead Log (optional)' }));
    box.appendChild(h('p', { class: 'sub', text: 'Copies the leads and day notes from the old sheet\'s "JS 1 - Name" tabs into this database, ' +
      'so totals and bonus history go back to your first day. The old sheet is only read, never changed. ' +
      'Running it again replaces the earlier copy and keeps every lead logged on this site. Skip this to start from zero.' }));
    const url = h('input', { type: 'url', value: data.historySource || '', placeholder: 'https://docs.google.com/spreadsheets/d/...', 'aria-label': 'Old Lead Log link' });
    const btn = h('button', { class: 'btn', type: 'button', text: c.imported ? 'Copy again' : 'Copy history' });
    btn.addEventListener('click', async () => {
      if (!url.value.trim()) { url.setAttribute('aria-invalid', 'true'); url.focus(); return; }
      url.removeAttribute('aria-invalid');
      const ok = await QT.confirm(c.imported ? 'Copy the history again?' : 'Copy the history?',
        (c.imported ? 'This replaces the ' + fmt.int(c.imported) + ' leads copied last time with a fresh copy. ' : '') +
        'Leads logged on this site are kept. It can take up to a minute.', c.imported ? 'Copy again' : 'Copy history', false);
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = 'Copying...';
      try {
        const res = await QT.api('importOld', { url: url.value.trim() });
        data = await QT.api('adminData', {});
        QT.quoters = data.quoters;
        QT.settings = data.settings;
        renderQuoters(); renderUsers(); renderSettings();
        renderData(res);
        QT.toast('Copied ' + fmt.int(res.total) + ' leads from ' + (res.sourceName || 'the old Lead Log') + '.');
      } catch (e) {
        QT.toast(e.message, { kind: 'error' });
        btn.disabled = false;
        btn.textContent = c.imported ? 'Copy again' : 'Copy history';
      }
    });
    box.appendChild(h('div', { class: 'url-row' }, url, btn));
    if (result && result.tabs) {
      box.appendChild(h('div', { class: 'import-log' },
        h('p', { style: 'margin:0 0 8px', text: 'Copied ' + fmt.int(result.total) + ' leads. Kept ' + fmt.int(result.kept) + ' logged on this site.' +
          (result.trackingStart ? ' Totals now start ' + QT.d.full(result.trackingStart) + '.' : '') }),
        h('table', null, h('thead', null, h('tr', null, ['Tab', 'Leads', 'No date', 'Notes'].map((x, i) => h('th', { class: i ? 'n' : '', text: x })))),
          h('tbody', null, result.tabs.map(t => h('tr', null, h('td', { text: t.tab }), h('td', { class: 'n', text: fmt.int(t.leads) }),
            h('td', { class: 'n', text: fmt.int(t.undated) }), h('td', { class: 'n', text: fmt.int(t.notes) })))))));
    }
  }

  QT.boot({
    page: 'admin',
    title: 'Admin',
    minRole: 'admin',
    async render() {
      data = await QT.api('adminData', {});
      $('#sheet-link').href = data.sheetUrl;
      $('#add-user').addEventListener('click', () => editUser(null));
      $('#add-quoter').addEventListener('click', () => editQuoter(null));
      renderUsers();
      renderQuoters();
      renderSettings();
      renderData();
    },
  });
})();
