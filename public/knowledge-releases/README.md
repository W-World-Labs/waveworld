# Knowledge releases (static catalog)

Atlas browser catalog (`VITE_KNOWLEDGE_RELEASES_URL` or `/knowledge-releases`) reads:

```
index.json
<id>/release.json
```

## Sample release (`#48-O` + `#48-Q`)

Dev tree ships one offline multi-subject sample: `kr-sample-48o`

- **Edges (#48-O):** ≥6 claims on distinct conversion edges (rectenna, PV, thermoelectric,
  piezoelectric, LED efficiency + battery mechanism).
- **Controversies (#48-Q):** ≥2 claims on Controversies UI subjects —
  controversy id `information-energy` and related energy node `thermal`.

Regenerate via the offline pipeline (deterministic, no network):

```bash
npm run knowledge:offline-pipeline
# or
npx tsx scripts/knowledge/offline-pipeline.ts
npx tsx scripts/knowledge/write-sample-release.ts
```

Or write elsewhere:

```bash
KNOWLEDGE_RELEASES_DIR=data/knowledge-releases npm run knowledge:offline-pipeline
```

Pipeline path: fixture → efficiency gate → `publishKnowledgeRelease` → `writeKnowledgeRelease` → index.
Library: `src/lib/knowledge/offlinePipeline.ts` + `sampleRelease.ts`.
See `docs/knowledge-pipeline.md` § Offline six-edge sample (`#48-O`) and § Controversies sample subjects (`#48-Q`).

## Sync from data/ (#48-P)

If releases live under `data/knowledge-releases` and you want Vite to serve them:

```bash
npm run knowledge:sync-public-releases
# or
bash scripts/knowledge/sync-public-releases.sh
```

Production mount (Caddy `WAVEWORLD_KNOWLEDGE_RELEASES_ROOT`, rsync, `VITE_KNOWLEDGE_RELEASES_URL`):
see `docs/deploy.md` § Production catalog mount checklist and `docs/knowledge-pipeline.md`.
Operator steps only — this tree does not mutate live servers.
