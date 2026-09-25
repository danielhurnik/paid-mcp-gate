---
id: tpr-fg-cavitation
title: "Cavitation in centrifugal pumps: a 20-minute field checklist"
updated: 2025-11-12
url: https://kb.tarnwick.example/field-guides/cavitation
summary: How to confirm or rule out cavitation at the pump with a pressure gauge, a thermometer and your ears.
---
# Cavitation in centrifugal pumps: a 20-minute field checklist

> Fictional sample content for the paid-mcp-gate demo. Not engineering advice.

## Symptoms that point to cavitation

- A crackling, "pumping gravel" noise near the suction nozzle that gets worse as flow increases.
- Discharge pressure and motor current that fluctuate instead of holding steady.
- Head that falls short of the pump curve at the measured flow.
- On teardown: pitting on the low-pressure side of the impeller vanes, close to the eye.

Suction recirculation can sound similar but behaves differently: it gets worse as flow is *reduced*, and it damages the pressure side of the vanes. If the noise appears at low flow, read the recirculation section of the vibration primer instead.

## The checklist

1. **Find the operating point.** Measure flow and compare it with the best efficiency point (BEP). Cavitation from lack of NPSH is most common to the right of BEP.
2. **Measure suction pressure and liquid temperature** at the suction flange. Convert the pressure to absolute.
3. **Calculate NPSH available**: absolute suction pressure minus the vapour pressure at the measured temperature, converted to head, plus the velocity head.
4. **Compare with NPSH required** from the pump curve at the measured flow. Tarnwick's rule of thumb is a margin ratio (NPSHa / NPSHr) of at least 1.3 for general service and 2.0 for high-energy pumps.
5. **Check the suction strainer.** Read the differential pressure or open it.
6. **Check the suction valve** is fully open and the tank level is above the minimum submergence for the inlet.
7. **Look for air entrainment**: vortices at the tank inlet or leaking suction joints give similar noise but need different fixes.

## What we usually find

In 38% of Tarnwick cavitation call-outs between 2015 and 2024, the cause was a partially blocked suction strainer. A further 21% were caused by a warmer process liquid than the pump was selected for, which raises vapour pressure and quietly consumes the NPSH margin.

## Quick fixes, in order of cost

1. Clean the strainer and open the suction valve fully.
2. Raise the suction tank level or lower the liquid temperature.
3. Throttle the discharge to move the operating point back towards BEP.
4. Longer term: reduce speed, trim the impeller, or re-rate the pump with a lower-NPSHr impeller.
