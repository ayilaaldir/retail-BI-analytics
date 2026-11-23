from __future__ import annotations

import argparse
import gzip
import io
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

import duckdb
import numpy as np
import pandas as pd

from .inventory_model import AGE_LIMITS, EXCESS_DAYS, HEALTH, LOOKBACK, MOVEMENT_SIGNS, SAFETY_DAYS, SLOW_UNITS, Simulation, simulate_inventory
from .pos_pipeline import DEFAULT_SOURCE, ROOT, verify_pos_source
from .pos_validation import load_and_validate_pos


MOVEMENT_COLUMNS = {
    'receipts': ('stock_receipt', 1), 'same_day': ('same_day_receipt', 1),
    'sold': ('fulfilled_sale', -1), 'returned': ('customer_return', 1),
    'adjustment': ('inventory_adjustment', 1), 'damaged': ('damaged_stock', -1), 'shrinkage': ('shrinkage', -1),
}
CRITICAL_CHECKS = (
    'missing_movement_id', 'duplicate_movement_id', 'missing_product', 'missing_store', 'unmatched_product',
    'unmatched_store', 'invalid_date', 'movement_without_snapshot', 'invalid_quantity', 'invalid_cost',
    'invalid_event', 'opening_outside_first_day', 'duplicate_snapshot_key', 'balance_mismatch',
    'roll_forward_mismatch', 'snapshot_flow_mismatch', 'negative_stock', 'intraday_fulfilment_gap', 'valuation_mismatch',
    'sales_reconciliation', 'invalid_opening', 'invalid_lot', 'fifo_balance_mismatch', 'invalid_order', 'receipt_order_mismatch',
)


def check_source(pos: pd.DataFrame, report) -> dict[str, int]:
    counts = {'pos_validation': len(report.errors)}
    if not report.valid:
        return counts
    key = ['sku', 'location', 'item', 'category', 'price_point_name']
    counts.update({
        'missing_product': int(pos['sku'].str.strip().eq('').sum()),
        'missing_store': int(pos['location'].str.strip().eq('').sum()),
        'invalid_description': int(pos[key[2:]].apply(lambda column: column.str.strip().eq('')).any(axis=1).sum()),
        'invalid_date': int(pos['date'].ne(pos['date'].dt.normalize()).sum()),
        'invalid_quantity': int((~np.isfinite(pos['qty']) | pos['qty'].ne(np.trunc(pos['qty']))).sum()),
        'invalid_cost': 0,
        'duplicate_source_row': report.metrics['exact_duplicate_rows'],
    })
    for column in ['unit_cost', 'unit_price']:
        cents = pos[column] * 100
        counts['invalid_cost'] += int((~np.isfinite(cents) | ~np.isclose(cents, np.rint(cents), rtol=0, atol=1e-6)).sum())
    catalog = pos[['sku', 'item', 'category', 'price_point_name', 'unit_cost', 'unit_price']].drop_duplicates()
    counts['conflicting_product_master'] = int(catalog.loc[catalog['sku'].duplicated(False), 'sku'].nunique())
    return counts


def load_model(con: duckdb.DuckDBPyConnection, simulation: Simulation, slow_units: int = SLOW_UNITS) -> None:
    models = {
        'inventory_products': simulation.products, 'inventory_stores': simulation.stores,
        'source_daily': simulation.source_daily, 'expected_daily': simulation.expected_daily,
        'inventory_opening': simulation.opening, 'inventory_lots': simulation.lots,
        'inventory_orders': simulation.orders,
        'movement_signs': pd.DataFrame(MOVEMENT_SIGNS.items(), columns=['event', 'sign']),
    }
    for name, frame in models.items():
        con.register('input_frame', frame)
        con.execute(f'CREATE TABLE {name} AS SELECT * FROM input_frame')
        con.unregister('input_frame')

    movement_types = ', '.join(f"('{event}', {factor} * d.{column})" for column, (event, factor) in MOVEMENT_COLUMNS.items())
    con.execute(f"""
        CREATE TABLE inventory_movements AS
        WITH events AS (
            SELECT d.location, d.sku, d.date, e.event, e.quantity
            FROM expected_daily d, LATERAL (VALUES {movement_types}) e(event, quantity)
            WHERE e.quantity <> 0
            UNION ALL
            SELECT location, sku, date, 'opening_balance', quantity FROM inventory_opening
        )
        SELECT row_number() OVER (ORDER BY e.location, e.sku, e.date, e.event) AS movement_id,
               e.*, p.cost_cents,
               CASE WHEN e.event IN ('fulfilled_sale', 'customer_return') THEN 'source_derived' ELSE 'synthetic' END AS provenance
        FROM events e JOIN inventory_products p USING (sku)
    """)
    transforms = (ROOT / 'sql' / 'inventory_analysis.sql').read_text(encoding='utf-8')
    for token, value in {'LOOKBACK_PRECEDING': LOOKBACK - 1, 'LOOKBACK': LOOKBACK,
                         'SLOW_UNITS': slow_units, 'EXCESS_DAYS': EXCESS_DAYS, 'SAFETY_DAYS': SAFETY_DAYS,
                         **{f'AGE_{i}': limit for i, limit in enumerate(AGE_LIMITS, 1)}}.items():
        transforms = transforms.replace(f'__{token}__', str(value))
    con.execute(transforms)
    materialize(con, 'inventory_daily')


