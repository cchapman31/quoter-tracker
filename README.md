# Remote Quoter Tracker

A website for logging leads and tracking quoter stats. It replaces the old
"Remote Quoter Lead Log" spreadsheet: quoters enter everything on the site, and the data is stored
in a **separate Google Sheet used only as the database**. Nobody but admins ever opens that sheet.

- **Quoters** log each lead in a few seconds (name, Eligible/Ineligible, email + quote link or a
  reason), see today's count against the 50-a-day target, and fix rows that are missing info.
- **Managers** see the team summary (today, this week, any date range), charts, ineligible
  reasons, and a weekly bonus report they can download.
- **Admins** also manage who can sign in, the quoter list, and the targets.

```
 Browser (GitHub Pages)  ──►  Apps Script web app  ──►  Database Google Sheet
 index / stats / team /       checks the Google         Leads, Users, Quoters,
 admin pages                  sign-in + role            Day Notes, Settings, Audit Log
```

The site never touches the database sheet directly. Each request carries the person's Google
sign-in token; the Apps Script checks it with Google, looks the email up on the **Users** tab,
and only then reads or writes.

## What's in this repo

```
index.html          Log leads (the page quoters live on)
stats.html          Stats for one quoter (quoters see their own; managers pick anyone)
team.html           Team summary, charts, weekly bonus report, CSV downloads
admin.html          People, quoters, targets, copying in history
.nojekyll           Tells GitHub Pages to serve files as-is
assets/
  config.js         ← your Google client ID + Apps Script URL go here
  common.js         Sign-in, API calls, shared date/stats math
  leads.js          The lead list, edit and delete (shared by Log leads and Quoter stats)
  log.js stats.js team.js admin.js   One script per page
  charts.js         The charts
  demo.js           Made-up data for demo mode
  styles.css, fonts/, icon.svg
apps-script/
  Code.gs           The backend. Runs in Apps Script, NOT on GitHub (kept here for history)
```

## Try it first: demo mode

While `API_URL` in `assets/config.js` is empty, the site runs in **demo mode** with made-up
people and a "View as" switcher (quoter / manager / admin). Nothing is saved. Push the repo to
GitHub Pages first if you want to click around before doing the Google setup. After you go live
you can still see the demo by adding `?demo` to any page address.

---

## Setup (about 20 minutes)

### 1. Create the database sheet

1. Go to <https://sheets.new> to make a new, blank Google Sheet. Name it
   **Quoter Tracker Database**. Don't share it with quoters; only admins need it.
2. In that new sheet, open **Extensions → Apps Script**.
3. Delete whatever is in `Code.gs`, paste in the whole of `apps-script/Code.gs` from this repo,
   and click **Save**. Name the project *Quoter Tracker*.
4. In the toolbar's function dropdown pick **setup**, then **Run**. Google asks for permission:
   click **Review permissions**, choose your account, then **Advanced → Go to Quoter Tracker
   (unsafe)** → **Allow**. ("Unsafe" only means Google hasn't reviewed a script you wrote
   yourself.)

`setup` creates six tabs (**Leads, Users, Quoters, Day Notes, Settings, Audit Log**) and makes
you the first admin. It never deletes anything, so running it again is safe. You can delete the
empty "Sheet1" tab.

### 2. Create a Google sign-in client ID

1. Go to <https://console.cloud.google.com/>, create a project (e.g. *Quoter Tracker*).
2. Open **APIs & Services → OAuth consent screen** (also labelled *Google Auth Platform*).
   - App name: *Remote Quoter Tracker*; support email: yours.
   - Audience / user type: **External**, then **Publish app** so it's *In production*.
     The site only asks for name and email, so Google doesn't need to review it. (Left in
     *Testing*, only people you list as test users could sign in.)
3. Open **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://YOUR-GITHUB-USERNAME.github.io`
     (just the origin, no folder and no trailing slash)
4. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

### 3. Connect the client ID and deploy the backend

1. In Apps Script, click the gear (**Project Settings**) in the left strip, scroll to
   **Script properties**, **Add script property**: `GOOGLE_CLIENT_ID` = the client ID. Save.
