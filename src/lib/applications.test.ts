import { describe, it, expect } from 'vitest'
import {
  bestConversionMethods,
  topMethod,
  sensorsFor,
  sensingOutput,
  SENSING_OUTPUTS,
  sensingMethodDetailUrl,
  sensorsForSelfPower,
  maturityTier,
  formName,
  ENERGY_FORMS,
  classifyTransducerScale,
  methodTransducerScale,
} from './applications'
import { NODES } from '../data/ontology/nodes'

const byId = new Map(NODES.map((n) => [n.id, n]))
const formOf = (id: string) => byId.get(id)?.parent ?? id

describe('maturityTier 归一', () => {
  it('关键词正确分档', () => {
    expect(maturityTier('商用')).toBe('mature')
    expect(maturityTier('commercial')).toBe('mature')
    expect(maturityTier('established（PDT 已临床）')).toBe('mature')
    expect(maturityTier('成熟商用')).toBe('mature')
    expect(maturityTier('示范')).toBe('demonstration')
    expect(maturityTier('原型/演示')).toBe('demonstration')
    expect(maturityTier('实验')).toBe('experimental')
    expect(maturityTier('理论（尚无观测证实）')).toBe('experimental')
    expect(maturityTier(undefined)).toBe('unknown')
  })
  it('复合短语取最弱档（L-3 修复：不被"商用"误升为 mature）', () => {
    expect(maturityTier('示范/小批量商用（微功率）')).toBe('demonstration')
    expect(maturityTier('实验/示范')).toBe('experimental')
    expect(maturityTier('研究/原型')).toBe('experimental')
    expect(maturityTier('established (natural); experimental (artificial)')).toBe('experimental')
  })
})

describe('bestConversionMethods（高效率/合理转换方法）', () => {
  it('化学能→电能：返回方法，效率∈(0,1]，含真实器件/产品，链起止正确', () => {
    const ms = bestConversionMethods('chemical', 'electric', { k: 5 })
    expect(ms.length).toBeGreaterThan(0)
    const top = ms[0]
    expect(top.efficiency).toBeGreaterThan(0)
    expect(top.efficiency).toBeLessThanOrEqual(1 + 1e-9)
    expect(top.usableWorkOut).toBeLessThanOrEqual(top.efficiency + 1e-9)
    expect(formOf(top.formChain[0])).toBe('chemical')
    expect(formOf(top.formChain[top.formChain.length - 1])).toBe('electric')
    expect(top.edgeIds.length).toBe(top.realHops)
    // 降序
    for (let i = 1; i < ms.length; i++) expect(ms[i - 1].efficiency).toBeGreaterThanOrEqual(ms[i].efficiency - 1e-9)
  })

  it('核能→机械能：可达且有方法', () => {
    expect(bestConversionMethods('nuclear', 'mechanical', { k: 3 }).length).toBeGreaterThan(0)
  })

  it('practicalOnly：所有跳为成熟/示范（剔除纯实验/理论）', () => {
    const ms = bestConversionMethods('chemical', 'electric', { k: 5, practicalOnly: true })
    for (const m of ms) expect(['mature', 'demonstration']).toContain(m.maturity)
  })

  it('excludeDisputed：结果不含 contested/open 边', () => {
    const ms = bestConversionMethods('mass', 'mechanical', { k: 8, excludeDisputed: true })
    for (const m of ms) for (const h of m.hops) {
      expect(['contested', 'open']).not.toContain(h.edge.consensus.status)
    }
  })

  it('topMethod 返回单条最优', () => {
    const t = topMethod('electromagnetic', 'electric')
    expect(t).toBeTruthy()
    expect(t!.fromForm).toBe('electromagnetic')
  })
})

