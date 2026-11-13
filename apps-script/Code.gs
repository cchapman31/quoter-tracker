/**
 * Remote Quoter Tracker: Google Apps Script backend.
 *
 * The database is its own new, blank Google Sheet that only this script uses.
 * Paste this whole file into that sheet's Extensions > Apps Script, run setup()
 * once, then deploy it as a web app. README.md walks through every step.
 *
 * Quoters and managers never open the sheet. They use the website (GitHub Pages),
 * and every request comes here with the visitor's Google sign-in token. This
 * script checks the token with Google, looks the person up on the Users tab, and
 * only then reads or writes the sheet.
 */

const API_VERSION = 1;

const SHEETS = {
  LEADS: 'Leads',
  USERS: 'Users',
  QUOTERS: 'Quoters',
  NOTES: 'Day Notes',
  SETTINGS: 'Settings',
  AUDIT: 'Audit Log',
};

const LEAD_HEADERS = ['ID', 'Date', 'Quoter', 'Prospect Name', 'Status', 'Email', 'Quote PDF Link',
  'Ineligible Reason', 'Logged By', 'Created At', 'Updated At', 'Source'];
const L = { ID: 0, DATE: 1, QUOTER: 2, NAME: 3, STATUS: 4, EMAIL: 5, PDF: 6, REASON: 7, BY: 8, CREATED: 9, UPDATED: 10, SOURCE: 11 };

const USER_HEADERS = ['Email', 'Name', 'Role', 'Quoter', 'Active', 'Added By', 'Added At'];
const QUOTER_HEADERS = ['Code', 'Name', 'Active'];
const NOTE_HEADERS = ['Quoter', 'Date', 'Note', 'Updated By', 'Updated At', 'Source'];
const SETTING_HEADERS = ['Key', 'Value', 'What it does'];
const AUDIT_HEADERS = ['Timestamp', 'User', 'Action', 'Lead ID', 'Details'];

const ROLES = { quoter: 1, manager: 2, admin: 3 };
const STATUSES = ['Eligible', 'Ineligible'];

/** Tabs in the old "Remote Quoter Lead Log" look like "JS 1 - Mahi" (used only by the optional history import). */
const OLD_TAB_RE = /^(JS\s*\d+)\s*-\s*(.+)$/i;

const SETTING_DEFS = {
  appName: { def: 'Remote Quoter Tracker', type: 'text', help: 'Name shown at the top of the site' },
  dailyTarget: { def: 50, type: 'int', help: 'Eligible leads each quoter should log per weekday' },
  eligRateTarget: { def: 0.65, type: 'pct', help: 'Target eligible rate. 0.65 means 65%' },
  bonusThreshold: { def: 50, type: 'int', help: 'Eligible leads above this number on a weekday count as bonus leads' },
  weekendBonus: { def: true, type: 'bool', help: 'TRUE: every eligible lead logged on a Saturday or Sunday counts as a bonus lead' },
  trackingStart: { def: '', type: 'date', help: 'First day of the "since start" totals. Setup sets it to your first day; copying history moves it back to the first old lead' },
  quotersSeeTeam: { def: false, type: 'bool', help: 'TRUE: quoters can open the team page (lead counts only, no prospect details)' },
  reasons: {
    def: 'Mobile home|Existing customer|Fireline score|Wildfire exposure|Claims|Apartment|Bad address|No home info|' +
      'Condo / townhouse|Commercial property|Vacant land|Bad name|Contact opt-out|Past due premium|DOB missing|' +
      'Home condition|Coverage or zip limit|Duplicate|System error',
    type: 'list',
    help: 'Quick-pick ineligible reasons on the log form, separated by |',
  },
};

/** Groups free-text ineligible reasons (old sheet data) into the quick-pick categories. */
const REASON_RULES = [
  [/mobile|manufactur/i, 'Mobile home'],
  [/existing|policy (was )?found|already (a |being )?(customer|insured|client)|insured with farmers|active policy/i, 'Existing customer'],
  [/fire\s*line/i, 'Fireline score'],
  [/wild\s*fire|wildlife|brush|fire expos/i, 'Wildfire exposure'],
  [/claim/i, 'Claims'],
  [/apart/i, 'Apartment'],
  [/condo|town\s*house|multi\s*-?\s*family|duplex|triplex|fourplex/i, 'Condo / townhouse'],
  [/commercial|business/i, 'Commercial property'],
  [/vacant|empty lot|\bland\b/i, 'Vacant land'],
  [/opt\W*out|opted/i, 'Contact opt-out'],
  [/past due|earned premium/i, 'Past due premium'],
  [/\bdob\b|date of birth|birth ?date/i, 'DOB missing'],
  [/duplicat|\bdupe/i, 'Duplicate'],
  [/address|locate/i, 'Bad address'],
  [/home info|no info|information|bad info|details/i, 'No home info'],
  [/\bname\b/i, 'Bad name'],
  [/condition|roof|debris|tree|siding|damage|overgrown|hazard/i, 'Home condition'],
  [/exceed|zip code|count(y|ies)|property value|coverage amount|more than \d/i, 'Coverage or zip limit'],
  [/error|loading|not working|ppc|snag|system|glitch|trouble|appx/i, 'System error'],
];

/* ------------------------------------------------------------------------ */
/* Sheet menu + one-time setup                                               */
/* ------------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Quoter Tracker')
    .addItem('Run setup', 'setup')
    .addItem('Import history from the old Lead Log (optional)', 'importHistory')
    .addToUi();
}

/**
 * Creates the database tabs (safe to run again; it never deletes data) and
 * makes the person running it the first admin.
 */
