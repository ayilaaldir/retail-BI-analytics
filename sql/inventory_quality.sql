-- Independent checks compare the authoritative signed ledger with POS, the simulator and FIFO lots.
CREATE TABLE inventory_exceptions AS
WITH movement_checks AS (
    SELECT m.*, COUNT(*) OVER (PARTITION BY movement_id) AS id_count,
           s.location AS known_location, p.sku AS known_sku, p.cost_cents AS expected_cost,
           e.date AS known_date, signs.sign AS expected_sign
    FROM inventory_movements m
    LEFT JOIN inventory_stores s USING (location)
    LEFT JOIN inventory_products p USING (sku)
    LEFT JOIN expected_daily e USING (location, sku, date)
    LEFT JOIN movement_signs signs USING (event)
), snapshot_checks AS (
    SELECT d.*, COALESCE(d.date, e.date) AS check_date, COALESCE(d.location, e.location) AS check_location,
           COALESCE(d.sku, e.sku) AS check_sku, e.opening AS expected_opening, e.closing AS expected_closing,
           lag(d.closing) OVER (PARTITION BY d.location, d.sku ORDER BY d.date) AS prior_closing,
           lag(d.date) OVER (PARTITION BY d.location, d.sku ORDER BY d.date) AS prior_date,
           COUNT(*) OVER (PARTITION BY d.location, d.sku, d.date) AS key_count
    FROM inventory_daily d FULL OUTER JOIN expected_daily e USING (location, sku, date)
), ledger_sales AS (
    SELECT date, location, sku, -SUM(quantity) FILTER (WHERE event = 'fulfilled_sale') AS sold,
           SUM(quantity) FILTER (WHERE event = 'customer_return') AS returned
    FROM inventory_movements WHERE event IN ('fulfilled_sale', 'customer_return') GROUP BY date, location, sku
), source_checks AS (
    SELECT COALESCE(p.location, d.location) AS location, COALESCE(p.sku, d.sku) AS sku,
           COALESCE(p.date, d.date) AS date, COALESCE(p.payment_lines + p.refund_lines, 0) AS source_rows,
           COALESCE(p.sold, 0) AS source_sold, COALESCE(p.returned, 0) AS source_returned,
           COALESCE(d.sold, 0) AS ledger_sold, COALESCE(d.returned, 0) AS ledger_returned
    FROM source_daily p FULL OUTER JOIN ledger_sales d USING (location, sku, date)
), lot_totals AS (
    SELECT location, sku, date, SUM(quantity) AS units FROM inventory_lots GROUP BY location, sku, date
), month_ends AS (
    SELECT location, sku, MAX(date) AS date, arg_max(closing, date) AS closing
    FROM inventory_daily GROUP BY location, sku, date_trunc('month', date)
)
SELECT 'critical' AS severity, c.code, m.date, m.location, m.sku, m.movement_id::VARCHAR AS reference,
       0::BIGINT AS source_rows, NULL::BIGINT AS units
FROM movement_checks m, LATERAL (VALUES
    ('missing_movement_id', movement_id IS NULL),
    ('duplicate_movement_id', movement_id IS NOT NULL AND id_count > 1),
    ('missing_product', sku IS NULL OR trim(sku) = ''),
    ('missing_store', location IS NULL OR trim(location) = ''),
    ('unmatched_product', sku IS NOT NULL AND trim(sku) <> '' AND known_sku IS NULL),
    ('unmatched_store', location IS NOT NULL AND trim(location) <> '' AND known_location IS NULL),
    ('invalid_date', date IS NULL OR date NOT BETWEEN (SELECT min(date) FROM source_daily) AND (SELECT max(date) FROM source_daily)),
    ('movement_without_snapshot', known_date IS NULL),
    ('invalid_quantity', quantity IS NULL OR quantity = 0 OR NOT isfinite(quantity) OR quantity <> trunc(quantity)
        OR (expected_sign <> 0 AND sign(quantity) <> expected_sign)),
    ('invalid_cost', cost_cents IS NULL OR cost_cents < 0 OR cost_cents IS DISTINCT FROM expected_cost),
    ('invalid_event', expected_sign IS NULL),
    ('opening_outside_first_day', event = 'opening_balance' AND date <> (SELECT min(date) FROM source_daily))
) c(code, invalid) WHERE c.invalid
UNION ALL
SELECT 'critical', c.code, d.check_date, d.check_location, d.check_sku, NULL, 0, NULL
FROM snapshot_checks d, LATERAL (VALUES
    ('duplicate_snapshot_key', key_count > 1),
    ('balance_mismatch', closing IS DISTINCT FROM expected_closing OR opening IS DISTINCT FROM expected_opening),
    ('roll_forward_mismatch', prior_closing IS NOT NULL AND
        (opening IS DISTINCT FROM prior_closing OR date_diff('day', prior_date, date) <> 1)),
    ('snapshot_flow_mismatch', closing IS DISTINCT FROM opening + receipts + same_day + returned + adjustment + transfer_net - sold - damaged - shrinkage),
    ('negative_stock', closing < 0 OR opening < 0),
    ('intraday_fulfilment_gap', opening + receipts + same_day < sold),
    ('valuation_mismatch', inventory_value_cents IS DISTINCT FROM closing * cost_cents)
) c(code, invalid) WHERE c.invalid
UNION ALL
SELECT 'critical', 'sales_reconciliation', date, location, sku, NULL, source_rows,
       abs(source_sold - ledger_sold) + abs(source_returned - ledger_returned)
