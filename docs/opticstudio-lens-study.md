# OpticStudio lens study

The `/opticstudio` page combines the existing native optics cases with a guided,
bounded workflow from a centered prescription to an image-plane spot diagram.
The guided editor builds an input for the existing W-Sim
`lens-design/geometric-ray-trace` operation and submits it as an authenticated
Host job only when the user selects **Trace lens**. It does not add or change a
native operation, selector, or OpenAPI contract.

## Prescription and ray bundle

The editor accepts one to eight plane or spherical surfaces. It records the
radius, clear aperture, gap to the next surface, and refractive index after each
surface. The first vertex is at z = 0; each gap advances the next vertex. The
last surface has zero thickness. Refractive indices are constant, and the
surface editor derives each incoming index from the previous surface's outgoing
index. The image distance is specified separately. Length values are in mm.

The deterministic bundle has a center ray and one to four concentric rings with
four to sixteen spokes per ring, for a maximum of 65 rays. Ray origins lie on a
plane before the first surface. All rays share a forward direction set by the
two field angles. Every sample is equally weighted. This is launch-plane
sampling, not entrance-pupil aiming, irradiance weighting, or a pupil model.

The study uses the native geometric trace input with the `host` backend field:
plane/spherical surfaces, refractive indices, apertures, thicknesses, ray
origins and directions, and image distance. The native operation returns a
per-ray status, optical path length, optional image spot, last position, and
direction, together with valid-spot count, centroid, RMS radius, and backend
provenance. The UI and exports are tied to the submitted input snapshot, even
if the editor is changed after a completed run.

## Results and exports

The scatter plot uses only native-returned successful image spots and gives x
and y the same physical scale in mm. The results also show native centroid and
RMS radius, valid and total ray counts, status counts, backend provenance, and a
per-ray table. Failed-ray last positions are identified as trace termination
positions; they are not treated as image-plane intercepts. No intermediate
surface path is available from this native result, so the UI does not invent or
draw ray paths.

The CSV contains one row per submitted ray, including status, optical path
length, nullable image coordinates, last position, and direction. Missing image
coordinates are empty CSV cells. The JSON report includes the captured draft,
exact native input, returned result, job ID, units, and scope notes. It states
that the study is independent and carries no OpticStudio, GPU, or vendor
validation claim.

If every ray fails or is vignetted, the per-ray outcomes and statuses remain
available, while the valid-spot count is zero and centroid and RMS radius are
null/undefined. In particular, RMS is not reported as zero: no spots do not
describe a perfect image.

## Bounded AGF reference-index import

The guided editor can import glass entries from text AGF catalog files. It reads
the `NM` record's name, dispersion-formula identifier, `N(d)`, and `V(d)`, and
retains those values alongside catalog metadata for reference. The editor maps
the selected glass's `N(d)` to its constant scalar refractive index, using the
d-line reference wavelength of 0.5875618 µm. It does not evaluate `CD` formula
coefficients or `LD` wavelength limits, model dispersion, or run wavelength
sweeps. This is a bounded catalog-reference import: it does not import native
ZMX lens files or claim OpticStudio compatibility. The AGF/BGF record structure
and catalog fields are documented by Ansys in [The AGF & BGF File Formats](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v252/en/OpticStudio_User_Guide/OpticStudio_Help/topics/The_AGF_BGF_File_Formats.html)
and [Description of Catalog Data](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v252/en/OpticStudio_User_Guide/OpticStudio_Help/topics/Description_of_Catalog_Data.html).
Ansys documents d-light at 0.5875618 µm in [Using Model Glasses](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v252/en/OpticStudio_User_Guide/OpticStudio_Help/topics/Using_Model_Glasses.html).
The reader accepts UTF-8/ASCII text (including one leading UTF-8 byte-order mark)
and rejects other or invalid encodings; Ansys's format description does not
specify a character encoding.
No browser validation, optical solver validation, or parity validation is
claimed for this import.

The AGF source passed the two static gates `npx tsc -b` and
`npx tsc --noEmit -p tsconfig.app.tests.json`; source hashes were stable across
both gates. Authored tests and parser execution remain unrun, as do browser,
solver, benchmark, vendor, and GPU validation.

## Capability boundary and verification

This workflow closes part of the inventory gap against the OpticStudio Lens
Data Editor (LDE): it provides a small guided centered prescription, launches a
native geometric trace, and presents a spot result. It is not a full OpticStudio
product and does not claim product parity. It does not include native ZMX import,
aspheres, decenter or tilt, coatings, reflections, dispersion or wavelength
modeling, diffraction, ray aiming, optimization, Monte Carlo analysis, or a full
parity suite.

Static checks passed: project TypeScript builds, app-test TypeScript checking,
focused lens-study E2E TypeScript checking, Host typecheck, and native Rust
`cargo check --tests --locked`. Tests themselves remain deferred. No browser
run, solver run, benchmark, GPU execution, deployment, or vendor validation is
claimed here. The native check used empty fat-bin stubs because `nvcc` was
absent; it provides no GPU evidence.
