-- The ledger is signed. Opening balances seed the first day and are counted once.
CREATE VIEW inventory_purchase_receipts AS
SELECT m.movement_id AS receipt_id, m.location, m.sku, m.date AS receipt_date,
       m.quantity AS quantity_received, m.cost_cents, o.order_date,
       m.event = 'same_day_receipt' AS same_day_override
FROM inventory_movements m
LEFT JOIN inventory_orders o ON m.location = o.location AND m.sku = o.sku
    AND m.date = o.due_date AND m.event = 'stock_receipt'
WHERE m.event IN ('stock_receipt', 'same_day_receipt');

CREATE VIEW inventory_daily AS
WITH flows AS (
    SELECT location, sku, date,
           SUM(quantity) FILTER (WHERE event = 'opening_balance') AS starting_units,
           SUM(quantity) FILTER (WHERE event = 'stock_receipt') AS receipts,
           SUM(quantity) FILTER (WHERE event = 'same_day_receipt') AS same_day,
           -SUM(quantity) FILTER (WHERE event = 'fulfilled_sale') AS sold,
           SUM(quantity) FILTER (WHERE event = 'customer_return') AS returned,
           SUM(quantity) FILTER (WHERE event = 'inventory_adjustment') AS adjustment,
           SUM(quantity) FILTER (WHERE event LIKE 'stock_transfer_%') AS transfer_net,
           -SUM(quantity) FILTER (WHERE event = 'damaged_stock') AS damaged,
           -SUM(quantity) FILTER (WHERE event = 'shrinkage') AS shrinkage,
           SUM(quantity) AS net
    FROM inventory_movements
    GROUP BY location, sku, date
), balances AS (
    SELECT e.location, e.sku, e.date, p.cost_cents, p.lead_days,
           COALESCE(f.receipts, 0)::BIGINT AS receipts, COALESCE(f.same_day, 0)::BIGINT AS same_day,
           COALESCE(f.sold, 0)::BIGINT AS sold, COALESCE(f.returned, 0)::BIGINT AS returned,
           COALESCE(f.adjustment, 0)::BIGINT AS adjustment, COALESCE(f.transfer_net, 0)::BIGINT AS transfer_net,
           COALESCE(f.damaged, 0)::BIGINT AS damaged, COALESCE(f.shrinkage, 0)::BIGINT AS shrinkage,
           COALESCE(f.starting_units, 0)::BIGINT AS starting_units,
           COALESCE(f.net, 0)::BIGINT AS net,
           SUM(COALESCE(f.net, 0)) OVER (PARTITION BY e.location, e.sku ORDER BY e.date
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::BIGINT AS closing
    FROM expected_daily e
    JOIN inventory_products p USING (sku)
    LEFT JOIN flows f USING (location, sku, date)
), demand AS (
    SELECT *, closing - net + starting_units AS opening,
           closing * cost_cents AS inventory_value_cents,
           (sold - returned) * cost_cents AS cogs_cents,
           SUM(sold) OVER demand_window AS recent_units, COUNT(*) OVER demand_window AS recent_days
    FROM balances
    WINDOW demand_window AS (PARTITION BY location, sku ORDER BY date
        RANGE BETWEEN INTERVAL '__LOOKBACK_PRECEDING__ days' PRECEDING AND CURRENT ROW)
), rates AS (
    SELECT *, recent_units / recent_days AS demand_per_day,
           GREATEST(1, (__SAFETY_DAYS__ * recent_units + recent_days - 1) // recent_days)::INTEGER AS safety_stock
    FROM demand
), policy AS (
    SELECT *, ((recent_units * lead_days + recent_days - 1) // recent_days)::INTEGER + safety_stock AS reorder_point,
           closing / NULLIF(demand_per_day, 0) AS cover_days
    FROM rates
)
SELECT * EXCLUDE (net, starting_units),
       demand_per_day > 0 AND closing < reorder_point AS below_reorder,
       -- Compare exact unit-days so coverage equal to lead time never rounds into risk.
       recent_units > 0 AND closing * recent_days < lead_days * recent_units AS stockout_risk,
       CASE
           WHEN demand_per_day > 0 AND closing < reorder_point THEN 'Replenishment attention'
           WHEN recent_days < __LOOKBACK__ THEN 'Limited history'
           WHEN closing > 0 AND recent_units = 0 THEN 'Non-moving'
           WHEN closing > 0 AND recent_units <= __SLOW_UNITS__ THEN 'Slow-moving'
           WHEN recent_units > 0 AND closing * recent_days > __EXCESS_DAYS__ * recent_units THEN 'Overstocked'
           ELSE 'Healthy'
       END AS health
FROM policy;

CREATE VIEW inventory_aging AS
SELECT location, sku, date,
       SUM(CASE WHEN age <= __AGE_1__ THEN quantity ELSE 0 END)::BIGINT AS age_0_30,
       SUM(CASE WHEN age > __AGE_1__ AND age <= __AGE_2__ THEN quantity ELSE 0 END)::BIGINT AS age_31_60,
       SUM(CASE WHEN age > __AGE_2__ AND age <= __AGE_3__ THEN quantity ELSE 0 END)::BIGINT AS age_61_90,
       SUM(CASE WHEN age > __AGE_3__ AND age <= __AGE_4__ THEN quantity ELSE 0 END)::BIGINT AS age_91_180,
       SUM(CASE WHEN age > __AGE_4__ THEN quantity ELSE 0 END)::BIGINT AS age_over_180
FROM (SELECT *, date_diff('day', received_on, date) AS age FROM inventory_lots)
GROUP BY location, sku, date;

CREATE VIEW inventory_monthly AS
WITH totals AS (
    SELECT location, sku, CAST(date_trunc('month', date) AS DATE) AS month,
           MIN(date) AS period_start, MAX(date) AS period_end, COUNT(*) AS days,
           arg_min(opening, date) AS opening, SUM(receipts) AS receipts, SUM(same_day) AS same_day,
           SUM(sold) AS sold, SUM(returned) AS returned,
           SUM(adjustment + transfer_net - damaged - shrinkage) AS other,
           SUM(closing) AS stock_unit_days, SUM(cogs_cents) AS cogs_cents,
           SUM(inventory_value_cents) AS value_days_cents
    FROM inventory_daily GROUP BY location, sku, month
)
SELECT t.*, d.closing, d.inventory_value_cents, d.recent_units, d.recent_days, d.reorder_point,
       d.below_reorder, d.stockout_risk, d.health,
       COALESCE(a.age_0_30, 0) AS age_0_30, COALESCE(a.age_31_60, 0) AS age_31_60,
       COALESCE(a.age_61_90, 0) AS age_61_90, COALESCE(a.age_91_180, 0) AS age_91_180,
       COALESCE(a.age_over_180, 0) AS age_over_180
FROM totals t JOIN inventory_daily d ON d.location = t.location AND d.sku = t.sku AND d.date = t.period_end
LEFT JOIN inventory_aging a ON a.location = t.location AND a.sku = t.sku AND a.date = t.period_end;

-- A month-boundary period uses one closing snapshot and calendar-day-weighted daily value.
CREATE MACRO inventory_period(from_month, through_month) AS TABLE
WITH totals AS (
    SELECT location, sku, SUM(days) AS days, arg_max(closing, month) AS ending_units,
           arg_max(inventory_value_cents, month) AS ending_value_cents,
           SUM(value_days_cents) / SUM(days) AS avg_value_cents, SUM(cogs_cents) AS cogs_cents,
           SUM(sold) AS sold, SUM(returned) AS returned,
           arg_max(recent_units, month) AS recent_units, arg_max(recent_days, month) AS recent_days,
           arg_max(reorder_point, month) AS reorder_point, arg_max(health, month) AS health,
           arg_max(below_reorder, month) AS below_reorder, arg_max(stockout_risk, month) AS stockout_risk
    FROM inventory_monthly WHERE month BETWEEN from_month AND through_month GROUP BY location, sku
)
SELECT t.*, p.category, p.item, p.lead_days,
       cogs_cents / NULLIF(avg_value_cents, 0) AS turnover,
       CASE WHEN cogs_cents > 0 THEN avg_value_cents / cogs_cents * days END AS dio,
       ending_units / NULLIF(recent_units / recent_days, 0) AS cover_days
FROM totals t JOIN inventory_products p USING (sku);

CREATE VIEW inventory_store_month AS
SELECT month, location, SUM(closing) AS ending_units, SUM(inventory_value_cents) AS ending_value_cents,
       SUM(cogs_cents) / NULLIF(SUM(value_days_cents) / MAX(days), 0) AS turnover,
       SUM(closing) / NULLIF(SUM(recent_units) / MAX(recent_days), 0) AS cover_days,
       count_if(below_reorder) AS reorder_alerts,
       SUM(inventory_value_cents) / NULLIF(SUM(SUM(inventory_value_cents)) OVER (PARTITION BY month), 0) AS value_share
FROM inventory_monthly GROUP BY month, location;

CREATE VIEW inventory_category_month AS
SELECT month, category, SUM(closing) AS ending_units, SUM(inventory_value_cents) AS ending_value_cents,
       SUM(cogs_cents) / NULLIF(SUM(value_days_cents) / MAX(days), 0) AS turnover
FROM inventory_monthly JOIN inventory_products USING (sku) GROUP BY month, category;

CREATE VIEW inventory_sku_velocity_month AS
WITH totals AS (
    SELECT month, sku, SUM(sold) AS sold, SUM(returned) AS returned, SUM(closing) AS ending_units,
           SUM(inventory_value_cents) AS ending_value_cents, SUM(receipts + same_day + returned) AS inflow
    FROM inventory_monthly GROUP BY month, sku
)
SELECT *, dense_rank() OVER (PARTITION BY month ORDER BY sold DESC) AS fastest_rank,
          dense_rank() OVER (PARTITION BY month ORDER BY sold ASC) AS slowest_rank
FROM totals;

CREATE VIEW inventory_watchlist AS
SELECT location, sku, date, closing, reorder_point, recent_units, cover_days, lead_days, stockout_risk
FROM inventory_daily WHERE below_reorder;
