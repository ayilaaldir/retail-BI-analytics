from __future__ import annotations

import pandas as pd
import pytest

from retail_bi.validation import DataValidationError, load_and_validate, require_valid


def valid_row() -> dict:
    return {
        "Row ID": 1,
        "Order ID": "TEST-1",
        "Order Date": "2024-01-10",
        "Ship Date": "2024-01-12",
        "Ship Mode": "Standard",
        "Customer ID": "C-1",
        "Customer Name": "Synthetic Customer",
        "Segment": "Consumer",
        "Country": "Test Country",
        "City": "Test City",
        "State": "Test State",
        "Postal Code": 10000,
        "Region": "Test Region",
        "Product ID": "P-1",
        "Category": "Test Category",
        "Sub-Category": "Test Subcategory",
        "Product Name": "Synthetic Product",
        "Sales": 100.0,
        "Quantity": 2,
        "Discount": 0.1,
        "Profit": 20.0,
    }


def write_csv(tmp_path, rows):
    path = tmp_path / "fixture.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def test_valid_superstore_shape_passes(tmp_path):
    frame, report = load_and_validate(write_csv(tmp_path, [valid_row()]))
    assert report.valid
    assert len(require_valid(frame, report)) == 1
    assert report.metrics["total_sales"] == 100.0


def test_missing_required_column_fails(tmp_path):
    row = valid_row()
    del row["Profit"]
    _, report = load_and_validate(write_csv(tmp_path, [row]))
    with pytest.raises(DataValidationError, match="Missing required columns: profit"):
        require_valid(pd.DataFrame(), report)


@pytest.mark.parametrize(
    ("column", "value", "message"),
    [("Sales", -1, "negative"), ("Quantity", 0, "greater than zero"), ("Discount", 1.2, "between 0 and 1")],
)
def test_invalid_business_constraints_fail(tmp_path, column, value, message):
    row = valid_row()
    row[column] = value
    _, report = load_and_validate(write_csv(tmp_path, [row]))
    assert not report.valid
    assert any(message in error for error in report.errors)


def test_ship_date_cannot_precede_order_date(tmp_path):
    row = valid_row()
    row["Ship Date"] = "2024-01-01"
    _, report = load_and_validate(write_csv(tmp_path, [row]))
    assert "ship_date precedes order_date" in report.errors
