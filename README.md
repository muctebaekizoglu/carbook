# Carbook

A small HTML/CSS/JavaScript vehicle ledger. Expenses, estimated value, optional sale price, and profit. No framework or build step. Supabase provides email/password authentication and PostgreSQL storage. The pinned Supabase JS 2.49.8 browser SDK is included in `vendor/supabase.js` (MIT; upstream license in `vendor/SUPABASE-LICENSE`).

## One-time Supabase setup

The existing public Supabase configuration is preserved. Read-only live checks confirmed that the configured Auth endpoint responds and anonymous vehicle access is denied. Authenticated saving, login, and email delivery are not live-verified; the browser regression tests use a mock service. Follow these steps for a new Supabase project or deployment; existing configured projects do not need a schema change for this interface update. Existing `carbook.records.v2` browser data is untouched.

1. Create a Supabase project at https://supabase.com/dashboard. Keep its database password private.
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and run it once against the new database. This creates vehicles, expenses stored as validated JSON per vehicle, valuation metadata, import receipts, owner-only RLS policies, and a transactional import function. It does not seed any financial data. Do not run it on top of an unrelated existing schema.
3. Under **Project Settings → API / API Keys**, copy the **Project URL** and **publishable key** (`sb_publishable_…`). The legacy `anon` key also works. Edit `config.js`:
   ```js
   window.CARBOOK_CONFIG = {
     supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
     supabasePublishableKey: 'YOUR_PUBLIC_PUBLISHABLE_KEY'
   };
   ```
   These two values are intentionally public. Never paste a secret key (`sb_secret_…`), `service_role` key, database password, or connection string here. Access protection comes from authentication and RLS, not from hiding the public key.
4. In **Authentication → Sign In / Providers**, enable **Email**, email/password sign-in, and email confirmation. Set a minimum password length of 8 or higher; the app accepts at least 8 for new/reset passwords.
5. In **Authentication → URL Configuration**, set **Site URL** to the production URL (for example `https://carbook.vercel.app`). Add the exact application root URLs to **Redirect URLs**, including the trailing slash: `https://carbook.vercel.app/`, your custom domain if used, and `http://localhost:5173/` for development. Add each preview URL explicitly if testing confirmation/reset links there. The app sends users back to the root URL for confirmation and password recovery.
6. Configure **Authentication → Email → SMTP Settings** with a production email provider and verified sender. Supabase's default sender is intended for limited testing; delivery and rate limits must be verified. Keep default confirmation/recovery templates compatible with Supabase `ConfirmationURL` links.
7. Commit the public config and project changes to GitHub. Vercel: import this repository, choose **Other**, leave build command unset and output directory as the repository root. Pushes deploy automatically. No Vercel secrets or backend are required for the manual valuation version. `vercel.json` prevents stale config and applies basic security headers.
8. Open the deployed site, create an account, confirm its email, and log in. Follow the live verification checklist below before relying on cloud saving.

For local preview: `python3 -m http.server 5173` and open http://localhost:5173/. Use an HTTP server rather than opening index.html as a file.

## Saving and device sync

“Saving…” appears during an actual save. “Saved” appears only after Supabase confirms success, then fades out after about two seconds. Neither initial loading nor background synchronization reports a successful save. Notifications occupy no layout space when hidden. Saving errors remain visible while editing or waiting; retrying successfully resolves them. Fields use explicit Save buttons; unsaved changes are indicated and navigation warns before discarding them. Failed saves leave input visible for retry. A revision check prevents stale saves from overwriting a concurrent edit; reload after a conflict. Browser edits are not an offline queue: keep the page open and retry if a network request fails.

Signed-in sessions persist using the Supabase SDK and refresh automatically. Cloud records are fetched after login, on focus/online, and approximately every 30 seconds while visible and idle. Polling pauses while edits or a vehicle dialog are open. This does not require enabling Realtime. Logout clears the current device session and visible account records.

Expenses include the purchase price: record it as an expense to include it in total invested. Profit is estimated value minus expenses when unsold, and sold price minus expenses when sold. Blank means unknown; zero is a valid recorded amount. A sale price marks a vehicle sold; clear it to mark unsold. Calculations sum integer cents. Estimates are manually entered and their source/date is stored. Changing a VIN clears the previous estimate to avoid showing a value for another vehicle.

## Garage and vehicle links

The homepage is a responsive gallery of the signed-in user's Supabase vehicles. Each card links to `?vehicle=VEHICLE_ID`. It shows recorded vehicle details and profit only when an estimate or sold price is available. Add vehicle appears only in the garage.

Vehicle detail links survive refresh and login, and browser back/forward works without a router dependency or hosting rewrite. The Garage link returns to the gallery. Missing or inaccessible vehicle IDs show a neutral unavailable state; they never fall back to another vehicle. Unsaved edits require confirmation before navigation; navigation during an active save is blocked until it completes. Deletion returns to the garage after Supabase confirms it.

