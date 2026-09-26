---
id: tpr-fa-2023-008
title: "FA-2023-008: Structural resonance after a VFD retrofit on a vertical pump"
updated: 2025-08-08
url: https://kb.tarnwick.example/failure-analyses/fa-2023-008
summary: Vibration on a vertical cooling-water pump jumped after a variable-speed drive retrofit, but only at some speeds. How the cause was confirmed and fixed without losing the energy savings.
---
# FA-2023-008: Structural resonance after a VFD retrofit on a vertical pump

> Fictional sample content for the paid-mcp-gate demo. Not engineering advice.

## Situation

A vertical turbine cooling-water pump with a 4-pole motor (about 1,480 rpm at full speed on a 50 Hz supply) was retrofitted with a variable frequency drive (VFD) to save energy. Soon after, operators reported severe vibration at the top of the motor, but only at some speeds.

## Evidence

- Vibration at the motor's top bearing reached 11 mm/s RMS at 78% speed, against about 2 mm/s at full speed.
- The vibration was almost entirely at 1x running speed, and it peaked sharply around 19–20 Hz.
- A bump test on the stopped pump found a natural frequency of the motor and discharge head of about 19.5 Hz.
- Before the retrofit, the pump only ran at full speed (about 24.7 Hz), comfortably away from that natural frequency.

## Root cause

Vertical pumps are tall and flexible, so the natural frequency of the motor and discharge head is often close to running speed. The VFD made the pump spend hours at speeds where 1x running speed matched that natural frequency. At resonance, even a normal amount of unbalance produces large vibration.

## Corrective actions

1. Short term: programmed a skip band of 18.5–20.5 Hz into the VFD so that the drive never dwells in the resonant range.
2. Permanent: stiffened the motor stand with gussets, which raised the natural frequency to about 27 Hz, above the maximum running speed.
3. Removed the skip band after a second bump test confirmed the new natural frequency.

## Outcome

Vibration fell to about 2.1 mm/s across the whole speed range, and the VFD energy savings were kept.

## Lesson

Bump-test every vertical pump before a VFD retrofit, and compare the natural frequencies with the full planned speed range, not just full speed.
