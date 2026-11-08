# Python environment note

The project virtual environment at `.venv` was created with Microsoft Store Python 3.13.14. Its `pyvenv.cfg` points to the packaged interpreter under the user's WindowsApps registration.

The Codex restricted process token can read the virtual-environment launcher but cannot execute the base interpreter in `C:\Program Files\WindowsApps`; that produces an access-denied or “file cannot be accessed” launcher error. This is a sandbox boundary, not virtual-environment corruption.

Verification outside that restricted token confirmed:

```text
Python 3.13.14
D:\Projects\portofolio-dashboard\.venv\Scripts\python.exe
```

No environment was deleted or recreated. The project requirements were installed into the existing `.venv` only. Use the explicit interpreter in Windows terminals and VS Code tasks:

```powershell
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m retail_bi.pipeline --source "data/raw/Sample - Superstore.csv"
```

Avoid relying on the bare `python` command in this machine configuration: the current PATH resolves it to a separate Python 3.11 installation.
