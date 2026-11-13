# Dymola / MSL `#1` text tables

This note describes the plain-text table format documented by the Modelica
Standard Library (MSL), and how a file-backed one-dimensional CombiTable block
selects a matrix from such a file. It documents syntax and table layout only;
it does not define simulation-time behavior.

## Text-file layout

The file begins with the format marker `#1`. After it, each matrix consists of
a declaration giving its numeric type, name, and dimensions, followed by the
matrix values in row-wise order. For a five-row, two-column table named `tab1`:

```text
#1
double tab1(5,2) # x and y
0  0
1  1
2  4
3  9
4 16
```

The declaration has the documented shape `double name(rows,columns)` or
`float name(rows,columns)`. Dimensions are the actual matrix dimensions. In a
one-dimensional lookup table, column 1 contains the grid (abscissa) values;
the remaining columns contain values to interpolate. MSL requires the grid
values to be strictly increasing.

The text-format rules documented by MSL are:

- The first two file characters are `#1`. MSL also documents that an optional
  UTF-8 byte-order mark at the start of the file is ignored.
- Matrix values are a sequence of numbers in row-wise order. A row may span
  multiple lines, and line breaks need not coincide with row boundaries.
- Numbers use C syntax; documented examples include `2.3`, `-2`, and `+2.e4`.
- Values can be separated by spaces, tabs, commas, or semicolons.
- Line comments begin with `#` and may occur throughout the file. Multiple
  named matrices may appear one after another.
- A matrix name is ASCII and may not contain blanks, line breaks, tabs, commas,
  or parentheses.
- Text is ASCII or UTF-8. UTF-8 characters are allowed only in line comments.
  Characters outside the described matrix data and comments are not allowed.

The MSL documentation describes the accepted elements above but does not
publish a complete formal lexer or grammar. In particular, do not infer support
for extra declaration types, quoted values, labels, units, or arbitrary
trailing text. This is a numeric matrix format rather than a general-purpose
delimited text format.

## File-backed CombiTable mapping

For MSL 3.2.3, `Modelica.Blocks.Tables.CombiTable1D` is the one-dimensional
block with *n* inputs and *n* outputs. Its `columns` parameter selects which
matrix columns supply outputs: for example, `columns={2,4}` maps input 1 to
table column 2 and input 2 to table column 4. The first matrix column remains
the shared grid. The block's documented file-backed settings are
`tableOnFile=true`, `fileName` set to the text file, and `tableName` set to the
declared matrix name. For example, the declaration above is selected with
`tableName="tab1"`.

In MSL 4.x, the one-input, multiple-output block is named
`Modelica.Blocks.Tables.CombiTable1Ds`; its `columns` parameter maps each
output to a selected data column in the same way. The MSL 4.1 table docs list
text files among its file-backed sources. Check the installed MSL version and
block name when applying this mapping in a model.

This note covers the `#1` text-file matrix format and the matrix-to-block
selection mapping. It makes no claim about another table block's runtime,
timing, or event behavior.

## Sources

- [MSL 3.2.3 `Modelica.Blocks.Tables` documentation (Dymola help)](https://doc.modelica.org/Modelica%203.2.3/Resources/helpDymola/Modelica_Blocks_Tables.html) — defines `CombiTable1D`, its `columns` mapping, file parameters, and the `#1` format.
- [MSL 4.1.0 `Modelica.Blocks.Tables` documentation (Dymola help)](https://doc.modelica.org/Modelica%204.1.0/Resources/helpDymola/Modelica_Blocks_Tables.html) — documents `CombiTable1Ds` and the current text-format details, including matrix-name restrictions and encoding.