def materialize(con: duckdb.DuckDBPyConnection, view: str) -> None:
    con.execute(f'CREATE TABLE {view}_data AS SELECT * FROM {view}')
    con.execute(f'CREATE OR REPLACE VIEW {view} AS SELECT * FROM {view}_data')


def validate_model(con: duckdb.DuckDBPyConnection, report) -> dict:
    con.execute((ROOT / 'sql' / 'inventory_quality.sql').read_text(encoding='utf-8'))
    checks = con.execute('''
        SELECT severity, code, COUNT(*) AS records, COALESCE(SUM(source_rows), 0), COALESCE(SUM(units), 0)
        FROM inventory_exceptions GROUP BY severity, code ORDER BY severity, code
    ''').fetchall()
    movement_count, snapshot_count, source_groups, sold, returned = con.execute('''
        SELECT (SELECT COUNT(*) FROM inventory_movements), COUNT(*), (SELECT COUNT(*) FROM source_daily),
               SUM(sold), SUM(returned) FROM inventory_daily
    ''').fetchall()[0]
    critical = sum(count for severity, _, count, _, _ in checks if severity == 'critical')
    warnings = sum(count for severity, _, count, _, _ in checks if severity == 'warning')
    return {
        'valid': not critical,
        'sourceRows': report.row_count,
        'sourceRowsAccepted': report.row_count if not critical else 0,
        'sourceRowsQuarantined': report.row_count if critical else 0,
        'sourceDuplicates': report.metrics['exact_duplicate_rows'],
        'sourceDailyGroups': source_groups,
        'movementRecords': movement_count,
        'acceptedMovements': movement_count if not critical else 0,
        'quarantinedMovements': movement_count if critical else 0,
        'snapshots': snapshot_count,
        'critical': critical,
        'warnings': warnings,
        'sold': sold,
        'returned': returned,
        'checks': {**dict.fromkeys(CRITICAL_CHECKS, 0), **{code: count for _, code, count, _, _ in checks}},
        'exceptions': [dict(severity=severity, code=code, records=count, sourceRows=rows, units=units)
                       for severity, code, count, rows, units in checks],
    }


def build_payload(con: duckdb.DuckDBPyConnection, quality: dict, seed: int, manifest: dict, public: bool,
                  slow_units: int = SLOW_UNITS) -> dict:
    stores = [row[0] for row in con.execute('SELECT location FROM inventory_stores ORDER BY location').fetchall()]
    products = con.execute('SELECT sku, item, price_point_name, category, cost_cents, lead_days FROM inventory_products ORDER BY sku').fetchall()
    periods = con.execute('''
        SELECT DISTINCT CAST(month AS VARCHAR)[:7], CAST(period_start AS VARCHAR)[:10], CAST(period_end AS VARCHAR)[:10],
               days, recent_days FROM inventory_monthly ORDER BY 1
    ''').fetchall()
    series = []
    store_indexes = {store: index for index, store in enumerate(stores)}
    product_indexes = {product[0]: index for index, product in enumerate(products)}
    previous_key = None
    for store, sku, health, reorder, risk, *metrics in con.execute('''
        SELECT location, sku, health, below_reorder, stockout_risk, opening, receipts, same_day, sold, returned,
               other, closing, stock_unit_days, recent_units, reorder_point,
               age_0_30, age_31_60, age_61_90, age_91_180, age_over_180
        FROM inventory_monthly ORDER BY location, sku, month
    ''').fetchall():
        key = (store, sku)
        if key != previous_key:
            series.append([store_indexes[store], product_indexes[sku], []])
            previous_key = key
        series[-1][2].append([*metrics, HEALTH.index(health), int(reorder), int(risk)])
    exceptions_by_period = con.execute('''
        SELECT strftime(date, '%Y-%m'), severity, code, COUNT(*), COALESCE(SUM(units), 0), COALESCE(SUM(source_rows), 0)
        FROM inventory_exceptions GROUP BY ALL ORDER BY 1, 2, 3
    ''').fetchall()
    return {
        'version': 1, 'synthetic': True, 'scope': 'licensed_demo' if public else 'local', 'seed': seed,
        'source': {key: manifest[key] for key in ('dataset_name', 'source_owner', 'source_url', 'license_name', 'license_url')},
        'policy': {'lookbackDays': LOOKBACK, 'safetyDays': SAFETY_DAYS, 'slowUnits': slow_units,
                   'overstockDays': EXCESS_DAYS, 'health': HEALTH},
        'periods': periods, 'stores': stores,
        'catalog': [[f'INV-{i:03d}', f'{category} item {i:03d}', category, cost, lead] if public
                    else [sku, f'{item} / {variant}', category, cost, lead]
                    for i, (sku, item, variant, category, cost, lead) in enumerate(products, 1)],
        'series': series, 'quality': {**quality, 'byPeriod': exceptions_by_period},
    }


