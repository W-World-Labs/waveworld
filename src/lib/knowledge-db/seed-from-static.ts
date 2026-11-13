/**
 * Seed Knowledge DB from static ontology / materials sources (EPIC #52 K1).
 * Idempotent upsert: re-run is stable (same row counts, same primary keys).
 *
 * Sources:
 *   - energy nodes: src/data/ontology/nodes.ts (BASE + subforms)
 *   - conversion edges: edges.data.json + edges.subform.data.json (id-deduped)
 *   - materials: materials.data.json → materials + material_properties
 *
 * @see docs/knowledge-db.md §6
 */
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

/** Numeric LJ-style fields flattened from materials.data.json into material_properties. */
export const MATERIAL_PROPERTY_SPECS: ReadonlyArray<{
  key: string
  unit: string
  field: string
}> = [
  { key: 'sigma_nm', unit: 'nm', field: 'sigma_nm' },
  { key: 'epsilon_kJmol', unit: 'kJ/mol', field: 'epsilon_kJmol' },
  { key: 'epsilon_over_kB_K', unit: 'K', field: 'epsilon_over_kB_K' },
  { key: 'charge_e', unit: 'e', field: 'charge_e' },
  { key: 'mass_amu', unit: 'amu', field: 'mass_amu' },
]

/**
 * Stable material ids (Chinese name → id). Must not drift across re-seeds.
 * Doc examples: mat:ar-lj, mat:tip3p-o.
 */
export const MATERIAL_ID_BY_NAME: Readonly<Record<string, string>> = {
  氩: 'mat:ar-lj',
  氖: 'mat:ne-lj',
  氪: 'mat:kr-lj',
  氙: 'mat:xe-lj',
  'TIP3P 氧位点': 'mat:tip3p-o',
  'TIP3P 氢位点': 'mat:tip3p-h',
  'SPC/E 氧位点': 'mat:spce-o',
  'SPC/E 氢位点': 'mat:spce-h',
  'SPC 氧位点': 'mat:spc-o',
  'SPC 氢位点': 'mat:spc-h',
  '粗粒化水（单球参考）': 'mat:cg-water-1bead',
  钠离子: 'mat:na-jc-tip3p',
  钾离子: 'mat:k-jc-tip3p',
  氯离子: 'mat:cl-jc-tip3p',
  芳环碳: 'mat:opls-ca',
  芳环氢: 'mat:opls-ha',
  噻吩环硫: 'mat:opls-s-thio',
  磺酸基硫: 'mat:opls-s-so3',
  磺酸基氧: 'mat:opls-o-so3',
  苯乙烯骨架碳: 'mat:opls-c-styrene',
  'Martini 3 常规珠': 'mat:martini3-bead',
}

export type SeedCounts = {
  energy_nodes: number
  conversion_edges: number
  edge_devices: number
  edge_products: number
  material_categories: number
  materials: number
  material_properties: number
}

export type SeedFromStaticResult = {
  dbPath: string
  counts: SeedCounts
  static: {
    nodes: number
    edges: number
    materials: number
    material_properties: number
  }
  migrated: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

function j(v: unknown): string {
  return JSON.stringify(v ?? null)
}

function emptyArrJson(v: unknown): string {
  return JSON.stringify(Array.isArray(v) ? v : [])
}

function emptyObjJson(v: unknown): string {
  return JSON.stringify(v && typeof v === 'object' ? v : {})
}

/** Parents before children so FK parent_id succeeds. */
export function orderNodesParentsFirst(nodes: EnergyNode[]): EnergyNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const visiting = new Set<string>()
  const done = new Set<string>()
  const out: EnergyNode[] = []

  function visit(id: string) {
    if (done.has(id)) return
    if (visiting.has(id)) {
      throw new Error(`energy_nodes cycle involving ${id}`)
    }
    const n = byId.get(id)
    if (!n) return
    visiting.add(id)
    if (n.parent && byId.has(n.parent)) visit(n.parent)
    visiting.delete(id)
    done.add(id)
    out.push(n)
  }

  for (const n of nodes) visit(n.id)
  return out
}

export function resolveMaterialId(name: string): string {
  const id = MATERIAL_ID_BY_NAME[name]
  if (!id) {
    throw new Error(
      `seed-from-static: no stable material id for name=${JSON.stringify(name)}; extend MATERIAL_ID_BY_NAME`,
    )
  }
  return id
}

