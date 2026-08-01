# Microsoft Edge WebView2 Evergreen Bootstrapper

`MicrosoftEdgeWebview2Setup.exe` is the official online Evergreen bootstrapper
embedded in `FluxoraSetup.exe`. It is used only when the native pre-WebView
check reports that the Microsoft WebView2 Runtime is unavailable and the user
confirms the Microsoft download.

- Official source: `https://go.microsoft.com/fwlink/p/?LinkId=2124703`
- Retrieved: 2026-07-31
- Size: 1,691,856 bytes
- SHA-256: `0223fa1e8d5bd5e4344fb8734e60d088e79f262c0a24444d01f240bc996f04e5`
- Authenticode status at retrieval: valid
- Signer subject: `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`
- Signer certificate thumbprint: `4028CAD637509D4744B17EC5B42AED8D7A31E6AF`

Microsoft documents both packaging the Evergreen bootstrapper with an
application and invoking it as `MicrosoftEdgeWebview2Setup.exe /silent
/install`. The bootstrapper downloads the architecture-appropriate Evergreen
Runtime from Microsoft. This means Setup without an existing WebView2 Runtime
still requires network access after the user confirms; an offline Fluxora
installation remains supported when WebView2 is already present.

Redistribution and deployment references:

- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options

Do not replace this binary without updating `source.json`, rechecking its
SHA-256 value, and verifying a valid Microsoft Authenticode signature. Release
builds fail closed on any mismatch.
