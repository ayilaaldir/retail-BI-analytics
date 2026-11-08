from pathlib import Path

import pandas as pd

from retail_bi.analytics import build_dashboard_payload


def test_duckdb_model_builds_dashboard_payload(tmp_path):
    rows = pd.DataFrame([
        {"row_id": 1, "order_id": "TEST-1", "order_date": pd.Timestamp("2024-01-10"), "region": "West", "segment": "Consumer", "category": "Office", "sub_category": "Paper", "state": "Test State", "discount": 0.0, "sales": 100.0, "profit": 20.0},
        {"row_id": 2, "order_id": "TEST-2", "order_date": pd.Timestamp("2024-02-10"), "region": "East", "segment": "Corporate", "category": "Tech", "sub_category": "Phones", "state": "Other State", "discount": 0.1, "sales": 50.0, "profit": -5.0},
    ])
    parquet = tmp_path / "synthetic.parquet"
    rows.to_parquet(parquet, index=False)
    payload = build_dashboard_payload(parquet, Path("sql/analysis.sql"))
    assert payload["status"] == "ready"
    assert payload["kpis"] == {"sales": 150.0, "profit": 15.0, "margin": 0.1, "orders": 2, "averageOrderValue": 75.0}
    assert payload["filters"]["regions"] == ["East", "West"]
    assert payload["rows"][0]["discount"] == 0.0
    assert len(payload["regions"]) == 2
    assert [item["name"] for item in payload["discounts"]] == ["No discount", "0–20%"]
