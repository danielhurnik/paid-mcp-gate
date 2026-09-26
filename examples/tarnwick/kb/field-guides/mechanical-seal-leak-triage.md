---
id: tpr-fg-seal-leaks
title: "Mechanical seal leaks: first-hour triage"
updated: 2026-02-03
url: https://kb.tarnwick.example/field-guides/seal-leaks
summary: A decision table for narrowing down why a mechanical seal is leaking before anyone pulls the pump.
---
# Mechanical seal leaks: first-hour triage

> Fictional sample content for the paid-mcp-gate demo. Not engineering advice.

Most seal leaks can be narrowed down to one or two causes in the first hour, without dismantling anything, by answering three questions: *when* does it leak, *how much*, and *what changed*.

## When does it leak?

| Observation | Most likely cause |
| --- | --- |
| Leaks only when the pump is stopped | Secondary seal (O-ring or bellows) damage, or a face that is not closing |
| Leaks while running, worse at higher speed or temperature | Thermal distortion of the faces, or a flush plan that is not cooling |
| Started suddenly after a process upset | Dry running or flashing between the faces |
| Leaks from the first start after a rebuild | Installation error: setting dimension, damaged O-ring, dirty faces |
| Slowly increasing over weeks | Face wear, often from solids or a crystallising product |

## Checks you can do while the pump runs

1. **Flush plan.** Confirm flow in the flush line and compare the seal chamber temperature with the process temperature. A blocked orifice is the single most common finding.
2. **Vibration.** Seals rarely survive long above the site's vibration alarm limit. Check coupling alignment and bearing condition.
3. **Barrier or buffer system** on dual seals: level, pressure and temperature trends in the seal pot tell you whether the inner or the outer seal is failing.
4. **Process conditions.** Low suction pressure or high temperature can make the product flash between the faces.

## What to look for when the seal comes out

- Heat checking or blistering on the faces: dry running or poor cooling.
- Chipped face edges: shaft vibration or excessive endplay.
- Swollen or hardened O-rings: chemical incompatibility or overheating.
- Deposits on the atmospheric side: crystallising product; consider a quench.

Record the answers. Tarnwick's seal MTBF benchmark shows that sites which log the failure mode for every seal replacement reach roughly double the seal life of sites that do not.
