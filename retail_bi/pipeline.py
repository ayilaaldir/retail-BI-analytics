from __future__ import annotations

import argparse
import json
from pathlib import Path

from .analytics import build_dashboard_payload, write_payload
from .license import verify_source_manifest
from .validation import load_and_validate, require_valid

ROOT = Path(__file__).resolve().parents[1]


def run(source: Path, manifest: Path, publish_export: bool = False, local_export: bool = False) -> dict:
    frame, report = load_and_validate(source)
    report_path = ROOT / "data" / "reports" / "quality_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    require_valid(frame, report)

    processed = ROOT / "data" / "processed" / "superstore.parquet"
    processed.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(processed, index=False)
    result = {"quality_report": str(report_path), "processed_data": str(processed), "dashboard_export": None}
    if publish_export or local_export:
        if publish_export:
            verify_source_manifest(manifest)
        payload = build_dashboard_payload(processed, ROOT / "sql" / "analysis.sql")
        export = (
            ROOT / "frontend" / "public" / "data" / "dashboard.json"
            if publish_export
            else ROOT / "data" / "local" / "dashboard.json"
        )
        write_payload(payload, export)
        result["dashboard_export"] = str(export)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and prepare the Superstore analytics dataset")
    parser.add_argument("--source", type=Path, default=ROOT / "data" / "raw" / "superstore.csv")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data" / "source_manifest.json")
    export_group = parser.add_mutually_exclusive_group()
    export_group.add_argument("--local-export", action="store_true", help="Write ignored data/local/dashboard.json for the Vite development server only")
    export_group.add_argument("--publish-export", action="store_true", help="Export browser data; requires verified redistribution permission")
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.manifest, args.publish_export, args.local_export), indent=2))


if __name__ == "__main__":
    main()