2. Click **Deploy → New deployment**. Click the gear next to *Select type* and choose
   **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**, approve
   again if asked, and copy the **Web app URL** (ends in `/exec`).

> **If you only see "Anyone within your-domain.com":** your Google Workspace blocks public web
> apps. The site calls the script without a Google session (it does its own sign-in check), so
> it needs **Anyone**. Ask your Workspace admin to allow it, or create the database sheet from a
> personal Gmail account.

### 4. Put the site on GitHub

1. Create a repository (e.g. `quoter-tracker`) and upload everything in this folder, keeping
   `index.html` at the top level of the repo, not inside a subfolder.
2. Edit `assets/config.js`:
   ```js
   GOOGLE_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
   API_URL: 'https://script.google.com/macros/s/XXXX/exec',
   ```
3. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
   After a minute or two the site is at `https://YOUR-GITHUB-USERNAME.github.io/quoter-tracker/`.

Both values in `config.js` are visible to anyone who opens the site, and that's fine: neither is
a secret, and the backend checks every request by itself. A public repo is OK because no data
lives in it (GitHub Pages on a private repo needs a paid GitHub plan).

### 5. Add your team

Sign in on the site and open **Admin → People → Add person**. For each quoter enter the Google
account they'll sign in with (Gmail works), their name, role **Quoter**, and either pick an
existing quoter code or leave **New quoter code** selected (it suggests the next number, e.g.
`JS 1`; type the code they already use). Add managers with the **Manager** role. Anyone not on
the list is turned away at sign-in.

If you copy in history first (step 6), the quoter codes from the old tabs already exist and you
just pick them.

### 6. Bring in history from the old Lead Log (optional)

Skip this to start everyone from zero. To keep the Oct 6 to today numbers and bonus history:
**Admin → Data → Bring in history**, paste the link to the old *Remote Quoter Lead Log* sheet,
and click **Copy history**. (The database sheet's **Quoter Tracker** menu has the same option.)

It reads every tab named like `JS 1 - Mahi` in the old sheet and copies the leads and day notes
into the database. Quoter codes it hasn't seen are added (anyone with no leads in the last
14 days starts as inactive), and "since start" totals move back to the first old lead. The old
sheet is only read, never changed. Expect about 15,900 leads from 14 tabs. You can run it again
any time: it replaces the previous copy and keeps every lead logged on the site.

The account that owns the script needs at least view access to the old sheet.

### 7. Switch over

On the day you switch:

1. Ask quoters to stop typing in the old Lead Log.
2. If you brought in history, click **Copy again** on the Admin page to pick up their last rows.
3. Send quoters the site link. From now on they only use the site.
4. Make the old Lead Log view-only (or unshare it) so nobody keeps typing there by habit.

---

## Using it

**Quoters (Log leads):** type the name, pick Eligible or Ineligible (**Alt+1 / Alt+2**), fill
email + quote link or a reason, press **Enter**. The form clears instantly and the lead saves in
the background. If the internet drops, unsaved leads wait on that computer and retry; nothing
typed is lost. A warning appears if the same email (or the same name on the same day) was
already logged, with an Undo button. The Today panel shows eligible leads and bonus leads so far
this pay period. **Needs fixing** lists any rows missing info.

**Quoter stats / My stats:** figures, a daily chart, week-by-week totals, ineligible reasons,
day-by-day notes, and the **lead list** for the chosen date range. Filter the list to Eligible,
Ineligible or Missing info, search by name or email, edit or delete a lead, or download the list
as a CSV. Select a date in the day-by-day table to see only that day's leads.

**Managers (Team):** pick a date range. The summary table matches the old Team Summary tab;
click a quoter for their stats and leads. **Bonus leads** can be grouped by pay period or by week;
**Download bonus report** gives that table as a CSV, and **Download leads** exports every lead in
the range.

**Date ranges:** every date filter has quick picks (This week, Last week, This month, Since
start), a **Pay period** picker, and a custom From/To range.