## Vehicle entry and interactions

Add a vehicle by pasting its VIN. Whitespace is removed and letters are normalized to uppercase; the form accepts exactly 17 characters excluding I, O, and Q. The official [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/) retrieves model year, make, and model, which appear before saving and become the display name. No example vehicle or default name is inserted. The request goes directly from the browser to NHTSA without credentials, and times out after 10 seconds.

The decoder only accepts a complete result with NHTSA error code 0. Uncertain/invalid results, missing fields, and outages offer **Enter details manually** and a retry. Manual correction never invents missing data. Changing a VIN cancels the previous request so a delayed response cannot overwrite the current result. Opening an existing vehicle preserves its stored name and VIN without automatically decoding or renaming it; **Correct details** allows a deliberate name edit. Legacy vehicles without VINs can still be edited. The existing database schema is unchanged.

The centered ledger uses one surface for expenses and values, with compact rows and explicit saving. A row's **Remove** action becomes **Save** while its fields are edited. Saved changes never erase another form's unsaved draft. Subtle entrance, gallery/detail, modal, and expense transitions use 160–240ms motion. All motion is disabled when the system requests reduced motion.

Login, registration, reset email, and replacement-password forms have stable, separate IDs and native POST form semantics. Email fields use `autocomplete="username"`; login uses `current-password` and registration/replacement use `new-password`. Credentials remain in their native controls during submission for password managers, with no paste interception or composition rules that block generated passwords. Browser tests verify labels, field association, autocomplete metadata, keyboard submission, and autofill-like value assignment. Actual save/generation prompts in iCloud Keychain, Safari, and password-manager extensions still require device-level testing.

## Existing browser records

The browser-record migration experience has been removed. The client does not read, import, or delete `carbook.records.v2`, and it never suggests an import on login or signup. The garage reads only the user's Supabase records. Existing cloud vehicles are unchanged.

The database's legacy import function, receipt table, policies, and legacy keys remain intact for compatibility and data preservation. No database migration is required; do not drop those objects as part of this UI update. Their existing SQL regression tests remain in place.

## Valuation

Manual value entry and a CARFAX lookup link use ZIP **73013**. The lookup attempts to copy the VIN; enter VIN and ZIP on CARFAX yourself. No scraping, fake estimates, or automatic valuation refresh takes place. NHTSA decoding supplies vehicle identity only, not a financial value.

CARFAX US routes third-party integrations through its [partnership team](https://www.carfax.com/company/partners). CARFAX Canada advertises an API, but that does not establish US ZIP coverage or authorization for this project. See [`supabase/valuation.md`](supabase/valuation.md) for sources and the backend adapter / 72-hour refresh contract for a future authorized provider. Automatic valuation requires a separate provider agreement, backend credentials, implementation against its actual API, and live validation.

## Validation

Run `node --test tests/finance.test.cjs tests/vin.test.cjs`. Browser integration tests use Playwright against an explicitly mocked Supabase service: `npm install --no-save --package-lock=false playwright@1.64.1 @electric-sql/pglite@0.5.13` then `node --test tests/browser.test.cjs tests/interface.test.cjs` (a Chromium installation is required: `npx playwright install chromium`). Run `node --test tests/schema.test.cjs` for embedded PostgreSQL checks of RLS, ownership, revision conflicts, data validation, and import transactions. These checks do not verify a real Supabase project. The interface tests include 320px, 360px, 390px, 760px, and desktop layouts; native auth-form semantics; decoding, fallback, stale responses, safe editing, reduced motion, gallery layouts, direct links, browser history, unsaved-navigation guards, two-second save feedback, persistent errors, and absence of migration prompts. To include a real NHTSA browser request using a public test VIN, run `CARBOOK_LIVE_VIN=1 node --test tests/interface.test.cjs`. Both browser suites override config.js and Supabase so they never read or write your live account records.

Required live checks after setup:

- Sign up, confirm email, log in, reload to confirm session persistence, log out, and reset password through an actual email. Confirm invalid/expired reset links report an error.
- Add a vehicle by VIN, confirm the decoded details, record purchase and repair costs, edit/remove costs, save an estimate, mark sold with a sale price, clear sale price, and edit/delete a vehicle. Reload to confirm saved values.
- Log into the same account on a second device; verify changes appear when idle (within 30 seconds or on focus). Edit the same vehicle on both devices and verify the stale save is rejected.
- Create a second account and verify it sees none of the first account's records. Using that account's access token, attempt select/update/delete against another user's vehicle UUID and an insert with the other user's user_id. RLS must deny changes and return no private rows. Repeat without a session. Never disable RLS to fix a configuration problem.
- Verify that login/signup never offers a browser import and old browser records remain untouched.
- Open a direct vehicle link, refresh, and navigate back/forward. On a phone, test gallery cards, forms, keyboard, scrolling, validation, and dialogs. At 360px wide, expenses and amounts must remain usable without horizontal scrolling.
