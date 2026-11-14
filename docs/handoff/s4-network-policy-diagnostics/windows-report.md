# Windows diagnostic result

Status: complete.

- Network profile: `Public`, IPv4 connectivity `Internet`.
- Firewall profiles: Domain, Private, and Public are enabled. Default inbound and outbound actions report `NotConfigured`, so no effective fallback action is inferred.
- Inbound application rules: an enabled `Allow` rule for `msedgewebview2.exe` applies to all profiles. No explicit inbound application rule matched `peer-canvas.exe`.
- Commands run: `Get-NetConnectionProfile | Select-Object NetworkCategory,IPv4Connectivity`; `Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction`; read-only active application-filter query for `peer-canvas.exe` and `msedgewebview2.exe`.
- No firewall or router settings changed. No peer connection was attempted.