function setup() {
  const ss = ss_();
  ensureSheet_(SHEETS.LEADS, LEAD_HEADERS, [140, 95, 70, 190, 90, 220, 260, 220, 200, 150, 150, 160], [L.DATE + 1]);
  ensureSheet_(SHEETS.USERS, USER_HEADERS, [240, 160, 80, 80, 70, 200, 150]);
  ensureSheet_(SHEETS.QUOTERS, QUOTER_HEADERS, [80, 200, 70]);
  ensureSheet_(SHEETS.NOTES, NOTE_HEADERS, [80, 95, 360, 200, 150, 160], [2]);
  ensureSheet_(SHEETS.SETTINGS, SETTING_HEADERS, [150, 260, 520], [2]);
  ensureSheet_(SHEETS.AUDIT, AUDIT_HEADERS, [160, 220, 110, 120, 600]);

  // Default settings (only adds keys that are missing).
  const settingsSheet = sheet_(SHEETS.SETTINGS);
  const have = readTable_(SHEETS.SETTINGS, 3).map(r => String(r[0]).trim());
  const add = Object.keys(SETTING_DEFS)
    .filter(k => have.indexOf(k) < 0)
    .map(k => [k, k === 'trackingStart' ? todayIso_() : settingToCell_(SETTING_DEFS[k].def, SETTING_DEFS[k].type), SETTING_DEFS[k].help]);
  if (add.length) appendRows_(settingsSheet, add, [2]);

  // First admin = whoever runs setup.
  const me = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const users = getUsers_();
  if (me && !users.some(u => u.email === me)) {
    appendRows_(sheet_(SHEETS.USERS), [[me, 'Owner', 'admin', '', true, 'setup', new Date()]]);
  }
  bumpDataVersion_();

  const msg = 'Setup finished. The database tabs are ready and ' + (me || 'you') + ' is an admin.\n\n' +
    'Next: follow README steps 2 to 4 to connect Google sign-in and put the site online. ' +
    'Bringing in history from the old Lead Log is optional and done later from the Admin page.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor */ }
  return msg;
}

/**
 * Optional, from the sheet's Quoter Tracker menu: copy history from the old
 * Lead Log into this database. (The Admin page on the site does the same.)
 */
function importHistory() {
  const ui = SpreadsheetApp.getUi();
  const last = PropertiesService.getScriptProperties().getProperty('HISTORY_SOURCE') || '';
  const ask = ui.prompt('Import history', 'Paste the link to the old Remote Quoter Lead Log sheet.' +
    (last ? '\n\nLast time: ' + last : ''), ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return null;
  const me = (Session.getEffectiveUser().getEmail() || 'editor').toLowerCase();
  const res = runImport_(me, ask.getResponseText().trim() || last);
  const lines = res.tabs.map(t => t.tab + ': ' + t.leads + ' leads' +
    (t.undated ? ', ' + t.undated + ' with no date' : '') +
    (t.notes ? ', ' + t.notes + ' day notes' : ''));
  ui.alert('Imported ' + res.total + ' leads from ' + res.tabs.length + ' tabs.\n\n' + lines.join('\n') +
    '\n\nLeads logged on the website were kept.');
  return res;
}

/* ------------------------------------------------------------------------ */
/* Web app entry points                                                      */
/* ------------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, data: { service: 'Remote Quoter Tracker API', version: API_VERSION } });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_({ ok: true, data: route_(body) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), code: (err && err.code) || 'error' });
  }
}

const ACTIONS = {
  me: { min: 'quoter', fn: actMe_ },
  leads: { min: 'quoter', fn: actLeads_ },
  addLead: { min: 'quoter', fn: actAddLead_ },
  updateLead: { min: 'quoter', fn: actUpdateLead_ },
  deleteLead: { min: 'quoter', fn: actDeleteLead_ },
  stats: { min: 'quoter', fn: actStats_ },
  saveNote: { min: 'quoter', fn: actSaveNote_ },
  adminData: { min: 'admin', fn: actAdminData_ },
  saveUser: { min: 'admin', fn: actSaveUser_ },
  deleteUser: { min: 'admin', fn: actDeleteUser_ },
  saveQuoter: { min: 'admin', fn: actSaveQuoter_ },
  saveSettings: { min: 'admin', fn: actSaveSettings_ },
  importOld: { min: 'admin', fn: actImportOld_ },
};

function route_(body) {
  const action = ACTIONS[body.action];
  if (!action) fail_('bad_request', 'Unknown action: ' + body.action);
  const who = verifyToken_(body.token);
  const user = getUsers_().filter(u => u.email === who.email && u.active)[0];
  if (!user) {
    fail_('not_allowed', 'The Google account ' + who.email + " isn't on the team list. Ask an admin to add you.");
  }
  user.picture = who.picture;
  if (!user.name) user.name = who.name;
  if (ROLES[user.role] < ROLES[action.min]) fail_('forbidden', 'Your role (' + user.role + ") can't do that.");
  if (user.role === 'quoter' && !user.quoter) {
    fail_('not_allowed', 'Your account has no quoter code yet. Ask an admin to link you to your quoter code.');
  }
  return action.fn(body, user);
}

/* ------------------------------------------------------------------------ */
/* Google sign-in check                                                      */
/* ------------------------------------------------------------------------ */

function verifyToken_(token) {
  if (!token) fail_('auth', 'Sign in to continue.');
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) {
    fail_('config', 'The backend has no GOOGLE_CLIENT_ID yet. Add it under Project Settings > Script properties.');
  }
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + digest_(token);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) fail_('auth', 'Your sign-in expired. Sign in again.');
  const info = JSON.parse(res.getContentText());
  const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const expMs = Number(info.exp) * 1000;
  if (info.aud !== clientId || !issOk) fail_('auth', 'That sign-in was not issued for this site.');
  if (String(info.email_verified) !== 'true') fail_('auth', 'Verify your Google email address first.');
  if (!(expMs > Date.now())) fail_('auth', 'Your sign-in expired. Sign in again.');

  const who = { email: String(info.email).toLowerCase(), name: info.name || info.email, picture: info.picture || '' };
  const ttl = Math.min(21600, Math.floor((expMs - Date.now()) / 1000) - 30);
  if (ttl > 0) cache.put(key, JSON.stringify(who), ttl);
  return who;
}

