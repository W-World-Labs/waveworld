# LAMMPS import workflows

WaveWorld currently exposes a **data-file** workflow for the particle module.
In the MD page, load the bundled LAMMPS 2D snapshot or choose a local data/JSON
file, inspect the imported geometry, then apply it to the model editor. That
path reads atom data and maps it into the existing 2D shifted-Lennard-Jones
model; it does not interpret an input script.

W-Sim has a separate source-script importer, `@w-sim/lammps-import`. Its local
parser accepts a bounded command subset and returns diagnostics plus a
`md-batch` JobSpec when the complete deck fits that subset. For example, a
package consumer can pass the script and any bundled `read_data` files:

```ts
import { importLammpsScript } from '@w-sim/lammps-import'

const result = importLammpsScript(scriptText, {
  'data.lj': dataFileText,
}, 'in.lammps')

if (!result.ok || !result.spec) {
  throw new Error(result.diagnostics.map((item) => `${item.path}: ${item.message}`).join('\n'))
}

const jobSpec = result.spec
```

The local equal-variable parser evaluates literal `+`, `-`, `*`, and `/` with
parentheses and ordinary arithmetic precedence after the existing constant
variable substitutions. It bounds the source expression to 1,024 characters,
64 tokens, 16 nested parenthesis levels, and 15 multiplication operators. It
rejects division by zero, non-finite results, functions, exponentiation,
dynamic/unbound references, and unsupported commands. This source update does
not change WaveWorld's released W-Sim package pin. LAMMPS documents its full
equal-style formula language in the [variable command reference](https://docs.lammps.org/variable.html);
the local parser deliberately supports only the arithmetic subset listed here.

**Source-script UI seam:** WaveWorld does not currently depend on
`@w-sim/lammps-import` or offer an input-script upload/review flow. The snippet
above is the package API workflow for an integrating consumer; WaveWorld's MD
page still uses its separate data-file importer. A product integration would
need to add script and include-file intake, show the importer's diagnostics,
and explicitly hand an accepted JobSpec to the jobs workflow. Parsing alone
does not execute the simulation.
