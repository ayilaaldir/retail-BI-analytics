import pandas as pd
import pytest

from retail_bi.pos_validation import PosDataValidationError, load_and_validate_pos, require_valid_pos


def valid_payment() -> dict:
    return {
        "Date": "2024-01-10", "Time": "10:30", "Time Zone": "CST", "Category": "Apparel",
        "Item": "Synthetic Shirt", "Qty": 2, "Price Point Name": "M", "SKU": "SQ-TEST",
        "Unit Price": 10.0, "Gross Sales": 20.0, "Discounts": -2.0, "Net Sales": 18.0,
        "Tax": 1.49, "Total Collected": 19.49, "Transaction ID": "TXN-TEST",
        "Payment Method": "Card", "Device Name": "Register 1", "Location": "Store 01 - Test",
        "Customer ID": None, "Event Type": "Payment", "Unit Cost": 4.0, "Gross Profit": 10.0,
    }


def write_csv(tmp_path, rows):
    path = tmp_path / "pos.csv.gz"
    pd.DataFrame(rows).to_csv(path, index=False, compression="gzip")
    return path


def test_valid_pos_shape_and_optional_customer_id_pass(tmp_path):
    frame, report = load_and_validate_pos(write_csv(tmp_path, [valid_payment()]))
    assert report.valid
    assert len(require_valid_pos(frame, report)) == 1
    assert report.metrics["net_sales"] == 18.0
    assert report.metrics["customer_identifier_rows"] == 0


def test_missing_required_pos_column_fails(tmp_path):
    row = valid_payment()
    del row["Gross Profit"]
    _, report = load_and_validate_pos(write_csv(tmp_path, [row]))
    with pytest.raises(PosDataValidationError, match="Missing required columns: gross_profit"):
        require_valid_pos(pd.DataFrame(), report)


def test_accounting_identity_failure_is_rejected(tmp_path):
    row = valid_payment()
    row["Net Sales"] = 19.0
    _, report = load_and_validate_pos(write_csv(tmp_path, [row]))
    assert any("net_sales = gross_sales + discounts" in error for error in report.errors)


def test_refund_requires_negative_quantity(tmp_path):
    row = valid_payment()
    row.update({"Event Type": "Refund", "Qty": 1})
    _, report = load_and_validate_pos(write_csv(tmp_path, [row]))
    assert "Refund rows must have negative qty" in report.errors