/* ------------------------------------------------------------------------ */
/* Actions                                                                   */
/* ------------------------------------------------------------------------ */

function actMe_(body, user) {
  return {
    apiVersion: API_VERSION,
    user: publicUser_(user),
    settings: getSettings_(),
    quoters: getQuoters_(),
    today: todayIso_(),
    timeZone: tz_(),
  };
}

/** Lead rows for one quoter (or ALL for managers) between two dates, or every row missing info. */
function actLeads_(body, user) {
  const quoter = scopeQuoter_(body.quoter, user, true);
  const from = normDate_(body.from) || '0000-00-00';
  const to = normDate_(body.to) || '9999-99-99';
  const missingOnly = !!body.missingOnly;
  const leads = readLeads_().filter(l => {
    if (quoter !== 'ALL' && l.quoter !== quoter) return false;
    if (missingOnly) return l.missing;
    return l.date && l.date >= from && l.date <= to;
  });
  return { leads: leads.map(publicLead_) };
}

function actAddLead_(body, user) {
  const input = body.lead || {};
  const lead = cleanLead_(input, user);
  const clientId = String(body.clientId || '').replace(/[^\w-]/g, '').slice(0, 40);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const all = readLeads_();
    if (clientId) {
      // Retried request: don't log the same lead twice.
      const again = all.filter(l => l.source === 'app:' + clientId)[0];
      if (again) return { lead: publicLead_(again), duplicates: [] };
    }
    const dups = findDuplicates_(all, lead, null);
    const now = new Date();
    const row = [newId_(), lead.date, lead.quoter, lead.name, lead.status, lead.email, lead.pdf, lead.reason,
      user.email, now, now, 'app' + (clientId ? ':' + clientId : '')];
    appendRows_(sheet_(SHEETS.LEADS), [row], [L.DATE + 1]);
    bumpDataVersion_();
    return { lead: publicLead_(rowToLead_(row, 0)), duplicates: dups };
  } finally {
    lock.releaseLock();
  }
}

function actUpdateLead_(body, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const found = findLead_(body.id);
    if (!canSeeQuoter_(user, found.lead.quoter)) fail_('forbidden', 'You can only edit your own leads.');
    const lead = cleanLead_(Object.assign({ quoter: found.lead.quoter }, body.lead || {}), user);
    const before = publicLead_(found.lead);
    const vals = found.values.slice();
    vals[L.DATE] = lead.date; vals[L.QUOTER] = lead.quoter; vals[L.NAME] = lead.name;
    vals[L.STATUS] = lead.status; vals[L.EMAIL] = lead.email; vals[L.PDF] = lead.pdf;
    vals[L.REASON] = lead.reason; vals[L.UPDATED] = new Date();
    const range = sheet_(SHEETS.LEADS).getRange(found.row, 1, 1, LEAD_HEADERS.length);
    range.getCell(1, L.DATE + 1).setNumberFormat('@');
    range.setValues([vals]);
    const after = publicLead_(rowToLead_(vals, found.row));
    audit_(user.email, 'update', body.id, { before: before, after: after });
    bumpDataVersion_();
    return { lead: after, duplicates: findDuplicates_(readLeads_(), lead, body.id) };
  } finally {
    lock.releaseLock();
  }
}