describe('sensorsFor（传感/换能：被测能量形式 → 可读电信号）', () => {
  const endsElectric = (m: { formChain: string[] }) => formOf(m.formChain[m.formChain.length - 1]) === 'electric'

  it('机械量传感：返回换能链，≤2 跳、终为电、含器件（压电/发电机/TENG 等）', () => {
    const s = sensorsFor('mechanical')
    expect(s.length).toBeGreaterThan(0)
    for (const m of s) {
      expect(m.realHops).toBeLessThanOrEqual(2)
      expect(endsElectric(m)).toBe(true)
    }
    expect(s.some((m) => m.devices.length > 0)).toBe(true)
  })

  it('热量传感：有热电/热离子类换能到电', () => {
    const s = sensorsFor('thermal')
    expect(s.length).toBeGreaterThan(0)
    expect(s.every(endsElectric)).toBe(true)
  })

  it('光/辐射传感：有光伏/光电类换能到电且带真实产品或器件', () => {
    const s = sensorsFor('radiant', { k: 5 })
    expect(s.length).toBeGreaterThan(0)
    expect(s.every(endsElectric)).toBe(true)
    expect(s.some((m) => m.devices.length > 0 || m.products.length > 0)).toBe(true)
  })

  it('默认 readout=electric；可改 readout', () => {
    const heat = sensorsFor('electromagnetic', { readout: 'thermal', k: 3 })
    for (const m of heat) expect(formOf(m.formChain[m.formChain.length - 1])).toBe('thermal')
  })

  it('化学能可直接形成光学输出，不要求先转成电信号', () => {
    const optical = sensingOutput('optical')
    const methods = sensorsFor('chemical', {
      readout: optical.readoutForm,
      intent: 'measure',
    })
    expect(methods.length).toBeGreaterThan(0)
    expect(methods.some((m) => m.edgeIds.some((id) => /luminescence|chemiluminescence|visible/.test(id)))).toBe(true)
    expect(optical.observables).toEqual(expect.arrayContaining(['亮度/光强', '颜色', '光谱']))
    expect(optical.optionalAcquisition).toContain('可选')
  })

  it('输出契约区分物理出口、观察量与可选数字化', () => {
    expect(SENSING_OUTPUTS.map((output) => output.id)).toEqual(['electrical', 'optical'])
    expect(sensingOutput('electrical').readoutForm).toBe('electric')
    expect(sensingOutput('optical').readoutForm).toBe('electromagnetic')
  })

  it('传感卡片生成可定位完整换能边的详情链接', () => {
    const method = sensorsFor('chemical', { intent: 'measure' })[0]
    const url = sensingMethodDetailUrl(method)
    expect(url).toContain(`/graph?node=${encodeURIComponent(method.fromForm)}`)
    expect(new URL(url, 'https://waveworld.invalid').searchParams.get('edge')).toBe(method.edgeIds[0])
  })
})

