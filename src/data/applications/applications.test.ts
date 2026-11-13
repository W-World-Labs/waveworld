import { describe, it, expect } from 'vitest'
import {
  APPLICATIONS,
  applicationById,
  flattenLevels,
  levelAtPath,
  familyVariants,
  applicationsGroupedByFamily,
} from './applications'
import { methodById } from '../methods/methods'
import { EDGES } from '../ontology/edges'
import { NODES } from '../ontology/nodes'
import { bestConversionMethods } from '../../lib/applications'

const edgeSet = new Set(EDGES.map((e) => e.id))
const nodeSet = new Set(NODES.map((n) => n.id))

describe('应用档案目录', () => {
  it('至少 3 个应用，含太阳能电池旗舰', () => {
    expect(APPLICATIONS.length).toBeGreaterThanOrEqual(28)
    expect(applicationById('app-solar-cell')).toBeDefined()
    expect(applicationById('app-solar-cell')!.name).toMatch(/太阳|光伏|Solar/i)
  })

  it('每个 level 的 method/edge/node id 可解析', () => {
    for (const app of APPLICATIONS) {
      for (const { level } of flattenLevels(app)) {
        for (const m of level.methodIds ?? []) expect(methodById(m), m).toBeDefined()
        for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
        for (const n of level.energyNodeIds ?? []) expect(nodeSet.has(n), n).toBe(true)
      }
    }
  })

  it('太阳能电池：可沿路径下钻到载流子层', () => {
    const app = applicationById('app-solar-cell')!
    const flat = flattenLevels(app)
    expect(flat.some((x) => x.level.id === 'pv-carriers')).toBe(true)
    const deep = levelAtPath(app, [
      'pv-system',
      'pv-module',
      'pv-cell',
      'pv-optics',
      'pv-bandgap',
      'pv-carriers',
    ])
    expect(deep?.name).toMatch(/载流子/)
    expect((deep?.methodIds?.length ?? 0)).toBeGreaterThan(0)
  })

  it('旗舰 goal 与能量路径库可达（from→to 有最优路径）', () => {
    const app = applicationById('app-solar-cell')!
    const ms = bestConversionMethods(app.goal.from, app.goal.to, { k: 3, excludeDisputed: false })
    expect(ms.length).toBeGreaterThan(0)
    expect(ms[0]!.efficiency).toBeGreaterThan(0)
  })

  it('光伏族：太阳 PV 与 TPV 同族且 goal 源不同', () => {
    const solar = applicationById('app-solar-cell')!
    const tpv = applicationById('app-tpv')!
    expect(solar.familyId).toBe('family-photovoltaic-stack')
    expect(tpv.familyId).toBe(solar.familyId)
    expect(solar.goal.from).toBe('radiant-solar')
    expect(tpv.goal.from).toBe('thermal')
    const v = familyVariants(solar)
    expect(v.some((a) => a.id === 'app-tpv')).toBe(true)
  })

  it('热电族：塞贝克与珀尔帖 goal 对调', () => {
    const teg = applicationById('app-thermoelectric-seebeck')!
    const tec = applicationById('app-peltier-cooler')!
    expect(teg.familyId).toBe('family-thermoelectric')
    expect(tec.familyId).toBe(teg.familyId)
    expect(teg.goal.from).toBe('thermal')
    expect(teg.goal.to).toBe('electric')
    expect(tec.goal.from).toBe('electric')
    expect(tec.goal.to).toBe('thermal')
  })

  it('assemblyNoteEn overlay covers apps that have assemblyNote', () => {
    const withNote = APPLICATIONS.filter((a) => a.assemblyNote)
    expect(withNote.length).toBeGreaterThan(20)
    for (const a of withNote) {
      expect(a.assemblyNoteEn, a.id).toBeTruthy()
      expect(a.assemblyNoteEn!, a.id).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })

  it('every application level has nameEn without CJK', () => {
    for (const app of APPLICATIONS) {
      for (const { level } of flattenLevels(app)) {
        expect(level.nameEn, `${app.id}/${level.id}`).toBeTruthy()
        expect(level.nameEn!, `${app.id}/${level.id}`).not.toMatch(/[\u4e00-\u9fff]/)
      }
    }
  })

  it('every application level has summaryEn without CJK', () => {
    for (const app of APPLICATIONS) {
      for (const { level } of flattenLevels(app)) {
        expect(level.summaryEn, `${app.id}/${level.id}`).toBeTruthy()
        expect(level.summaryEn!, `${app.id}/${level.id}`).not.toMatch(/[\u4e00-\u9fff]/)
      }
    }
  })

  it('applicationsGroupedByFamily 含多成员族', () => {
    const groups = applicationsGroupedByFamily()
    const pv = groups.find((g) => g.familyId === 'family-photovoltaic-stack')
    expect(pv && pv.apps.length).toBeGreaterThanOrEqual(2)
  })

  it('新增能源应用：STEG / RTG / 燃料电池 / 风机 均存在且树深≥3', () => {
    const ids = ['app-steg', 'app-rtg', 'app-fuel-cell', 'app-wind-turbine'] as const
    for (const id of ids) {
      const app = applicationById(id)
      expect(app, id).toBeDefined()
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), id).toBeGreaterThanOrEqual(3)
    }
    expect(applicationById('app-steg')!.goal).toEqual({ from: 'radiant-solar', to: 'electric' })
    expect(applicationById('app-rtg')!.goal).toEqual({ from: 'nuclear', to: 'electric' })
    expect(applicationById('app-fuel-cell')!.goal).toEqual({ from: 'chemical', to: 'electric' })
    expect(applicationById('app-wind-turbine')!.goal).toEqual({ from: 'mechanical', to: 'electric' })
    expect(applicationById('app-rtg')!.familyId).toBe('family-thermoelectric')
    expect(applicationById('app-steg')!.familyId).toBe('family-steg')
  })

  it('TPV 加深到带隙/SQ 层', () => {
    const deep = levelAtPath(applicationById('app-tpv')!, [
      'tpv-system',
      'tpv-emitter',
      'tpv-cell',
      'tpv-shared-physics',
      'tpv-bandgap-sq',
    ])
    expect(deep?.id).toBe('tpv-bandgap-sq')
    expect((deep?.methodIds?.length ?? 0)).toBeGreaterThan(0)
  })

  it('新增应用：水电 / MHD / 光声 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-hydro-plant',
        goal: { from: 'gravitational', to: 'electric' },
        familyId: 'family-hydro-power',
        category: 'energy',
      },
      {
        id: 'app-mhd-generator',
        goal: { from: 'thermal', to: 'electric' },
        familyId: 'family-mhd-generator',
        category: 'energy',
      },
      {
        id: 'app-photoacoustic-imaging',
        goal: { from: 'radiant', to: 'acoustic' },
        familyId: 'family-photoacoustic',
        category: 'sensing',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 水电路径：水库 → 引水 → 轮机 → 发电机
    const hydroPath = levelAtPath(applicationById('app-hydro-plant')!, [
      'hp-plant',
      'hp-reservoir',
      'hp-penstock',
      'hp-turbine',
      'hp-generator',
    ])
    expect(hydroPath?.id).toBe('hp-generator')
    expect((hydroPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
  })


  it('新增应用：柴发 / PRO渗透能 / 热电子 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-diesel-genset',
        goal: { from: 'chemical', to: 'electric' },
        familyId: 'family-ice-thermal-mechanical',
        category: 'energy',
      },
      {
        id: 'app-pro-osmotic',
        goal: { from: 'chemical', to: 'electric' },
        familyId: 'family-salinity-gradient',
        category: 'energy',
      },
      {
        id: 'app-thermionic-converter',
        goal: { from: 'thermal', to: 'electric' },
        familyId: 'family-thermionic-converter',
        category: 'energy',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 柴发路径：燃料 → 燃烧 → 膨胀 → 发电机
    const dieselPath = levelAtPath(applicationById('app-diesel-genset')!, [
      'dg-system',
      'dg-fuel-chem',
      'dg-combustion',
      'dg-expansion',
      'dg-generator',
    ])
    expect(dieselPath?.id).toBe('dg-generator')
    expect((dieselPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // PRO：盐差 → 膜 → 透平 → 发电机
    const proPath = levelAtPath(applicationById('app-pro-osmotic')!, [
      'pro-system',
      'pro-salinity',
      'pro-membrane',
      'pro-hydro',
      'pro-generator',
    ])
    expect(proPath?.id).toBe('pro-generator')
    // 热电子：热源 → 发射 → 间隙 → 集电
    const ticPath = levelAtPath(applicationById('app-thermionic-converter')!, [
      'tic-system',
      'tic-heat-source',
      'tic-emission',
      'tic-gap',
      'tic-collector',
    ])
    expect(ticPath?.id).toBe('tic-collector')
    expect(
      applicationById('app-diesel-genset')!.levels[0]!.methodIds,
    ).toEqual(expect.arrayContaining(['method-diesel', 'method-algo-diesel-eta', 'method-carnot']))
    expect(
      applicationById('app-pro-osmotic')!.levels[0]!.methodIds,
    ).toEqual(expect.arrayContaining(['method-osmotic-power', 'method-algo-pro-power']))
    expect(
      applicationById('app-thermionic-converter')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining(['method-thermionic-emission', 'method-algo-richardson-current']),
    )
  })


  it('新增应用：ORC 余热 / α伏特 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-orc-plant',
        goal: { from: 'thermal', to: 'electric' },
        familyId: 'family-orc-rankine',
        category: 'energy',
      },
      {
        id: 'app-alphavoltaic',
        goal: { from: 'nuclear', to: 'electric' },
        familyId: 'family-nuclear-betavoltaic',
        category: 'energy',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // ORC：余热 → 蒸发器 → 膨胀机 → 发电机
    const orcPath = levelAtPath(applicationById('app-orc-plant')!, [
      'orc-system',
      'orc-waste-heat',
      'orc-evaporator',
      'orc-expander',
      'orc-generator',
    ])
    expect(orcPath?.id).toBe('orc-generator')
    expect((orcPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // α伏特：源 → 输运 → 结 → 负载
    const avPath = levelAtPath(applicationById('app-alphavoltaic')!, [
      'av-system',
      'av-source',
      'av-transport',
      'av-junction',
      'av-load',
    ])
    expect(avPath?.id).toBe('av-load')
    expect(
      applicationById('app-orc-plant')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-rankine',
        'method-algo-rankine-eta',
        'method-carnot',
        'method-algo-carnot-eta',
        'method-path-efficiency',
        'method-exergy-analysis',
      ]),
    )
    expect(
      applicationById('app-alphavoltaic')!.levels[0]!.methodIds,
    ).toEqual(expect.arrayContaining(['method-alphavoltaic', 'method-algo-av-power']))
    // family labels resolve
    const groups = applicationsGroupedByFamily()
    expect(groups.find((g) => g.familyId === 'family-orc-rankine')?.label).toMatch(/ORC|朗肯/)
    expect(groups.find((g) => g.familyId === 'family-nuclear-betavoltaic')?.label).toMatch(
      /核伏特|α|β/,
    )
  })

  it('新增应用：卡林纳循环 / 霍尔推力器 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-kalina-cycle',
        goal: { from: 'thermal', to: 'electric' },
        familyId: 'family-orc-rankine',
        category: 'energy',
      },
      {
        id: 'app-hall-thruster',
        goal: { from: 'electric', to: 'mechanical' },
        familyId: 'family-electric-propulsion',
        category: 'energy',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 卡林纳：余热 → 锅炉/分离器 → 膨胀机 → 发电机
    const kalinaPath = levelAtPath(applicationById('app-kalina-cycle')!, [
      'kalina-system',
      'kalina-waste-heat',
      'kalina-boiler-separator',
      'kalina-expander',
      'kalina-generator',
    ])
    expect(kalinaPath?.id).toBe('kalina-generator')
    expect((kalinaPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // 霍尔推力器：系统 → PPU → 电离 → 通道 → 羽流
    const htPath = levelAtPath(applicationById('app-hall-thruster')!, [
      'ht-system',
      'ht-ppu',
      'ht-ionization',
      'ht-channel',
      'ht-plume',
    ])
    expect(htPath?.id).toBe('ht-plume')
    expect((htPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-kalina-cycle')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-rankine',
        'method-algo-rankine-eta',
        'method-carnot',
        'method-algo-carnot-eta',
        'method-path-efficiency',
        'method-exergy-analysis',
      ]),
    )
    expect(
      applicationById('app-hall-thruster')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-hall-effect',
        'method-algo-hall-voltage',
        'method-mhd-generator',
        'method-algo-mhd-emf',
      ]),
    )
    // ORC 与卡林纳同族；family labels resolve
    const groups = applicationsGroupedByFamily()
    const orcFam = groups.find((g) => g.familyId === 'family-orc-rankine')
    expect(orcFam && orcFam.apps.length).toBeGreaterThanOrEqual(2)
    expect(orcFam?.apps.some((a) => a.id === 'app-kalina-cycle')).toBe(true)
    expect(orcFam?.label).toMatch(/ORC|朗肯|卡林纳/)
    expect(groups.find((g) => g.familyId === 'family-electric-propulsion')?.label).toMatch(
      /电推进|喷气/,
    )
    // 边仅引用已存在 id
    const kalina = applicationById('app-kalina-cycle')!
    const ht = applicationById('app-hall-thruster')!
    for (const { level } of [...flattenLevels(kalina), ...flattenLevels(ht)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })





  it('新增应用：光栅光谱仪 / RF链路VSWR 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-spectrometer-grating',
        goal: { from: 'radiant', to: 'electric' },
        familyId: 'family-optical-instrument',
        category: 'sensing',
      },
      {
        id: 'app-rf-link-vswr',
        goal: { from: 'electric', to: 'electric' },
        familyId: 'family-rf-link',
        category: 'device',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 光谱仪：源 → 狭缝准直 → 光栅 → 级次 → 探测器
    const sgPath = levelAtPath(applicationById('app-spectrometer-grating')!, [
      'sg-system',
      'sg-source',
      'sg-slit-collimate',
      'sg-grating',
      'sg-order-select',
      'sg-detector',
    ])
    expect(sgPath?.id).toBe('sg-detector')
    expect((sgPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // RF：系统 → PA → 匹配/VSWR → 天线 → 传播接收
    const rflPath = levelAtPath(applicationById('app-rf-link-vswr')!, [
      'rfl-system',
      'rfl-source-pa',
      'rfl-match-feed',
      'rfl-antenna-rad',
      'rfl-propagate-rx',
    ])
    expect(rflPath?.id).toBe('rfl-propagate-rx')
    expect((rflPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-spectrometer-grating')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-diffraction-grating',
        'method-algo-grating-order',
        'method-young-double-slit',
        'method-beer-lambert',
        'method-path-efficiency',
      ]),
    )
    expect(
      applicationById('app-rf-link-vswr')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-vswr',
        'method-algo-vswr-from-gamma',
        'method-impedance-match',
        'method-algo-reflection-gamma',
        'method-bode-plot',
      ]),
    )
    // family labels resolve
    const groups = applicationsGroupedByFamily()
    expect(groups.find((g) => g.familyId === 'family-optical-instrument')?.label).toMatch(
      /光学|光谱|色散/,
    )
    expect(groups.find((g) => g.familyId === 'family-rf-link')?.label).toMatch(/RF|VSWR|匹配/)
    // 边仅引用已存在 id
    const sg = applicationById('app-spectrometer-grating')!
    const rfl = applicationById('app-rf-link-vswr')!
    for (const { level } of [...flattenLevels(sg), ...flattenLevels(rfl)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })



  it('新增应用：光纤NA链路 / 法布里-珀罗传感 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-fiber-link',
        goal: { from: 'electric', to: 'electric' },
        familyId: 'family-fiber-optic',
        category: 'device',
      },
      {
        id: 'app-fabry-perot-sensor',
        goal: { from: 'radiant', to: 'electric' },
        familyId: 'family-optical-instrument',
        category: 'sensing',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 光纤链路：系统 → 泵浦 → NA 耦合 → 衰减 → 探测
    const flPath = levelAtPath(applicationById('app-fiber-link')!, [
      'fl-system',
      'fl-source-pump',
      'fl-na-couple',
      'fl-guide-atten',
      'fl-detector',
    ])
    expect(flPath?.id).toBe('fl-detector')
    expect((flPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // FP：系统 → 源 → 腔 → FSR → 探测
    const fpPath = levelAtPath(applicationById('app-fabry-perot-sensor')!, [
      'fp-system',
      'fp-source',
      'fp-cavity',
      'fp-fsr-select',
      'fp-detector',
    ])
    expect(fpPath?.id).toBe('fp-detector')
    expect((fpPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-fiber-link')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-fiber-optic',
        'method-numerical-aperture',
        'method-algo-na',
        'method-beer-lambert',
        'method-fresnel-snell',
      ]),
    )
    expect(
      applicationById('app-fabry-perot-sensor')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-fabry-perot',
        'method-algo-fp-fsr',
        'method-michelson',
      ]),
    )
    // family labels + fiber family has ≥2 members
    const groups = applicationsGroupedByFamily()
    const fiberFam = groups.find((g) => g.familyId === 'family-fiber-optic')
    expect(fiberFam && fiberFam.apps.length).toBeGreaterThanOrEqual(2)
    expect(fiberFam?.label).toMatch(/光纤|NA|衰减/)
    expect(groups.find((g) => g.familyId === 'family-optical-instrument')?.label).toMatch(
      /光学|干涉|滤波|光谱/,
    )
    // 边仅引用已存在 id
    const fl = applicationById('app-fiber-link')!
    const fp = applicationById('app-fabry-perot-sensor')!
    for (const { level } of [...flattenLevels(fl), ...flattenLevels(fp)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })


  it('新增应用：萨格纳克光纤陀螺 / PID伺服定位 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-sagnac-gyro',
        goal: { from: 'mechanical', to: 'electric' },
        familyId: 'family-optical-instrument',
        category: 'sensing',
      },
      {
        id: 'app-pid-servo',
        goal: { from: 'electric', to: 'mechanical' },
        familyId: 'family-control',
        category: 'device',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // FOG：系统 → 转动 → 光源 → 光纤环 → 探测
    const fogPath = levelAtPath(applicationById('app-sagnac-gyro')!, [
      'fog-system',
      'fog-rotation',
      'fog-source',
      'fog-coil',
      'fog-detector',
    ])
    expect(fogPath?.id).toBe('fog-detector')
    expect((fogPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // PID：系统 → 控制 → ZN 整定 → 执行 → 对象
    const psPath = levelAtPath(applicationById('app-pid-servo')!, [
      'ps-system',
      'ps-controller',
      'ps-zn-tune',
      'ps-actuator',
      'ps-plant',
    ])
    expect(psPath?.id).toBe('ps-plant')
    expect((psPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-sagnac-gyro')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-sagnac',
        'method-algo-sagnac-phase',
        'method-fiber-optic',
        'method-numerical-aperture',
      ]),
    )
    expect(
      applicationById('app-pid-servo')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-ziegler-nichols',
        'method-algo-zn-pid',
        'method-pid',
      ]),
    )
    // family labels resolve
    const groups = applicationsGroupedByFamily()
    expect(groups.find((g) => g.familyId === 'family-optical-instrument')?.label).toMatch(
      /光学|干涉|滤波|光谱/,
    )
    expect(groups.find((g) => g.familyId === 'family-control')?.label).toMatch(/控制|PID|伺服/)
    const optFam = groups.find((g) => g.familyId === 'family-optical-instrument')
    expect(optFam && optFam.apps.length).toBeGreaterThanOrEqual(3)
    expect(optFam?.apps.some((a) => a.id === 'app-sagnac-gyro')).toBe(true)
    // 边仅引用已存在 id
    const fog = applicationById('app-sagnac-gyro')!
    const ps = applicationById('app-pid-servo')!
    for (const { level } of [...flattenLevels(fog), ...flattenLevels(ps)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })




  it('新增应用：托卡马克Lawson / 超导腔 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-tokamak-lawson',
        goal: { from: 'nuclear', to: 'electric' },
        familyId: 'family-fusion',
        category: 'energy',
      },
      {
        id: 'app-sc-cavity',
        goal: { from: 'electric', to: 'electric' },
        familyId: 'family-superconducting',
        category: 'device',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 托卡马克：系统 → 等离子体Lawson → MHD → 包层 → 热机电
    const tkPath = levelAtPath(applicationById('app-tokamak-lawson')!, [
      'tk-system',
      'tk-plasma-lawson',
      'tk-mhd-confinement',
      'tk-blanket',
      'tk-power-cycle',
    ])
    expect(tkPath?.id).toBe('tk-power-cycle')
    expect((tkPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // 超导腔：系统 → 驱动 → 腔Q → 伦敦壁 → 耦合取出
    const scPath = levelAtPath(applicationById('app-sc-cavity')!, [
      'sc-system',
      'sc-source-drive',
      'sc-cavity-q',
      'sc-london-wall',
      'sc-couple-out',
    ])
    expect(scPath?.id).toBe('sc-couple-out')
    expect((scPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-tokamak-lawson')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-lawson-criterion',
        'method-algo-lawson-ntt',
        'method-alfven-speed',
        'method-mhd-generator',
      ]),
    )
    expect(
      applicationById('app-sc-cavity')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-q-factor',
        'method-algo-q-factor',
        'method-london-penetration',
        'method-fabry-perot',
      ]),
    )
    // family labels resolve
    const groups = applicationsGroupedByFamily()
    expect(groups.find((g) => g.familyId === 'family-fusion')?.label).toMatch(
      /聚变|Lawson|托卡马克/,
    )
    expect(groups.find((g) => g.familyId === 'family-superconducting')?.label).toMatch(
      /超导|Q|腔/,
    )
    // 边仅引用已存在 id
    const tk = applicationById('app-tokamak-lawson')!
    const sc = applicationById('app-sc-cavity')!
    for (const { level } of [...flattenLevels(tk), ...flattenLevels(sc)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })





  it('新增应用：NMR拉比脉冲 / 超导量子比特腔QED 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-nmr-rabi',
        goal: { from: 'electromagnetic', to: 'electric' },
        familyId: 'family-mri-sensing',
        category: 'sensing',
      },
      {
        id: 'app-sc-qubit-cavity',
        goal: { from: 'electric', to: 'electromagnetic' },
        familyId: 'family-superconducting',
        category: 'compute',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // NMR：系统 → B0拉莫尔 → 拉比脉冲 → Bloch接收
    const nmrPath = levelAtPath(applicationById('app-nmr-rabi')!, [
      'nmr-system',
      'nmr-b0-larmor',
      'nmr-rf-rabi',
      'nmr-bloch-receive',
    ])
    expect(nmrPath?.id).toBe('nmr-bloch-receive')
    expect((nmrPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // 超导比特：系统 → 约瑟夫森 → 腔Q → 珀塞尔读出
    const sqcPath = levelAtPath(applicationById('app-sc-qubit-cavity')!, [
      'sqc-system',
      'sqc-josephson-qubit',
      'sqc-cavity-q',
      'sqc-purcell-readout',
    ])
    expect(sqcPath?.id).toBe('sqc-purcell-readout')
    expect((sqcPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-nmr-rabi')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-larmor-precession',
        'method-algo-larmor-omega',
        'method-rabi',
        'method-algo-rabi-freq',
        'method-bloch',
      ]),
    )
    expect(
      applicationById('app-sc-qubit-cavity')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-josephson',
        'method-critical-current',
        'method-purcell-factor',
        'method-q-factor',
        'method-london-penetration',
      ]),
    )
    // family labels resolve
    const groups = applicationsGroupedByFamily()
    expect(groups.find((g) => g.familyId === 'family-mri-sensing')?.label).toMatch(
      /MRI|NMR|拉比|自旋/,
    )
    expect(groups.find((g) => g.familyId === 'family-superconducting')?.label).toMatch(
      /超导|Q|腔|量子/,
    )
    // superconducting family has ≥2 members (cavity + qubit)
    const scFam = groups.find((g) => g.familyId === 'family-superconducting')
    expect(scFam && scFam.apps.length).toBeGreaterThanOrEqual(2)
    expect(scFam?.apps.some((a) => a.id === 'app-sc-qubit-cavity')).toBe(true)
    // 边仅引用已存在 id
    const nmr = applicationById('app-nmr-rabi')!
    const sqc = applicationById('app-sc-qubit-cavity')!
    for (const { level } of [...flattenLevels(nmr), ...flattenLevels(sqc)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })





  it('新增应用：雷达链路方程 / 拉姆齐原子钟 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-radar-link',
        goal: { from: 'electromagnetic', to: 'electric' },
        familyId: 'family-rf-link',
        category: 'sensing',
      },
      {
        id: 'app-atomic-clock-ramsey',
        goal: { from: 'electric', to: 'electric' },
        familyId: 'family-quantum-control',
        category: 'sensing',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 雷达：系统 → 发射天线 → 传播RCS → 接收探测
    const rlkPath = levelAtPath(applicationById('app-radar-link')!, [
      'rlk-system',
      'rlk-tx-antenna',
      'rlk-propagate-rcs',
      'rlk-rx-detect',
    ])
    expect(rlkPath?.id).toBe('rlk-rx-detect')
    expect((rlkPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // 原子钟：系统 → 本振驱动 → 拉姆齐询问 → 读出锁定
    const acrPath = levelAtPath(applicationById('app-atomic-clock-ramsey')!, [
      'acr-system',
      'acr-lo-drive',
      'acr-ramsey-interrogation',
      'acr-readout-lock',
    ])
    expect(acrPath?.id).toBe('acr-readout-lock')
    expect((acrPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-radar-link')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-radar-equation',
        'method-algo-radar-pr',
        'method-fspl',
        'method-snr',
        'method-link-budget',
      ]),
    )
    expect(
      applicationById('app-atomic-clock-ramsey')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-ramsey',
        'method-rabi',
        'method-larmor-precession',
        'method-shannon-capacity',
      ]),
    )
    // family labels resolve；rf-link 族 ≥2 成员
    const groups = applicationsGroupedByFamily()
    expect(groups.find((g) => g.familyId === 'family-rf-link')?.label).toMatch(/RF|VSWR|匹配/)
    expect(groups.find((g) => g.familyId === 'family-quantum-control')?.label).toMatch(
      /量子|拉姆齐|原子钟/,
    )
    const rfFam = groups.find((g) => g.familyId === 'family-rf-link')
    expect(rfFam && rfFam.apps.length).toBeGreaterThanOrEqual(2)
    expect(rfFam?.apps.some((a) => a.id === 'app-radar-link')).toBe(true)
    expect(rfFam?.apps.some((a) => a.id === 'app-rf-link-vswr')).toBe(true)
    // rabi drive edge present on atomic clock
    const acr = applicationById('app-atomic-clock-ramsey')!
    const allEdges = flattenLevels(acr).flatMap((x) => x.level.edgeIds ?? [])
    expect(allEdges).toContain('electric-to-electromagnetic-rabi-drive')
    // 边仅引用已存在 id
    const rlk = applicationById('app-radar-link')!
    for (const { level } of [...flattenLevels(rlk), ...flattenLevels(acr)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })



  it('新增应用：对流传热Nu-Re-Pr / SQUID磁强计 均存在且树深≥3', () => {
    const specs = [
      {
        id: 'app-convective-cooling',
        goal: { from: 'thermal', to: 'thermal' },
        familyId: 'family-heat-transfer',
        category: 'device',
      },
      {
        id: 'app-squid-magnetometer',
        goal: { from: 'electromagnetic', to: 'electric' },
        familyId: 'family-superconducting',
        category: 'sensing',
      },
    ] as const
    for (const s of specs) {
      const app = applicationById(s.id)
      expect(app, s.id).toBeDefined()
      expect(app!.category).toBe(s.category)
      expect(app!.goal).toEqual(s.goal)
      expect(app!.familyId).toBe(s.familyId)
      const depths = flattenLevels(app!).map((x) => x.depth)
      expect(Math.max(...depths), s.id).toBeGreaterThanOrEqual(3)
    }
    // 对流冷却：系统 → Re流态 → Nu-Pr → Fourier壁
    const ccPath = levelAtPath(applicationById('app-convective-cooling')!, [
      'cc-system',
      'cc-forced-flow',
      'cc-nusselt-pr',
      'cc-wall-fourier',
    ])
    expect(ccPath?.id).toBe('cc-wall-fourier')
    expect((ccPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    // SQUID：系统 → 伦敦拾取 → 约瑟夫森 → 磁通读出
    const sqmPath = levelAtPath(applicationById('app-squid-magnetometer')!, [
      'sqm-system',
      'sqm-pickup-london',
      'sqm-josephson',
      'sqm-flux-readout',
    ])
    expect(sqmPath?.id).toBe('sqm-flux-readout')
    expect((sqmPath?.methodIds?.length ?? 0)).toBeGreaterThan(0)
    expect(
      applicationById('app-convective-cooling')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-reynolds-number',
        'method-nusselt-number',
        'method-prandtl-number',
        'method-fourier-law',
      ]),
    )
    expect(
      applicationById('app-squid-magnetometer')!.levels[0]!.methodIds,
    ).toEqual(
      expect.arrayContaining([
        'method-squid',
        'method-algo-squid-flux',
        'method-josephson',
        'method-london-penetration',
      ]),
    )
    // family labels resolve
    const groups = applicationsGroupedByFamily()
    expect(groups.find((g) => g.familyId === 'family-heat-transfer')?.label).toMatch(
      /传热|对流|Nu|Re|Pr|导热/,
    )
    expect(groups.find((g) => g.familyId === 'family-superconducting')?.label).toMatch(
      /超导|SQUID|Q|腔|量子/,
    )
    // superconducting family has ≥3 members (cavity + qubit + squid)
    const scFam = groups.find((g) => g.familyId === 'family-superconducting')
    expect(scFam && scFam.apps.length).toBeGreaterThanOrEqual(3)
    expect(scFam?.apps.some((a) => a.id === 'app-squid-magnetometer')).toBe(true)
    // convection edges present
    const cc = applicationById('app-convective-cooling')!
    const ccEdges = flattenLevels(cc).flatMap((x) => x.level.edgeIds ?? [])
    expect(ccEdges).toEqual(
      expect.arrayContaining([
        'thermal-to-thermal-heatexchange',
        'thermal-to-thermal-fourier-conduction',
      ]),
    )
    // squid edges: josephson + london
    const sqm = applicationById('app-squid-magnetometer')!
    const sqmEdges = flattenLevels(sqm).flatMap((x) => x.level.edgeIds ?? [])
    expect(sqmEdges).toEqual(
      expect.arrayContaining([
        'electric-to-electromagnetic-josephson-ac',
        'electric-to-electromagnetic-london-sc',
        'electromagnetic-to-electric-meissner-expulsion',
      ]),
    )
    // 边仅引用已存在 id
    for (const { level } of [...flattenLevels(cc), ...flattenLevels(sqm)]) {
      for (const e of level.edgeIds ?? []) expect(edgeSet.has(e), e).toBe(true)
    }
  })


})
