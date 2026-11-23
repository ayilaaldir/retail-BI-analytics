# Inventory interview guide

Ridla A. Gani · Northstar Retail Inventory Intelligence

## The project in plain English

Retail sales tell a manager what moved. Inventory adds what is left, how long it has been there, and which products may run out before another delivery. Northstar combines the existing fictional sales analysis with an inventory model for that second set of questions. The model uses recorded amounts from the licensed synthetic POS for sales and refunds. It generates the supply history the POS does not include, including purchase receipts, opening lots and stock losses.

Pandas validates and groups the source. Python simulates each store–SKU in date order. DuckDB rebuilds stock from signed movements, reconciles it against the daily expected balances, compares sales and refunds against the source, and prepares analytical views. React reads a compact monthly export and calculates filtered ratios from sums. That lets anyone explore the dashboard on a static host, and it keeps the raw records off the site.

## Two-to-three-minute walkthrough

> I extended a retail profitability dashboard to help a store manager answer two questions. Where is cash tied up in stock, and which products need a replenishment review? The project uses 970,838 synthetic POS lines across 30 stores and 67 SKUs. I wanted the inventory side to use the same dates, products and stores as sales so both views tell a consistent story.
>
> I mapped payments into stock outflows and refunds into saleable returns. The POS has no stock counts or deliveries, so I generated opening lots and scheduled receipts with a reproducible seed. The order rule uses the recent demand history available on the order date. If recorded payments exceed modeled available stock, a tagged same-day receipt covers the gap. I report those overrides because they affect how much you can infer from the model.
>
> I use DuckDB to reconstruct daily closing stock from the signed ledger and compare it with the prior day, the simulation and the POS quantities. I then roll the data up to store–SKU months. The app can filter a cohort and recalculate turnover by dividing net cost of goods sold by the average daily closing value. FIFO aging uses estimated receipt dates, and the watchlist flags stock below a reorder point with enough detail to see whether current cover can last through supplier lead time.
>
> Here is a result I would follow up on. At the end of 2025, Footwear held about 37% of stock value and turned 20.10 times, below the network's 23.25. That suggests checking the size and frequency of receipts for expensive variants. I would also open the watchlist and compare stores by SKU before considering a transfer. The figures are from a fictional model. In a real deployment I'd reconcile to inventory counts, inbound deliveries and actual stockouts first, then evaluate recommendations on subsequent results.

## Likely questions

1. **What decision does the inventory view support?** It helps target supplier follow-up, stock transfers or aging reviews. Look at store–SKU risk and age rather than using network averages to decide which units to move.
2. **What comes directly from the POS?** Store, SKU, variant, category, date, cost, price, paid units and refund units. The supplied POS data itself is synthetic. The inventory simulation adds stock and supply assumptions.
3. **How do you handle returns and cancellations?** The verified source has positive `Payment` and negative `Refund` quantity. Payments reduce stock. Refunds restore their absolute quantity in a saleable lot and reverse COGS. There is no cancellation event or return disposition field in this dataset.
4. **How did you avoid using future sales?** Starting quantities use seeded draws. At day close the order rule sees only prior and current fulfilled units. A planned order has a future due date. The urgent receipt uses the observed payment requirement at fulfilment and is logged separately.
5. **Why keep a daily ledger and a snapshot?** The ledger explains why a balance changed. A snapshot is convenient for as-of reporting. A reconcile check catches duplicate movements, incorrect signs or breaks in the opening and closing chain.
6. **Why use cost for turnover?** The denominator values stock at cost, so the numerator uses matching net COGS. Sales revenue includes markups and discounts and uses a different basis. A $100 average balance with $250 of net COGS turns 2.5 times during the period.
7. **How do DIO and days of cover differ?** DIO uses historical cost and average stock over the selected period. With $100 average inventory, $250 COGS and 30 days, DIO is 12 days. Days of cover divides today's units by a trailing daily sales rate. It estimates how long current units may last at that rate.
8. **Why mean daily balances?** They weight all covered calendar days equally. An average of month-ends misses mid-month changes. An average of monthly means would give February the same weight as March.
9. **How do you calculate a reorder point?** Multiply trailing daily fulfilled units by supplier lead days and round up. Add three days of modeled safety stock with a one-unit minimum. At two units per day and five lead days, the result is 16 units. An alert requires positive demand and on-hand stock below that point. At year-end most flagged pairs already had an open order, so I would check its due date before recommending another purchase.
10. **How do you measure the age of stock?** Intake adds dated lots. FIFO consumes the oldest lots first. At month-end measure the age of units still present. A product's launch date cannot tell you when its current stock arrived.
11. **How do you classify slow and non-moving stock?** After the replenishment and limited-history checks, positive stock with zero fulfilled units in 28 days is non-moving. Positive stock with one or two fulfilled units is slow-moving by default. The threshold is configurable. High cover and old stock are distinct signals.
12. **Why use DuckDB and Python together?** Python and pandas validate source rows and handle stateful generation and FIFO. DuckDB is efficient for window functions, ledger roll-forwards, comparisons and grouped metrics. Tests compare SQL results with hand-computed daily fixtures.
13. **Why aggregate before loading the dashboard?** The full transaction and daily data would be expensive to send to a browser. The monthly export supplies each pair's totals, day counts, end snapshot and daily stock exposure. The browser filters those rows, then recalculates ratios from the combined measures. The quality exceptions follow the date filter at network scope.
14. **What changes in a real deployment?** Integrate warehouse receipts, transfer pairs, returns disposition and stock counts. Add incremental loads with late adjustments and formal unit-cost policy. Validate alerts against observed replenishment, demand and out-of-stock outcomes before setting thresholds or estimating financial impact.
15. **How did you keep the joins from multiplying units?** Aggregate POS payments and refunds to store–SKU–day before comparing to ledger flows at that same key. Join month-end FIFO balances to one snapshot per pair and month. At each stage the release audit compares independent counts, quantities, and valuations before treating the results as valid.

## Portfolio description

Northstar Retail Inventory Intelligence extends a fictional multi-store retail BI dashboard with a reproducible, reconciled inventory model. It links 970,838 synthetic POS lines to stock balances, FIFO aging, turnover, and a replenishment watchlist across 30 stores using Python, DuckDB, and React.

## Draft resume bullets for review

- Built a seeded Python and DuckDB inventory pipeline from 970,838 synthetic POS lines, reconciling 1.47M daily store–SKU snapshots and separately validating fulfilled and returned quantities.
- Modeled inventory turnover, days on hand, FIFO aging, and lead-time risk for 2,010 store–SKU pairs with documented cost, demand, and replenishment rules.
- Extended a React and TypeScript retail dashboard with shared filters, stock movement charts, a sortable replenishment watchlist, quality reporting, and scoped CSV exports.
