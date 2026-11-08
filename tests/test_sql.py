from pathlib import Path


def test_analysis_defines_required_views():
    sql = Path("sql/analysis.sql").read_text(encoding="utf-8").lower()
    for view in ("kpi_summary", "monthly_performance", "category_performance", "state_performance", "discount_effectiveness", "loss_drivers"):
        assert f"view {view}" in sql