**Light or dark:** the sun/moon button in the top bar switches between light and dark. Until
someone uses it, the site follows their computer's setting; after that it remembers their
choice on that browser.

**Admins (Admin):** add or remove people, mark quoters inactive, change targets and the pay
period schedule, copy history.

## How the numbers work

Same rules as the old sheet:

- **Eligible / Ineligible**: count of leads with that status on that date.
- **Eligible rate**: eligible ÷ (eligible + ineligible). Target 65%.
- **Eligible per day**: eligible ÷ days with at least one lead logged. Target 50.
- **Bonus leads**: on a weekday (Monday to Friday), every eligible lead above 50 that day; on a
  Saturday or Sunday, every eligible lead. Ineligible leads never count toward bonus.
- **Pay periods**: 14 days, Saturday to Friday, starting Saturday, Nov 7, 2026 (Nov 7 – Nov 20,
  Nov 21 – Dec 4, and so on). Every past and future period is calculated from that start, so
  nothing needs adding as time goes on. If the schedule ever changes, update *A pay period
  starts on* and *Pay period length* on the Admin page.
- **Rows missing info**: eligible without email or quote link, ineligible without a reason, or
  no date.
- **Today** follows the database sheet's time zone. A new sheet uses your Google account's time
  zone; the old Lead Log used Pacific time. Change it under *File → Settings* in the database
  sheet if you want "today" to roll over at a different midnight.

Targets, the bonus threshold, the start date and the pay period schedule are editable on the
Admin page.

**One deliberate difference from the old Team Summary:** six tabs (JS 3, 5, 11, 14, 16, 17)
have an extra column, so the old summary read the wrong columns for them. It showed 0 for
"This Week" and summed the "Avg Elig/Day" column as "Bonus" (e.g. Baburaj 232.0). The site
counts the leads themselves, so those six show their real numbers (Baburaj: 123 bonus). Every
other figure matches the old summary exactly.

Ineligible reasons in the old sheet were free text (over 200 spellings). The form now offers
standard picks, and the reasons chart groups the copied text into the same categories (e.g.
"mobile/manufactured home" counts as *Mobile home*). The original text is kept unchanged.

## Updating a site that's already set up

When you get a new version of this repo:

1. **Backend:** open the database sheet's **Extensions → Apps Script**, replace all of `Code.gs`
   with the new `apps-script/Code.gs`, click **Save**, then **Deploy → Manage deployments →
   pencil icon → Version: New version → Deploy**. The `/exec` URL stays the same.
2. **Site:** upload the changed files to the GitHub repo, keeping your own `assets/config.js`.
   GitHub Pages republishes within a minute or two. Ask people to refresh the page.

New settings (like the pay period schedule) use their defaults until an admin changes them on
the Admin page; nothing else needs doing.

## Changing the backend later

Edit the code in Apps Script, then **Deploy → Manage deployments → pencil icon → Version: New
version → Deploy**. This keeps the same `/exec` URL, so `config.js` doesn't change. Copy your
edits back into `apps-script/Code.gs` here so the repo stays the source of truth.

## Security notes

- Every request is checked: the Google token must be valid and issued for your client ID, the
  email must be active on the **Users** tab, and quoters can only read or change their own leads.
- Edits, deletes and history copies are recorded on the **Audit Log** tab, including a copy of
  any deleted lead.
- The database sheet is the master copy. Share it with admins only: anyone who can edit it can
  read every prospect's details and change the script.

## Limits worth knowing

- A Google Sheet holds 10 million cells. At ~600 leads a day the Leads tab grows by about
  2 million cells a year, so plan to move old years into an archive sheet.
- Each save takes a second or two to reach the database; the page doesn't make anyone wait for it.
- A Google sign-in lasts an hour. Google usually renews it silently; if not, the page asks the
  person to sign in again and keeps anything waiting to save.

## Running it on your computer

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. With `API_URL` empty you get demo mode. To test real sign-in
locally, add `http://localhost:8000` to the client ID's Authorized JavaScript origins.