function actDeleteLead_(body, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const found = findLead_(body.id);
    if (!canSeeQuoter_(user, found.lead.quoter)) fail_('forbidden', 'You can only delete your own leads.');
    sheet_(SHEETS.LEADS).deleteRow(found.row);
    audit_(user.email, 'delete', body.id, publicLead_(found.lead));
    bumpDataVersion_();
    return { deleted: body.id };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Daily counts per quoter. The browser turns these into every total on the
 * site (today, this week, since start, weekly bonus), so the pages always agree.
 * days:    [quoter, date, eligible, ineligible, other, rowsMissingInfo]
 * reasons: [quoter, date, reasonCategory, count]
 * notes:   [quoter, date, note]
 */
function actStats_(body, user) {
  const settings = getSettings_();
  const all = statsCached_();
  if (user.role !== 'quoter') return all;
  const mine = q => q === user.quoter;
  if (settings.quotersSeeTeam && body.scope === 'team') {
    return {
      days: all.days, reasons: all.reasons, undated: all.undated, lastLogged: all.lastLogged,
      notes: all.notes.filter(n => mine(n[0])),
    };
  }
  const undated = {}; undated[user.quoter] = all.undated[user.quoter] || 0;
  const lastLogged = {}; lastLogged[user.quoter] = all.lastLogged[user.quoter] || '';
  return {
    days: all.days.filter(d => mine(d[0])),
    reasons: all.reasons.filter(r => mine(r[0])),
    notes: all.notes.filter(n => mine(n[0])),
    undated: undated,
    lastLogged: lastLogged,
  };
}

function actSaveNote_(body, user) {
  const quoter = scopeQuoter_(body.quoter, user, false);
  const date = normDate_(body.date);
  if (!date) fail_('bad_request', 'Pick a date for the note.');
  const note = String(body.note || '').trim().slice(0, 1000);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SHEETS.NOTES);
    const rows = readTable_(SHEETS.NOTES, NOTE_HEADERS.length);
    let at = -1;
    rows.forEach((r, i) => { if (String(r[0]).trim() === quoter && normDate_(r[1]) === date) at = i; });
    if (at >= 0 && !note) {
      sh.deleteRow(at + 2);
    } else if (at >= 0) {
      const range = sh.getRange(at + 2, 1, 1, NOTE_HEADERS.length);
      range.getCell(1, 2).setNumberFormat('@');
      range.setValues([[quoter, date, note, user.email, new Date(), 'app']]);
    } else if (note) {
      appendRows_(sh, [[quoter, date, note, user.email, new Date(), 'app']], [2]);
    }
    bumpDataVersion_();
    return { quoter: quoter, date: date, note: note };
  } finally {
    lock.releaseLock();
  }
}

function actAdminData_() {
  const leads = readLeads_();
  return {
    users: getUsers_().map(publicUser_),
    quoters: getQuoters_(),
    settings: getSettings_(),
    settingHelp: Object.keys(SETTING_DEFS).reduce((o, k) => { o[k] = SETTING_DEFS[k].help; return o; }, {}),
    counts: {
      leads: leads.length,
      imported: leads.filter(l => /^import/.test(l.source)).length,
      fromSite: leads.filter(l => /^app/.test(l.source)).length,
      missing: leads.filter(l => l.missing).length,
    },
    historySource: PropertiesService.getScriptProperties().getProperty('HISTORY_SOURCE') || '',
    sheetUrl: ss_().getUrl(),
  };
}

function actSaveUser_(body, user) {
  const u = body.user || {};
  const email = String(u.email || '').trim().toLowerCase();
  const original = String(body.originalEmail || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail_('bad_request', 'Enter a full Google email address.');
  const role = normRole_(u.role);
  const quoter = String(u.quoter || '').trim();
  const active = u.active !== false;
  const quoterCode = quoter.replace(/\s+/g, ' ').toUpperCase();
  if (role === 'quoter' && !quoterCode) fail_('bad_request', 'Enter the quoter code this person logs leads under, for example JS 1.');
  const codeExists = getQuoters_().some(q => q.code === quoterCode);
  if (quoterCode && !codeExists && !body.createQuoter) fail_('bad_request', 'Quoter code ' + quoterCode + " doesn't exist.");
  if ((original || email) === user.email && (role !== 'admin' || !active)) {
    fail_('bad_request', "You can't remove your own admin access. Ask another admin to do it.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SHEETS.USERS);
    const users = getUsers_();
    const existing = users.filter(x => x.email === (original || email))[0];
    if (users.some(x => x.email === email && x !== existing)) fail_('bad_request', email + ' is already on the list.');
    if (quoterCode && !codeExists) {
      appendRows_(sheet_(SHEETS.QUOTERS), [[quoterCode, String(u.name || '').trim() || quoterCode, true]]);
      bumpDataVersion_();
    }
    const row = [email, String(u.name || '').trim(), role, quoterCode, active,
      existing ? existing.addedBy : user.email, existing ? existing.addedAt : new Date()];
    if (existing) sh.getRange(existing.row, 1, 1, USER_HEADERS.length).setValues([row]);
    else appendRows_(sh, [row]);
    return { users: getUsers_().map(publicUser_), quoters: getQuoters_() };
  } finally {
    lock.releaseLock();
  }
}

function actDeleteUser_(body, user) {
  const email = String(body.email || '').trim().toLowerCase();
  if (email === user.email) fail_('bad_request', "You can't remove yourself.");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const target = getUsers_().filter(x => x.email === email)[0];
    if (!target) fail_('not_found', email + ' is not on the list.');
    sheet_(SHEETS.USERS).deleteRow(target.row);
    return { users: getUsers_().map(publicUser_) };
  } finally {
    lock.releaseLock();
  }
}

function actSaveQuoter_(body) {
  const q = body.quoter || {};
  const code = String(q.code || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const name = String(q.name || '').trim();
  if (!code) fail_('bad_request', 'Enter a quoter code, for example JS 18.');
  if (!name) fail_('bad_request', 'Enter the quoter\'s name.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SHEETS.QUOTERS);
    const rows = readTable_(SHEETS.QUOTERS, QUOTER_HEADERS.length);
    const at = rows.findIndex(r => String(r[0]).trim().toUpperCase() === code);
    const row = [code, name, q.active !== false];
    if (at >= 0) sh.getRange(at + 2, 1, 1, QUOTER_HEADERS.length).setValues([row]);
    else appendRows_(sh, [row]);
    bumpDataVersion_();
    return { quoters: getQuoters_() };
  } finally {
    lock.releaseLock();
  }
}

function actSaveSettings_(body) {
  const incoming = body.settings || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SHEETS.SETTINGS);
    const rows = readTable_(SHEETS.SETTINGS, 3);
    Object.keys(incoming).forEach(k => {
      const def = SETTING_DEFS[k];
      if (!def) return;
      const val = coerceSetting_(incoming[k], def.type, def.def);
      if (def.type === 'int' && !(val >= 0)) fail_('bad_request', k + ' must be a number.');
      if (def.type === 'date' && !val) fail_('bad_request', k + ' must be a date like 2026-10-06.');
      writeSetting_(k, settingToCell_(val, def.type), sh, rows);
    });
    bumpDataVersion_();
    return { settings: getSettings_() };
  } finally {
    lock.releaseLock();
  }
}