function deviceId(edgeId: string, index: number, label: string): string {
  // Stable: edge + index (device list order is authoritative in static JSON)
  void label
  return `ed:${edgeId}:${index}`
}

function productId(edgeId: string, index: number): string {
  return `ep:${edgeId}:${index}`
}

function propertyId(materialId: string, key: string): string {
  return `mp:${materialId}:${key}`
}

function countTable(db: SqliteDatabase, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
    c: number
  }
  return row.c
}

export function readSeedCounts(db: SqliteDatabase): SeedCounts {
  return {
    energy_nodes: countTable(db, 'energy_nodes'),
    conversion_edges: countTable(db, 'conversion_edges'),
    edge_devices: countTable(db, 'edge_devices'),
    edge_products: countTable(db, 'edge_products'),
    material_categories: countTable(db, 'material_categories'),
    materials: countTable(db, 'materials'),
    material_properties: countTable(db, 'material_properties'),
  }
}

type RawMaterialsFile = {
  categories: Array<{
    key: string
    label: string
    crossCheck?: string
    materials: Array<{
      name: string
      formula?: string
      sigma_nm?: number
      epsilon_kJmol?: number
      epsilon_over_kB_K?: number
      charge_e?: number
      mass_amu?: number
      forcefield?: string
      source?: string
      fidelity?: 'quantitative' | 'qualitative'
      notes?: string
    }>
  }>
}

type NameEnMaps = {
  materialNameEn: Readonly<Record<string, string>>
  categoryLabelEn: Readonly<Record<string, string>>
}

/**
 * Core upsert. Caller supplies loaded static graphs (avoids circular import in tests).
 */
