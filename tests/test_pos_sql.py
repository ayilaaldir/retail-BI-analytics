from pathlib import Path


def test_pos_analysis_defines_dataset_specific_views():
    sql = Path("sql/pos_analysis.sql").read_text(encoding="utf-8").lower()
    for view in (
        "kpi_summary",
        "monthly_performance",
        "category_performance",
        "location_performance",
        "discount_effectiveness",
        "refund_summary",
    ):
        assert f"view {view}" in sql
