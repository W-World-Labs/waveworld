/** EnergyPlus `.idf` subset reader for the bundled software-case corpus.
 * IDF objects are comma-separated fields terminated by `;`, with `!` comments.
 * We extract Construction layer stacks and resolve each layer to its declared
 * Material thickness/conductivity or Material:NoMass thermal resistance, so the
 * 1D conduction solver can be checked against the file's own declared R-values.
 * Unrelated object types are preserved but not interpreted; malformed objects
 * fail closed.
 */

export const IDF_MAX_BYTES = 256 * 1024

export type IdfObject = { type: string; fields: string[] }

export function parseIdf(text: string): IdfObject[] {
  if (new TextEncoder().encode(text).length > IDF_MAX_BYTES) {
    throw new Error('IDF input exceeds 256 KiB')
  }
  const stripped = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/!.*$/, ''))
    .join('\n')
  const objects: IdfObject[] = []
  for (const chunk of stripped.split(';')) {
    const fields = chunk.split(',').map((f) => f.trim()).filter((f) => f.length > 0)
    if (fields.length === 0) continue
    const type = fields[0]!
    if (!/^[A-Za-z][\w:.-]*$/.test(type)) {
      throw new Error(`IDF: invalid object type '${type.slice(0, 60)}'`)
    }
    objects.push({ type, fields: fields.slice(1) })
  }
  return objects
}

function idfNumber(fields: string[], index: number, what: string): number {
  const v = Number(fields[index])
  if (!Number.isFinite(v)) throw new Error(`IDF: missing or non-numeric ${what}`)
  return v
}

export type IdfLayer =
  | { name: string; kind: 'material'; thicknessM: number; conductivity: number }
  | { name: string; kind: 'nomass'; resistanceR: number }

export type IdfConstruction = { name: string; layers: IdfLayer[] }

/** Resolve every Construction's layer list against Material/Material:NoMass objects. */
export function idfConstructions(objects: IdfObject[]): IdfConstruction[] {
  const materials = new Map<string, IdfLayer>()
  for (const o of objects) {
    if (o.type === 'Material') {
      const name = o.fields[0]
      if (!name || materials.has(name)) throw new Error(`IDF: invalid or duplicate Material '${name}'`)
      materials.set(name, {
        name, kind: 'material',
        thicknessM: idfNumber(o.fields, 2, `Material ${name} thickness`),
        conductivity: idfNumber(o.fields, 3, `Material ${name} conductivity`),
      })
    } else if (o.type === 'Material:NoMass') {
      const name = o.fields[0]
      if (!name || materials.has(name)) throw new Error(`IDF: invalid or duplicate Material:NoMass '${name}'`)
      materials.set(name, {
        name, kind: 'nomass',
        resistanceR: idfNumber(o.fields, 2, `Material:NoMass ${name} thermal resistance`),
      })
    }
  }
  const constructions: IdfConstruction[] = []
  const seen = new Set<string>()
  for (const o of objects) {
    if (o.type !== 'Construction') continue
    const name = o.fields[0]
    if (!name || seen.has(name)) throw new Error(`IDF: invalid or duplicate Construction '${name}'`)
    seen.add(name)
    const layers = o.fields.slice(1).filter((f) => f.length > 0).map((layerName) => {
      const layer = materials.get(layerName)
      if (!layer) throw new Error(`IDF: Construction '${name}' references unknown layer '${layerName}'`)
      return layer
    })
    if (layers.length === 0) throw new Error(`IDF: Construction '${name}' has no layers`)
    constructions.push({ name, layers })
  }
  if (constructions.length === 0) throw new Error('IDF: no Construction objects')
  return constructions
}

/** Total declared thermal resistance [m^2-K/W] of a construction's layers. */
export function idfConstructionResistance(c: IdfConstruction): number {
  return c.layers.reduce(
    (r, l) => r + (l.kind === 'nomass' ? l.resistanceR : l.thicknessM / l.conductivity),
    0,
  )
}