function writeSetting_(key, cell, sh, rows) {
  sh = sh || sheet_(SHEETS.SETTINGS);
  rows = rows || readTable_(SHEETS.SETTINGS, 3);
  const at = rows.findIndex(r => String(r[0]).trim() === key);
  if (at >= 0) {
    const c = sh.getRange(at + 2, 2);
    c.setNumberFormat('@');
    c.setValue(cell);
  } else {
    appendRows_(sh, [[key, cell, SETTING_DEFS[key].help]], [2]);
  }
}

function actImportOld_(body, user) {
  return runImport_(user.email, body.url);
}

/* ------------------------------------------------------------------------ */
/* Optional history import from the old Lead Log spreadsheet                 */
/* ------------------------------------------------------------------------ */

/**
 * Copies every lead from the old Lead Log's per-quoter tabs ("JS 1 - Mahi")
 * into this database, along with the day notes. The old spreadsheet is only
 * read, never changed. Safe to run more than once: rows from an earlier import
 * are replaced, and leads logged through the website are never touched.
 */
function runImport_(byEmail, url) {
  const source = String(url || '').trim();
  const idMatch = source.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || source.match(/^([a-zA-Z0-9_-]{20,})$/);
  if (!idMatch) fail_('bad_request', 'Paste the full link to the old Lead Log Google Sheet.');
  if (idMatch[1] === ss_().getId()) fail_('bad_request', "That's the database itself. Paste the link to the old Lead Log.");
  let src;
  try { src = SpreadsheetApp.openById(idMatch[1]); } catch (e) {
    fail_('not_found', "Couldn't open that sheet. Check the link, and that the account that owns this script can view it.");
  }
  const srcTz = src.getSpreadsheetTimeZone() || tz_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const tabs = src.getSheets().filter(sh => OLD_TAB_RE.test(sh.getName().trim()));
    if (!tabs.length) fail_('not_found', 'That sheet has no quoter tabs named like "JS 1 - Mahi".');
    const now = new Date();
    const appNotes = {};
    readTable_(SHEETS.NOTES, NOTE_HEADERS.length).forEach(r => {
      if (!/^import/.test(String(r[5]))) appNotes[String(r[0]).trim() + '|' + normDate_(r[1])] = true;
    });

    const newLeads = [];
    const newNotes = [];
    const summary = [];
    const lastByQuoter = {};

    tabs.forEach(sh => {
      const m = sh.getName().trim().match(OLD_TAB_RE);
      const code = m[1].replace(/\s+/g, ' ').toUpperCase();
      const name = m[2].trim();
      const info = { tab: sh.getName(), code: code, name: name, leads: 0, undated: 0, notes: 0 };
      summary.push(info);
      const lastRow = sh.getLastRow();
      if (lastRow < 4) return;
      const width = Math.max(6, Math.min(sh.getLastColumn(), 30));
      const vals = sh.getRange(1, 1, lastRow, width).getValues();
      const source = 'import:' + sh.getName();

      for (let i = 3; i < vals.length; i++) {
        const r = vals[i];
        const nm = oneLine_(r[1]);
        const st = oneLine_(r[2]); const em = oneLine_(r[3]); const pdf = oneLine_(r[4]); const rs = oneLine_(r[5]);
        if (!nm) continue;
        const date = normDate_(r[0], srcTz);
        if (!date) info.undated++;
        if (date && (!lastByQuoter[code] || date > lastByQuoter[code])) lastByQuoter[code] = date;
        newLeads.push([newId_(), date, code, nm, normStatus_(st), em, pdf, rs, '', now, now, source]);
        info.leads++;
      }

      // Day notes typed into the old "Daily Stats" block.
      const hdr = (vals[2] || []).map(h => String(h).trim().toLowerCase());
      let dateCol = -1;
      for (let c = 6; c < hdr.length; c++) { if (hdr[c] === 'date') { dateCol = c; break; } }
      const noteCol = dateCol >= 0 ? hdr.indexOf('notes', dateCol) : -1;
      if (dateCol >= 0 && noteCol >= 0) {
        for (let i = 3; i < vals.length; i++) {
          const note = str_(vals[i][noteCol]);
          const d = normDate_(vals[i][dateCol], srcTz);
          if (!note || !d || appNotes[code + '|' + d]) continue;
          newNotes.push([code, d, note, byEmail, now, source]);
          info.notes++;
        }
      }
    });

    // Leads: keep website rows, replace earlier imports.
    const leadSheet = sheet_(SHEETS.LEADS);
    const keepLeads = readRaw_(leadSheet, LEAD_HEADERS.length)
      .filter(r => (str_(r[L.ID]) || str_(r[L.NAME])) && !/^import/.test(String(r[L.SOURCE])));
    rewriteBody_(leadSheet, newLeads.concat(keepLeads), LEAD_HEADERS.length, [L.DATE + 1]);

    const noteSheet = sheet_(SHEETS.NOTES);
    const keepNotes = readRaw_(noteSheet, NOTE_HEADERS.length)
      .filter(r => str_(r[0]) && !/^import/.test(String(r[5])));
    rewriteBody_(noteSheet, newNotes.concat(keepNotes), NOTE_HEADERS.length, [2]);

    // Quoters: add any code we haven't seen. Quiet for 14+ days = inactive.
    const known = getQuoters_().map(q => q.code);
    const cutoff = addDays_(todayIso_(), -14);
    const addQ = summary.filter(s => known.indexOf(s.code) < 0)
      .map(s => [s.code, s.name, !!lastByQuoter[s.code] && lastByQuoter[s.code] >= cutoff]);
    if (addQ.length) appendRows_(sheet_(SHEETS.QUOTERS), addQ);

    // "Since start" begins at the first imported day, if that's earlier.
    let first = '';
    newLeads.forEach(r => { if (r[L.DATE] && (!first || r[L.DATE] < first)) first = r[L.DATE]; });
    const settings = getSettings_();
    if (first && (!settings.trackingStart || first < settings.trackingStart)) {
      writeSetting_('trackingStart', first);
    }

    PropertiesService.getScriptProperties().setProperty('HISTORY_SOURCE', 'https://docs.google.com/spreadsheets/d/' + idMatch[1] + '/edit');
    const total = summary.reduce((a, s) => a + s.leads, 0);
    audit_(byEmail, 'import', '', { source: src.getName(), total: total, tabs: summary });
    bumpDataVersion_();
    return { total: total, kept: keepLeads.length, tabs: summary, sourceName: src.getName(), trackingStart: getSettings_().trackingStart };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------------ */
/* Leads helpers                                                             */
/* ------------------------------------------------------------------------ */

function readLeads_() {
  const vals = readRaw_(sheet_(SHEETS.LEADS), LEAD_HEADERS.length);
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i];
    if (!str_(r[L.ID]) && !str_(r[L.NAME])) continue;
    out.push(rowToLead_(r, i + 2));
  }
  return out;
}

