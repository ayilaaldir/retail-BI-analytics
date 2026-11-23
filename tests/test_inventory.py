from __future__ import annotations

import hashlib
import json

import duckdb
import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from retail_bi.inventory_model import Simulation, simulate_inventory
from retail_bi.inventory_pipeline import build_payload, check_source, load_model, validate_model
from retail_bi.pos_pipeline import verify_pos_source
from retail_bi.pos_validation import PosQualityReport


def source() -> pd.DataFrame:
    rows = [
        ('North', 'A', '2024-01-01', 'Payment', 400, 'Boot', 'Large', 'Footwear', 10., 25.),
        ('North', 'A', '2024-01-02', 'Refund', -2, 'Boot', 'Large', 'Footwear', 10., 25.),
        ('South', 'B', '2024-01-09', 'Payment', 2, 'Oil', 'Small', 'Beauty', 3., 12.),
        ('North', 'A', '2024-01-31', 'Payment', 3, 'Boot', 'Large', 'Footwear', 10., 25.),
        ('South', 'B', '2024-02-29', 'Payment', 5, 'Oil', 'Small', 'Beauty', 3., 12.),
    ]
    frame = pd.DataFrame(rows, columns=['location', 'sku', 'date', 'event_type', 'qty', 'item', 'price_point_name',
                                       'category', 'unit_cost', 'unit_price'])
    frame['date'] = pd.to_datetime(frame['date'])
    return frame


def quality_report(rows: int) -> PosQualityReport:
    return PosQualityReport('test fixture', rows, 10, metrics={'exact_duplicate_rows': 0})


def test_seed_and_future_independence():
    frame = source()
    full = simulate_inventory(frame, seed=4)
    repeated = simulate_inventory(frame.sample(frac=1, random_state=9), seed=4)
    for name in ('products', 'stores', 'opening', 'expected_daily', 'lots', 'orders'):
        assert_frame_equal(getattr(full, name), getattr(repeated, name))
    other = simulate_inventory(frame, seed=5)
    assert not full.opening.equals(other.opening)
    cutoff = pd.Timestamp('2024-01-31')
    prefix = simulate_inventory(frame[frame['date'] <= cutoff], seed=4)
    assert_frame_equal(full.expected_daily[full.expected_daily['date'] <= cutoff].reset_index(drop=True), prefix.expected_daily)
    assert_frame_equal(full.lots[full.lots['date'] <= cutoff].reset_index(drop=True), prefix.lots)
    assert_frame_equal(full.orders[full.orders['order_date'] <= cutoff].reset_index(drop=True), prefix.orders)


def test_paid_and_refunded_units_and_warnings_reconcile():
    with duckdb.connect() as con:
        load_model(con, simulate_inventory(source(), seed=4))
        quality = validate_model(con, quality_report(5))
        assert quality['valid'] and quality['critical'] == 0
        assert quality['warnings'] > 0
        assert quality['sold'] == 410 and quality['returned'] == 2
        assert quality['snapshots'] == 2 * 2 * 60
        assert con.execute('SELECT COUNT(*) = COUNT(DISTINCT movement_id) FROM inventory_movements').fetchall() == [(True,)]
        day = con.execute("""SELECT opening, receipts, same_day, sold, returned, adjustment, damaged, shrinkage, closing
                         FROM inventory_daily WHERE location='North' AND sku='A' ORDER BY date LIMIT 2""").fetchall()
        opening, received, urgent, paid, returned, adjustment, damage, shrink, closing = day[0]
        assert (paid, returned, urgent) == (400, 0, 400 - opening - received)
        assert closing == opening + received + urgent - paid + returned + adjustment - damage - shrink
        assert day[1][0] == closing and day[1][4] == 2
        assert con.execute("SELECT quantity, provenance FROM inventory_movements WHERE event='customer_return'").fetchall() == [(2, 'source_derived')]
        assert con.execute("SELECT min(closing) FROM inventory_daily").fetchall()[0][0] >= 0