export function seedKnowledgeDbFromStaticData(
  db: SqliteDatabase,
  input: {
    nodes: EnergyNode[]
    edges: ConversionEdge[]
    materialsFile: RawMaterialsFile
    nameEn?: NameEnMaps
  },
): SeedCounts {
  const now = nowIso()
  const nodes = orderNodesParentsFirst(input.nodes)
  const nameEn = input.nameEn

  const upsertNode = db.prepare(`
    INSERT INTO energy_nodes (
      id, parent_id, name, name_en, symbol, icon, color,
      desc_zh, desc_en, quantities_json, consensus_json, refs_json,
      created_at, updated_at
    ) VALUES (
      @id, @parent_id, @name, @name_en, @symbol, @icon, @color,
      @desc_zh, @desc_en, @quantities_json, @consensus_json, @refs_json,
      @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      parent_id = excluded.parent_id,
      name = excluded.name,
      name_en = excluded.name_en,
      symbol = excluded.symbol,
      icon = excluded.icon,
      color = excluded.color,
      desc_zh = excluded.desc_zh,
      desc_en = excluded.desc_en,
      quantities_json = excluded.quantities_json,
      consensus_json = excluded.consensus_json,
      refs_json = excluded.refs_json,
      updated_at = excluded.updated_at
  `)

  const upsertEdge = db.prepare(`
    INSERT INTO conversion_edges (
      id, from_node_id, to_node_id, name, name_en,
      principle, principle_en, efficiency_kind,
      efficiency_json, formula_json, loss_mechanisms_json,
      maturity, apps_json, consensus_json, refs_json, status,
      created_at, updated_at
    ) VALUES (
      @id, @from_node_id, @to_node_id, @name, @name_en,
      @principle, @principle_en, @efficiency_kind,
      @efficiency_json, @formula_json, @loss_mechanisms_json,
      @maturity, @apps_json, @consensus_json, @refs_json, @status,
      @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      from_node_id = excluded.from_node_id,
      to_node_id = excluded.to_node_id,
      name = excluded.name,
      name_en = excluded.name_en,
      principle = excluded.principle,
      principle_en = excluded.principle_en,
      efficiency_kind = excluded.efficiency_kind,
      efficiency_json = excluded.efficiency_json,
      formula_json = excluded.formula_json,
      loss_mechanisms_json = excluded.loss_mechanisms_json,
      maturity = excluded.maturity,
      apps_json = excluded.apps_json,
      consensus_json = excluded.consensus_json,
      refs_json = excluded.refs_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `)

  const upsertDevice = db.prepare(`
    INSERT INTO edge_devices (id, edge_id, label, label_en, sort_order)
    VALUES (@id, @edge_id, @label, @label_en, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      edge_id = excluded.edge_id,
      label = excluded.label,
      label_en = excluded.label_en,
      sort_order = excluded.sort_order
  `)

  const upsertProduct = db.prepare(`
    INSERT INTO edge_products (
      id, edge_id, vendor, vendor_en, model, model_en, spec, spec_en, sort_order
    ) VALUES (
      @id, @edge_id, @vendor, @vendor_en, @model, @model_en, @spec, @spec_en, @sort_order
    )
    ON CONFLICT(id) DO UPDATE SET
      edge_id = excluded.edge_id,
      vendor = excluded.vendor,
      vendor_en = excluded.vendor_en,
      model = excluded.model,
      model_en = excluded.model_en,
      spec = excluded.spec,
      spec_en = excluded.spec_en,
      sort_order = excluded.sort_order
  `)

  const upsertCategory = db.prepare(`
    INSERT INTO material_categories (id, label, label_en, cross_check, sort_order)
    VALUES (@id, @label, @label_en, @cross_check, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      label_en = excluded.label_en,
      cross_check = excluded.cross_check,
      sort_order = excluded.sort_order
  `)

  const upsertMaterial = db.prepare(`
    INSERT INTO materials (
      id, category_id, name, name_en, formula, kind, fidelity,
      forcefield, notes, source_text, meta_json, created_at, updated_at
    ) VALUES (
      @id, @category_id, @name, @name_en, @formula, @kind, @fidelity,
      @forcefield, @notes, @source_text, @meta_json, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      category_id = excluded.category_id,
      name = excluded.name,
      name_en = excluded.name_en,
      formula = excluded.formula,
      kind = excluded.kind,
      fidelity = excluded.fidelity,
      forcefield = excluded.forcefield,
      notes = excluded.notes,
      source_text = excluded.source_text,
      meta_json = excluded.meta_json,
      updated_at = excluded.updated_at
  `)

  const upsertProp = db.prepare(`
    INSERT INTO material_properties (
      id, material_id, key, value_num, value_text, unit,
      condition_json, fidelity, claim_id, sort_order
    ) VALUES (
      @id, @material_id, @key, @value_num, @value_text, @unit,
      @condition_json, @fidelity, @claim_id, @sort_order
    )
    ON CONFLICT(id) DO UPDATE SET
      material_id = excluded.material_id,
      key = excluded.key,
      value_num = excluded.value_num,
      value_text = excluded.value_text,
      unit = excluded.unit,
      condition_json = excluded.condition_json,
      fidelity = excluded.fidelity,
      claim_id = excluded.claim_id,
      sort_order = excluded.sort_order
  `)

  const run = db.transaction(() => {
    for (const n of nodes) {
      upsertNode.run({
        id: n.id,
        parent_id: n.parent ?? null,
        name: n.name,
        name_en: n.nameEn ?? null,
        symbol: n.symbol ?? null,
        icon: n.icon ?? null,
        color: n.color ?? null,
        desc_zh: n.desc ?? '',
        desc_en: n.descEn ?? null,
        quantities_json: emptyArrJson(n.quantities),
        consensus_json: emptyObjJson(n.consensus),
        refs_json: n.refs ? j(n.refs) : null,
        created_at: now,
        updated_at: now,
      })
    }

    for (const e of input.edges) {
      const kind = e.kind === 'transport' ? 'transport' : 'conversion'
      upsertEdge.run({
        id: e.id,
        from_node_id: e.from,
        to_node_id: e.to,
        name: e.name,
        name_en: e.nameEn ?? null,
        principle: e.principle ?? '',
        principle_en: e.principleEn ?? null,
        efficiency_kind: kind,
        efficiency_json: e.efficiency ? j(e.efficiency) : null,
        formula_json: e.formula ? j(e.formula) : null,
        loss_mechanisms_json: e.lossMechanisms ? j(e.lossMechanisms) : null,
        maturity: e.maturity ?? null,
        apps_json: e.apps ? j(e.apps) : null,
        consensus_json: emptyObjJson(e.consensus),
        refs_json: e.refs ? j(e.refs) : null,
        status: 'active',
        created_at: now,
        updated_at: now,
      })

      const devices = e.device ?? []
      for (let i = 0; i < devices.length; i++) {
        const label = devices[i]!
        upsertDevice.run({
          id: deviceId(e.id, i, label),
          edge_id: e.id,
          label,
          label_en: null,
          sort_order: i,
        })
      }

      const products = e.products ?? []
      for (let i = 0; i < products.length; i++) {
        const p = products[i]!
        upsertProduct.run({
          id: productId(e.id, i),
          edge_id: e.id,
          vendor: p.vendor ?? null,
          vendor_en: p.vendorEn ?? null,
          model: p.model,
          model_en: p.modelEn ?? null,
          spec: p.spec ?? null,
          spec_en: p.specEn ?? null,
          sort_order: i,
        })
      }
    }

    let catOrder = 0
    for (const cat of input.materialsFile.categories) {
      upsertCategory.run({
        id: cat.key,
        label: cat.label,
        label_en: nameEn?.categoryLabelEn[cat.key] ?? null,
        cross_check: cat.crossCheck ?? null,
        sort_order: catOrder++,
      })

      for (const m of cat.materials) {
        const mid = resolveMaterialId(m.name)
        upsertMaterial.run({
          id: mid,
          category_id: cat.key,
          name: m.name,
          name_en: nameEn?.materialNameEn[m.name] ?? null,
          formula: m.formula ?? null,
          kind: 'forcefield_lj',
          fidelity: m.fidelity ?? null,
          forcefield: m.forcefield ?? null,
          notes: m.notes ?? null,
          source_text: m.source ?? null,
          meta_json: j({ seed: 'static', category: cat.key }),
          created_at: now,
          updated_at: now,
        })

        let sort = 0
        for (const spec of MATERIAL_PROPERTY_SPECS) {
          const raw = (m as Record<string, unknown>)[spec.field]
          if (typeof raw !== 'number' || Number.isNaN(raw)) continue
          upsertProp.run({
            id: propertyId(mid, spec.key),
            material_id: mid,
            key: spec.key,
            value_num: raw,
            value_text: null,
            unit: spec.unit,
            // Prefer non-null so UNIQUE(material_id, key, condition_json) is useful
            condition_json: '{}',
            fidelity: m.fidelity ?? null,
            claim_id: null,
            sort_order: sort++,
          })
        }
      }
    }
  })

  run()
  return readSeedCounts(db)
}