function rowToLead_(r, row) {
  const lead = {
    id: str_(r[L.ID]),
    date: normDate_(r[L.DATE]),
    quoter: str_(r[L.QUOTER]),
    name: str_(r[L.NAME]),
    status: normStatus_(r[L.STATUS]),
    email: str_(r[L.EMAIL]),
    pdf: str_(r[L.PDF]),
    reason: str_(r[L.REASON]),
    by: str_(r[L.BY]),
    created: tsIso_(r[L.CREATED]),
    updated: tsIso_(r[L.UPDATED]),
    source: str_(r[L.SOURCE]),
    row: row,
  };
  lead.missing = isMissing_(lead);
  return lead;
}

function publicLead_(l) {
  return {
    id: l.id, date: l.date, quoter: l.quoter, name: l.name, status: l.status, email: l.email, pdf: l.pdf,
    reason: l.reason, by: l.by, created: l.created, updated: l.updated,
    source: /^import/.test(l.source) ? 'import' : 'app', missing: l.missing,
  };
}

/** Same rule as the old sheet's "Rows Missing Info" column. */
function isMissing_(l) {
  if (!l.date || !l.status) return true;
  if (l.status === 'Eligible') return !l.email || !l.pdf;
  if (l.status === 'Ineligible') return !l.reason;
  return false;
}

