# Cantera NASA species thermo workflow

WaveWorld's COMSOL page (`/comsol`) includes a prepared-record panel for one
NASA7 or NASA9 species. It evaluates the selected species' standard-state
thermo properties through the existing W-Sim native `sw-cantera-nasa-poly`
operation. It is not a Cantera file loader or a COMSOL integration.

## Prepared input

Import JSON, not raw YAML. A prepared record has this shape:

```json
{
  "name": "ALCL3",
  "model": "nasa9",
  "temperature-ranges": [200, 1000, 6000],
  "data": [
    [77506.0097, -1440.779717, 14.01744141, -0.00638163124, 5.87167472e-6, -2.908872278e-9, 5.99405089e-13, -65793.4318, -44.94017799],
    [-137863.0916, -55.7920729, 10.04190387, -1.682165339e-5, 3.72466466e-9, -4.27552678e-13, 1.982341329e-17, -73434.0747, -20.45130429]
  ],
  "source": { "file": "Cantera test/data/nasa9-test.yaml", "species": "ALCL3" }
}
```

The source species must match `name`. NASA7 uses 7-value coefficient rows and
two or three increasing bounds; NASA9 uses 9-value rows, one for each
neighboring pair of bounds. The prepared-record form accepts NASA7's one- or
two-region forms and NASA9's multiple regions, subject to the panel's 64 KiB
JSON limit and temperature bounds. The page validates structure and finite
numbers before submission; it does not parse or verify the cited source file.

## Native request and result

After choosing one temperature within the selected species' full range, the
page builds a one-species, one-temperature request. For the ALCL3 example at
900 K, its envelope is:

```json
{
  "module": "sw-cantera-nasa-poly",
  "backend": "host",
  "model": "nasa9",
  "T": [900],
  "species": [{
    "name": "ALCL3",
    "temperature-ranges": [200, 1000, 6000],
    "data": [
      [77506.0097, -1440.779717, 14.01744141, -0.00638163124, 5.87167472e-6, -2.908872278e-9, 5.99405089e-13, -65793.4318, -44.94017799],
      [-137863.0916, -55.7920729, 10.04190387, -1.682165339e-5, 3.72466466e-9, -4.27552678e-13, 1.982341329e-17, -73434.0747, -20.45130429]
    ]
  }]
}
```

This is sent as the module parameters of a `waveworld-module` JobSpec;
the existing Host job path dispatches the native module with the `host`
backend. The pinned module accepts NASA9 multi-region rows and selects the
upper region at an exact internal breakpoint. The response reports module,
method, backend and species metadata, plus one evaluation per requested
temperature. Each evaluation includes its selected `region`/`rangeName`,
`cpOverR`, `hOverRT`, `sOverR`, dimensional `cp`, `h`, `s`, and `gOverRT`.
The page checks the returned module/model, species, ranges, temperature,
region count, and finite property values against the submitted request before
displaying a result.

## Sign-in and export

Submitting requires a signed-in WaveWorld user. The page uses the stored user
session as a Bearer token for the existing Host API, verifies the user session,
then submits and polls the native job through the shared settlement client.
When signed out, use the page's sign-in link and return to the workflow; do not
use an agent token as a user credential. Job failures and mismatched results
are surfaced instead of being shown as successful evaluations.

The result export is a JSON snapshot containing source file/species metadata,
the original prepared JSON text, selected temperature, exact submitted native
input, Host job ID, and native result. It is a provenance bundle for this
single evaluation, not a hash-verified source archive or a full mechanism
export. Preserve and cite the original Cantera source independently when
byte-level traceability is required.

This workflow submits exactly one species and one temperature per job. It
does not load phases, reactions, mixtures, transport properties, full
mechanisms, or raw Cantera YAML/CHEMKIN files; it does not run a Cantera
reactor or claim numerical parity with Cantera.
