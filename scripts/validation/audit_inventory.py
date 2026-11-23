"""Recheck the approved inventory database against the original POS and signed ledger."""

from collections import defaultdict, deque
from itertools import groupby
from pathlib import Path
import json

import duckdb


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'data/raw/mendeley_pos/01_square_item_sales_detail_24mo.csv.gz'


def replay_fifo(con):
    checkpoints = defaultdict(dict)
    for store, sku, date, received, origin, units in con.execute('''
        SELECT location, sku, date::DATE, received_on::DATE, origin, quantity FROM inventory_lots
    ''').fetchall():
        checkpoints[store, sku, date][received, origin] = units

    openings = {(store, sku): received for store, sku, received in con.execute('''
        SELECT location, sku, received_on::DATE FROM inventory_opening
    ''').fetchall()}
    dates = [row[0] for row in con.execute('SELECT DISTINCT period_end::DATE FROM inventory_monthly ORDER BY 1').fetchall()]
    aging = {(store, sku, date): bands for store, sku, date, *bands in con.execute('''
        SELECT location, sku, period_end::DATE, age_0_30, age_31_60, age_61_90, age_91_180, age_over_180
        FROM inventory_monthly
    ''').fetchall()}
    rows = iter(con.execute('''
        SELECT location, sku, date::DATE, event, quantity FROM inventory_movements ORDER BY location, sku, date,
           CASE event WHEN 'opening_balance' THEN 0 WHEN 'stock_receipt' THEN 1 WHEN 'same_day_receipt' THEN 2
                WHEN 'fulfilled_sale' THEN 3 WHEN 'customer_return' THEN 4 WHEN 'inventory_adjustment' THEN 5
                WHEN 'damaged_stock' THEN 6 ELSE 7 END, movement_id
    ''').fetchall())
    checks = 0
    for pair, movements in groupby(rows, key=lambda row: row[:2]):
        lots = deque()
        month_ends = iter(dates)
        month_end = next(month_ends, None)

        def check(date):
            actual = {(received, event): units for received, event, units in lots}
            assert actual == checkpoints.pop((*pair, date), {}), (pair, date, 'FIFO layer difference')
            bands = [0] * 5
            for received, _, units in lots:
                band = sum((date - received).days > limit for limit in (30, 60, 90, 180))
                bands[band] += units
            assert bands == aging.pop((*pair, date)), (pair, date, 'FIFO age band difference')

        for _, _, when, event, quantity in movements:
            while month_end is not None and month_end < when:
                check(month_end)
                checks += 1
                month_end = next(month_ends, None)
            if quantity > 0:
                lots.append((openings[pair] if event == 'opening_balance' else when, event, quantity))
            else:
                while quantity < 0:
                    assert lots, (pair, when, 'outbound units exceed dated lots')
                    received, origin, remaining = lots.popleft()
                    remainder = remaining + quantity
                    if remainder > 0:
                        lots.appendleft((received, origin, remainder))
                    quantity = min(0, remainder)
        while month_end is not None:
            check(month_end)
            checks += 1
            month_end = next(month_ends, None)
    assert not checkpoints and not aging
    return checks