function cleanLead_(input, user) {
  const lead = {
    quoter: scopeQuoter_(input.quoter, user, false),
    date: normDate_(input.date),
    name: String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    status: normStatus_(input.status),
    email: String(input.email || '').trim().slice(0, 200),
    pdf: String(input.pdf || '').trim().slice(0, 1000),
    reason: String(input.reason || '').trim().slice(0, 500),
  };
  if (!getQuoters_().some(q => q.code === lead.quoter)) fail_('bad_request', 'Unknown quoter code ' + lead.quoter + '.');
  if (!lead.date) fail_('bad_request', 'Pick the date you worked this lead.');
  if (!lead.name) fail_('bad_request', "Enter the prospect's full name.");
  if (STATUSES.indexOf(lead.status) < 0) fail_('bad_request', 'Choose Eligible or Ineligible.');
  if (lead.email && !/^[^@\s]+@[^@\s]+$/.test(lead.email)) fail_('bad_request', 'That email address looks incomplete.');
  if (lead.status === 'Eligible') {
    if (!lead.email) fail_('bad_request', 'Eligible leads need an email address.');
    if (!/^https?:\/\//i.test(lead.pdf)) fail_('bad_request', 'Eligible leads need the quote PDF link (starting with https://).');
    lead.reason = '';
  } else {
    if (!lead.reason) fail_('bad_request', 'Ineligible leads need a reason.');
    lead.pdf = '';
  }
  return lead;
}

function findLead_(id) {
  if (!id) fail_('bad_request', 'Missing lead ID.');
  const sh = sheet_(SHEETS.LEADS);
  const n = sh.getLastRow() - 1;
  const cell = n > 0 ? sh.getRange(2, 1, n, 1).createTextFinder(String(id)).matchEntireCell(true).findNext() : null;
  if (!cell) fail_('not_found', 'That lead was already deleted or changed. Refresh the page.');
  const row = cell.getRow();
  const values = sh.getRange(row, 1, 1, LEAD_HEADERS.length).getValues()[0];
  return { row: row, values: values, lead: rowToLead_(values, row) };
}

function findDuplicates_(all, lead, exceptId) {
  const email = lead.email.toLowerCase();
  const name = lead.name.toLowerCase();
  return all.filter(l => l.id !== exceptId && (
    (email && l.email.toLowerCase() === email) ||
    (l.quoter === lead.quoter && l.date === lead.date && l.name.toLowerCase() === name)
  )).slice(0, 5).map(l => ({ quoter: l.quoter, date: l.date, name: l.name, status: l.status }));
}

function reasonCategory_(text, quickPicks) {
  const t = String(text || '').trim();
  if (!t) return 'No reason given';
  const lower = t.toLowerCase();
  for (let i = 0; i < quickPicks.length; i++) {
    if (quickPicks[i].toLowerCase() === lower) return quickPicks[i];
  }
  for (let i = 0; i < REASON_RULES.length; i++) {
    if (REASON_RULES[i][0].test(t)) return REASON_RULES[i][1];
  }
  return 'Other';
}

/* ------------------------------------------------------------------------ */
/* Stats                                                                     */
/* ------------------------------------------------------------------------ */

function computeStats_() {
  const leads = readLeads_();
  const picks = getSettings_().reasons;
  const days = {};
  const reasons = {};
  const undated = {};
  const last = {};
  leads.forEach(l => {
    const q = l.quoter;
    if (!l.date) { undated[q] = (undated[q] || 0) + 1; return; }
    const k = q + '|' + l.date;
    const d = days[k] || (days[k] = [q, l.date, 0, 0, 0, 0]);
    if (l.status === 'Eligible') d[2]++;
    else if (l.status === 'Ineligible') d[3]++;
    else d[4]++;
    if (l.missing) d[5]++;
    if (l.status === 'Ineligible') {
      const rk = k + '|' + reasonCategory_(l.reason, picks);
      reasons[rk] = (reasons[rk] || 0) + 1;
    }
    if (!last[q] || l.date > last[q]) last[q] = l.date;
  });
  const notes = readTable_(SHEETS.NOTES, NOTE_HEADERS.length)
    .map(r => [str_(r[0]), normDate_(r[1]), str_(r[2])])
    .filter(n => n[0] && n[1] && n[2]);
  return {
    days: Object.keys(days).map(k => days[k]),
    reasons: Object.keys(reasons).map(k => { const p = k.split('|'); return [p[0], p[1], p[2], reasons[k]]; }),
    undated: undated,
    lastLogged: last,
    notes: notes,
  };
}

function statsCached_() {
  const version = dataVersion_();
  const key = 'stats_' + version;
  const cached = cacheGetBig_(key);
  if (cached) return JSON.parse(cached);
  const stats = computeStats_();
  cachePutBig_(key, JSON.stringify(stats), 600);
  return stats;
}

/* ------------------------------------------------------------------------ */
/* Users, quoters, settings                                                  */
/* ------------------------------------------------------------------------ */

function getUsers_() {
  return readTable_(SHEETS.USERS, USER_HEADERS.length)
    .map((r, i) => ({
      row: i + 2,
      email: str_(r[0]).toLowerCase(),
      name: str_(r[1]),
      role: normRole_(r[2]),
      quoter: str_(r[3]).replace(/\s+/g, ' ').toUpperCase(),
      active: r[4] === '' || r[4] === true || /^(true|yes|y|1)$/i.test(String(r[4])),
      addedBy: str_(r[5]),
      addedAt: r[6],
    }))
    .filter(u => u.email);
}

function publicUser_(u) {
  return { email: u.email, name: u.name, role: u.role, quoter: u.quoter, active: u.active, picture: u.picture || '' };
}

function normRole_(r) {
  const s = String(r || '').trim().toLowerCase();
  return ROLES[s] ? s : 'quoter';
}

function getQuoters_() {
  return readTable_(SHEETS.QUOTERS, QUOTER_HEADERS.length)
    .map(r => ({
      code: str_(r[0]).replace(/\s+/g, ' ').toUpperCase(),
      name: str_(r[1]),
      active: r[2] === '' || r[2] === true || /^(true|yes|y|1)$/i.test(String(r[2])),
    }))
    .filter(q => q.code)
    .sort((a, b) => naturalKey_(a.code) - naturalKey_(b.code) || a.code.localeCompare(b.code));
}

function getSettings_() {
  const out = {};
  Object.keys(SETTING_DEFS).forEach(k => { out[k] = SETTING_DEFS[k].def; });
  readTable_(SHEETS.SETTINGS, 3).forEach(r => {
    const k = str_(r[0]);
    if (SETTING_DEFS[k]) out[k] = coerceSetting_(r[1], SETTING_DEFS[k].type, SETTING_DEFS[k].def);
  });
  if (typeof out.reasons === 'string') out.reasons = out.reasons.split('|').map(s => s.trim()).filter(String);
  if (!out.trackingStart) out.trackingStart = todayIso_();
  return out;
}

function coerceSetting_(v, type, def) {
  if (v === '' || v === null || v === undefined) return def;
  switch (type) {
    case 'int': { const n = parseInt(v, 10); return isNaN(n) ? def : n; }
    case 'pct': {
      let n = parseFloat(String(v).replace('%', ''));
      if (isNaN(n)) return def;
      if (n > 1) n = n / 100;
      return Math.round(n * 1000) / 1000;
    }
    case 'bool': return v === true || /^(true|yes|y|1)$/i.test(String(v).trim());
    case 'date': return normDate_(v) || def;
    case 'list': return Array.isArray(v) ? v.join('|') : String(v);
    default: return String(v).trim();
  }
}

function settingToCell_(v, type) {
  if (type === 'bool') return v ? 'TRUE' : 'FALSE';
  if (type === 'list' && Array.isArray(v)) return v.join('|');
  return String(v);
}

/** Quoters may only touch their own code; managers and admins pick any (or ALL when allowed). */
function scopeQuoter_(requested, user, allowAll) {
  if (user.role === 'quoter') return user.quoter;
  const q = String(requested || '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (q === 'ALL' && allowAll) return 'ALL';
  if (!q) fail_('bad_request', 'Pick a quoter.');
  return q;
}

function canSeeQuoter_(user, code) {
  return user.role !== 'quoter' || user.quoter === code;
}

/* ------------------------------------------------------------------------ */
/* Sheet plumbing                                                            */
/* ------------------------------------------------------------------------ */

function ss_() { return SpreadsheetApp.getActive(); }
function tz_() { return ss_().getSpreadsheetTimeZone() || 'America/Los_Angeles'; }
function todayIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) fail_('setup', 'The "' + name + '" tab is missing. Run setup() in Apps Script.');
  return sh;
}

