# STAR-CCM+ surface-load workflow

WaveWorld's **Imported surface pressure and shear loads** panel turns a caller-prepared, app-defined face table into a saved native load-integration report. It runs the existing W-Sim module `sw-su2-force-coeffs-b`, with `method: "surface"` and `backend: "host"`, pinned in the released W-Sim source at `dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`. The panel submits a Host job through WaveWorld's module-compute workflow; after success it displays the result and offers a JSON report and a summary CSV.

## Workflow

1. Export or prepare per-face samples yourself, then upload a CSV file or paste its text. The CSV is a WaveWorld input format; it is not produced by STAR-CCM+ automatically.
2. Set the pressure reference, freestream density and speed, reference area and length, dimension, moment origin, angle of attack, and sideslip. Defaults are provided, but use values and coordinate conventions appropriate to the case.
3. Confirm the parsed face count and settings. The panel submits to the backend Host executor; it changes a browser execution target to backend if necessary.
4. On successful completion, inspect the returned forces, moments, and coefficients. Download the JSON report to retain source CSV, parsed rows, settings, submitted native input, and result; download the summary CSV for scalar result fields.

The input is fixed to these columns, in this exact order:

```csv
faceId,areaX_m2,areaY_m2,areaZ_m2,pressure_Pa,shearForceX_N,shearForceY_N,shearForceZ_N,centroidX_m,centroidY_m,centroidZ_m
```

Every data row has eleven finite numeric values. `faceId` is a unique positive safe integer. Area components are an oriented Cartesian area vector in m², pressure is static pressure in Pa, shear-force columns are already integrated Cartesian forces in N, and centroid coordinates are in m. A zero area vector is rejected. The parser accepts an optional UTF-8 BOM, quoted CSV cells with doubled quotes, and LF or CRLF records; bare CR, malformed quoting, extra/missing cells, a different header or header order (including added header whitespace), and empty data are rejected. Numeric cells are trimmed before parsing.

## Bounds and validation

- CSV text is limited to 512 KiB after UTF-8 encoding; the file picker also checks the file's byte size against this limit.
- There must be 1–5,000 face rows. The serialized native input must also be no larger than 1 MiB. If that JSON limit is exceeded, the panel does not enable submission.
- All CSV numeric cells and settings must be finite. `rhoFreestream`, `velocityFreestream`, `refArea`, and `refLength` must be greater than zero. Pressure reference, angle values, moment-origin coordinates, pressure, shear force, and centroid values may be any finite values.
- `dimension` is exactly 2 or 3. In 2D, the UI admits only XY-plane samples: area-Z, shear-force-Z, centroid-Z, and origin-Z must all be zero. The native operation also requires the integrated momentX and momentY to be exactly zero; only the out-of-plane momentZ is supported.
- The app rejects repeated or non-positive face IDs and zero area vectors. W-Sim itself requires a non-empty faces array, required finite `areaX`, `areaY`, `areaZ`, and `pressure` for each face, and accepts optional finite `tauX/Y/Z` and `x/y/z` (defaulting each to zero). Unknown top-level or per-face native parameters are rejected.

These are input bounds, not data-quality or CFD checks. The workflow does not infer units, normals, missing faces, wetted area, pressure reference, shear-force sign, or coefficient references from a STAR-CCM+ project. In particular, the app does not impose positive pressure or component-wise area/force/coordinate ranges. The effective native-input limit can constrain how many rows fit below the CSV row maximum.

## Integration and conventions

For each face (i), the native operation computes pressure force from the pressure difference and oriented area vector:

\[
\mathbf F_{p,i}=-(p_i-p_{ref})\,\mathbf A_i.
\]

WaveWorld performs the subtraction before submission: the CSV `pressure_Pa` is converted to native `pressure = pressure_Pa - pressureReferencePa`. Choose `pressureReferencePa` deliberately. For an open surface, this acts as the assumed pressure on the unrepresented side; a closed surface with consistent oriented area vectors cancels uniform reference pressure in the sum.

The CSV's shear-force components are passed as \(\mathbf F_{v,i}\), already integrated over each face. They are not multiplied by face area. Total force and moment are:

\[
\mathbf F=\sum_i(\mathbf F_{p,i}+\mathbf F_{v,i}),\qquad
\mathbf M_{O}=\sum_i(\mathbf r_i-\mathbf O)\times(\mathbf F_{p,i}+\mathbf F_{v,i}).
\]

`centroidX/Y/Z_m` and `originX/Y/Z` must use the same Cartesian frame and meter units. The origin is `refOriginMoment` (`O`) and the returned moment is about that point. Area-vector orientation determines pressure-force sign; the shear inputs must use the intended force sign in the same frame.

The app uses direct dimensional freestream inputs, with dynamic pressure and force reference:

\[
q_\infty=\tfrac12\rho_\infty V_\infty^2,\qquad F_{ref}=q_\infty S_{ref}.
\]

The native module reports Cartesian force coefficients \(CF_j=F_j/F_{ref}\), moment coefficients \(CM_j=M_j/(F_{ref}L_{ref})\), and rotates force coefficients using the supplied angles in degrees. With (a=\mathrm{aoa}), (b=\mathrm{sideslip}):

\[
\begin{aligned}
2D:\quad CD&=CF_x\cos a+CF_y\sin a,\\
CL&=-CF_x\sin a+CF_y\cos a;\\[2pt]
3D:\quad CD&=CF_x\cos a\cos b+CF_y\sin b+CF_z\sin a\cos b,\\
CL&=-CF_x\sin a+CF_z\cos a,\\
CSF&=-CF_x\sin b\cos a+CF_y\cos b-CF_z\sin b\sin a.
\end{aligned}
\]

The result also exposes `CSide` as an alias of `CSF` and `CEff = CL / (CD + 1e-16)`. `refArea`, `refLength`, freestream state, moment origin, and angles are supplied by the caller; they are not recovered from the imported samples.

## Relationship to Siemens STAR-CCM+

This page documents a WaveWorld import and post-processing workflow around an independent W-Sim calculation. It is not a STAR-CCM+ export schema, `.sim` reader, Siemens API or macro, solver, or vendor-validated reproduction. Names such as “STAR-CCM+” identify the workflow's intended data context only. Do not describe a generated result as a Siemens report or claim numerical equivalence.

The following Siemens-report descriptions are available through third-party mirrors of vendor documentation, not an official Siemens-hosted documentation endpoint: [Force Coefficient report tutorial mirror](https://stevedocs.azurewebsites.net/GUID-CFB04A1C-D081-41F3-BF77-10F5801E0097.html) describes report reference-area setup; [Moment Coefficient report mirror](https://www.tech-doc.cn/wp-content/uploads/Free/StarCCM2406/GUID-3ACC6F86-C092-4876-9BC6-03763E9D0D95.html) describes pressure and shear contributions, moment origin/axis, and reference quantities; [Moment report mirror](https://www.topcfd.cn/Ebook/STARCCMP/GUID-763C13F8-A72E-4632-BE65-5E13B4F280C4.html) discusses face pressure, area vector, and reference pressure. They provide context for familiar report concepts; WaveWorld's schema and equations above are its own explicit conventions.
