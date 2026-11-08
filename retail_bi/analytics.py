from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb


def build_dashboard_payload(parquet_path: str | Path, sql_path: str | Path) -> dict:
    parquet = str(Path(parquet_path).resolve()).replace("'", "''")
    connection = duckdb.connect()
    connection.execute(f"CREATE VIEW retail AS SELECT * FROM read_parquet('{parquet}')")
    connection.execute(Path(sql_path).read_text(encoding="utf-8"))

    def records(query: str) -> list[dict]:
        result = connection.execute(query)
        columns = [column[0] for column in result.description]
        return [dict(zip(columns, row, strict=True)) for row in result.fetchall()]

    summary = records("SELECT * FROM kpi_summary")[0]
    bounds = records("SELECT COUNT(*) rows, MIN(order_date) min_date, MAX(order_date) max_date FROM retail")[0]
    raw_rows = records("SELECT order_date, region, segment, category, discount, sales, profit, order_id FROM retail ORDER BY order_date, row_id")
    rows = [{"orderDate": row["order_date"].date().isoformat(), "region": row["region"], "segment": row["segment"], "category": row["category"], "discount": float(row["discount"]), "sales": float(row["sales"]), "profit": float(row["profit"]), "orderId": row["order_id"]} for row in raw_rows]
    trend = [{"month": str(row["month"]), "sales": float(row["sales"]), "profit": float(row["profit"]), "margin": float(row["margin"] or 0)} for row in records("SELECT * FROM monthly_performance ORDER BY month")]
    categories = [{"name": row["category"], "sales": float(row["sales"]), "profit": float(row["profit"]), "margin": float(row["margin"] or 0)} for row in records("SELECT * FROM category_performance ORDER BY sales DESC")]
    states = [{"state": row["state"], "sales": float(row["sales"]), "profit": float(row["profit"]), "margin": float(row["margin"] or 0)} for row in records("SELECT * FROM state_performance ORDER BY sales DESC")]
    regions = [{"name": row["region"], "sales": float(row["sales"]), "profit": float(row["profit"]), "margin": float(row["margin"] or 0)} for row in records("SELECT region, SUM(sales) sales, SUM(profit) profit, SUM(profit) / NULLIF(SUM(sales), 0) margin FROM retail GROUP BY region ORDER BY sales DESC")]
    discounts = [{"name": row["discount_band"], "sales": float(row["sales"]), "profit": float(row["profit"]), "margin": float(row["margin"] or 0)} for row in records("SELECT * FROM discount_effectiveness ORDER BY CASE discount_band WHEN 'No discount' THEN 1 WHEN '0–20%' THEN 2 WHEN '21–40%' THEN 3 ELSE 4 END")]
    filters = records('SELECT list_sort(list_distinct(list(region))) AS regions, list_sort(list_distinct(list(segment))) AS segments, list_sort(list_distinct(list(category))) AS categories, list_sort(list_distinct(list(year(order_date)))) AS "years" FROM retail')[0]
    return {
        "status": "ready",
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": {"name": "Kaggle Superstore", "rows": int(bounds["rows"]), "minDate": bounds["min_date"].date().isoformat(), "maxDate": bounds["max_date"].date().isoformat()},
        "filters": filters,
        "rows": rows,
        "trend": trend,
        "categories": categories,
        "states": states,
        "regions": regions,
        "discounts": discounts,
        "kpis": {"sales": float(summary["sales"]), "profit": float(summary["profit"]), "margin": float(summary["margin"] or 0), "orders": int(summary["orders"]), "averageOrderValue": float(summary["average_order_value"] or 0)},
    }


def write_payload(payload: dict, path: str | Path) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2), encoding="utf-8")
