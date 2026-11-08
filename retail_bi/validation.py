from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from .schema import DATE_COLUMNS, NUMERIC_COLUMNS, REQUIRED_COLUMNS, normalize_column


class DataValidationError(ValueError):
    """Raised when source data cannot safely enter the analytics layer."""


@dataclass
class QualityReport:
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


def load_and_validate(path: str | Path) -> tuple[pd.DataFrame, QualityReport]:
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"Dataset not found: {source}")
    try:
        frame = pd.read_csv(source, encoding="utf-8-sig")
    except UnicodeDecodeError:
        frame = pd.read_csv(source, encoding="latin-1")
    frame.columns = [normalize_column(column) for column in frame.columns]
    report = QualityReport(str(source), len(frame), len(frame.columns))

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

    required_nulls = frame[list(REQUIRED_COLUMNS)].isna().sum()
    null_counts = {key: int(value) for key, value in required_nulls.items() if value}
    if null_counts:
        report.errors.append(f"Required fields contain nulls: {null_counts}")

    duplicate_row_ids = int(frame["row_id"].duplicated().sum())
    duplicate_lines = int(frame.duplicated(subset=["order_id", "product_id", "sales", "quantity", "profit"]).sum())
    if duplicate_row_ids:
        report.errors.append(f"row_id is not unique ({duplicate_row_ids} duplicates)")
    if duplicate_lines:
        report.warnings.append(f"Found {duplicate_lines} potentially duplicated order lines")
    if (frame["ship_date"] < frame["order_date"]).any():
        report.errors.append("ship_date precedes order_date")
    if (frame["sales"] < 0).any():
        report.errors.append("sales contains negative values")
    if (frame["quantity"] <= 0).any():
        report.errors.append("quantity must be greater than zero")
    if ((frame["discount"] < 0) | (frame["discount"] > 1)).any():
        report.errors.append("discount must be between 0 and 1")

    report.metrics = {
        "duplicate_row_ids": duplicate_row_ids,
        "potential_duplicate_lines": duplicate_lines,
        "loss_making_rows": int((frame["profit"] < 0).sum()),
        "min_order_date": frame["order_date"].min().date().isoformat() if frame["order_date"].notna().any() else None,
        "max_order_date": frame["order_date"].max().date().isoformat() if frame["order_date"].notna().any() else None,
        "total_sales": float(frame["sales"].sum()),
        "total_profit": float(frame["profit"].sum()),
    }
    return frame, report


def require_valid(frame: pd.DataFrame, report: QualityReport) -> pd.DataFrame:
    if not report.valid:
        raise DataValidationError("; ".join(report.errors))
    return frame
