# CST Touchstone S11 workflow boundary

The `/cst` page adds a file-to-analysis path for measured or otherwise supplied
Touchstone S-parameter data. The file is parsed locally for preview; analysis is
an explicit, authenticated Host job against the existing W-Sim native operation
`module: "vswr"`, `operation: "cst-s11-vswr-sweep"`. The submitted job contains
the frequency samples and complex S11 values only. Two-port files retain the
Touchstone ordering S11, S21, S12, S22, but the workflow analyzes S11 only.
Returned values and backend provenance are presented in a table, a selected
VSWR or return-loss plot, and CSV.

The import is a deliberately bounded Touchstone 1.0 subset plus an explicit
Touchstone 2.0/2.1 keyword subset; it is not a general Touchstone reader. It
accepts `.s1p` through `.s8p` files (extension case-insensitive), up to 512 KiB
and 4096 frequency records. Text is ASCII (tabs and CR, LF, or CRLF endings are
accepted), with blank lines, `!` comments, and an optional leading BOM.

For Touchstone 1.0, exactly one explicit option line must precede data. It
specifies a frequency unit (`Hz`, `kHz`, `MHz`, or `GHz`), parameter `S`, data
format (`RI`, `MA`, or `DB`), and positive finite `R` reference impedance; no
defaults are assumed. Every point contains a frequency plus the complete
`ports × ports` matrix: one complex pair for 1-port, four for 2-port, and
`ports²` for 3- through 8-port files. A complex value is two numbers in the
selected format, so each complete point has `1 + 2 × ports²` numeric values.
One- and two-port records can continue across physical lines. For three- and
four-port files, the frequency line contains the complete first matrix row,
followed by one physical line per remaining row. For five or more ports, each
matrix row starts on a physical line, contains at most four complex pairs per
line, and may continue on subsequent lines; only the first line has the
frequency.

Touchstone 2.0/2.1 is accepted only with this envelope: `[Version] 2.0` or
`[Version] 2.1` as the first non-comment content; one explicit `#` option line;
`[Number of Ports] N`; optional metadata; `[Network Data]`; exactly `F`
complete network records; and final `[End]`. `[Number of Frequencies] F` is
required metadata. `[Two-Port Data Order]` is required only when `N` is 2 and
forbidden otherwise. `[Reference]` and `[Matrix Format]` are optional. These
metadata keywords may appear in any relative order after `[Number of Ports]`
and before `[Network Data]`. Keyword spelling is case-insensitive. `N` is 1
through 8. For `.sNp` filenames, `N` must match the extension; `.ts` files are
accepted only for Touchstone 2.x and take `N` from the required header. `F`
must match the record count. The option line has the same required unit, `S`,
format, and positive finite `R` value as Touchstone 1.0. If `[Reference]` is
present, it must give exactly `N` positive finite real values in port order;
these per-port references override option-line `R`. If it is absent, the
positive real option-line `R` is used for every port. The importer retains the
ordered reference list, including when all values are equal. `[Matrix Format]`
may be omitted (meaning `Full`) or specify `Full`, `Lower`, or `Upper`. Full
matrix pairs use row-major order for
all port counts: `S11, S12, …, S1N, S21, …, SNN`. For two-port full data,
`21_12` means `S11, S21, S12, S22`, while `12_21` means `S11, S12, S21, S22`.
The one-port matrix contains only `S11`. Every matrix value is parsed and
validated, but the analysis extracts S11 only.

For `Lower` and `Upper`, each record contains only the triangle, listed row by
row. `Lower` gives `S11; S21, S22; S31, S32, S33; …`; `Upper` gives
`S11, S12, …, S1N; S22, S23, …, S2N; …; SNN`. The importer expands either
triangle into the full canonical row-major matrix and assumes symmetry by
copying each off-diagonal value to its transposed position. It does not
validate reciprocity. For two ports, triangular input has diagonal entries
`S11, S22` and one off-diagonal value (`S21` for `Lower`, `S12` for `Upper`);
`[Two-Port Data Order]` does not change this triangular row order. After
expansion, both forms use canonical `S11, S12, S21, S22` order internally.
The `21_12` / `12_21` setting describes full two-port data and does not reorder
triangular input. After expansion, two-port values use the existing flat order
`S11, S21, S12, S22`; three- and higher-port values use row-major order.

