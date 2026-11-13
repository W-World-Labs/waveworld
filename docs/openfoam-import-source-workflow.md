# OpenFOAM dictionary import source workflow

The local `@w-sim/openfoam-import` package source accepts a case as a
`FoamCaseFiles` map from case-relative paths to UTF-8 text. Call
`parseFoamCase(files)` to produce its case IR; supported mappers can then turn
that IR into a W-Sim JobSpec. The importer parses supplied text only and never
starts an OpenFOAM solver.

The package source resolves quoted, case-local `#include` and
`#includeIfPresent` directives in place. A missing required include is an
error. A missing optional include is skipped. For a small source example, see
[`packages/openfoam-import/fixtures/optional-includes.json`](../../20-15-w-sim/packages/openfoam-import/fixtures/optional-includes.json).
Resolution is bounded to depth 16, 128 distinct targets, and 4 MiB of expanded
text, and reads only the caller-supplied map. `#includeEtc`, function entries,
macro or environment substitution, and other general OpenFOAM preprocessing
remain unsupported.

WaveWorld Lab has a separate browser-side reader in
`apps/lab/src/lib/openfoam/parse-case.ts`. That reader uses regular expressions
and does not consume the W-Sim package or preprocess includes. It has no
full OpenFOAM dictionary grammar validator, so it cannot reliably diagnose
arbitrary malformed included dictionary text. The Lab panel catches errors
thrown during reading or parsing, but that catch does not make the regex
parser a safe general dictionary preprocessor. This document describes local
package source behavior only; it does not establish Lab UI, deployed,
pinned-version, or full CFD solver support.

Mesh topology, mapped time-varying boundary data, curved edges, snappy meshes,
and multi-region CHT remain outside the package's current single-region job
mapping. A parsed case is not evidence that the corresponding OpenFOAM solver
case can run in W-Sim.
