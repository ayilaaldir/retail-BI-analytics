from __future__ import annotations

import re

REQUIRED_COLUMNS = {
    "row_id",
    "order_id",
    "order_date",
    "ship_date",
    "ship_mode",
    "customer_id",
    "customer_name",
    "segment",
    "country",
    "city",
    "state",
    "postal_code",
    "region",
    "product_id",
    "category",
    "sub_category",
    "product_name",
    "sales",
    "quantity",
    "discount",
    "profit",
}

DATE_COLUMNS = ["order_date", "ship_date"]
NUMERIC_COLUMNS = ["row_id", "postal_code", "sales", "quantity", "discount", "profit"]


def normalize_column(name: str) -> str:
    """Normalize common Superstore column headings to stable snake_case names."""
    value = re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower())
    return value.strip("_")
