# Local MAT-v4 result reader scope

WaveWorld reads a bounded subset of uncompressed MATLAB level-4 MAT files used for OpenModelica-style simulation results. The file contents are parsed locally in the browser. Parsing does not contact Dymola or OpenModelica, run a solver, or verify that the values came from a solver; a successful parse establishes structural readability only.

## Required result structure

The result reader requires exactly these six matrices, in this order: `Aclass`, `name`, `description`, `dataInfo`, `data_1`, `data_2`. `Aclass` must be a character matrix with the fixed raw shape 4 × 11. It must identify an `Atrajectory` result, version `1.1`, and layout `binTrans` or `binNormal`.

The reader applies layout per matrix family. Under `binTrans`, it transposes `name`, `description`, and `dataInfo` to interpret metadata rows. Under `binNormal`, it transposes numeric tables `data_1` and `data_2`. Character rows supply each signal's name and description. `dataInfo` has one four-integer row per signal; the reader uses the table selector and signed, one-based row index. Multiple signals may reference one row as aliases; a negative index negates that signal's values. The time entry must be a single positive reference to row 1 of `data_2`.

`data_1` holds parameter values and supports one or two logical columns. `data_2` holds sampled rows, with row 1 supplying sample times. Other references to `data_2` become sampled signals. Values and times must be finite, and time must be nondecreasing. Duplicate adjacent timestamps, including event timestamps, remain in their original order. The reader does not sort or deduplicate samples, or apply the interpolation and extrapolation metadata in `dataInfo`.

## Binary subset and bounds

The MAT-v4 reader accepts one consistent little-endian or big-endian file and column-major matrices. It supports real IEEE float32 and float64 numeric matrices, signed int32 numeric matrices, and text matrices encoded as raw bytes (P=5, T=1) or double-character encoding (P=0, T=1). `dataInfo` must be int32; `data_1` and `data_2` may use float32 or float64; the named text matrices must be text. Complex matrices and unsupported MOPT machine, order, precision, or type combinations are rejected. Payload decoding honors the encoded byte order.

Float32 coverage is validated with authored synthetic matrices for each supported layout and byte order; no OpenModelica or Dymola float32 result artifact was available locally, and no vendor output is claimed for those cases.

Parser ceilings are 16 MiB per file, 2,000,000 stored matrix elements total, and 16 matrices. The result mapping additionally caps output at 10,000 signals, 100,000 samples, and 2,000,000 expanded values across all returned signals. These limits include separate output expansion for aliases.

The scope excludes MATLAB level-5/v5 and v7 files, MATLAB 7.3/HDF5, compressed MAT files, complex values, unsupported MOPT types or layouts, different/missing/additional result matrices, malformed result metadata, and solver execution or verification. This is a local result-file reader, not a general MAT-file implementation, a Dymola project importer/exporter, or a solver API.

## Verification state

The final shared WaveWorld static gates passed: `npx tsc -b` and `npx tsc --noEmit -p tsconfig.app.tests.json`; source hashes were stable across both gates. The WSim Dymola inventory JSON also parsed successfully. No tests, parser execution, browser run, solver, vendor-file comparison, or GPU execution was performed.

## Format references

The [OpenModelica User's Guide MATv4 result format](https://openmodelica.org/doc/OpenModelicaUsersGuide/1.21/technical_details.html#the-matv4-result-file-format) describes the result matrices and their logical meaning. The [MathWorks MAT-File Format specification](https://www.mathworks.com/help/pdf_doc/matlab/matfile_format.pdf) documents level-4 matrix headers, primitive encodings, and byte ordering. OpenModelica's primary [MAT-v4 reader](https://github.com/OpenModelica/OpenModelica/blob/master/OMCompiler/SimulationRuntime/c/util/read_matlab4.c) and [MAT-v4 writer](https://github.com/OpenModelica/OpenModelica/blob/master/OMCompiler/SimulationRuntime/c/util/write_matlab4.c) source were inspected read-only for matrix names, encoded types, Aclass dimensions, and layout handling. The independent [OMSimulator MatReader documentation](https://openmodelica.org/doc/OMSimulator/v2.0.1/OMSimulatorLib/classoms_1_1MatReader.html) also lists the same result matrix family.
