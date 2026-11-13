# MATPOWER multi-reference power-flow validation boundary

Local W-Sim source advancement for MATPOWER multi-reference power flow is
separate from WaveWorld's released native pin,
`dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`. WaveWorld must continue to honor
that pin's single-reference admission. Do not submit `case16ci` or `case70da`
payloads to it: the released build is not compatible with those cases.

Sparse-capacity work belongs in the sibling W-Sim source implementation at
`crates/w-sim-cuda/src/module/power_flow.rs`, within the existing
`power_flow` module. This is a source-level solver change; WaveWorld's released
pin and workflow remain unchanged.

Adding native support in the sibling W-Sim checkout does not add a WaveWorld UI
capability. No fixture-level acceptance or execution, PASS claim, deployment,
or pin update occurs in this static-only wave. Source changes alone establish
none of those outcomes. Static source validation does not establish solver,
GPU, performance, or vendor results.

Future fixture validation can start only after an authorized compatible build
and fixture update are available. Until then, keep multi-reference cases out of
the released WaveWorld workflow and preserve its existing pin.