def manual_model() -> Simulation:
    dates = pd.date_range('2024-01-01', '2024-02-29')
    ledger = []
    for sku, current in [('A', 10), ('B', 1)]:
        for date in dates:
            received = 5 if sku == 'A' and date == pd.Timestamp('2024-02-03') else 0
            sold = {('A', '2024-02-01'): 2, ('B', '2024-01-01'): 1}.get((sku, date.date().isoformat()), 0)
            returned = {('A', '2024-02-02'): 1, ('B', '2024-02-29'): 1}.get((sku, date.date().isoformat()), 0)
            closing = current + received - sold + returned
            ledger.append(('North', sku, date, current, received, 0, sold, returned, 0, 0, 0, closing))
            current = closing

    def table(rows, columns, date_columns=()):
        frame = pd.DataFrame(rows, columns=columns.split())
        for column in date_columns:
            frame[column] = pd.to_datetime(frame[column])
        return frame

    return Simulation(
        products=table([('A', 'Boot', 'Large', 'Footwear', 1000, 2500, 5, True),
                        ('B', 'Sample', 'Small', 'Beauty', 0, 0, 6, True)],
                       'sku item price_point_name category cost_cents price_cents lead_days active'),
        stores=table([('North',)], 'location'),
        source_daily=table([('North', 'A', '2024-02-01', 2, 0, 1, 0), ('North', 'A', '2024-02-02', 0, 1, 0, 1),
                            ('North', 'B', '2024-01-01', 1, 0, 1, 0), ('North', 'B', '2024-02-29', 0, 1, 0, 1)],
                           'location sku date sold returned payment_lines refund_lines', ['date']),
        expected_daily=table(ledger, 'location sku date opening receipts same_day sold returned adjustment damaged shrinkage closing'),
        opening=table([('North', 'A', '2024-01-01', '2023-12-31', 10, 10000),
                       ('North', 'B', '2024-01-01', '2023-12-25', 1, 0)],
                      'location sku date received_on quantity value_cents', ['date', 'received_on']),
        lots=table([('North', 'A', '2024-01-31', '2023-12-31', 'opening_balance', 10),
                    ('North', 'A', '2024-02-29', '2023-12-31', 'opening_balance', 8),
                    ('North', 'A', '2024-02-29', '2024-02-02', 'customer_return', 1),
                    ('North', 'A', '2024-02-29', '2024-02-03', 'stock_receipt', 5),
                    ('North', 'B', '2024-02-29', '2024-02-29', 'customer_return', 1)],
                   'location sku date received_on origin quantity', ['date', 'received_on']),
        orders=table([('North', 'A', '2024-01-29', '2024-02-03', 5, 1)],
                     'location sku order_date due_date quantity minimum_order_qty', ['order_date', 'due_date']),
    )


@pytest.fixture
def manual_connection():
    with duckdb.connect() as con:
        load_model(con, manual_model())
        yield con


def test_sql_period_matches_independent_daily_values(manual_connection):
    con = manual_connection
    assert validate_model(con, quality_report(4))['valid']
    values = con.execute("""
        SELECT ending_units, ending_value_cents, avg_value_cents, cogs_cents, turnover, dio, cover_days, health
        FROM inventory_period(DATE '2024-01-01', DATE '2024-02-01') WHERE sku = 'A'
    """).fetchall()[0]
    independent_stock = [10] * 31 + [8, 9] + [14] * 27
    average = sum(independent_stock) * 1000 / len(independent_stock)
    assert values[:4] == (14, 14000, average, 1000)
    assert values[4] == pytest.approx(1000 / average)
    assert values[5:] == (705, None, 'Non-moving')
    assert con.execute("""
        SELECT turnover, dio FROM inventory_period(DATE '2024-01-01', DATE '2024-01-01') ORDER BY sku
    """).fetchall() == [(0, None), (None, None)]
    assert con.execute("SELECT * FROM inventory_period(DATE '2024-03-01', DATE '2024-03-01')").fetchall() == []
    assert con.execute("""
        SELECT recent_units, recent_days, reorder_point, cover_days, health FROM inventory_daily
        WHERE sku='A' AND date=DATE '2024-02-01'
    """).fetchall() == [(2, 28, 2, pytest.approx(112), 'Slow-moving')]
    assert con.execute("SELECT health FROM inventory_daily WHERE sku='A' ORDER BY date LIMIT 1").fetchall() == [('Limited history',)]


def test_fifo_receipt_ages_and_boundaries(manual_connection):
    con = manual_connection
    assert con.execute("""
        SELECT age_0_30, age_31_60, age_61_90, age_91_180, age_over_180 FROM inventory_aging
        WHERE sku = 'A' ORDER BY date
    """).fetchall() == [(0, 10, 0, 0, 0), (6, 8, 0, 0, 0)]
    for age in [0, 30, 31, 60, 61, 90, 91, 180, 181]:
        con.execute("INSERT INTO inventory_lots VALUES ('North', 'C', DATE '2024-02-29', DATE '2024-02-29' - ?::INTEGER, 'fixture', 1)", [age])
    assert con.execute("""
        SELECT age_0_30, age_31_60, age_61_90, age_91_180, age_over_180 FROM inventory_aging WHERE sku='C'
    """).fetchall() == [(2, 2, 2, 2, 1)]