def write_atomic(path: Path, contents: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=path.parent) as stage:
        staged = Path(stage) / path.name
        staged.write_bytes(contents)
        os.replace(staged, path)


def write_json(path: Path, data: dict, *, compressed: bool = False) -> None:
    contents = json.dumps(data, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if compressed:
        buffer = io.BytesIO()
        with gzip.GzipFile(fileobj=buffer, mode='wb', mtime=0) as archive:
            archive.write(contents)
        contents = buffer.getvalue()
    write_atomic(path, contents)


def run(source: Path, manifest_path: Path, seed: int, public: bool, slow_units: int = SLOW_UNITS) -> dict:
    if not 0 <= seed <= 2**53 - 1 or not 0 <= slow_units <= 2**31 - 1:
        raise ValueError('Seed or slow-moving threshold is outside the supported integer range')
    manifest = verify_pos_source(source, manifest_path) if public else json.loads(manifest_path.read_text(encoding='utf-8'))
    pos, report = load_and_validate_pos(source)
    source_checks = check_source(pos, report)
    report_path = ROOT / 'data' / 'reports' / 'inventory_quality.json'
    if any(source_checks.values()):
        write_json(report_path, {'valid': False, 'sourceRows': report.row_count, 'sourceRowsAccepted': 0,
                                 'sourceRowsQuarantined': report.row_count, 'sourceChecks': source_checks,
                                 'posQuality': report.to_dict()})
        raise ValueError(f'Source validation failed. See {report_path}')
    simulation = simulate_inventory(pos, seed)
    del pos
    database = ROOT / 'data' / 'processed' / 'inventory.duckdb'
    database.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=database.parent) as stage:
        staged_db = Path(stage) / database.name
        with duckdb.connect(str(staged_db), config={'threads': 4}) as con:
            load_model(con, simulation, slow_units)
            del simulation
            quality = validate_model(con, report)
            report_output = {**quality, 'seed': seed, 'slowUnits': slow_units,
                             'coverage': [report.metrics['min_date'], report.metrics['max_date']],
                             'sourceChecks': source_checks}
            if not quality['valid']:
                cursor = con.execute('SELECT * FROM inventory_exceptions ORDER BY severity, code, date, location, sku, reference')
                headers = [column[0] for column in cursor.description]
                report_output['exceptionDetails'] = [dict(zip(headers, row, strict=True)) for row in cursor.fetchall()]
                for record in report_output['exceptionDetails']:
                    if record['date'] is not None:
                        record['date'] = record['date'].isoformat()
            write_json(report_path, report_output)
            if not quality['valid']:
                raise ValueError(f'Inventory validation failed. See {report_path}')
            materialize(con, 'inventory_monthly')
            payload = build_payload(con, quality, seed, manifest, public, slow_units)
        os.replace(staged_db, database)
    export = (ROOT / 'frontend' / 'public' / 'inventory' / 'monthly.json.gzip' if public
              else ROOT / 'data' / 'local' / 'inventory.json')
    write_json(export, payload, compressed=public)
    return {'database': str(database), 'report': str(report_path), 'export': str(export), 'quality': quality}


def main() -> None:
    parser = argparse.ArgumentParser(description='Reconcile and model inventory against the validated synthetic POS source')
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'data' / 'source_manifest.json')
    parser.add_argument('--seed', type=int, default=20261123)
    parser.add_argument('--slow-units', type=int, default=SLOW_UNITS, help='Maximum fulfilled units in 28 days for slow-moving stock')
    parser.add_argument('--publish-export', action='store_true', help='Generate the compressed static candidate locally for review')
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.manifest, args.seed, args.publish_export, args.slow_units), indent=2))


if __name__ == '__main__':
    main()
