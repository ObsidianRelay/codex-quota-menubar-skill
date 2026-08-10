---
name: codex-quota-menubar
description: Build, run, verify, and troubleshoot the local macOS Codex weekly-quota menu bar app. Use when Codex needs to compile the bundled AppKit utility, check the real weekly quota, start or stop the menu bar display, verify its signature and packaged icons, or repair it after an App Server protocol change.
---

# Codex Quota Menu Bar

## Overview

Maintain a local menu bar utility that shows the real Codex icon followed by the remaining weekly percentage. Clicking it opens one borderless dark dashboard that keeps quota and local Mac status visually connected. Keep the utility self-contained inside this Skill and never modify ChatGPT.app or a pet package.

## Build

Run:

    scripts/build_app.sh

The build script compiles Objective-C with the installed Command Line Tools, packages both Codex icon variants, ad-hoc signs the App, and runs parser self-tests.

## Verify

Run:

    scripts/verify_app.sh

Require all of these checks to pass before treating the App as complete:

- Skill validation.
- App bundle plist validation and code-signature verification.
- Parser self-tests for a weekly window, by-limit-id response, non-weekly rejection, and empty-data rejection.
- A local system sample that prints total CPU, system CPU, and memory-pressure state.
- A live quota read that prints only the weekly remaining percentage and reset timestamp.

## Run

Start the menu bar utility:

    open dist/CodexQuotaMenuBar.app

The menu bar entry uses variable system width, a native Codex image, and a native percentage title. Clicking it toggles a transparent borderless `NSPanel`; do not replace it with `NSMenu`, because the system menu window adds an unavoidable outer frame. The upper section contains the real weekly quota, reset/check times, progress bar, and monthly token chart. The lower section contains a 60-second CPU chart, a visual fan beside the CPU label, and memory pressure. Do not add a login item unless the user explicitly requests it.

Keep the stable bundle identifier `local.codex.quota.menubar.v3`. Do not reuse the retired `local.codex.quota.menubar` or `local.codex.quota.menubar.v2` identifiers: macOS 26 cached those identities with conflicting status-item positions.

## Data Rules

- Launch the local Codex App Server with stdio transport for each refresh.
- Request account/rateLimits/read and accept only a primary window whose duration is 10080 minutes.
- Calculate remaining percentage as 100 minus usedPercent.
- Refresh at launch, whenever the panel opens, and every three minutes.
- Show an em dash and “暂时无法读取” on any failure. Never substitute sample, stale, 15-minute, or one-hour data.
- Use the bundled dark and light Codex icon assets; do not read icons from ChatGPT.app at runtime.
- Let AppKit choose the status-item width and position. Never write private `NSStatusItem Preferred Position` preference keys or change the positions and visibility of other menu bar items.

## Local Status Rules

- Read CPU and virtual-memory statistics from local Mach APIs; do not request extra permissions or send this data over the network.
- Sample CPU and memory pressure once per second only while the dashboard is open, and stop the sampler when it closes.
- Draw total CPU in blue and system CPU in red using at most 60 recent samples.
- Place the small fan immediately after the CPU label. Its visual rotation rises with CPU load and runs only while the dashboard is open; it does not read or control the physical Mac fan.
- Show memory pressure as `正常`, `注意`, or `紧张` with a green-yellow-red gauge. Do not show memory GB or a fabricated percentage.
- Keep quota colors meaningful: high remaining is green, then orange, yellow, and red as the quota falls.

## Repair

After a Codex update, run the verification script first. If the live read fails while self-tests pass, inspect the current App Server schema before changing the request or response parser.
