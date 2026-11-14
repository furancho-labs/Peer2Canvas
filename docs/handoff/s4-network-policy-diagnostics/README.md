# S4 Windows network-policy diagnostics

This temporary branch collects a short, read-only Windows check after the first same-Wi-Fi attempt returned `peer-ice-failed` on Mac and `host-unreachable` on Windows.

- Base: `dev` at `3f29497`.
- Scope: inspect Windows network profile and existing firewall rules only.
- No peer retry, firewall/router change, TURN setup, source-code edit, or session code belongs in this branch.
- Windows Codex appends its concise findings to `windows-report.md`; Mac Codex reads them and tells the user the next step.
- The branch diff must remain Markdown-only. The user operates both app windows.
