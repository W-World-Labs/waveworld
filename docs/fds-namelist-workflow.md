# FDS namelist review workflow

This workflow accepts one local `.fds` text deck within the UI's configured
file-size limit and rejects it if its serialized inline module input exceeds
1 MiB. The bounded text is submitted to the existing pinned W-Sim native
namelist parser, and the parsed groups are presented for review. It is an
input-format workflow; it does not run Fire Dynamics Simulator.

The job uses module `sw-fds-namelist` and method
`method-fds-namelist-parse`, with the uploaded text passed as the module's
`content` string. The module is present in WaveWorld's pinned W-Sim revision
`dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`. Its host-f64 parser returns a
matching module identity, success flag, method and family IDs, a `groups`
array, `groupCount`, and backend metadata. Each group reports its source order,
name, parsed key/value object, and key count. The parser handles namelist
groups, indexed keys, common numeric and logical forms, quoted strings,
repeat counts, comma-separated values, and `!` comments as implemented at that
pin. It fails closed on empty or malformed decks and unsupported module
parameters or methods. The 1 MiB cap applies to the serialized inline module
input enforced by the existing JobSpec reader; it is not a parser-level limit.

Local lexical improvements are not present in the released native pin above.
Until the released pin changes, the UI rejects known unsupported
whitespace-delimited numeric lists before submission, including forms such as
`XB=0 1 0 1 0 1` and `XYZ=0 0 0`. Comma-separated values accepted by the pinned
parser remain subject to its actual parsing rules. The UI also rejects empty
comma-list slots such as `XB=0,1,0,1,0,1,,`: the released parser discards empty
atoms, which can shift positional values. The local source parser reports those
omitted entries as an admission error, so they remain unsupported until a
released pin includes that behavior.

The submitted module input is the inline
`waveworld-module` JobSpec produced by WaveWorld's existing module-job
builder. It names the module and parse method, sets the module's internal
backend to `host`, and carries the deck in `content`. The JobSpec's native
executor requirement routes the `sw-*` module through the existing
`w-sim-cuda` module runner; `host-f64` describes the parser's reported
calculation backend, not a FDS solver backend.

Before submission, the UI validates the selected file and its bounded text
payload. After completion, it checks that the returned native payload matches
the requested module and method and has the expected successful result shape.
Parser rejection and malformed result data are shown as diagnostics tied to
the submitted input. The review and exports are derived only from this
validated parse result; they do not infer missing FDS defaults or repair the
source deck. JSON is the supported export, containing the validated result and
its submitted-input/job provenance.

Parsing a namelist is not validation by the FDS solver. The workflow does not
launch FDS, solve a fire or smoke case, perform LES, model combustion, validate
mesh or boundary-condition semantics against FDS, or claim numerical,
physical, engineering, or solver parity with NIST FDS. Recognized syntax and
successfully parsed values establish only that this pinned parser accepted
those portions of the text. Static source inspection can confirm the wiring
and declared contract; it cannot establish that the UI upload, job execution,
diagnostics, result validation, or exports work at runtime.
