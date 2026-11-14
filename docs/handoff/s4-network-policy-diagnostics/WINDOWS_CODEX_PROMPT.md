# Prompt for Windows Codex

Read the active Windows `AGENTS.md`, the PeerCanvas project memory index, repository `AGENTS.md`, `PLANS.md`, `docs/handoff/windows-s4-network-test.md`, and this directory's README and report template. Refresh `dev` and issue #37 without discarding local work.

The current evidence is: both PCs were on the same Wi-Fi; Mac reports `peer-ice-failed`; Windows reports `host-unreachable`; both gathered `host` and `srflx` candidates, with no active peer link. The Mac application firewall is disabled. The user wants help in chat and will operate the UI.

Inspect Windows read-only:

```powershell
Get-NetConnectionProfile | Select-Object NetworkCategory, IPv4Connectivity
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
```

Also check whether an existing inbound allow/block rule applies to the PeerCanvas/Tauri test executable or WebView2. Report whether this is confirmed, absent, or unknown. Do not change firewall settings, router settings, install software, configure TURN, enter a session code, or retry the connection.

Append a concise answer (120 words or fewer) to `windows-report.md`, with commands actually run and only the requested result. Do not include the Wi-Fi name, IP addresses, user paths, session code, SDP, or raw ICE candidates. Commit and push only that Markdown file on `feature/s4-network-policy-diagnostics`. Reply to the user in simple Spanish with the finding and wait for the next instruction.
