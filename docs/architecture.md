# Architecture

```text
Kaggle CSV (local, ignored)
  -> Pandas schema and quality validation
  -> Parquet analytical layer (local, ignored)
  -> DuckDB SQL views
  -> Local-only JSON export in data/local/ (ignored, Vite dev server only)
  -> OR license-gated public JSON export (ignored, requires permission)
  -> React + Recharts dashboard
  -> Cloudflare Pages dist/
```

The pipeline separates data quality from presentation. A failed validation never replaces the last valid export. The Vite middleware serving `/__local/dashboard.json` is registered only for `vite serve`; production code looks only for `/data/dashboard.json`. Static deployment keeps the portfolio inexpensive and fast, while source and local derived files stay outside Git until redistribution rights are confirmed.
