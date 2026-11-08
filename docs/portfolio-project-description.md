# Northstar Retail BI — portfolio project description

## Application-ready summary

Built an end-to-end retail business intelligence platform that validates and models 970,838 synthetic POS line items, then delivers filter-aware profitability insights through a production React dashboard. The solution uses Python, Pandas, DuckDB, SQL, Parquet, TypeScript, Recharts, automated tests, GitHub Actions, and Cloudflare Pages. It includes governed KPI definitions, accounting-identity checks, privacy-aware aggregate publication, dataset attribution, and release-boundary controls.

## Résumé bullets

- Developed a Python and DuckDB analytics pipeline for 970,838 synthetic POS line items across 30 stores, producing validated net sales, gross profit, margin, transaction, refund, category, store, and discount metrics.
- Defined and tested business KPIs in SQL and Python, including signed-refund treatment, discount-band analysis, gross-margin calculations, and distinct transaction logic.
- Built a responsive React and TypeScript dashboard with year, store, payment-method, and category filters that recalculate KPIs and visualizations across 1,524 approved aggregate views.
- Implemented data-quality controls for required fields, numeric and date parsing, transaction signs, duplicate detection, and four line-level accounting identities.
- Designed a privacy-conscious browser export that excludes customer, transaction, product, SKU, device, and line-level records; limits analysis to three simultaneous filters; and suppresses small aggregate cells.
- Automated Python tests, frontend tests, linting, TypeScript compilation, production builds, and deployment-boundary checks through GitHub Actions and Cloudflare Pages.

## Interview narrative

Northstar started with a source-data and KPI-definition problem rather than a visualization problem. I first mapped the actual POS schema, documented the CC BY 4.0 provenance, and built validation rules that reject malformed dates, invalid event signs, and broken accounting relationships. The validated data is written to Parquet and queried through DuckDB views so metric logic stays explicit and testable.

For the dashboard, I published only the aggregates required for the existing interactions. Users can explore year, store, payment method, and product category while net sales, gross profit, gross margin, transactions, average ticket, trends, store rankings, category economics, and discount performance recalculate consistently. A three-filter limit, minimum cohort size, and complementary suppression reduce unnecessary disclosure risk.

The final release is deployed on Cloudflare Pages with GitHub-based continuous integration. Production checks verify that the application loads only the approved aggregate asset and does not expose raw CSV data, identifiers, local development endpoints, credentials, or analytical working files.

## Selected findings

- Net sales total $46.60M and gross profit totals $25.78M, producing a 55.34% gross margin across the full synthetic observation period.
- 2025 net sales are approximately 5.49% higher than 2024.
- Apparel contributes the most gross profit at $10.26M, while Beauty has the highest category margin at approximately 68.22%.
- Payment lines with no discount produce approximately 57.77% margin, compared with approximately 40.10% above a 20% discount.
- Store 09 - Chicago is the largest gross-profit contributor at approximately $1.59M.

These findings are descriptive results from a deterministic synthetic dataset and do not represent a real company, customer population, or causal business study.

## Skills demonstrated

Python · Pandas · DuckDB · SQL · Parquet · data validation · KPI design · profitability analysis · data visualization · React · TypeScript · Vite · Tailwind CSS · Recharts · Pytest · Vitest · GitHub Actions · Cloudflare Pages · data governance · privacy-aware publication

**Live dashboard:** [https://retail-bi-analytics.pages.dev/](https://retail-bi-analytics.pages.dev/)

**Source dataset:** [A Synthetic Multi-Store Retail Point-of-Sale Transaction Dataset in Square POS Export Format](https://data.mendeley.com/datasets/39xdjxgnmf/1), MD Owes Quruny Shubho, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
