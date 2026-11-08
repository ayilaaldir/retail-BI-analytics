from __future__ import annotations

import argparse
import json
from pathlib import Path

from .license import verify_source_manifest
from .pos_analytics import build_pos_dashboard_payload, write_pos_payload
from .pos_validation import load_and_validate_pos, require_valid_pos

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data" / "raw" / "mendeley_pos" / "01_square_item_sales_detail_24mo.csv.gz"


def run(source: Path, manifest: Path, publish_export: bool = False, local_export: bool = False) -> dict:
    frame, report = load_and_validate_pos(source)
    report_path = ROOT / "data" / "reports" / "pos_quality_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    require_valid_pos(frame, report)

    processed = ROOT / "data" / "processed" / "pos_transactions.parquet"
    processed.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(processed, index=False)
    result = {"quality_report": str(report_path), "processed_data": str(processed), "dashboard_export": None}
    if publish_export or local_export:
        if publish_export:
            verify_source_manifest(manifest)
        payload = build_pos_dashboard_payload(processed, ROOT / "sql" / "pos_analysis.sql")
        export = (
            ROOT / "frontend" / "public" / "data" / "dashboard.json"
            if publish_export
            else ROOT / "data" / "local" / "dashboard.json"
        )
        write_pos_payload(payload, export)
        result["dashboard_export"] = str(export)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and prepare the synthetic multi-store POS analytics dataset")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data" / "source_manifest.json")
    export_group = parser.add_mutually_exclusive_group()
    export_group.add_argument("--local-export", action="store_true", help="Write ignored data/local/dashboard.json for Vite development")
    export_group.add_argument("--publish-export", action="store_true", help="Write the CC BY licensed production browser aggregate")
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.manifest, args.publish_export, args.local_export), indent=2))


if __name__ == "__main__":
    main()
