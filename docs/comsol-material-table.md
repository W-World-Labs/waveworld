# Temperature-dependent material table workflow

WaveWorld's COMSOL study page can import a small local CSV file, select one
temperature-dependent property, and evaluate it through the existing W-Sim
native task path. This is a WaveWorld table workflow that follows the general
idea of temperature-dependent material properties and interpolation functions
documented by COMSOL; it is not COMSOL's proprietary importer or a COMSOL
execution path.

## CSV format and limits

The app accepts an app-defined two-column CSV with one exact header pair. For
thermal conductivity:

```csv
temperature_K,conductivity_W_per_mK
250,12.5
300,14
```

For specific heat capacity, use `temperature_K,specific_heat_J_per_kgK` as the
header. Each data row has one temperature and one positive property value.
Temperatures are positive absolute values in kelvin and must be strictly
ascending. Values must be finite and positive. The file is limited to 128 KiB
and 1,000 data rows. The workflow requires at least two rows so interpolation
is defined. It accepts comma-separated numeric fields and ordinary LF, CRLF, or
CR line endings; a leading UTF-8 BOM is ignored. This is a narrow CSV reader,
not a general CSV dialect: extra columns, quoted cells, comments, and other
property headers are not supported. The file's property header must match the
property kind selected in the form.

The supported properties and units are:

| Property | CSV column | Unit | Meaning |
| --- | --- | --- | --- |
| Thermal conductivity | `conductivity_W_per_mK` | W/(m·K) | User-supplied scalar material property versus temperature |
| Specific heat capacity | `specific_heat_J_per_kgK` | J/(kg·K) | User-supplied scalar material property versus temperature |

The evaluation temperature is a finite positive absolute temperature in K.
The workflow does not perform unit conversion or infer a material identity.

## Interpolation and extrapolation

Choose either piecewise linear interpolation or shape-preserving piecewise
cubic Hermite interpolation (PCHIP). Linear interpolation joins each adjacent
pair of table samples with a straight segment. PCHIP uses local cubic pieces
whose slopes are selected to preserve the shape of the tabulated data and avoid
spurious overshoot on monotone data; it is not a general polynomial fit.
These options select the existing W-Sim methods `method-algo-piecewise-linear`
and `method-algo-piecewise-cubic` respectively. COMSOL documents linear and
shape-preserving piecewise-cubic interpolation for its own interpolation
functions, but this workflow's PCHIP method is the W-Sim implementation and
does not claim numerical equivalence with COMSOL.

Choose the out-of-range policy explicitly:

- **Constant** holds the nearest endpoint value outside the tabulated
  temperature range.
- **Linear** extends the nearest end segment using its endpoint slope.

The selected policy applies below the first and above the last temperature.
Linear extension can produce values outside the range represented by the
source data; the workflow does not treat extrapolated values as new measured
material data.

## Native task, result, and provenance

Submitting the form captures the property kind and meaning, unit, original
temperature/value knots, evaluation temperature, interpolation and
extrapolation selections, and source CSV text in one input snapshot. The
transport submits the existing native task with the allowed operation fields
(`module`, `method`, `temps`, `values`, `temperature`, and `extrapolation`);
UI and provenance metadata remain attached to the captured submission
snapshot. The page does not implement a second interpolation or solver path.

The displayed output comes from the native result: interpolated property value,
its temperature derivative, evaluation temperature, selected method, and the
original knots. The export is a JSON snapshot for this WaveWorld workflow. It
preserves the input and result context; it is not a COMSOL material file or
interchange format.

## Scope

The table represents one user-supplied scalar property as a function of
temperature. It does not look up a material database, identify or certify a
material, combine multiple properties, fit source data, or derive enthalpy.
This workflow does not read or write `.mph` files, invoke COMSOL, or claim
behavioral or numerical parity with COMSOL. COMSOL references below provide
background on interpolated functions and material-property temperature
dependence only; they do not validate this implementation.

## Sources

- [COMSOL Multiphysics Reference Manual: Interpolation](https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_definitions.21.063.html) — official reference for table-backed interpolation functions and interpolation/extrapolation choices.
- [COMSOL Material Library User's Guide: Available Material Properties](https://doc.comsol.com/6.3/doc/com.comsol.help.matlib/matlib_ug_using.3.32.html) — official list of temperature-argument thermal conductivity and heat capacity properties and their SI units.
- F. N. Fritsch and R. E. Carlson, [Monotone Piecewise Cubic Interpolation](https://doi.org/10.1137/0717021), *SIAM Journal on Numerical Analysis* 17(2), 238–246 (1980) — primary reference for monotone piecewise-cubic interpolation.