Other Touchstone 2.x sections or keywords, reordered, duplicate, missing, or
unknown keywords, additional/late option lines, unsupported option tokens,
Y/Z/H/G parameters, noise records, mixed-mode declarations, and malformed or
partial records fail closed. Frequencies
must convert to positive Hz and be strictly increasing. Inputs that parse but
have `|S11| >= 1` are rejected by the S11 analysis. That action does not analyze
S21 or any other matrix entry. For S11, it uses port 1's positive real
reference. It does not renormalize S-parameters; the ordered reference
metadata from the file is retained and displayed. It does not perform de-embedding,
passivity certification, noise or mixed-mode analysis, or general/full-network
analysis.

## Complete-network native re-export (1–4 ports)

The parser retains the complete S matrix at each frequency. The `/cst` page
now exposes two separate actions: **Analyze S11** submits the existing
`vswr` job and calculates VSWR, return loss, and reflected power; **Export
complete network** submits the entire matrix to the W-Sim native module
`sw-ansys-touchstone` at the pinned W-Sim revision
`dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`, validates the returned Touchstone
text, and offers the `.sNp` file for download. Export serializes the matrix; it
does not calculate full-network metrics. Both are separate authenticated Host
jobs, and neither invokes the CST solver. The export controls initialize the
frequency unit and format from the imported network; users can change either
output setting before exporting. The native Touchstone v1 emitter accepts one
reference for the whole network. Export therefore uses the common value for
uniform per-port references and fails closed when the imported references are
nonuniform. It does not renormalize the network. An app JSON snapshot can
preserve the ordered per-port reference metadata, including nonuniform values.

For each parsed point, pass `frequencyHz` unchanged in the `freqs` array (the
emitter expects Hz), and pass all matrix values in `sweep`. Set `ports` from
`network.ports`, `param: "S"`, and the unchanged common `ref` for a
uniform-reference network. The
importer has already decoded RI, MA, or DB input into finite `[real, imag]`
pairs; convert each pair to the emitter's `{ "re": real, "im": imag }` complex
object (or a real number when the imaginary part is zero). Choose `format` as
`RI` (real, imaginary), `MA` (magnitude, angle in degrees), or `DB` (20 log10
magnitude in dB, angle in degrees). This changes number formatting, not the
network reference or underlying S data. `freqUnit` chooses the output unit
(`HZ`, `KHZ`, `MHZ`, or `GHZ`); frequencies are scaled from the Hz values for
output. The UI sets `backend: "host"` and `method: "touchstone"`, and omits
`title`, so the native emitter uses its default comment
`w-sim touchstone export`. A representative native request has this shape:

```json
{
  "module": "sw-ansys-touchstone",
  "backend": "host",
  "method": "touchstone",
  "ports": 2,
  "freqUnit": "GHZ",
  "param": "S",
  "format": "RI",
  "ref": 50,
  "freqs": [1000000000],
  "sweep": [
    [{"re": 0.1, "im": 0.0}, {"re": 0.2, "im": 0.0}],
    [{"re": 0.3, "im": 0.0}, {"re": 0.4, "im": 0.0}]
  ]
}
```

This example assumes the imported file declares `50` for both ports; in
general, native export requires uniform imported references, and `ref` must be
their common value.

