# Inventory methodology

Northstar Retail Inventory Intelligence is a fictional case study by Ridla A. Gani. The observation window is January 1, 2024 through December 31, 2025. The underlying synthetic POS source contains 970,838 lines across 30 stores, 67 SKUs and six categories. [Source and attribution](data-provenance.md)

## Source and simulation

The POS validator checks dates, required values, event signs and financial identity. Inventory also requires whole units, fixed cent-precision SKU costs and prices, nonblank keys, and zero exact duplicate source rows. The static SKU catalog is assumed to be known at launch and available at all 30 locations. Payments yield fulfilled units, and each negative refund yields the same quantity of positive saleable returns. The source contains `Payment` and `Refund` events. Refunds have no original basket or disposition flag, so one unit refunded is treated as one unit received back to a new lot on the refund date.

Each store–SKU uses its own seeded random stream. Opening stock, pre-period receipt dates, category-specific lead times, review weekdays, pack-size constraints, and minor adjustments, damages and shrinkage are modeled. Leading zeros in daily sales are retained. Demand comes from the latest 28 calendar days of fulfilled units, including zero-sales days, with a shorter window at launch. Known SKU and store dimensions are shared with sales. Historical replenishment uses the window ending on the order date. The seeded stream for each pair keeps the same prior draws when the source is extended within the same static catalog.

1. The day opens with the prior closing units. An opening balance movement seeds the first day. Its FIFO lot has a modeled receipt date 7–104 days earlier. A small opening cohort starts with extra bulk stock.
2. Scheduled orders arrive after their calendar-day lead time. If today's paid units exceed opening stock plus scheduled receipts, a **same-day receipt** fills exactly the observed gap before sales. It is an explicit warning. Returns and positive adjustments enter after sales, followed by damage and shrinkage. FIFO removes the oldest units for outbound movements.
3. After close, a SKU with positive demand and stock below reorder point may place one modeled open order. It orders on its weekly review day or earlier if closing stock is below expected lead-time demand. The order aims for `ceil(daily demand × max(lead + 7, 2 × lead + 3) × pair factor) + safety stock`, with a seeded pair factor of 0.85–1.35. The target is reduced by stock already on hand. For a seeded 8% probability cohort with trailing demand at most 0.4 unit/day, the supplier minimum is 72 units. This produces some aged excess stock without changing recorded demand.

The ledger accepts signed transfers and negative or positive inventory adjustments. This seed simulates positive adjustments, damage and shrinkage. It generates zero transfer movements. Logical receipts and orders exist for analysis. Supplier names, calendars, costs of expediting, reservations, customer backorders and lost demand are unavailable.

## Reconciliation and cost

Each movement uses one signed quantity. Opening balance quantities seed the running total once. Closing stock equals opening stock plus regular and same-day receipts, returns, transfer net, and signed adjustments, minus fulfilled units, damage and shrinkage. The next opening equals the prior close. The stock, receipt, FIFO lot and source-to-ledger checks run independently in DuckDB. [Data dictionary and quality](inventory-data-dictionary.md)

Inventory is valued at the source's fixed, per-SKU unit cost in USD cents. FIFO determines which units remain and their age. The fixed cost remains the same for each lot, including a return, so FIFO age allocation and cost valuation can be verified separately. The POS source is synthetic, including its item costs.

## Measures

| Measure | Formula and interpretation |
| --- | --- |
| Ending units and value | Sum `closing` or `closing × cost` at the last reporting date in the range. |
| Net COGS | Sum `(fulfilled units − returned units) × fixed SKU cost` over the range. A returns-heavy period can produce negative net COGS. |
| Average value | Sum the closing value for every calendar day in scope and divide by the number of days. The complete date grid gives days with no movements their correct weight. |
| Inventory turnover | Net COGS ÷ average value. Undefined if average value is zero. Expressed as turns during the selected period. |
| Days of inventory on hand (DIO) | Average inventory value ÷ positive net COGS × number of calendar days. Otherwise undefined. |
| Days of cover | Ending units ÷ trailing daily fulfilled units. Undefined for zero demand. At store/category/network grain, divide total stock by the sum of constituent demand rates. |
| Safety stock and reorder point | `max(1, ceil(3 × trailing daily demand))`, and `ceil(lead days × trailing daily demand) + safety stock`. Both are recomputed by store, SKU and date. |
| Reorder alert and stockout risk | Alert when demand is positive and stock falls strictly below the reorder point. The higher-risk comparison uses integer unit-days, `closing × recent days < lead days × recent units`, so exact equality is excluded. The indicator measures on-hand pressure. Check open inbound quantities and due dates before ordering. |
| Slow-moving value | Ending value of pairs classified as slow-moving or non-moving. |
| Aging | Remaining lot's days between receipt and snapshot, grouped as 0–30, 31–60, 61–90, 91–180, and 181+ days. Sums match closing stock per date. |

Health precedence is replenishment attention, limited history (under 28 days), non-moving (stock with zero sales), slow-moving (stock with one to two fulfilled units in the trailing window by default), overstocked (over 90 days of cover), then healthy. `--slow-units` changes only the slow-moving threshold. Recommendations in the watchlist prompted by projected cover and reorder points are review suggestions for inbound timing or possible transfers.

## Browser reporting

The dashboard selects inclusive calendar months. Each export row represents one store, SKU and month. The monthly stock-unit-days field is the sum of **daily closing units**. The browser values these units at fixed cost and divides by total covered days so February and March carry their actual respective weights. It calculates turnover and DIO from combined numerators and denominators. Filtered health is evaluated as of the last selected date and applies that cohort to the entire period. The quality audit is network-wide. Its exception breakdown follows the selected months.

Local export keeps the POS catalog labels for analysis. The licensed static candidate uses `INV-###` aliases and generic category item names. It carries exact monthly totals from the verified synthetic source, alongside modeled inventory measures. Its compact gzip format uses modern browsers' [Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream). The existing sales asset retains its aggregate restrictions. The archive's public license and source checksum are verified before creating the candidate.

The simulation can demonstrate accounting consistency and decision workflows. Its balances, age, order parameters, and risk flags depend on the modeling assumptions. The same-day receipt rate indicates reliance on the override within this model. Real operating conclusions require actual receipts, counts, transfers, supplier delivery histories, stockout events and return dispositions.
