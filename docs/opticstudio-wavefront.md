# OpticStudio sampled wavefront fit

WaveWorld's `/opticstudio` page can fit caller-supplied pupil samples with the
existing W-Sim `zernike` operation, selected by `operation: "weighted-fit"`
and `backend: "host"`. This is a bounded sampled-data workflow. It does not
call OpticStudio, trace rays, sample a pupil, or read a native OpticStudio
project or export file.

## Sample CSV

The upload is an app-defined CSV with this exact header:

```csv
rho,thetaRadians,wavefront,weight
```

Each following row is one sample: normalized pupil radius `rho` in `[0, 1]`,
polar angle `thetaRadians`, wavefront value, and positive sample weight. The
wavefront values must use one consistent unit; the fitter does not assign or
convert units. The caller supplies the samples and weights. WaveWorld does not
infer quadrature weights, sample locations, pupil mapping, or wavefront values
from an optical model. There is no ray trace, chief-ray reference, subaperture
transform, or annular-pupil fit in this workflow.

The native request allows 1–4096 rows, with at least as many rows as selected
terms. `terms` is an integer from 1 to 10. Native admission requires finite
values, absolute wavefront values no greater than `10¹²`, `thetaRadians` in
`[-2π, 2π]`, and weights in `(0, 10¹²]`; a rank-deficient fit fails closed.
The CSV is a WaveWorld input contract only. It is
not a reader for proprietary or raw OpticStudio exports. The coefficient
references below do not specify such an export format, so no vendor-export
parser is claimed.

## Fit and returned result

The request uses `module: "zernike"`, `operation: "weighted-fit"`,
`backend: "host"`, the selected `terms`, and the parsed rows in `samples` as
`[rho, theta, wavefront, weight]` tuples. The existing native implementation
fits the first `terms` orthonormal unit-disk OSA/ANSI modes. Its zero-based
index `j=0` is piston; indices advance by radial order, with negative `m`
(sine), then `m=0`, then positive `m` (cosine) within each order. The returned
array is **not** an OpticStudio Noll-numbered coefficient vector and the
workflow does not convert to Fringe coefficients.

The result reports `coefficients`, `weightedRmsResidual`, `terms`,
`indexing`, `normalization`, `methodId`, and backend provenance
(`backend.id: "host-f64"`). The residual is computed on the supplied samples:

```text
sqrt(Σ weightᵢ (wavefrontᵢ − fitᵢ)² / Σ weightᵢ)
```

It therefore describes weighted fit error for this input set; it is not a
vendor residual or a measure of an independently sampled pupil.

The result export is JSON. It is a WaveWorld report carrying local format and
schema/version metadata, the exact submitted native input, the validated
native result, a job ID when returned, and bounded-scope/provenance notes. It
does not add a CSV coefficient-vector export or change the native result
contract.

## Dependency and evidence boundary

WaveWorld's CI and deploy workflow files currently set `WSIM_REF` to
`dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`. That pin records the source
dependency selected by those build workflows. A configured source pin alone
does not validate a released or deployed binary, establish runtime behavior,
or demonstrate numerical agreement with OpticStudio. No vendor equivalence or
vendor-run result is claimed. This app workflow adds no native operation,
changes no CPU/GPU behavior, and makes no API/OpenAPI contract change.

The catalog cites Ansys's [Zernike Standard Coefficients](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v251/en/OpticStudio_User_Guide/OpticStudio_Help/topics/Zernike_Standard_Coefficients.html)
and [Zernike Fringe Coefficients](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v251/en/OpticStudio_User_Guide/OpticStudio_Help/topics/Zernike_Fringe_Coefficients.html)
pages as coefficient references. The app's fit follows the OSA/ANSI ordering
reported by the native operation; those references are not evidence of a
WaveWorld-to-OpticStudio result match or of a supported OpticStudio file
format.
