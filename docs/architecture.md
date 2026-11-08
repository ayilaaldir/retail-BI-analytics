# Architecture

```text
Mendeley POS CSV.gz (local, ignored)
  -> Pandas POS schema, accounting, and quality validation
  -> Parquet analytical layer (local, ignored)
  -> DuckDB POS SQL views
  -> Disclosure-controlled aggregate views (max 3 filters, minimum 10 transactions)
  -> Local-only JSON export in data/local/ (ignored, Vite dev server only)
  -> OR CC BY 4.0-gated public JSON export (reviewed before commit)
  -> React + Recharts dashboard
  -> Cloudflare Pages dist/
```

The pipeline separates data quality from presentation. A failed validation never replaces the last valid export. The Vite middleware serving `/__local/dashboard.json` is registered only for `vite serve`; production code looks only for `/data/dashboard.json`. Static deployment keeps the portfolio inexpensive and fast, while the source archive, identifiers, and local analytical files stay outside Git.
