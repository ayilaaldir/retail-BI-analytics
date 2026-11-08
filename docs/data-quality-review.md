# Data quality review

Reviewed on 2026-11-08 against the Mendeley Data Version 1 detail archive.

## Validated profile

- Rows: 970,838
- Columns: 22
- Observation period: 2024-01-01 through 2025-12-31
- Payment rows: 961,389
- Refund rows: 9,449
- Distinct transactions: 585,691
- Stores: 30
- Categories: 6
- Exact duplicate rows: 0
- Accounting-identity failures: 0

`Customer ID` is absent on 634,393 rows by design; it is an optional attribution field rather than a required measure. The 336,445 populated customer-identifier rows are retained only in the ignored analytical layer and excluded from browser data.

## Financial checks

Every row satisfies, within one cent:

- Gross Sales = Unit Price x Qty
- Net Sales = Gross Sales + Discounts
- Total Collected = Net Sales + Tax
- Gross Profit = Net Sales - Unit Cost x Qty

Payment quantities are positive, refund quantities are negative, and discount amounts are zero or negative as documented.

## Comparison with publisher validation

The observed row count, payment/refund counts, date range, and source-file SHA-256 agree with the Mendeley record and accompanying validation report. The pipeline independently recomputes business totals rather than importing the publisher's summary values.