def audit(con):
    con.execute('''
        CREATE TEMP TABLE raw_pos AS
        SELECT "Location" AS location, "SKU" AS sku, "Date"::DATE AS date,
               "Event Type" AS event, "Qty"::BIGINT AS qty,
               ("Unit Cost"::DECIMAL(12,2) * 100)::BIGINT AS cost_cents,
               "Net Sales"::DECIMAL(12,2) AS sales, "Gross Profit"::DECIMAL(12,2) AS profit,
               "Transaction ID" AS txn
        FROM read_csv(?, header=true, all_varchar=true)
    ''', [str(SOURCE)])
    checks = {
        'source_event_errors': """SELECT count(*) FROM raw_pos WHERE event IS NULL OR event NOT IN ('Payment','Refund')
            OR qty IS NULL OR location IS NULL OR sku IS NULL OR date IS NULL OR cost_cents IS NULL
            OR cost_cents<0 OR (event='Payment' AND qty<=0) OR (event='Refund' AND qty>=0)""",
        'movement_key_errors': 'SELECT count(*) - count(DISTINCT movement_id) FROM inventory_movements',
        'snapshot_key_errors': 'SELECT count(*) - count(DISTINCT (location,sku,date)) FROM inventory_daily',
        'lot_key_errors': 'SELECT count(*) - count(DISTINCT (location,sku,date,received_on,origin)) FROM inventory_lots',
        'reference_or_sign_errors': '''
            SELECT count(*) FROM inventory_movements m LEFT JOIN inventory_products p USING(sku)
            LEFT JOIN inventory_stores s USING(location) LEFT JOIN movement_signs r USING(event)
            WHERE p.sku IS NULL OR s.location IS NULL OR m.date IS NULL OR m.quantity IS NULL OR m.quantity=0
                OR m.cost_cents IS DISTINCT FROM p.cost_cents OR r.sign IS NULL OR (r.sign<>0 AND sign(m.quantity)<>r.sign)
        ''',
        'daily_balance_errors': '''
            SELECT count(*) FROM (SELECT *,lag(closing) OVER w AS prior, lag(date) OVER w AS prior_date
                FROM inventory_daily WINDOW w AS (PARTITION BY location,sku ORDER BY date))
            WHERE closing<0 OR opening<0 OR closing <> opening+receipts+same_day+returned+adjustment+transfer_net-sold-damaged-shrinkage
                OR (prior IS NOT NULL AND (opening<>prior OR date_diff('day',prior_date,date)<>1))
                OR closing*cost_cents IS DISTINCT FROM inventory_value_cents
        ''',
        'pos_ledger_differences': '''
            WITH p AS (SELECT location,sku,date, sum(CASE WHEN event='Payment' THEN -qty ELSE 0 END) AS sales,
                         sum(CASE WHEN event='Refund' THEN -qty ELSE 0 END) AS refunds
                       FROM raw_pos GROUP BY location,sku,date),
                 m AS (SELECT location,sku,date::DATE AS day, sum(CASE WHEN event='fulfilled_sale' THEN quantity ELSE 0 END) AS sales,
                         sum(CASE WHEN event='customer_return' THEN quantity ELSE 0 END) AS refunds
                       FROM inventory_movements GROUP BY location,sku,day)
            SELECT count(*) FROM p FULL JOIN m ON p.location=m.location AND p.sku=m.sku AND p.date=m.day
            WHERE coalesce(p.sales,0)<>coalesce(m.sales,0) OR coalesce(p.refunds,0)<>coalesce(m.refunds,0)
        ''',
        'monthly_balance_errors': '''
            SELECT count(*) FROM (SELECT *,lag(closing) OVER (PARTITION BY location,sku ORDER BY month) AS prior FROM inventory_monthly)
            WHERE closing <> opening+receipts+same_day+returned+other-sold OR (prior IS NOT NULL AND opening<>prior)
              OR closing <> age_0_30+age_31_60+age_61_90+age_91_180+age_over_180
        ''',
        'policy_errors': '''
            SELECT count(*) FROM inventory_daily WHERE
                reorder_point <> ceil(CAST(recent_units*lead_days AS DOUBLE)/recent_days)+greatest(1,ceil(CAST(recent_units*3 AS DOUBLE)/recent_days))
                OR below_reorder IS DISTINCT FROM (recent_units>0 AND closing<reorder_point)
                OR stockout_risk IS DISTINCT FROM (recent_units>0 AND closing*recent_days<lead_days*recent_units)
        ''',
    }
    results = {name: con.execute(query).fetchall()[0][0] for name, query in checks.items()}
    assert not any(results.values()), results
    rows, paid, returned, first, last, stores, skus, sales, profit, txns = con.execute('''
        SELECT count(*), sum(qty) FILTER (WHERE event='Payment'), -sum(qty) FILTER (WHERE event='Refund'),
               min(date),max(date),count(DISTINCT location),count(DISTINCT sku),sum(sales),sum(profit),count(DISTINCT txn)
        FROM raw_pos
    ''').fetchall()[0]
    snapshots = con.execute('SELECT count(*) FROM inventory_daily').fetchall()[0][0]
    assert snapshots == ((last-first).days + 1) * stores * skus
    valuation = con.execute('''
        WITH period_rows AS (SELECT * FROM inventory_daily WHERE date::DATE BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'),
             totals AS (SELECT sum(closing) FILTER (WHERE date::DATE=DATE '2025-12-31') AS ending_units,
                        sum(inventory_value_cents) FILTER (WHERE date::DATE=DATE '2025-12-31')/100 AS ending_value,
                        sum(inventory_value_cents)/count(DISTINCT date)/100 AS daily_average,
                        sum(cogs_cents)/100 AS cogs, count(DISTINCT date) AS days FROM period_rows)
        SELECT *, cogs/daily_average AS turnover, daily_average/cogs*days AS dio FROM totals
    ''').fetchall()[0]
    pos_cogs = con.execute("SELECT sum(qty*cost_cents)/100 FROM raw_pos WHERE year(date)=2025").fetchall()[0][0]
    assert valuation[3] == pos_cogs
    assert replay_fifo(con) == stores * skus * con.execute('SELECT count(DISTINCT month) FROM inventory_monthly').fetchall()[0][0]
    exceptions = con.execute('SELECT severity, code, count(*), sum(units) FROM inventory_exceptions GROUP BY ALL').fetchall()
    assert all(severity == 'warning' for severity, *_ in exceptions)
    return {'checks': results, 'source': [rows, paid, returned, first, last, stores, skus, sales, profit, txns],
            'snapshots': snapshots, 'kpis': valuation, 'exceptions': exceptions}


if __name__ == '__main__':
    with duckdb.connect(str(ROOT / 'data/processed/inventory.duckdb'), read_only=True, config={'threads': 4}) as connection:
        print(json.dumps(audit(connection), default=str, indent=2))
