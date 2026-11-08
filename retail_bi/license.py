from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse


class LicenseVerificationError(ValueError):
    """Raised when source provenance is not sufficient for a publishable export."""


def verify_source_manifest(path: str | Path) -> dict:
    manifest_path = Path(path)
    if not manifest_path.is_file():
        raise LicenseVerificationError(f"Source manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    required = [
        "dataset_name",
        "source_url",
        "license_name",
        "license_url",
        "license_verified",
        "redistribution_status",
        "verified_at",
    ]
    missing = [field for field in required if field not in manifest or manifest[field] in (None, "")]
    if missing:
        raise LicenseVerificationError(f"Source manifest is incomplete: {', '.join(missing)}")
    for field in ("source_url", "license_url"):
        parsed = urlparse(manifest[field])
        if parsed.scheme != "https" or not parsed.netloc:
            raise LicenseVerificationError(f"{field} must be an HTTPS URL")
    if manifest["license_verified"] is not True:
        raise LicenseVerificationError("license_verified must be true before a public dashboard export")
    if manifest["redistribution_status"] != "permitted":
        raise LicenseVerificationError("redistribution_status must be permitted before a public dashboard export")
    permission_url = manifest.get("redistribution_permission_url", "")
    parsed_permission = urlparse(permission_url)
    if parsed_permission.scheme != "https" or not parsed_permission.netloc:
        raise LicenseVerificationError("redistribution_permission_url must identify authoritative HTTPS evidence")
    return manifest