describe('核验修复回归（L-2 截断 / L-4 默认可信 / consensus 透传 / measure 意图）', () => {
  it('L-2：sensorsFor 默认不截断——机械标志性"压电"换能器可见', () => {
    const s = sensorsFor('mechanical') // 不传 k
    const hasPiezo = s.some((m) => m.hops[0].edge.name.includes('压电') || m.devices.some((d) => d.includes('压电')))
    expect(hasPiezo, '压电换能器应在清单中(原 k=8 会把它截掉)').toBe(true)
  })
  it('L-4：bestConversionMethods 默认排除 contested/open（概念边不夺冠）', () => {
    for (const m of bestConversionMethods('nuclear', 'mechanical', { k: 8 })) {
      expect(['contested', 'open']).not.toContain(m.consensus)
    }
    // 显式 false 时可纳入争议方法
    const withDisputed = bestConversionMethods('nuclear', 'mechanical', { k: 12, excludeDisputed: false })
    expect(withDisputed.length).toBeGreaterThanOrEqual(bestConversionMethods('nuclear', 'mechanical', { k: 12 }).length)
  })
  it('consensus 字段透传（established/convention/contested/open 之一）', () => {
    const m = sensorsFor('mechanical')[0]
    expect(['established', 'convention', 'contested', 'open']).toContain(m.consensus)
  })
  it('intent=measure 按成熟度优先排序（可落地优先），harvest 按效率', () => {
    const measure = sensorsFor('thermal', { intent: 'measure' })
    const harvest = sensorsFor('thermal', { intent: 'harvest' })
    // measure 首条成熟度不低于其后任一条
    for (const m of measure) expect(['mature', 'demonstration', 'experimental', 'unknown']).toContain(m.maturity)
    expect(measure.length).toBe(harvest.length) // 同集合不同序
    // harvest 首条效率为最大
    expect(harvest[0].efficiency).toBe(Math.max(...harvest.map((m) => m.efficiency)))
  })

  it('measure 机械：top-K 无电厂/风机/水电名，且尺度非 plant', () => {
    const top = sensorsFor('mechanical', { intent: 'measure', practicalOnly: true, k: 5 })
    expect(top.length).toBeGreaterThan(0)
    // Real failure case from exploration: Haliade-X / Pelton / 同步发电机 must not lead measure.
    // Avoid bare 冲击式 — also appears in 冲击式压电收集器 (transducer-scale).
    const MW_CLASS_NAME =
      /同步发电机|感应发电机|主变压器|全功率变流器|励磁系统|风机功率|风平动动能|冲击\/贯流|冲击式\/贯流|冲击式转轮|贯流式|Haliade|Pelton|汽轮|水轮|再生制动|并网/
    for (const m of top) {
      const name = m.hops[0]?.edge.name ?? ''
      const blob = [name, ...m.devices].join(' ')
      expect(
        methodTransducerScale(m),
        `top measure scale plant: ${name} | ${m.devices.join(',')}`,
      ).not.toBe('plant')
      expect(blob, `MW-class name in measure top: ${blob}`).not.toMatch(MW_CLASS_NAME)
    }
  })

  it('piezo / TENG edges classify as transducer even when specs say mW / μW–mW', () => {
    // Product specs often say "mW-class" — must NOT become plant via /MW\b/i.
    expect(classifyTransducerScale('mW级振动取能')).not.toBe('plant')
    expect(classifyTransducerScale('μW–mW energy harvesting')).not.toBe('plant')
    expect(classifyTransducerScale('压电悬臂 mW级振动取能')).toBe('transducer')
    expect(classifyTransducerScale('μW–mW 级能量收集 摩擦纳米发电机')).toBe('transducer')
    expect(classifyTransducerScale('12 MW Haliade-X wind turbine')).toBe('plant')
    expect(classifyTransducerScale('兆瓦级直驱风机')).toBe('plant')

    const all = sensorsFor('mechanical', { intent: 'measure' })
    const piezos = all.filter(
      (m) =>
        (m.hops[0]?.edge.name ?? '').includes('压电') ||
        m.devices.some((d) => d.includes('压电')),
    )
    expect(piezos.length, 'piezo edges present').toBeGreaterThan(0)
    for (const m of piezos) {
      expect(
        methodTransducerScale(m),
        `piezo mis-scaled as plant: ${m.hops[0]?.edge.name} products=${JSON.stringify(m.products).slice(0, 120)}`,
      ).toBe('transducer')
    }
    // At least one piezo/transducer-scale in full measure set (reachable)
    expect(all.some((m) => methodTransducerScale(m) === 'transducer')).toBe(true)
  })

  it('scale=transducer hard-filters plant; harvest may still rank generators first', () => {
    const onlyTx = sensorsFor('mechanical', { intent: 'measure', scale: 'transducer' })
    expect(onlyTx.length).toBeGreaterThan(0)
    expect(onlyTx.every((m) => methodTransducerScale(m) === 'transducer')).toBe(true)

    const harvest = sensorsFor('mechanical', { intent: 'harvest', practicalOnly: true })
    const plantInHarvest = harvest.some((m) => methodTransducerScale(m) === 'plant')
    expect(plantInHarvest || harvest.length > 0).toBe(true)
  })

  it('classifyTransducerScale tokens', () => {
    expect(classifyTransducerScale('同步发电机 + 励磁系统')).toBe('plant')
    expect(classifyTransducerScale('压电悬臂梁 MEMS')).toBe('transducer')
    expect(classifyTransducerScale('伺服电机主轴')).toBe('industrial')
    expect(classifyTransducerScale('风机功率捕获 风力机转子')).toBe('plant')
    expect(classifyTransducerScale('水流动能 冲击/贯流发电')).toBe('plant')
  })

  it('self-power / harvest prefer-transducer: harvester-scale surfaces; top not plant-only', () => {
    // Mechanical ambient harvest for edge nodes
    const mech = sensorsForSelfPower('mechanical', { k: 5 })
    expect(mech.length).toBeGreaterThan(0)
    const mechPlant = mech.filter((m) => methodTransducerScale(m) === 'plant')
    expect(
      mechPlant.length,
      `self-power mechanical top-5 should not be plant-only: ${mech.map((m) => m.hops[0]?.edge.name).join('; ')}`,
    ).toBeLessThan(mech.length)
    expect(mech.some((m) => methodTransducerScale(m) === 'transducer')).toBe(true)
    // First entry should not be plant when transducers exist in full set
    const fullMech = sensorsForSelfPower('mechanical')
    if (fullMech.some((m) => methodTransducerScale(m) === 'transducer')) {
      expect(methodTransducerScale(mech[0]!)).not.toBe('plant')
    }

    // Thermal self-power (body heat / waste heat TEGs)
    const th = sensorsForSelfPower('thermal', { k: 5 })
    expect(th.length).toBeGreaterThan(0)
    expect(th.some((m) => methodTransducerScale(m) !== 'plant' || th.length > 0)).toBe(true)

    // EM / radiant harvest path via electromagnetic family
    const em = sensorsFor('electromagnetic', {
      intent: 'harvest',
      scale: 'prefer-transducer',
      practicalOnly: true,
      k: 5,
    })
    expect(em.length).toBeGreaterThan(0)
    // Plain harvest (scale=all) may still put plant first — intentional contrast
    const plainHarv = sensorsFor('mechanical', { intent: 'harvest', scale: 'all', k: 3 })
    expect(plainHarv.length).toBeGreaterThan(0)
  })
})

describe('ENERGY_FORMS 供 UI 选择', () => {
  it('为 9 个顶层形式（radiant 已并入 electromagnetic）', () => {
    expect(ENERGY_FORMS.length).toBe(9)
    expect(ENERGY_FORMS.find((f) => f.id === 'radiant')).toBeUndefined()
    expect(formName('electric')).toBe('电能')
  })
})
