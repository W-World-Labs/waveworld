/**
 * Seed knowledge.db from static ontology + materials + efficiency claims
 * + sim.param_pack (EPIC #52 K1/K2/K7).
 *
 *   npx tsx scripts/knowledge/seed-from-static.ts
 *   npm run knowledge:db:seed   (if wired) / db-cli seed
 *
 * Env: KNOWLEDGE_DB_PATH, KNOWLEDGE_SCHEMA_PATH
 * Idempotent: safe to re-run; skeleton + claim/release digests stay stable.
 */
import {
  seedKnowledgeDbFromRepoFull,
  staticInventory,
} from '../../src/lib/knowledge-db/seed-from-static.repo.ts'

async function main() {
  const inv = staticInventory()
  const { skeleton, claims, paramPack } = await seedKnowledgeDbFromRepoFull()
  const alignedSkeleton =
    skeleton.counts.energy_nodes === inv.nodes &&
    skeleton.counts.conversion_edges === inv.edges &&
    skeleton.counts.materials === inv.materials &&
    skeleton.counts.material_properties === inv.material_properties
  const alignedClaims =
    claims.counts.claims_released > 0 &&
    claims.sha256.length === 64 &&
    claims.edgeClaimCount === inv.edges
  const alignedParamPack =
    paramPack.sha256.length === 64 &&
    paramPack.packClaimId.length > 0 &&
    paramPack.claimCount >= 1

  console.log(
    JSON.stringify(
      {
        ok: alignedSkeleton && alignedClaims && alignedParamPack,
        dbPath: skeleton.dbPath,
        migrated: skeleton.migrated,
        static: inv,
        counts: skeleton.counts,
        claims: {
          releaseId: claims.releaseId,
          sha256: claims.sha256,
          edgeClaimCount: claims.edgeClaimCount,
          counts: claims.counts,
        },
        paramPack: {
          releaseId: paramPack.releaseId,
          sha256: paramPack.sha256,
          packClaimId: paramPack.packClaimId,
          materialClaimId: paramPack.materialClaimId,
          jobKind: paramPack.jobKind,
          claimCount: paramPack.claimCount,
        },
        aligned: {
          nodes: skeleton.counts.energy_nodes === inv.nodes,
          edges: skeleton.counts.conversion_edges === inv.edges,
          materials: skeleton.counts.materials === inv.materials,
          material_properties:
            skeleton.counts.material_properties === inv.material_properties,
          claims_released: claims.counts.claims_released > 0,
          edge_claims: claims.edgeClaimCount === inv.edges,
          release_sha256: claims.sha256.length === 64,
          param_pack_release: alignedParamPack,
        },
      },
      null,
      2,
    ),
  )

  if (!alignedSkeleton || !alignedClaims || !alignedParamPack) {
    console.error(
      'seed-from-static: skeleton, claims, or sim.param_pack release did not align',
    )
    process.exit(1)
  }
}

try {
  await main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
