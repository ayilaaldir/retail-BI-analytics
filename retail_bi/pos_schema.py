from __future__ import annotations

from .schema import normalize_column

REQUIRED_COLUMNS = {
    "date",
    "time",
    "time_zone",
    "category",
    "item",
    "qty",
    "price_point_name",
    "sku",
    "unit_price",
    "gross_sales",
    "discounts",
    "net_sales",
    "tax",
    "total_collected",
    "transaction_id",
    "payment_method",
    "device_name",
    "location",
    "event_type",
    "unit_cost",
    "gross_profit",
}

OPTIONAL_COLUMNS = {"customer_id"}
DATE_COLUMNS = ["date"]
NUMERIC_COLUMNS = [
    "qty",
    "unit_price",
    "gross_sales",
    "discounts",
    "net_sales",
    "tax",
    "total_collected",
    "unit_cost",
    "gross_profit",
]

__all__ = [
    "DATE_COLUMNS",
    "NUMERIC_COLUMNS",
    "OPTIONAL_COLUMNS",
    "REQUIRED_COLUMNS",
    "normalize_column",
]