FROM source_checks WHERE source_sold <> ledger_sold OR source_returned <> ledger_returned
UNION ALL
SELECT 'critical', 'invalid_opening', o.date, o.location, o.sku, NULL, 0, o.quantity
FROM inventory_opening o LEFT JOIN inventory_products p USING (sku)
WHERE o.received_on IS NULL OR o.received_on > o.date OR o.quantity IS NULL OR o.quantity <= 0
    OR o.value_cents IS DISTINCT FROM o.quantity * p.cost_cents
UNION ALL
SELECT 'critical', 'invalid_lot', l.date, l.location, l.sku, NULL, 0, l.quantity
FROM inventory_lots l LEFT JOIN month_ends e USING (location, sku, date)
WHERE e.date IS NULL OR l.received_on IS NULL OR l.received_on > l.date OR l.quantity IS NULL OR l.quantity <= 0
UNION ALL
SELECT 'critical', 'fifo_balance_mismatch', e.date, e.location, e.sku, NULL, 0, COALESCE(l.units, 0) - e.closing
FROM month_ends e LEFT JOIN lot_totals l USING (location, sku, date)
WHERE e.closing <> COALESCE(l.units, 0)
UNION ALL
SELECT 'critical', 'invalid_order', o.order_date, o.location, o.sku, NULL, 0, o.quantity
FROM (
    SELECT *, COUNT(*) OVER (PARTITION BY location, sku, due_date) AS key_count
    FROM inventory_orders
) o LEFT JOIN expected_daily e ON e.location = o.location AND e.sku = o.sku AND e.date = o.order_date
LEFT JOIN inventory_products p ON p.sku = o.sku
WHERE e.date IS NULL OR o.key_count > 1 OR o.minimum_order_qty IS NULL OR o.minimum_order_qty < 1
    OR o.quantity IS NULL OR o.quantity < o.minimum_order_qty
    OR date_diff('day', o.order_date, o.due_date) IS DISTINCT FROM p.lead_days
UNION ALL
SELECT 'critical', 'receipt_order_mismatch', COALESCE(r.receipt_date, o.due_date), COALESCE(r.location, o.location),
       COALESCE(r.sku, o.sku), r.receipt_id, 0, COALESCE(r.quantity_received, o.quantity)
FROM (SELECT * FROM inventory_purchase_receipts WHERE NOT same_day_override) r
FULL OUTER JOIN inventory_orders o ON r.location = o.location AND r.sku = o.sku AND r.receipt_date = o.due_date
LEFT JOIN inventory_products p ON o.sku = p.sku
WHERE (r.receipt_id IS NOT NULL OR o.due_date <= (SELECT max(date) FROM source_daily))
  AND (r.quantity_received IS DISTINCT FROM o.quantity OR date_diff('day', o.order_date, o.due_date) IS DISTINCT FROM p.lead_days)
UNION ALL
SELECT 'warning', 'same_day_receipt', date, location, sku, movement_id, 0, quantity
FROM inventory_movements WHERE event = 'same_day_receipt';
