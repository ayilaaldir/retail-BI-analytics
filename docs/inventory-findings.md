# Inventory findings

Ridla A. Gani · Northstar Retail Inventory Intelligence · Synthetic retail case study

These results come from the default seed `20261123` with the slow-moving threshold set to two fulfilled units in 28 days. The default dashboard period covers January 1 through December 31, 2025. Ending quantities and replenishment indicators are as of December 31, 2025. Inventory values are in USD.

| Measure | Result |
| --- | ---: |
| Ending stock | 21,745 units |
| Ending inventory value | $426,502.07 |
| Average daily closing value | $459,315.95 |
| Net COGS | $10,680,748.44 |
| Turnover | 23.25× |
| Days of inventory on hand | 15.70 days |
| Store–SKU pairs below reorder point | 1,294 of 2,010 |
| Slow-moving and non-moving stock value | $402.48 |

## Where to investigate

- **Footwear ties up the largest inventory value.** Its $159,153.56 was 37.3% of the network total, and its 20.10 turns were below the network's 23.25. Electronics turned even slower at 19.63 with $60,219.29 tied up. A buyer could compare order minima and receipt frequency for higher-cost variants against their sell-through. Both receipt volumes and purchase rules are seeded assumptions.
- **On-hand replenishment pressure varies by store.** Chicago had 43 pairs with cover below lead time and 53 below reorder point. Las Vegas carried 14.11 days of aggregate cover, the longest across stores, yet had 25 pairs below lead time. Check inbound due dates first, then verify matching SKU stock at another store before considering transfers. Aggregate cover can conceal shortages in individual SKUs, and the risk rule uses no open inbound units.
- **Old inventory is concentrated in a few pairs.** Across the network, 426 units worth $16,709.62 were over 90 days old. This included 131 units worth $7,625.60 over 180 days. Las Vegas had 100 units above 90 days for demo SKU `INV-032` (Leather Boots variant locally), worth $6,708.00. Check whether the packing minimum is binding, then review a smaller purchase or redistribution. FIFO ages and minimum order quantities come from modeled receipts.
- **Movement classifications depend strongly on the snapshot.** There was one slow-moving pair and zero non-moving pairs at year-end. July 2024 had 23 slow-moving pairs worth $29,425.40. Compare multiple month-ends and verify the assortment before choosing a markdown. This case covers a static synthetic catalog, and the two-unit cutoff applies to a 28-day period.
- **Urgent synthetic supply materially supports recorded fulfilment.** Across the two-year source, 84,195 units, about 7.1% of the 1,182,565 paid units, needed a same-day override in the simulation. Of those, 41,794 units occurred in 2025. A real operator could examine supplier reliability and safety stock with actual receipts before taking action. The overrides are a reconciliation mechanism and provide no estimate of lost sales.

## Why the year-end indicators look unusual

- **Reorder alerts compare on-hand stock with the reorder point.** On December 31, 2025, 1,294 of 2,010 pairs (64.4%) were below the threshold, versus 422 in January. At year-end, the modeled lead times ranged from 3 to 16 days and the median on-hand cover was 8.22 days. Of the flagged pairs, 1,089 had a modeled open order. On-hand plus those open order units would reach the reorder point for 1,035 pairs, assuming they all arrived. Check arrival timing before placing a duplicate order. The graph reports on-hand pressure using recent fulfilled demand, while delivery timing and the receipt override are modeled.
- **Same-day receipts cover a precisely defined gap.** The 46,776 warnings occur when the current day's recorded payment units exceed opening stock plus scheduled receipts. The override fills that difference immediately before the sale. Planned purchase orders use only data available through their order date. The distinction matters because the model resolves the paid-unit gap, while the dataset has no evidence of actual expedited deliveries or unfilled demand.
- **The slow-moving value represents one stocked pair.** All 2,010 pairs recorded at least one fulfilled unit in the December 31 trailing window. Of those pairs, 318 ended with zero stock, and the slow-moving classification requires positive stock. One pair sold two units in the window and held $402.48, about 0.094% of ending value. The July 2024 comparison shows how much the count can vary under the same policy. Review a longer history when deciding whether to markdown or discontinue a SKU.

The independent audit found 51 daily risk flags caused by floating-point arithmetic when coverage equaled lead time. Comparing integer unit-days corrected the flags. Two affected month-end snapshots, and the December 2025 figures above reproduced after the correction. [Release review](inventory-release-review.md)

## Reproduce the annual summary

Refresh `data/processed/inventory.duckdb` with the documented default command, then query it with DuckDB. Monthly bounds are inclusive. Group the same period by `category` or `location` for comparisons. Read the five `age_*` columns joined to `inventory_products` at month `2025-12-01` for the FIFO values.

```sql
SELECT SUM(ending_units) AS ending_units,
       SUM(ending_value_cents) / 100 AS ending_value_usd,
       SUM(avg_value_cents) / 100 AS average_value_usd,
       SUM(cogs_cents) / 100 AS net_cogs_usd,
       SUM(cogs_cents) / NULLIF(SUM(avg_value_cents), 0) AS turnover,
       SUM(avg_value_cents) / NULLIF(SUM(cogs_cents), 0) * MAX(days) AS dio,
       COUNT_IF(below_reorder) AS reorder_alerts,
       SUM(ending_value_cents) FILTER (WHERE health IN ('Slow-moving', 'Non-moving')) / 100 AS slow_value_usd
FROM inventory_period(DATE '2025-01-01', DATE '2025-12-01');
```
