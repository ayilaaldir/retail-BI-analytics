from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from .pos_schema import DATE_COLUMNS, NUMERIC_COLUMNS, REQUIRED_COLUMNS, normalize_column


class PosDataValidationError(ValueError):
    """Raised when the synthetic POS data cannot enter the analytics layer."""


@dataclass
class PosQualityReport:
    source: str
    row_count: int
    column_count: int
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {"valid": self.valid, **asdict(self)}


def _identity_failures(left: pd.Series, right: pd.Series, tolerance: float = 0.011) -> int:
    return int((left.sub(right).abs() > tolerance).sum())


def load_and_validate_pos(path: str | Path) -> tuple[pd.DataFrame, PosQualityReport]:
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"Dataset not found: {source}")
    frame = pd.read_csv(source, encoding="utf-8-sig", low_memory=False)
    frame.columns = [normalize_column(column) for column in frame.columns]
    report = PosQualityReport(str(source), len(frame), len(frame.columns))

    missing = sorted(REQUIRED_COLUMNS - set(frame.columns))
    if missing:
        report.errors.append(f"Missing required columns: {', '.join(missing)}")
        return frame, report
    if frame.empty:
        report.errors.append("Dataset contains no rows")
        return frame, report

    for column in DATE_COLUMNS:
        original = frame[column]
        frame[column] = pd.to_datetime(original, errors="coerce")
        invalid = int(frame[column].isna().sum() - original.isna().sum())
        if invalid:
            report.errors.append(f"{column} contains {invalid} unparseable values")

    for column in NUMERIC_COLUMNS:
        original = frame[column]
        frame[column] = pd.to_numeric(original, errors="coerce")
        invalid = int(frame[column].isna().sum() - original.isna().sum())
        if invalid:
            report.errors.append(f"{column} contains {invalid} non-numeric values")

    null_counts = frame[list(REQUIRED_COLUMNS)].isna().sum()
    required_nulls = {key: int(value) for key, value in null_counts.items() if value}
    if required_nulls:
        report.errors.append(f"Required fields contain nulls: {required_nulls}")

    if not frame["event_type"].isin(["Payment", "Refund"]).all():
        report.errors.append("event_type must contain only Payment or Refund")
    payments = frame["event_type"].eq("Payment")
    refunds = frame["event_type"].eq("Refund")
    if (frame.loc[payments, "qty"] <= 0).any():
        report.errors.append("Payment rows must have positive qty")
    if (frame.loc[refunds, "qty"] >= 0).any():
        report.errors.append("Refund rows must have negative qty")
    if (frame["unit_price"] < 0).any() or (frame["unit_cost"] < 0).any():
        report.errors.append("unit_price and unit_cost must be non-negative")
    if (frame["discounts"] > 0).any():
        report.errors.append("discounts must be zero or negative")

    identities = {
        "gross_sales = unit_price * qty": _identity_failures(frame["gross_sales"], frame["unit_price"] * frame["qty"]),
        "net_sales = gross_sales + discounts": _identity_failures(frame["net_sales"], frame["gross_sales"] + frame["discounts"]),
        "total_collected = net_sales + tax": _identity_failures(frame["total_collected"], frame["net_sales"] + frame["tax"]),
        "gross_profit = net_sales - unit_cost * qty": _identity_failures(frame["gross_profit"], frame["net_sales"] - frame["unit_cost"] * frame["qty"]),
    }
    for identity, failures in identities.items():
        if failures:
            report.errors.append(f"Accounting identity failed for {failures} rows: {identity}")

    duplicate_rows = int(frame.duplicated().sum())
    if duplicate_rows:
        report.warnings.append(f"Found {duplicate_rows} exact duplicate rows")

    net_sales = float(frame["net_sales"].sum())
    gross_profit = float(frame["gross_profit"].sum())
    report.metrics = {
        "exact_duplicate_rows": duplicate_rows,
        "payment_rows": int(payments.sum()),
        "refund_rows": int(refunds.sum()),
        "transactions": int(frame["transaction_id"].nunique()),
        "locations": int(frame["location"].nunique()),
        "categories": int(frame["category"].nunique()),
        "min_date": frame["date"].min().date().isoformat() if frame["date"].notna().any() else None,
        "max_date": frame["date"].max().date().isoformat() if frame["date"].notna().any() else None,
        "net_sales": net_sales,
        "gross_profit": gross_profit,
        "gross_margin": gross_profit / net_sales if net_sales else 0,
        "refund_net_sales": float(frame.loc[refunds, "net_sales"].sum()),
        "discounts": float(frame["discounts"].sum()),
        "customer_identifier_rows": int(frame.get("customer_id", pd.Series(dtype="object")).notna().sum()),
        "accounting_identity_failures": identities,
    }
    return frame, report


def require_valid_pos(frame: pd.DataFrame, report: PosQualityReport) -> pd.DataFrame:
    if not report.valid:
        raise PosDataValidationError("; ".join(report.errors))
    return frame
