# Catalog mega-file pipeline (#86)

Large generated/curated sources:

| File | Role |
|------|------|
| `src/data/methods/methods.data.ts` | method catalog |
| `src/data/applications/applications.data.ts` | applications |
| `src/lib/principle-depth/registry.ts` | principle-depth registry |

**Pipeline (do not hand-merge 8k-line files):**

1. Author a slice JSON under `src/data/catalog-slices/` (future) or edit one domain file.
2. `node scripts/check-source-budgets.mjs` fails if a listed file grows past its budget.
3. Next extraction: split `methods.data.ts` by domain prefix into `src/data/methods/parts/` and re-export from `methods.data.ts`.

Until slices exist, the budget script is the merge-hazard gate.
