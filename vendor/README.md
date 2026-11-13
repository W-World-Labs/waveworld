# Reviewed dependency source packages

`w-xradar-0.2.1.tgz` is a deterministic, unbuilt source package of the public
[W-Radar JS SDK](https://github.com/W-World-Labs/w-radar/tree/579174832c5de9a1b606f82084171b3965deae56/sdk/js/xradar).
It preserves `@w/xradar` 0.2.1, its four source files, package metadata and the
original MIT license. No SDK API, Host/Agent telemetry call or authentication
behavior is removed. This is a checked source package, not a claim of a new npm
release. Archive SHA-256:
`5097c41e0fea35939e98faeef49cf013f69591d9ff5d3abf7452497cdc5b5e31`.

W-Sim source/package provenance remains separately owned by its bundle manifest.

The complete W-Sim library inputs are vendored from public source `f558f268922e498cd235c468ee7044586e23a24b`, successful PUBLIC CI run43466966826. The immutable bundle hash is `e71388a1a39b7f6cac9aaf17579db8e3c28ab627ac199c0f371ad4a681940784`. `w-sim/manifest.json` applies the existing consumer provenance rule by recording each artifact source revision; package bytes remain exactly the double-reviewed producer bundle. CI artifact retention is finite; downstream builds consume these checked-in inputs, not a future download of that temporary artifact.
