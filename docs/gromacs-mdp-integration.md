# GROMACS `.mdp` preview boundary

WaveWorld's MD page mounts `GromacsMdpPreview` alongside the existing `.gro` preview. The MDP panel submits `{ module: "sw-gromacs-inputdeck", backend: "host", mdp }` through the existing module JobSpec and Host settlement flow. It displays a bounded setup summary and retains the exact source text for download. This is an MDP-only preview; it does not create a `.tpr`, validate all MDP options against a GROMACS release, or run molecular dynamics.

## Pinned operation and schema

Both `.gitea/workflows/ci.yml` and `.gitea/workflows/deploy.yml` pin W-Sim at `dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`. That revision contains the host-f64 `sw-gromacs-inputdeck` operation in `crates/w-sim-cuda/src/module/sw_gromacs_inputdeck.rs`. With an MDP-only request, its result provides `files.mdp` (`nEntries`, `cppDirectives`, `duplicateKeys`, `integrator`, `dtPs`, `nsteps`, `tinitPs`, and selected `outputKeys`) and `runPlan` (`integrator`, timing values, `totalTimePs`, nullable `natoms`, and output cadence/frame estimates). The reader accepts `key = value` lines, strips semicolon comments, skips `#` directives, and parses the selected numeric run-control fields. Other options are not semantically validated.

At the immutable pin, repeated keys increment `duplicateKeys` and the last occurrence wins, even when values conflict. The local W-Sim source has a newer duplicate policy that rejects conflicting values, but that change is not in the pinned workflow revision. Until a future authorized pin advance, WaveWorld's local preflight must reject conflicting case-insensitive duplicate inputs before dispatching to the old pinned operation. Identical duplicate values may still be counted and submitted.

## Host lifecycle and bounds

The panel checks login, constructs and validates the shared module JobSpec, then calls `runRemoteJob`: Host submission returns a job ID, the client polls status serially, and a succeeded result is decoded and checked before rendering. If the user cancels or edits/unmounts the panel during work, the `AbortController` stops local polling; `runRemoteJob` sends the Host cancel request for an acknowledged non-terminal job. Host remains responsible for execution and terminal settlement; the panel only accepts a result after the Host reports success. A 512 KiB `.mdp` intake cap applies, and the shared module-input validator also enforces the 1 MiB serialized inline Host limit.

## Release boundary

The local W-Sim source change and WaveWorld UI source are workspace edits only. They have not been released or deployed. The deployed consumer remains governed by the workflow pin above; the duplicate-conflict rejection is a local UI admission rule that prevents conflicting input from reaching that older parser. Advancing the W-Sim pin requires its own authorization and coordinated release decision.