/** Count expected property rows from materials file (numeric LJ fields present). */
export function countStaticMaterialProperties(
  materialsFile: RawMaterialsFile,
): number {
  let n = 0
  for (const cat of materialsFile.categories) {
    for (const m of cat.materials) {
      for (const spec of MATERIAL_PROPERTY_SPECS) {
        const raw = (m as Record<string, unknown>)[spec.field]
        if (typeof raw === 'number' && !Number.isNaN(raw)) n++
      }
    }
  }
  return n
}

/**
 * Seed with caller-supplied static graphs (CLI uses seed-from-static.repo.ts).
 */
export function seedKnowledgeDbFromStaticSync(options: {
  dbPath?: string
  root?: string
  skipMigrate?: boolean
  nodes: EnergyNode[]
  edges: ConversionEdge[]
  materialsFile: RawMaterialsFile
  nameEn?: NameEnMaps
}): SeedFromStaticResult {
  const root = options.root ?? repoRootFromHere()
  const dbPath = options.dbPath ?? resolveKnowledgeDbPath(root)

  let migrated = false
  if (!options.skipMigrate) {
    migrateKnowledgeDb({ dbPath, root })
    migrated = true
  }

  const db = openKnowledgeDb({ dbPath, root })
  try {
    const counts = seedKnowledgeDbFromStaticData(db, {
      nodes: options.nodes,
      edges: options.edges,
      materialsFile: options.materialsFile,
      nameEn: options.nameEn,
    })
    const materialCount = options.materialsFile.categories.reduce(
      (a, c) => a + c.materials.length,
      0,
    )
    return {
      dbPath,
      counts,
      static: {
        nodes: options.nodes.length,
        edges: options.edges.length,
        materials: materialCount,
        material_properties: countStaticMaterialProperties(options.materialsFile),
      },
      migrated,
    }
  } finally {
    db.close()
  }
}