function ensureSheet_(name, headers, widths, textCols) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  (widths || []).forEach((w, i) => sh.setColumnWidth(i + 1, w));
  (textCols || []).forEach(c => sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'));
  return sh;
}

function readTable_(name, width) {
  return readRaw_(sheet_(name), width);
}

function readRaw_(sh, width) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, width).getValues();
}

/** Appends rows, keeping the listed columns (1-based) as plain text so dates stay YYYY-MM-DD. */
function appendRows_(sh, rows, textCols) {
  if (!rows.length) return;
  const start = sh.getLastRow() + 1;
  const need = start + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  (textCols || []).forEach(c => sh.getRange(start, c, rows.length, 1).setNumberFormat('@'));
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

function rewriteBody_(sh, rows, width, textCols) {
  const old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, width).clearContent();
  if (!rows.length) return;
  const need = rows.length + 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  (textCols || []).forEach(c => sh.getRange(2, c, rows.length, 1).setNumberFormat('@'));
  const CHUNK = 4000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    sh.getRange(2 + i, 1, part.length, width).setValues(part);
  }
}

function audit_(email, action, id, details) {
  try {
    const text = JSON.stringify(details || {});
    appendRows_(sheet_(SHEETS.AUDIT), [[new Date(), email, action, id || '', text.slice(0, 45000)]]);
  } catch (e) { /* never block the real work on the audit trail */ }
}

/* ------------------------------------------------------------------------ */
/* Small utilities                                                           */
/* ------------------------------------------------------------------------ */

function fail_(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function str_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Text with stray line breaks and doubled spaces removed (some old cells hold a hidden line break). */
function oneLine_(v) {
  return str_(v).replace(/\s+/g, ' ');
}

function normStatus_(v) {
  const s = str_(v);
  if (/^eligible$/i.test(s)) return 'Eligible';
  if (/^ineligible$/i.test(s)) return 'Ineligible';
  return s;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Any date a sheet may hold (real date, serial number, or text) -> "YYYY-MM-DD", or "" if it isn't one.
 * Real date cells are read in the time zone of the sheet they came from (default: this database).
 */
function normDate_(v, timeZone) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, timeZone || tz_(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return '';
    return Utilities.formatDate(new Date(Math.round((v - 25569) * 86400000)), 'UTC', 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return iso_(+m[3], +m[1], +m[2]);
  m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso_(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return '';
}

function iso_(y, mo, d) {
  if (!(y > 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}

function addDays_(iso, n) {
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}

function tsIso_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : v.toISOString();
  return str_(v);
}

function naturalKey_(code) {
  const m = String(code).match(/(\d+)/);
  return m ? Number(m[1]) : 9999;
}

function newId_() {
  return 'L' + Utilities.getUuid().replace(/-/g, '').slice(0, 11);
}

function digest_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
  return Utilities.base64EncodeWebSafe(bytes).slice(0, 43);
}

function dataVersion_() {
  const cache = CacheService.getScriptCache();
  let v = cache.get('dataVersion');
  if (!v) { v = Utilities.getUuid().slice(0, 8); cache.put('dataVersion', v, 21600); }
  return v;
}

function bumpDataVersion_() {
  CacheService.getScriptCache().put('dataVersion', Utilities.getUuid().slice(0, 8), 21600);
}

/** CacheService caps each value at 100 KB, so big values are split across keys. */
function cachePutBig_(key, text, ttl) {
  const cache = CacheService.getScriptCache();
  const size = 90000;
  const parts = {};
  let n = 0;
  for (let i = 0; i < text.length; i += size) { parts[key + '_' + n] = text.slice(i, i + size); n++; }
  if (n > 200) return; // too big to be worth caching
  parts[key + '_n'] = String(n);
  try { cache.putAll(parts, ttl); } catch (e) { /* cache is best effort */ }
}

function cacheGetBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + '_n') || 0);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  let text = '';
  for (let i = 0; i < n; i++) {
    if (got[keys[i]] === undefined) return null;
    text += got[keys[i]];
  }
  return text;
}
