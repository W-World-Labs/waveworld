# AGF Sellmeier 1 material import

The OpticStudio AGF glass catalog format stores one glass per record. Its `NM`
record includes a dispersion formula number and reference values; `CD` carries
formula-dependent coefficients, and `LD` gives the formula's valid wavelength
interval in micrometers. Ansys documents these records and identifies formula
ID `2` as Sellmeier 1 in [The AGF & BGF File Formats](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v252/en/OpticStudio_User_Guide/OpticStudio_Help/topics/The_AGF_BGF_File_Formats.html).

This import path evaluates **formula ID 2 only**. Sellmeier 1 uses

```text
n(λ)² = 1 + Σᵢ Bᵢ λ² / (λ² − Cᵢ),   i = 1..3
```

with wavelength `λ` in micrometers. This is the three-term Sellmeier 1 form
documented by Ansys; fewer terms can be represented by omitting trailing
coefficient pairs. The AGF `CD` values are consumed as adjacent pairs
`B1, C1, B2, C2, B3, C3` and mapped to the native material's `{ B, C }`
coefficient arrays. Ansys's OpticStudio glass example lists the Sellmeier 1
coefficients as K1, L1, K2, L2, K3, L3 in that order.
[Ansys: The Sellmeier 1 Formula](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v25101/en/OpticStudio_User_Guide/OpticStudio_Help/topics/The_Sellmeier_1_Formula.html),
[Ansys: Speos for NX Users Guide, glass catalog example](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/pdf/Speos_for_NX_Users_Guide.pdf)

## Released binary boundary

The active pinned binary is `dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`. That
released binary still admits only wavelengths above every Sellmeier pole:
for each coefficient pair, it requires `λ_um² > Cᵢ`. Consequently, AGF samples
whose valid wavelength is below or at any pole remain blocked by the released
workflow. For example, SCHOTT N-BK7 at `0.5876 µm` remains blocked. Local source
delivery intended to fix this check is a separate state from the pinned binary;
it does not change the capability of that released pin. No release parity,
passing-sample, or deployment claim is made here.

The user selects one wavelength in micrometers. The selected glass must have
`NM` formula ID `2`, a usable `CD` coefficient set, and an `LD` interval; the
selected wavelength is checked against that interval before evaluation. Values
outside the declared interval are rejected rather than extrapolated. The
material calculation runs on the native host path and returns one scalar
refractive index for that wavelength. That scalar is copied into the selected
surface's `LensStudyDraft` as its constant refractive index. The subsequent
lens trace therefore uses a constant index: it does not reevaluate the formula
at ray wavelengths and is not wavelength-dispersive tracing.

Other formula IDs are unsupported for this calculation. The import does not
apply `N(d)`/`V(d)` as dispersion, infer or repair missing coefficients, or
consume other catalog properties such as thermal, mechanical, transmission,
stress-birefringence, melt, substitution, or status data. It does not claim
catalog completeness, compatibility with OpticStudio, or numerical parity with
Ansys or any glass vendor.

## ZMX boundary

ZMX parsing is not implemented. Ansys's [File Types by Extension](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v252/en/OpticStudio_User_Guide/OpticStudio_Help/topics/OpticStudio_File_Types_by_Extension.html)
page identifies ZMX as text containing a complete lens description, including
apertures, wavelengths, prescription data, and merit function, and notes that
new features may not be supported by the format. That page does not publish a
ZMX record grammar or syntax specification sufficient to implement a parser;
the documented scope alone is not a basis for claiming ZMX import or
OpticStudio compatibility.