def test_coverage_equal_to_lead_time_is_not_a_stockout_risk():
    model = manual_model()
    model.products.loc[model.products['sku'] == 'A', 'lead_days'] = 14
    # 18 fulfilled units in 28 days with 9 units left gives exactly 14 days of cover.
    current_day = model.expected_daily['sku'].eq('A') & model.expected_daily['date'].eq(pd.Timestamp('2024-02-01'))
    model.expected_daily.loc[current_day, ['opening', 'same_day', 'sold', 'closing']] = [10, 17, 18, 9]
    with duckdb.connect() as con:
        load_model(con, model)
        value = con.execute("""
            SELECT closing, recent_units, recent_days, lead_days, cover_days, below_reorder, stockout_risk
            FROM inventory_daily WHERE sku='A' AND date=DATE '2024-02-01'
        """).fetchall()[0]
        assert value[:4] == (9, 18, 28, 14)
        assert value[4] == pytest.approx(14)
        assert value[5:] == (True, False)


def test_critical_anomalies_fail_closed(manual_connection):
    con = manual_connection
    # All mutations are deliberate fixtures and never enter the shipped model.
    con.execute("INSERT INTO inventory_movements SELECT * FROM inventory_movements WHERE event='fulfilled_sale' AND sku='A'")
    con.execute("UPDATE inventory_movements SET quantity=-5 WHERE event='customer_return' AND sku='A'")
    con.execute("INSERT INTO inventory_movements VALUES (999, 'Unknown', '', DATE '2023-12-15', 'shrinkage', -1, -1, 'fixture')")
    con.execute("UPDATE inventory_daily_data SET closing=-1, opening=100 WHERE sku='A' AND date=DATE '2024-02-01'")
    quality = validate_model(con, quality_report(4))
    assert not quality['valid'] and quality['acceptedMovements'] == 0
    assert quality['quarantinedMovements'] == quality['movementRecords']
    expected_codes = {'duplicate_movement_id', 'invalid_quantity', 'missing_product', 'unmatched_store', 'invalid_date',
                      'invalid_cost', 'negative_stock', 'balance_mismatch', 'roll_forward_mismatch', 'sales_reconciliation'}
    assert expected_codes <= {e['code'] for e in quality['exceptions'] if e['severity'] == 'critical'}
    assert quality['checks']['duplicate_movement_id'] == 2


def test_source_checks_reject_fractional_quantities_and_nonstatic_master():
    frame = source().astype({'qty': 'float64'})
    frame.loc[0, ['qty', 'unit_cost']] = [1.5, 10.001]
    checks = check_source(frame, quality_report(len(frame)))
    assert checks['invalid_quantity'] == checks['invalid_cost'] == checks['conflicting_product_master'] == 1


def test_public_pos_source_must_match_verified_archive(tmp_path):
    archive = tmp_path / 'pos.csv.gz'
    archive.write_bytes(b'synthetic fixture')
    manifest = tmp_path / 'manifest.json'
    evidence = {
        'dataset_name': 'fixture', 'source_url': 'https://example.org/dataset', 'license_name': 'CC BY 4.0',
        'license_url': 'https://creativecommons.org/licenses/by/4.0/', 'license_verified': True,
        'redistribution_status': 'permitted', 'redistribution_permission_url': 'https://example.org/license',
        'verified_at': '2026-11-23', 'synthetic_data': True,
        'source_file_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    }
    manifest.write_text(json.dumps(evidence), encoding='utf-8')
    assert verify_pos_source(archive, manifest) == evidence
    archive.write_bytes(b'changed fixture')
    with pytest.raises(ValueError, match='SHA-256'):
        verify_pos_source(archive, manifest)


def test_browser_payload_aliases_and_monthly_grain(manual_connection):
    con = manual_connection
    quality = validate_model(con, quality_report(4))
    keys = dict.fromkeys(('dataset_name', 'source_owner', 'source_url', 'license_name', 'license_url'), 'Fixture')
    local = build_payload(con, quality, 4, keys, public=False)
    demo = build_payload(con, quality, 4, keys, public=True)
    assert local['catalog'][0][:2] == ['A', 'Boot / Large']
    assert demo['catalog'][0][:2] == ['INV-001', 'Footwear item 001']
    assert local['series'] == demo['series']
    assert demo['periods'][1] == ('2024-02', '2024-02-01', '2024-02-29', 29, 28)
    assert demo['series'][0][2][1][6:8] == [14, 395]
