import type { JobSpecV1, MacJobParameters } from '@w-sim/contracts'
import type { LbmTriangleMesh } from '@w-sim/solvers-lbm/d3q19'
import { prepareMacInput, WasmMac } from '@w-sim/solvers-lbm/mac3d'

/** Inspect the actual discretization at rest. Never step, sample a field or publish a result. */
export function inspectMacGrid(spec: JobSpecV1, geometry: LbmTriangleMesh) {
  if (spec.kind !== 'mac-3d') throw new Error('MAC grid inspection requires a MAC task')
  const { mac, flags } = prepareMacInput(spec, geometry)
  const parameters = spec.parameters as MacJobParameters // prepareMacInput validated the shared contract.
  const solver = new WasmMac(mac, flags)
  const dx = mac.dxMeters
  const powered = mac.thermal?.mode === 'solid-power'
  const materials = powered ? [
    { name: '其余固体（默认材料）', totalPowerW: mac.thermal!.totalPowerW },
    ...(parameters.thermalRegions ?? []).map(region => ({ name: region.name, totalPowerW: region.totalPowerW })),
  ].map((material, index) => ({ ...material, index, cells: 0, volumeM3: 0 })) : []
  const contacts = (mac.thermal?.contacts ?? []).map(contact => ({ ...contact, faces: 0, areaM2: 0 }))
  const pairs = new Map(contacts.map(contact => [Math.min(contact.first, contact.second) * 17 + Math.max(contact.first, contact.second), contact]))
  for (let cell = 0; cell < flags.length; cell++) {
    const material = flags[cell] - 4
    if (material < 0 || !powered) continue
    materials[material].cells++
    if (!contacts.length) continue
    const x = cell % mac.nx, y = Math.floor(cell / mac.nx) % mac.ny, z = Math.floor(cell / (mac.nx * mac.ny))
    const neighbors = [x + 1 < mac.nx ? cell + 1 : -1, y + 1 < mac.ny ? cell + mac.nx : -1, z + 1 < mac.nz ? cell + mac.nx * mac.ny : -1]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || flags[neighbor] < 4 || flags[neighbor] === flags[cell]) continue
      const other = flags[neighbor] - 4
      const contact = pairs.get(Math.min(material, other) * 17 + Math.max(material, other))
      if (contact) contact.faces++
    }
  }
  for (const material of materials) material.volumeM3 = material.cells * dx ** 3
  for (const contact of contacts) contact.areaM2 = contact.faces * dx ** 2
  return {
    cellCount: flags.length, solidCells: mac.solidCells, fluidCells: flags.length - mac.solidCells, dxMeters: dx,
    fixedTemperature: mac.thermal?.mode === 'fixed-temperature' ? {
      cells: flags.reduce((count, flag) => count + (flag === 2 ? 1 : 0), 0), temperatureC: mac.thermal.fixedSurfaceC,
    } : null,
    fans: solver.fans().map((fan, index) => {
      const input = mac.fans[index], nominalAreaM2 = Math.PI * input.radiusMeters ** 2
      return { name: fan.name, plane: fan.plane, faceCount: fan.faceCount, areaM2: fan.areaM2, nominalAreaM2,
        diameterCells: 2 * input.radiusMeters / dx, areaErrorRatio: fan.areaM2 / nominalAreaM2 - 1,
        normalOffsetMeters: (fan.plane - input.centerCells[input.axis]) * dx }
    }),
    materials, contacts,
  }
}

export type MacGridInspection = ReturnType<typeof inspectMacGrid>
