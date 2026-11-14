# Windows diagnostic result

Status: complete.

- Network profile: `Public`, IPv4 connectivity `Internet`. This Windows category does not show whether the Wi-Fi is a guest network or isolates clients; no such evidence was available from this check.
- Firewall profiles: Domain, Private, and Public are enabled. Default inbound and outbound actions report `NotConfigured`, so no effective fallback action is inferred.
- Inbound application rules: an enabled `Allow` rule for `msedgewebview2.exe` applies to profile `Any`, protocol `UDP`, local port `5353`. No explicit inbound application rule matched `peer-canvas.exe`. This rule does not establish the peer WebRTC path.
- Commands run: `Get-NetConnectionProfile | Select-Object NetworkCategory,IPv4Connectivity`; `Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction`; read-only active application-filter query for `peer-canvas.exe` and `msedgewebview2.exe`.
- No firewall or router settings changed, and no peer connection was attempted.
