from __future__ import annotations

import json
from datetime import UTC, datetime
from itertools import combinations
from pathlib import Path

import duckdb
import pandas as pd

ALL = "All"
DIMENSIONS = ("year", "location", "payment_method", "category")
DISCOUNT_ORDER = ["No discount", "1–10%", "11–20%", "Above 20%"]
DEFAULT_MAX_ACTIVE_FILTERS = 3
DEFAULT_MINIMUM_TRANSACTIONS = 10


def _view_key(selection: dict[str, object]) -> str:
    return "|".join(str(selection.get(dimension, ALL)) for dimension in DIMENSIONS)


def _grouped_measures(frame: pd.DataFrame, column: str, minimum_transactions: int) -> pd.DataFrame:
    grouped = frame.groupby(column, observed=True).agg(
        sales=("net_sales", "sum"),
        profit=("gross_profit", "sum"),
        transactions=("transaction_id", "nunique"),
    ).reset_index()
    grouped["margin"] = grouped["profit"].div(grouped["sales"]).fillna(0)
    suppressed = grouped["transactions"] < minimum_transactions
    if int(suppressed.sum()) == 1 and len(grouped) > 1:
        complementary = grouped.loc[~suppressed].sort_values(["transactions", column]).index[0]
        suppressed.loc[complementary] = True
    return grouped.loc[~suppressed].copy()


def _breakdown(
    frame: pd.DataFrame,
    column: str,
    minimum_transactions: int,
    *,
    sort_by: str = "sales",
) -> list[dict]:
    grouped = _grouped_measures(frame, column, minimum_transactions).sort_values(sort_by, ascending=False)
    return [
        {
            "name": str(row[column]),
            "sales": float(row["sales"]),
            "profit": float(row["profit"]),
            "margin": float(row["margin"]),
        }
        for _, row in grouped.iterrows()
    ]


def _summarize(frame: pd.DataFrame, minimum_transactions: int) -> dict:
    sales = float(frame["net_sales"].sum())
    profit = float(frame["gross_profit"].sum())
    transactions = int(frame["transaction_id"].nunique())

    monthly = _grouped_measures(frame, "month", minimum_transactions).sort_values("month")
    trend = [
        {
            "month": str(row["month"]),
            "sales": float(row["sales"]),
            "profit": float(row["profit"]),
            "margin": float(row["margin"]),
        }
        for _, row in monthly.iterrows()
    ]

    payments = frame.loc[frame["event_type"].eq("Payment")]
    discounts = _breakdown(payments, "discount_band", minimum_transactions)
    discounts.sort(key=lambda item: DISCOUNT_ORDER.index(item["name"]))

    return {
        "kpis": {
            "sales": sales,
            "profit": profit,
            "margin": profit / sales if sales else 0,
            "orders": transactions,
            "averageOrderValue": sales / transactions if transactions else 0,
        },
        "trend": trend,
        "categories": _breakdown(frame, "category", minimum_transactions),
        "locations": _breakdown(frame, "location", minimum_transactions, sort_by="profit"),
        "discounts": discounts,
    }


def build_pos_dashboard_payload(
    parquet_path: str | Path,
    sql_path: str | Path,
    *,
    max_active_filters: int = DEFAULT_MAX_ACTIVE_FILTERS,
    minimum_transactions: int = DEFAULT_MINIMUM_TRANSACTIONS,
) -> dict:
    """Build disclosure-controlled POS aggregates without browser-visible identifiers."""
    parquet = str(Path(parquet_path).resolve()).replace("'", "''")
    connection = duckdb.connect()
    try:
        connection.execute(f"CREATE VIEW retail AS SELECT * FROM read_parquet('{parquet}')")
        connection.execute(Path(sql_path).read_text(encoding="utf-8"))
        frame = connection.execute(
            """
            SELECT date, category, gross_sales, discounts, net_sales, gross_profit,
                   transaction_id, payment_method, location, event_type
            FROM retail
            """
        ).df()
    finally:
        connection.close()

    frame["date"] = pd.to_datetime(frame["date"])
    frame["year"] = frame["date"].dt.year
    frame["month"] = frame["date"].dt.strftime("%Y-%m")
    discount_rate = (-frame["discounts"]).div(frame["gross_sales"].where(frame["gross_sales"] > 0))
    frame["discount_band"] = pd.cut(
        discount_rate.fillna(0),
        bins=[-0.000001, 0, 0.10, 0.20, float("inf")],
        labels=DISCOUNT_ORDER,
        include_lowest=True,
    )

    filters = {
        "years": sorted(int(year) for year in frame["year"].unique()),
        "locations": sorted(str(value) for value in frame["location"].unique()),
        "paymentMethods": sorted(str(value) for value in frame["payment_method"].unique()),
        "categories": sorted(str(value) for value in frame["category"].unique()),
    }

    views: dict[str, dict] = {}
    for dimension_count in range(max_active_filters + 1):
        for dimensions in combinations(DIMENSIONS, dimension_count):
            if not dimensions:
                grouped_frames = [((), frame)]
            else:
                grouped_frames = frame.groupby(list(dimensions), observed=True, sort=False)
            for values, selected in grouped_frames:
                if not isinstance(values, tuple):
                    values = (values,)
                if selected["transaction_id"].nunique() < minimum_transactions:
                    continue
                selection = dict(zip(dimensions, values, strict=True))
                views[_view_key(selection)] = _summarize(selected, minimum_transactions)

    return {
        "status": "ready",
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": {
            "name": "A Synthetic Multi-Store Retail Point-of-Sale Transaction Dataset",
            "creator": "MD Owes Quruny Shubho",
            "rows": int(len(frame)),
            "minDate": frame["date"].min().date().isoformat(),
            "maxDate": frame["date"].max().date().isoformat(),
            "attributionUrl": "https://data.mendeley.com/datasets/39xdjxgnmf/1",
            "licenseName": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "doi": "10.17632/39xdjxgnmf.1",
            "synthetic": True,
            "usageCondition": "Synthetic source data; aggregates adapted for this dashboard under CC BY 4.0.",
        },
        "filters": filters,
        "privacy": {
            "maxActiveFilters": max_active_filters,
            "minimumTransactionsPerAggregate": minimum_transactions,
            "complementarySuppression": True,
        },
        "views": views,
    }


def write_pos_payload(payload: dict, path: str | Path) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
