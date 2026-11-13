/**
 * Repo-bound seed entry: imports live static ontology + materials.
 * Split from pure seed-from-static.ts so unit tests can inject fixtures
 * without loading the full edges JSON when unnecessary.
 *
 * K1: skeleton (nodes/edges/materials)
 * K2: efficiency claims + deterministic knowledge_releases row
 * K7: released sim.param_pack + sim.material for resolveJob
 */
import materialsFile from '../../data/materials/materials.data.json'
import {
  MATERIAL_CATEGORY_LABEL_EN,
  MATERIAL_NAME_EN,
} from '../../data/materials/materials.nameEn.ts'
import { EDGES } from '../../data/ontology/edges.ts'
import { NODES } from '../../data/ontology/nodes.ts'
import {
  seedEfficiencyClaimsFromEdgesSync,
  type SeedClaimsFromEdgesResult,
} from './seed-claims-from-edges.ts'
import {
  countStaticMaterialProperties,
  seedKnowledgeDbFromStaticSync,
  type SeedFromStaticResult,
} from './seed-from-static.ts'
import {
  seedSimParamPackReleaseSync,
  type SeedSimParamPackResult,
} from './seed-sim-param-pack.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

type MaterialsFile = {
  categories: Array<{
    key: string
    label: string
    crossCheck?: string
    materials: Array<Record<string, unknown> & { name: string }>
  }>
}

const mats = materialsFile as MaterialsFile

export function seedKnowledgeDbFromRepo(options?: {
  dbPath?: string
  root?: string
  skipMigrate?: boolean
}): SeedFromStaticResult {
  return seedKnowledgeDbFromStaticSync({
    dbPath: options?.dbPath,
    root: options?.root ?? repoRootFromHere(),
    skipMigrate: options?.skipMigrate,
    nodes: NODES,
    edges: EDGES,
    materialsFile: mats as Parameters<
      typeof seedKnowledgeDbFromStaticSync
    >[0]['materialsFile'],
    nameEn: {
      materialNameEn: MATERIAL_NAME_EN,
      categoryLabelEn: MATERIAL_CATEGORY_LABEL_EN,
    },
  })
}

/**
 * K1 skeleton + K2 efficiency claims/release + K7 sim.param_pack (full seed path).
 */
export async function seedKnowledgeDbFromRepoFull(options?: {
  dbPath?: string
  root?: string
  skipMigrate?: boolean
}): Promise<{
  skeleton: SeedFromStaticResult
  claims: SeedClaimsFromEdgesResult
  paramPack: SeedSimParamPackResult
}> {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath
  const skeleton = seedKnowledgeDbFromRepo({
    dbPath,
    root,
    skipMigrate: options?.skipMigrate,
  })
  const claims = await seedEfficiencyClaimsFromEdgesSync({
    dbPath: skeleton.dbPath,
    root,
    skipMigrate: true,
    edges: EDGES,
  })
  const paramPack = await seedSimParamPackReleaseSync({
    dbPath: skeleton.dbPath,
    root,
    skipMigrate: true,
  })
  return { skeleton, claims, paramPack }
}

export function staticInventory() {
  const materialCount = mats.categories.reduce(
    (a, c) => a + c.materials.length,
    0,
  )
  return {
    nodes: NODES.length,
    edges: EDGES.length,
    materials: materialCount,
    material_properties: countStaticMaterialProperties(
      mats as Parameters<typeof countStaticMaterialProperties>[0],
    ),
    categories: mats.categories.length,
  }
}

export function defaultSeedDbPath(root = repoRootFromHere()): string {
  return resolveKnowledgeDbPath(root)
}
