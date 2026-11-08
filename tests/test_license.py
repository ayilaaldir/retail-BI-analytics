import json

import pytest

from retail_bi.license import LicenseVerificationError, verify_source_manifest


def test_unverified_manifest_is_rejected(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({
        "dataset_name": "Synthetic test manifest",
        "source_url": "https://example.com/dataset",
        "license_name": "Test only",
        "license_url": "https://example.com/license",
        "license_verified": False,
        "redistribution_status": "not_established",
        "verified_at": "2026-01-01",
    }), encoding="utf-8")
    with pytest.raises(LicenseVerificationError, match="must be true"):
        verify_source_manifest(path)


def test_permission_requires_authoritative_url(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({
        "dataset_name": "Synthetic test manifest",
        "source_url": "https://example.com/dataset",
        "license_name": "Test only",
        "license_url": "https://example.com/license",
        "license_verified": True,
        "redistribution_status": "permitted",
        "redistribution_permission_url": "",
        "verified_at": "2026-01-01",
    }), encoding="utf-8")
    with pytest.raises(LicenseVerificationError, match="authoritative HTTPS evidence"):
        verify_source_manifest(path)
