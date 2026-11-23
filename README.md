# Northstar Retail BI

Northstar is a portfolio-grade retail business intelligence and profitability platform built around a fully synthetic, openly licensed multi-store point-of-sale dataset. It validates 970,838 POS line items with Pandas, models business views with DuckDB and SQL, and serves disclosure-controlled aggregates to a responsive React dashboard.

**Northstar Retail Inventory Intelligence**, by Ridla A. Gani, extends the sales overview with reconciled inventory balances, turnover and coverage, FIFO aging, and a replenishment watchlist. It is an independent fictional retail case study that uses the same source stores, dates, and SKUs as the sales analysis.

The sales overview is available publicly. [Live sales dashboard](https://retail-bi-analytics.pages.dev/)

The raw CSV archive, customer and transaction identifiers, local Parquet files, quality reports, and private development exports remain outside Git and deployment artifacts.

![Northstar synthetic POS dashboard](docs/dashboard-overview.png)

## Project objective

Build an end-to-end analytics product that converts a large, imperfectly shaped POS export into trustworthy business metrics and a decision-ready dashboard. The project demonstrates practical data validation, SQL modeling, KPI governance, interactive analysis, privacy-aware publication, automated testing, and production deployment.

## Business questions

- How are net sales, gross profit, margin, transaction volume, and average ticket changing?
- Which categories and stores contribute the most gross profit?
- How do payment method, store, category, and year selections change performance?
- How does discount depth affect payment-line margin?
- What impact do signed refunds have on net performance?
- Where are stock and cost concentrated, which stocked products move slowly, and which store–SKU pairs need replenishment review?
- How much stock is aging, and do inventory quantities reconcile to recorded payments and refunds?

## Technology

| Layer | Tools |
| --- | --- |
| Data validation | Python 3.13, Pandas, PyArrow |
| Analytical modeling | DuckDB, SQL, Parquet |
| Dashboard | React 19, TypeScript, Vite, Tailwind CSS 4, Recharts |
| Quality | Pytest, Vitest, Testing Library, Oxlint, TypeScript |
| Delivery | GitHub Actions, Cloudflare Pages |

## Portfolio relevance

- Translates business questions into governed KPI definitions rather than relying on ambiguous source labels.
- Validates accounting identities, signs, types, dates, duplicates, and required fields before analysis.
- Uses DuckDB and SQL to create reusable analytical views from a Parquet layer.
- Delivers filter-aware KPIs and visual diagnostics for management-style exploration.
- Applies minimum-cohort and complementary-suppression controls before browser publication.
- Automates Python, frontend, lint, and production-boundary checks in CI.

See the [job-application project description](docs/portfolio-project-description.md) for concise résumé and interview-ready versions.

## Architecture

```mermaid
flowchart LR
    A[Mendeley CSV.gz\nlocal + ignored] --> B[Pandas POS validation]
    B -->|quality report| C[Reports\nlocal + ignored]
    B --> D[Parquet analytical layer\nlocal + ignored]
    D --> E[DuckDB POS views]
    E --> F[Disclosure-controlled aggregate cube]
    F --> G[data/local/dashboard.json\nVite dev only]
    F --> H[CC BY 4.0 publication gate]
    H --> I[frontend/public/data/dashboard.json]
    G --> J[React dashboard]
    I --> J
```

Production code reads `/data/dashboard.json`. The Vite development-only `/__local/dashboard.json` middleware never enters `dist`, and the post-build audit rejects local paths, direct identifiers, unexpected fields, small aggregates, and over-granular views.

The inventory pipeline reuses POS validation and maps paid and refunded quantities into a signed store–SKU ledger. Seeded receipts, opening lots, and adjustments bridge the inventory records absent from the source. DuckDB independently reconciles daily balances and prepares month-level metrics. React fetches the compact inventory dataset on demand and applies month, store, category, health, and SKU filters to the same inventory cohort. The static inventory asset uses demo catalog aliases and excludes transaction-level records.

## Validated analytical findings

The source covers 2024-01-01 through 2025-12-31 across 30 synthetic stores, six product categories, and 585,691 transactions.

| KPI | Result |
| --- | ---: |
| Net sales | $46,595,173.27 |
| Gross profit | $25,784,056.34 |
| Gross margin | 55.34% |
| Distinct transactions | 585,691 |
| Average ticket | $79.56 |
| Net refund sales | -$396,495.00 |

Selected descriptive findings:

- 2025 net sales were approximately 5.49% above 2024.
- Apparel contributed $10.26M gross profit at 57.31% margin.
- Beauty had the highest category margin at approximately 68.22%.
- Payment lines with no discount produced approximately 57.77% margin; payment lines above 20% discount produced approximately 40.10%.
- Store 09 - Chicago was the largest gross-profit contributor at approximately $1.59M.

These are deterministic results from a seeded synthetic simulation, not claims about a real company or customers.

## KPI definitions

- **Net sales:** source `Net Sales`, including signed refunds and discounts.
- **Gross profit:** source `Gross Profit` = Net Sales - Unit Cost x Qty.
- **Gross margin:** Gross Profit / Net Sales.
- **Transactions:** distinct `Transaction ID`, including separately identified refund transactions.
- **Average ticket:** Net Sales / distinct transactions.
- **Discount bands:** effective payment-line discount amount divided by gross sales; refund rows are excluded from this diagnostic but remain included in net KPIs.

Filters use the actual source dimensions: year, store location, payment method, and category. No region, customer segment, shipping field, or order status is synthesized.

Inventory uses the last selected snapshot for ending stock and fixed POS SKU cost for valuation. Turnover is net COGS divided by mean daily closing inventory value. Days on hand uses the inverse ratio multiplied by calendar days. Days of cover uses trailing fulfilled units, and age uses the receipt dates of remaining FIFO lots. See the [inventory methodology](docs/inventory-methodology.md) and [2025 findings](docs/inventory-findings.md).

## Data quality and privacy

The pipeline validates required fields, dates, numeric types, payment/refund signs, discount signs, duplicate rows, and four line-level accounting identities. The current source has zero exact duplicate rows and zero accounting-identity failures.

The sales export contains KPI, monthly, category, store, and discount-band aggregates. It excludes Customer ID, Transaction ID, Item, SKU, Price Point Name, Device Name, time-of-day, and all line-level records. It allows at most three simultaneous filters, requires at least 10 transactions per published aggregate, and uses complementary suppression for a single small child cell.

The inventory release candidate includes only monthly synthetic demo series, catalog aliases, attribution, and aggregate quality results. The inventory refresh blocks export when critical checks fail. Same-day receipts are disclosed warnings that preserve POS fulfilment when scheduled supply is insufficient. See the [inventory data dictionary and quality checks](docs/inventory-data-dictionary.md).

## Dataset attribution and license

Source: [A Synthetic Multi-Store Retail Point-of-Sale Transaction Dataset in Square POS Export Format](https://data.mendeley.com/datasets/39xdjxgnmf/1), MD Owes Quruny Shubho, Mendeley Data, Version 1, DOI [10.17632/39xdjxgnmf.1](https://doi.org/10.17632/39xdjxgnmf.1).

Licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Northstar adapts the source into validated Parquet data, SQL analytical views, and aggregate browser JSON. The source is fully synthetic and is not affiliated with or endorsed by Square or Block, Inc.

See [dataset provenance](docs/data-provenance.md), [methodology](docs/methodology.md), and [data quality review](docs/data-quality-review.md).

## Run locally

Requirements:

- Python 3.13
- Node.js 22+
- `data/raw/mendeley_pos/01_square_item_sales_detail_24mo.csv.gz`

Download the named archive from the Mendeley dataset linked above when it is absent. The inventory release export checks its SHA-256 against `data/source_manifest.json`.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m retail_bi.pos_pipeline --local-export
.\.venv\Scripts\python.exe -m retail_bi.inventory_pipeline

cd frontend
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/> and choose **Inventory Intelligence**. The raw, processed, report, and local export files are Git-ignored. Run `python -m retail_bi.inventory_pipeline --seed 20261123 --slow-units 2` from the repository root with the virtual environment active to refresh inventory with the demo defaults. The same command accepts custom seeds and slow-moving thresholds.

## Tests and release checks

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe scripts/validation/audit_inventory.py
cd frontend
npm run lint
npm test
npm run build
npm run preview
```

To regenerate the sales and inventory assets for release review, run from the repository root.

```powershell
.\.venv\Scripts\python.exe -m retail_bi.pos_pipeline --publish-export
.\.venv\Scripts\python.exe -m retail_bi.inventory_pipeline --publish-export
```

Both commands verify the licensed synthetic source and its SHA-256 before writing local review files. The production build serves `frontend/public/data/dashboard.json` and `frontend/public/inventory/monthly.json.gzip`. See the [release review](docs/inventory-release-review.md) for reproducible Chrome QA and the publication checklist.

## Cloudflare Pages

| Setting | Value |
| --- | --- |
| Current sales URL | [retail-bi-analytics.pages.dev](https://retail-bi-analytics.pages.dev/) |
| Cloudflare project | `retail-bi-analytics` |
| Framework preset | React (Vite) |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 22.12 or newer |

GitHub records a successful Cloudflare Pages build for `main` in `retail-bi-analytics`. The existing Wrangler files name `retail-bi-dashboard`. Confirm the connected project and automatic deployment settings before pushing a release. The current public dashboard serves the sales release.

The existing Cloudflare Pages static build needs only the two frontend review assets once approved. Python and DuckDB run locally to refresh them. The single-file limit on the Free plan is 25 MiB. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

## Repository guide

```text
retail_bi/pos_*.py             Synthetic POS validation, modeling, and pipeline
sql/pos_analysis.sql           POS business views
tests/test_pos_*.py            POS validation and analytical tests
retail_bi/inventory_*.py       Inventory simulation, validation and export
sql/inventory_*.sql            Signed ledger reconciliation and inventory views
tests/test_inventory.py        Inventory data and KPI tests
retail_bi/{schema,validation,analytics,pipeline}.py
                               Preserved legacy implementation
frontend/src/                  React dashboard and tests
frontend/scripts/              Production boundary and privacy audit
docs/                          Architecture, methodology, provenance, and quality
data/source_manifest.json      Versioned source, checksum, attribution, and CC BY evidence
```

## Known limitations

- The source is synthetic and intentionally reflects its seeded generation assumptions.
- Refunds are separate negative transactions rather than links to original baskets.
- A flat 8.25% tax and simplified CST label are applied to all stores.
- Customer identifiers are nominal and excluded from all browser exports.
- The catalog and prices are static across the two-year period.
- The dashboard is descriptive; it does not infer causality or represent a real operating business.
- Actual inventory counts, supplier lead times, return dispositions, and lost demand are unavailable. Inventory results depend on modeled inputs, and the browser date selector uses calendar months. The [interview guide](docs/inventory-interview-guide.md) explains the tradeoffs and includes portfolio copy.

## Code license

No software license has been selected yet. Until one is added, the source code remains under default copyright terms. The dataset is licensed separately under CC BY 4.0.
