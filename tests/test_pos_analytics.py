import json
from pathlib import Path

import pandas as pd

from retail_bi.pos_analytics import build_pos_dashboard_payload


def test_pos_payload_maps_actual_dimensions_and_excludes_identifiers(tmp_path):
    rows = []
    for index in range(12):
        rows.append({
            "date": pd.Timestamp("2024-01-10") + pd.Timedelta(days=index),
            "category": "Apparel" if index < 6 else "Beauty",
            "gross_sales": 20.0,
            "discounts": -2.0 if index % 2 else 0.0,
            "net_sales": 18.0 if index % 2 else 20.0,
            "gross_profit": 10.0,
            "qty": 1,
            "transaction_id": f"PRIVATE-TXN-{index}",
            "payment_method": "Card" if index < 8 else "Cash",
            "location": "Store 01 - Test" if index < 10 else "Store 02 - Test",
            "event_type": "Payment",
        })
    parquet = tmp_path / "pos.parquet"
    pd.DataFrame(rows).to_parquet(parquet, index=False)
    payload = build_pos_dashboard_payload(
        parquet,
        Path("sql/pos_analysis.sql"),
        minimum_transactions=1,
    )
    summary = payload["views"]["All|All|All|All"]
    assert summary["kpis"]["sales"] == 228.0
    assert summary["kpis"]["orders"] == 12
    assert payload["filters"]["paymentMethods"] == ["Card", "Cash"]
    assert payload["filters"]["locations"] == ["Store 01 - Test", "Store 02 - Test"]
    assert payload["source"]["synthetic"] is True
    assert payload["source"]["licenseName"] == "CC BY 4.0"
    assert all(sum(value != "All" for value in key.split("|")) <= 3 for key in payload["views"])
    serialized = json.dumps(payload)
    assert "PRIVATE-TXN" not in serialized
    assert "customer" not in serialized.lower()


def test_pos_discount_bands_use_negative_discount_amounts(tmp_path):
    rows = pd.DataFrame([
        {"date": pd.Timestamp("2024-01-01"), "category": "Apparel", "gross_sales": 100.0, "discounts": 0.0, "net_sales": 100.0, "gross_profit": 50.0, "qty": 1, "transaction_id": "T1", "payment_method": "Card", "location": "Store", "event_type": "Payment"},
        {"date": pd.Timestamp("2024-01-02"), "category": "Apparel", "gross_sales": 100.0, "discounts": -15.0, "net_sales": 85.0, "gross_profit": 35.0, "qty": 1, "transaction_id": "T2", "payment_method": "Card", "location": "Store", "event_type": "Payment"},
    ])
    parquet = tmp_path / "discounts.parquet"
    rows.to_parquet(parquet, index=False)
    payload = build_pos_dashboard_payload(parquet, Path("sql/pos_analysis.sql"), minimum_transactions=1)
    names = [item["name"] for item in payload["views"]["All|All|All|All"]["discounts"]]
    assert names == ["No discount", "11–20%"]
