# Analytics methodology

## Input contract

The POS loader reads the published gzip-compressed CSV directly and normalizes headings to snake case. Required fields cover date/time, category and item descriptors, signed quantity and financial measures, transaction/payment/store dimensions, event type, unit cost, and gross profit. `Customer ID` is optional and is never exported.

## Validation rules

The pipeline rejects data when:

- a required column or value is missing;
- date or numeric parsing fails;
- event type is not `Payment` or `Refund`;
- a payment has non-positive quantity or a refund has non-negative quantity;
- price or cost is negative;
- a discount is positive rather than zero or negative; or
- any line violates the documented gross-sales, net-sales, collected-total, or gross-profit identity beyond one cent.

Exact duplicate rows are reported. Repeated Transaction IDs are expected because a transaction can contain multiple item lines.

## KPI definitions

- Net sales = sum of signed `Net Sales`, including refunds.
- Gross profit = sum of `Gross Profit`.
- Gross margin = Gross Profit / Net Sales.
- Transactions = distinct `Transaction ID`.
- Average ticket = Net Sales / distinct transactions.
- Discount depth = absolute discount amount / Gross Sales for payment lines.

Refund rows remain in all net KPIs, trends, category results, and store results. The discount diagnostic uses payment lines only because a signed refund is not a discount event.

## SQL model

`sql/pos_analysis.sql` defines KPI summary, monthly performance, category performance, location performance, discount effectiveness, and refund summary views. DuckDB executes these definitions during every export build so schema drift fails before browser data is written.

## Browser aggregates

The exporter builds views for the actual source dimensions: year, store location, payment method, and category. It permits any three simultaneously, requires at least 10 distinct transactions per view and child series, and applies complementary suppression when one small child could be recovered by subtraction.

The JSON contains no transaction/customer/product identifiers or line-level data. The React client selects the exact aggregate view rather than recalculating from source rows.

## Synthetic-data limitations

The values are deterministic outcomes of a seeded simulation, not empirical business performance. The modeled event calendar, traffic tiers, category skews, discounts, refunds, flat tax rate, static catalog, and cost ratios shape every analytical result. The dashboard is therefore suitable for engineering and analytical demonstration, not real-company benchmarking or causal inference.
