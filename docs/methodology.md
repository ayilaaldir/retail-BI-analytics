# Analytics methodology

## Input contract

The loader accepts conventional Superstore CSV headings and normalizes them to snake case. Required fields cover order identifiers and dates, customer/market dimensions, product hierarchy, and the core measures: sales, quantity, discount, and profit.

## Validation rules

The pipeline fails before modeling when:

- a required column or value is missing;
- a date or numeric value cannot be parsed;
- `Row ID` is duplicated;
- ship date precedes order date;
- sales is negative or quantity is not positive; or
- discount falls outside 0–1.

Potentially duplicated order lines are warnings because identical product lines can be legitimate. The generated quality report also records date coverage, row count, duplicate counts, loss-making line count, sales, and profit. Those totals are diagnostic output from the supplied data, not hard-coded claims.

## SQL model

`sql/analysis.sql` creates reusable DuckDB views:

- `kpi_summary`: sales, profit, margin, distinct orders, and AOV;
- `monthly_performance`: trend series;
- `category_performance` and `state_performance`: commercial mix and geographic performance;
- `discount_effectiveness`: margin by discount band; and
- `loss_drivers`: loss-making category, subcategory, and region combinations.

Ratios use `NULLIF` to avoid division-by-zero errors. Monetary aggregates are rounded to two decimal places; source rows remain unrounded.

## Dashboard behavior

The pipeline exports validated row-level measures and pre-aggregated views as JSON. Filters are applied in the browser, so revenue, profit, margin, orders, average order value, monthly trends, category performance, regional profitability, and discount-band analysis recompute from the active subset. The export omits customer names, product names, addresses, and other fields unnecessary for the dashboard.

## License and publication gate

Kaggle hosts datasets supplied by many publishers, so “from Kaggle” is not itself a license. Before including data-derived output in a public deployment, record the exact dataset URL, displayed license, authoritative license URL, verification date, and reviewer in `data/source_manifest.json`.

The codebase cannot determine whether a manifest accurately describes a future grant of rights. Human verification against an authoritative license or written permission remains required. `--publish-export` requires an explicit verification flag, a `permitted` redistribution status, and an authoritative permission URL; it cannot replace legal review. The evidence and current closed-gate decision are recorded in [data-provenance.md](data-provenance.md).

## Known limitations

- Profit is taken directly from the dataset and is not recomputed from cost data.
- Returns are not modeled unless the chosen dataset contains and documents them.
- Currency is displayed as USD, matching the common US Superstore dataset; verify this against the exact source.
- The static browser export is suitable for a portfolio dataset but not sensitive or high-volume production data.