Build each sweep entry as a square matrix of complex objects. The parser stores
1-port S11 as its sole pair. For 2-port input it normalizes both Touchstone
`21_12` and `12_21` encodings to the flat order `[S11, S21, S12, S22]`; reshape
that to `[[S11, S12], [S21, S22]]` for the emitter. For 3- and 4-port input,
the parser's flat values are already row-major (`S11, S12, …, S1N, S21, …,
SNN`); split them into N consecutive rows. The emitter writes 2-port values in
Touchstone order `S11, S21, S12, S22` (column-major), and emits each 3- or
4-port matrix row on its own data line. Passing 2-port values as two rows
without reordering would exchange S12 and S21.

The exporter accepts only 1–4 ports, parameters S/Y/Z, and RI/MA/DB. Since this
importer supplies S data, use `param: "S"`; selecting Y or Z labels the supplied
numbers and does not convert them. The exporter emits Touchstone v1 text, even
if a selector spelling mentions v2. It requires a positive finite reference,
strictly increasing positive finite Hz frequencies, and one complete matrix
per frequency; the native emitter itself caps output at 65,536 points. That is
not the end-to-end import→export limit: imported input is limited to 4,096
records and 512 KiB. The WaveWorld adapter also enforces a matrix-element
budget of `points × ports² ≤ 8,192`; this gives maximum point counts of 4,096
for 1-port, 2,048 for 2-port, 910 for 3-port, and 512 for 4-port networks.
These counts are in addition to the 512 KiB size bound: WaveWorld validates
emitted Touchstone text with the existing 512 KiB and 4,096-record parser
bounds, so output exceeding either is rejected even when it is within the
adapter budget or the native emitter's 65,536-point cap. The native result
contains the emitted text in `touchstone`. A zero-valued entry cannot be
rendered as DB because its logarithmic magnitude is negative infinity; choose
RI or MA for such data. MA gives a zero phasor an angle of zero degrees.

Re-export preserves numerical network data subject to decimal formatting, not
the original byte stream or exact decimal spellings. The emitter formats
numeric fields to ten significant decimal digits, so parsing and writing may
round values and cannot promise exact decimal identity. It writes a title
comment, one `# <unit> <parameter> <format> R <reference>` option line, then
frequency/data records; it does not reproduce original comments, whitespace,
Touchstone 2.x keywords, or line wrapping. It does not renormalize the imported
network, de-embed, or run the CST solver. The importer's existing
metadata, matrix, and file-validity limits still apply before export. Inputs
with 5–8 ports remain importable for S11 analysis but cannot be exported by
this module.

The native result supplies the metrics. An ideal match (`|S11| = 0`) has
infinite VSWR and positive-infinite return loss mathematically; the result
contract represents ideal-match return loss as `null`, and the UI/CSV label it
as `Infinity`/ideal match rather than treating it as missing data or zero.
Infinite points are omitted from the finite return-loss plot and gaps are not
joined. No RF metrics are calculated in the browser. This workflow is not a
full CST Studio Suite implementation, CST file reader, full Touchstone-standard
implementation, GPU path, or vendor-parity claim.

The implementation is local to WaveWorld: parser
`src/lib/sim/touchstone.ts`, W-Sim job adapter and result reader
`src/lib/sim/touchstone-vswr.ts`, CSV helper
`src/lib/sim/touchstone-vswr-export.ts`, import panel
`src/components/circuit/TouchstoneImportPanel.tsx`, result view
`src/components/circuit/TouchstoneVswrResults.tsx`, and the `/cst` page
`src/pages/Cst.tsx`. The adapter uses the existing exact module/operation
selector pair; no OpenAPI or external selector-version change is expected.

Verification status: the final frozen static gates passed: `npx tsc -b` and
`npx tsc --noEmit -p tsconfig.app.tests.json`. The CST inventory and dataset
manifest JSON parsed, and both synthetic Touchstone 2.x fixture byte counts and
SHA-256 hashes matched the manifest. Unit and browser tests, E2E checks, solver,
GPU, and vendor execution were not run. The existing exact API selector is
unchanged, no OpenAPI version change was needed, and the pinned native revision
is unchanged. Local source delivery does not claim a formal or production
shipment, full-standard CST compatibility, a CST solver run, or GPU parity. The
compact fixture represents test input only; its analytically expected values
are not external numerical validation. Synthetic Touchstone 2.x fixtures are
authored parser inputs, not vendor oracles and not external numerical
validation.

References: [IBIS Touchstone 2.1 specification](https://www.ibis.org/touchstone_ver2.1/touchstone_ver2_1.pdf)
(including §§ 4.3.5–4.3.7 on `[Matrix Format]`, `[Two-Port Data Order]`, and
network data ordering, as well as its Touchstone 1.0 rules), [CST Studio Suite](https://www.3ds.com/products/simulia/cst-studio-suite),
[SIMULIA workflow integration](https://www.3ds.com/products/simulia/cst-studio-suite/workflow-integration),
and [SIMULIA electromagnetic simulation](https://www.3ds.com/products/simulia/idem).
