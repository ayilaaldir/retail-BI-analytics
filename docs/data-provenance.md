# Dataset provenance and publication decision

Evidence reviewed on 2026-11-08.

## Identified source

- Dataset: **Superstore Dataset**
- Kaggle uploader: **Vivek Chowdhury**
- Kaggle URL: <https://www.kaggle.com/datasets/vivek468/superstore-dataset-final>
- Local file: `data/raw/Sample - Superstore.csv`
- SHA-256: `58fb59c63089e564d835e4aabe19d371757de1137a5bf1888243ae386c4b7a97`
- Validated observation period: **2014-01-03 through 2017-12-30**
- Rows: **9,994**

The uploader must not be described as the original data owner. The Kaggle description says the uploader does not own the data, credits the original authors/creators, and links a Tableau community post as the source.

Suggested attribution while the project remains private:

> Dataset downloaded from the “Superstore Dataset” Kaggle listing published by Vivek Chowdhury. The uploader credits the original authors/creators and identifies Tableau community sample data as the source.

## Available license evidence

1. Kaggle's public dataset API reports the license label **“Other (specified in description)”**.
2. The Kaggle description says the data is for educational purposes only, but provides no named license text or explicit permission to redistribute the file or a row-level derivative.
3. The linked [Tableau/Salesforce community post](https://trailhead.salesforce.com/trailblazer-community/feed/0D5KX00000kQPXv0AO) identifies and provides the sample file, but the post itself does not state a data redistribution license.

Public downloadability is evidence of access, not evidence of redistribution rights. “Educational purposes only” describes an intended use but is not a complete license grant. The Kaggle uploader also disclaims ownership, so the uploader cannot be presumed to grant rights held by the original creator.

## Publication decision

**Permission to publish `frontend/public/data/dashboard.json` has not been established.** The current export contains row-level order dates, regions, segments, categories, sales, profit, and order identifiers. Publishing it would redistribute a substantial data derivative rather than merely display a few aggregate findings.

Accordingly:

- `license_verified` remains `false`;
- `redistribution_status` remains `not_established`;
- the browser dataset remains absent and Git-ignored; and
- `python -m retail_bi.pipeline --publish-export` must continue to fail closed.

The code, tests, SQL definitions, documentation, and an empty-state deployment can be published independently, provided no ignored data artifact is added to the deployment.

## Evidence needed to open the gate

Obtain one of the following from the original rights holder or an authoritative source:

- a named license whose terms permit public redistribution and derivative datasets; or
- explicit written permission covering this project's public row-level browser export.

Then record the authoritative HTTPS evidence in `redistribution_permission_url`, set `redistribution_status` to `permitted`, review any attribution/share-alike obligations, and only then set `license_verified` to `true`.

## Safe deployment sequence

For a data-backed public deployment:

1. Obtain and review authoritative redistribution permission as described above.
2. Update `data/source_manifest.json`; preserve the source URL, checksum, observation period, attribution, and evidence trail.
3. Run `.\.venv\Scripts\python.exe -m pytest`.
4. Run `.\.venv\Scripts\python.exe -m retail_bi.pipeline --source "data/raw/Sample - Superstore.csv" --publish-export`. A failure here means publication remains prohibited.
5. Review the generated `frontend/public/data/dashboard.json` for scope, personal information, and compliance with the permission terms.
6. From `frontend`, run `npm run lint`, `npm test`, and `npm run build`.
7. Confirm `dist/data/dashboard.json` exists only when redistribution is permitted, then request explicit approval before any Cloudflare or GitHub publication action.

A code-only deployment may show the publication-safe empty state. Before building it, confirm that `frontend/public/data/dashboard.json` does not exist. Do not delete an existing export without approval; move or preserve it outside the deployment input if required.
