---
id: tpr-fg-vibration
title: "Reading pump vibration spectra: 1x, 2x and vane-pass"
updated: 2025-09-20
url: https://kb.tarnwick.example/field-guides/vibration
summary: Which peaks in a vibration spectrum point to unbalance, misalignment, looseness, hydraulic problems or bearing damage.
---
# Reading pump vibration spectra: 1x, 2x and vane-pass

> Fictional sample content for the paid-mcp-gate demo. Not engineering advice.

A vibration spectrum tells you *which* mechanism is shaking the pump. Start by identifying running speed (1x) and then read the other peaks as multiples of it.

## The common patterns

- **1x dominant, radial, steady phase**: unbalance. Check for impeller damage, build-up or a lost balance weight.
- **1x and 2x with high axial readings**: misalignment. Check coupling alignment hot and cold; pipe strain is a frequent hidden cause.
- **Many harmonics (1x, 2x, 3x and up)**: mechanical looseness. Check the baseplate bolts, the grout and the bearing fits.
- **Vane-pass frequency** (number of impeller vanes × running speed): hydraulic excitation. High vane-pass usually means the pump runs far from its best efficiency point, or the gap between the impeller and the cutwater is too small.
- **Non-synchronous peaks** matching bearing defect frequencies: rolling-element bearing damage.
- **Broadband noise floor lifting at high frequency**: cavitation or flow turbulence.

## Suction recirculation

At low flow, the liquid at the impeller eye starts to recirculate. The result is random, low-frequency vibration together with noise, and damage on the pressure side of the vanes. The fix is to raise the minimum flow, for example with a bypass line, rather than to add NPSH.

## Variable-speed pumps

With a variable-speed drive, 1x moves through a whole range of frequencies. If vibration rises sharply at one speed and falls again either side of it, suspect a structural resonance rather than a fault in the pump. The failure analysis FA-2023-008 shows how to confirm it.

## Setting alarm levels

Use your site's alarm limits. Many sites base them on the pump-specific parts of the ISO 10816 / ISO 20816 series, and then tighten them after collecting a baseline for each machine.
