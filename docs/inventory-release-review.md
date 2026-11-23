# Inventory release review

The inventory candidate is validated locally. The existing public sales site was reachable and returned its sales JSON. The inventory asset URL on that site still returned its HTML fallback. Publish the inventory URL only after the intended production deployment passes the checklist below.

## Reproduce the checks

Start from the repository root with the licensed POS archive and Python dependencies described in the README. The production data command generates a file for local review.

```powershell
.\.venv\Scripts\python.exe -m retail_bi.pos_pipeline --local-export
.\.venv\Scripts\python.exe -m retail_bi.inventory_pipeline --publish-export
.\.venv\Scripts\python.exe scripts/validation/audit_inventory.py
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider

cd frontend
npm ci
npm run lint
npx --no-install tsc -b
npm test
npm run build
npm install --prefix ..\data\local\browser-qa --no-save --no-package-lock --cache ..\data\local\browser-qa-cache playwright-core@1.65.1
node scripts/browser-qa.mjs
```

The browser check uses an installed Google Chrome and starts Vite preview on port 4175. Playwright installs into the Git-ignored local data directory. The check covers 375, 390, 768, 1024, and 1440 px, including chart and tooltip bounds, navigation, and intentional table scrolling. Desktop checks cover the sales overview, filters used together, cards and charts, table sorting, empty and loading states, and four actual CSV downloads. The script checks names, date scopes, numeric values, row counts, UTF-8 encoding, quoting, and source identifier exclusion. It fails on console warnings and errors, failed requests, or bad HTTP responses outside the deliberate failure test.

The independent data audit reopened the source archive and compared paid and refunded unit flows across the entire history. It used 731 days × 30 stores × 67 SKUs for the expected daily grain and replayed FIFO for 48,240 store–SKU month ends. The annual cost denominator used 365 daily closing balances. Two full runs generated identical inventory gzip checksums. [Findings](inventory-findings.md)

The full working tree passed 30 Python tests and 13 frontend tests. A separate archive of `main` with only the intended release files passed 26 Python tests and a clean-install production build. The four additional full-worktree tests cover unrelated legacy edits. The final build emits a 226.60 kB entry and a 424.78 kB chart chunk, with no chunk-size warning. The inventory gzip is 510,302 bytes.

## Publication boundary

Mendeley Data marks version 1 of the synthetic POS dataset CC BY 4.0. The browser credits the source and links the license. Both public export commands require the matching archive SHA-256. The sales asset applies its existing cohort policy. The inventory asset uses aggregate store–SKU months and catalog aliases. The build allows only the two reviewed data files, emitted app assets, and known site resources. The raw archive, processed database and Parquet files, local reports, caches, credentials, and private correspondence belong outside the release. [Mendeley dataset](https://data.mendeley.com/datasets/39xdjxgnmf/1) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Proposed Git scope

Branch `codex/migrate-mendeley-retail` starts from an ancestor of `main`. The extra `main` commit changes public presentation documentation. After commit authorization, perform the release in an isolated worktree based on current `main`, copying only the allowlisted paths below from the working tree. Integrate README edits with the existing public sales content and label that URL as sales until the inventory deployment is verified. Run `git diff --cached --name-status` and `git diff --cached --check` for each proposed commit.

| Proposed commit | Exact paths to stage with `git add --` |
| --- | --- |
| `Model and reconcile inventory from verified POS data` | `retail_bi/inventory_model.py`, `retail_bi/inventory_pipeline.py`, `retail_bi/pos_pipeline.py`, `sql/inventory_analysis.sql`, `sql/inventory_quality.sql`, `tests/test_inventory.py`, `scripts/validation/audit_inventory.py` |
| `Serve and verify the inventory dashboard` | `frontend/index.html`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/InventoryDashboard.tsx`, `frontend/src/InventoryDashboard.test.tsx`, `frontend/src/lib/inventory.ts`, `frontend/vite.config.ts`, `frontend/scripts/verify-production-boundary.mjs`, `frontend/scripts/browser-qa.mjs`, `frontend/public/inventory/monthly.json.gzip` |
| `Document inventory findings and release checks` | `README.md`, `docs/environment.md`, `docs/inventory-methodology.md`, `docs/inventory-data-dictionary.md`, `docs/inventory-findings.md`, `docs/inventory-interview-guide.md`, `docs/inventory-release-review.md` |

Keep `.gitignore`, `data/source_manifest.example.json`, `retail_bi/analytics.py`, `retail_bi/license.py`, `tests/test_analytics.py`, `tests/test_license.py`, and `docs/private-permission-review.md` outside these commits. They are pre-existing legacy Superstore and private-permission work. Stage the job-application copy separately if desired. The portfolio update belongs to its own repository and release approval.

## Cloudflare Pages settings

Use `frontend` as the root with `npm run build`, output directory `dist`, and Node.js 22.12 or newer. The project needs no runtime secrets, Python process, database, or Pages Functions. The Wrangler files use the name `retail-bi-dashboard`, whereas public repository documentation names `retail-bi-analytics`. Verify the linked project's name, integration mode, and production and preview branches in Cloudflare before approving a push or selecting a Wrangler target. A push to a configured branch can trigger a preview or production deployment automatically. [Cloudflare Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/) · [Free plan limits](https://developers.cloudflare.com/pages/platform/limits/)

## After deployment approval

1. Confirm the Pages deployment uses the approved commit and both static assets. Check the official deployment URL and SHA-256 of the inventory response against the reviewed gzip. A `200` response containing the SPA HTML is a missing asset.
2. From `frontend`, set `$env:NORTHSTAR_QA_URL` to the verified HTTPS origin and rerun `node scripts/browser-qa.mjs`. This uses the checked-out assets to verify the deployed figures, filters, charts, exports, and responsive behavior.
3. Verify the sales and inventory routes using the public URL, along with source and license links. Verify the GitHub README and methodology links are reachable for visitors who are signed out.
4. With separate portfolio publishing approval, update the existing Northstar entry to link to the verified `/#inventory` URL and mark the extension live. Check the deployed portfolio entry and its labels and links.
