# Codex Quota Menu Bar (Unofficial)

An unofficial, local-first macOS menu bar utility and Codex Skill for viewing
the remaining five-hour and weekly Codex quotas together with lightweight Mac
CPU and memory-pressure information.

## Preview

<p align="center">
  <img src="codex-quota-menubar/assets/screenshots/codex-quota-dashboard.png" alt="Codex quota and local Mac status dashboard" width="470">
</p>

## Download

<p align="center">
  <a href="https://github.com/ObsidianRelay/codex-quota-menubar-skill/releases/latest/download/CodexQuotaMenuBar-macOS-arm64.zip">
    <img src="https://img.shields.io/badge/Download-macOS%20Apple%20silicon-0A84FF?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download Codex Quota Menu Bar for macOS">
  </a>
</p>

<p align="center">
  macOS 13 or later · Apple silicon (M1 or newer) ·
  <a href="https://github.com/ObsidianRelay/codex-quota-menubar-skill/releases/latest">Release notes and SHA-256</a>
</p>

## Features

- Native AppKit menu bar utility for macOS 13 or newer
- Compact five-hour and weekly remaining percentages from the local Codex App Server
- Weekly-only fallback for accounts without a five-hour quota window
- Weekly reset time, refresh time, remaining-quota progress, and monthly token chart
- Native menu bar highlight while the borderless dashboard is open
- 60-second local CPU history and macOS memory-pressure status
- Borderless dark dashboard with no login item or extra permissions
- Source-only repository with repeatable build and verification scripts

## Privacy

The app starts the locally installed Codex App Server over stdio for each quota
refresh. CPU and memory-pressure samples are read from local macOS APIs. The
utility does not contain API keys, Telegram IDs, account data, logs, or local
configuration, and it does not send Mac status data to an external service.

## Requirements

- macOS 13 or newer
- Apple Command Line Tools (`clang` and `codesign`)
- A locally installed and signed-in Codex app or CLI with App Server support

## Build and verify

```bash
cd codex-quota-menubar
scripts/build_app.sh
scripts/verify_app.sh
open dist/CodexQuotaMenuBar.app
```

`build_app.sh` compiles the Objective-C source, packages the three local image
assets, performs an ad-hoc signature, and runs parser self-tests.
`verify_app.sh` additionally verifies the bundle signature, samples local Mac
status, and performs a real five-hour and weekly quota read. A passing self-test alone does
not prove that the live quota read succeeded.

## Repository contents

```text
codex-quota-menubar/
├── SKILL.md
├── agents/openai.yaml
├── assets/
│   ├── Info.plist
│   ├── icon-codex-dark-color.png
│   ├── icon-codex-light.png
│   ├── icon-fan.png
│   └── screenshots/
│       └── codex-quota-dashboard.png
└── scripts/
    ├── build_app.sh
    ├── verify_app.sh
    └── src/main.m
```

Compiled applications under `dist/` are intentionally excluded from Git. A
GitHub source archive must be built and verified on the destination Mac before
use.

## Unofficial project and trademarks

This is an independent, unofficial project. It is not affiliated with,
endorsed by, or sponsored by OpenAI. OpenAI, Codex, and related marks and brand
assets belong to OpenAI and remain subject to OpenAI's brand guidelines.

## License

MIT for the project code. The license does not grant rights to OpenAI names,
logos, or other brand assets; see the trademark notice in `LICENSE`.
