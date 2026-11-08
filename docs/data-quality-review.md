# Data quality review

Reviewed on 2026-11-08 against `data/raw/Sample - Superstore.csv`.

## Validation outcome

- Rows: 9,994
- Columns: 21
- Observation period: 2014-01-03 through 2017-12-30
- Duplicate `Row ID` values: 0
- Fatal validation errors: 0
- Potential duplicate order lines: 1

## Potential duplicate line

Rows **3406** and **3407** are identical in every source field except `Row ID`. Both describe order `US-2014-150119`, product `FUR-CH-10002965`, quantity 2, sales 281.372, discount 0.3, and profit -12.0588.

This is strong evidence of a duplicate transaction line, but the source supplies unique row identifiers and no order-line key, correction notice, or authoritative deduplication rule. Automatically removing the second row would alter published source data and every dependent KPI.

Decision: **preserve both rows** and retain the warning. If the original data owner supplies a correction or confirms that identical order/product lines are accidental duplicates, implement that rule as a documented transformation and update the affected KPI baseline.
