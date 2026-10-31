# Authorized valuation adapter contract

Automatic valuation is **disabled**. No provider, credentials, scheduled job, or invented API endpoint is included.

Research checked October 31, 2026:
- CARFAX US directs third-party integrations to Business Development: https://www.carfax.com/company/partners (busdevpartner@carfax.com). Obtain written authorization, US coverage, History-Based Value access, API contract, and storage/refresh rights. A consumer lookup page is not an API.
- CARFAX Canada advertises an authorized valuation API: https://go.carfax.ca/valuation-suite and https://apireference.carfax.ca/. That does not establish support for US ZIP 73013.
- Manheim documents a valuation API: https://developer.manheim.com/apis/marketplace/valuations.html. Its wholesale MMR product is different from CARFAX History-Based Value and requires its own access agreement.

Future integration should run on a trusted backend (Supabase Edge Function or Vercel function). Never put provider credentials or a Supabase service-role key in config.js, HTML, Git, or browser responses.

Use existing fields: `estimated_value` (USD), `valuation_source` (provider/product), `valuation_updated_at` (actual successful fetch time), `vin`, and `revision`. The location is fixed to ZIP `73013`. On VIN change the UI clears the old valuation. Keep manual values until a verified provider response succeeds. Validate currency, VIN, ZIP, amount, and valuation timestamp against the eventual provider contract. Never convert missing/error responses to zero.

Once authorized and configured, schedule a backend job at least daily and refresh eligible unsold vehicles whose provider valuation is at least 72 hours old. Define whether automatic values may replace manual entries; default to explicit opt-in. Read each vehicle revision, fetch the provider, then update with `where id = ... and revision = ...`, increasing revision by one. If no row matches, skip it so concurrent user edits are preserved. Store value, source, and actual successful timestamp together. Do not advance timestamps on errors; log errors on the backend and honor provider rate limits. RLS must remain enabled; a backend using an elevated key must constrain records explicitly. Test real responses and the scheduler before describing auto-refresh as active.
