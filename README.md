# Carbook

A deliberately simple vehicle expense and profit tracker. No framework, accounts, packages, or build step.

## Features

- Add vehicles by VIN (automatic make/model/year lookup through the public NHTSA vPIC API), or enter the details manually.
- Add, edit, and remove expenses; totals and potential profit update as you type.
- Enter an estimated value and optional sale price. When sold price is provided, the result changes from potential to actual profit.
- A CARFAX shortcut opens the official value page and copies the VIN to your clipboard. Use ZIP **73013** there, then enter the value in Carbook.
- Saves to `localStorage` on the current browser; JSON import and export for backup.
- Mobile responsive.

## Start / publish

Open `index.html` to try it locally. For full VIN lookup testing, use a local server because some browser security settings restrict network requests from `file://` pages:

```bash
python3 -m http.server 8000
```

Visit `http://localhost:8000`.

To publish like a typical GitHub → Vercel project: commit this directory to a GitHub repository called `carbook`; in the Vercel dashboard, import that repository. Framework preset: **Other**. Root directory: `/`. No build command or output directory configuration required. Each push to `main` automatically deploys after Git integration.

## CARFAX pricing limitation

**Carbook does not automatically retrieve or update CARFAX valuations.** The consumer website does not provide a documented public valuation API that this project can legitimately call. CARFAX directs third-party integrations to its business development team: https://www.carfax.com/company/partners. CARFAX and NHTSA provide different things: NHTSA's public API returns vehicle specifications, **not value**.

A genuine 72-hour auto-refresh feature would require CARFAX authorization and an agreed API/data contract, as well as a cloud database and a scheduled backend process. In the meantime, values are explicitly marked as manually entered; no invented valuations or fake refresh timestamps appear.

## Privacy and caveats

Your cars, VINs, costs, and sale values remain only in the local storage of the browser in which you enter them, not in a shared cloud database. This means you won't see the same records in another browser or phone. Clearing site data can erase them. Export backups regularly. Data in browser storage is not a secure encrypted vault; avoid use on shared public computers.

The ZIP code used for the CARFAX shortcut is 73013. CARFAX can take mileage, history, and location into account; update the estimate when those factors change. A market value does not guarantee that a particular car can be sold for that amount.
