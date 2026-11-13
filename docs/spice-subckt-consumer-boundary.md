# SPICE subcircuit consumer boundary

WaveWorld's SPICE import panel submits decks through `sw-ngspice-netlist`
(`method-ngspice-netlist-to-mna`). The released W-Sim dependency remains pinned
to `dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`; in that revision, the netlist
parser explicitly treats `.subckt` and `.ends` as unsupported directives.
WaveWorld's consumer path therefore does not support subcircuit decks at this
pin.

The current local W-Sim checkout now integrates bounded literal subcircuit
flattening into `sw-ngspice-netlist` itself. That local parser change does not
imply support in WaveWorld's released consumer: the import panel still creates
a `sw-ngspice-netlist` job, and CI/deploy still select the pinned revision
above. Keep the pinned parser's `.subckt` rejection in force until the consumer
pin advances through its authorized release path. No shipped WaveWorld runtime
support is claimed here.

Evidence checked 2026-09-23: `src/components/circuit/SpiceImportPanel.tsx`
routes imports through `createSpiceImportJob`; `src/lib/sim/spice-import-adapter.ts`
sets module `sw-ngspice-netlist` and method `method-ngspice-netlist-to-mna`;
`.gitea/workflows/{ci,deploy}.yml` both set `WSIM_REF` to the pin above; and
the pinned W-Sim `sw_ngspice_netlist.rs` documents `.subckt`/`.ends` as
unsupported directives. The local W-Sim checkout at
`8ba021a9d9c07ea5e38d8fd5e2894def338e75c7` calls
`flatten_literal_subckts` from that same importer; its implementation limits
flattening to literal, parameter-free subcircuits and rejects unsupported
features. No tests, builds, or runtime checks were performed for this
documentation change.
