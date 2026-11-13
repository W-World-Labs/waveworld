import { describe, expect, it } from 'vitest'
import {
  derivePlainEn,
  derivePlainZh,
  explainFormula,
  formatSampleNumber,
  formulaVarMeaning,
  parseAssignment,
} from './formulaExplain'

describe('formulaExplain — KUX 靶 C 解释层', () => {
  it('parseAssignment 识别 lhs = rhs', () => {
    expect(parseAssignment('eta = P_dc / P_rf')).toEqual({
      lhs: 'eta',
      rhs: 'P_dc / P_rf',
    })
    expect(parseAssignment('2*pi*f')).toBeNull()
  })

  it('derivePlainZh 优先 plainZh', () => {
    expect(
      derivePlainZh({
        expr: 'eta = a/b',
        vars: {},
        plainZh: '直流输出功率占射频入射功率的比例',
      }),
    ).toBe('直流输出功率占射频入射功率的比例')
  })

  it('derivePlainZh 从 vars 拼「计算 lhs（含义）」', () => {
    expect(
      derivePlainZh({
        expr: 'Phi = N_react / N_absorbed',
        vars: {
          Phi: '量子产率',
          N_react: '反应分子数',
          N_absorbed: '吸收光子数',
        },
      }),
    ).toBe('计算 Phi（量子产率）')
  })

  it('derivePlainZh 对 eta 有可读兜底', () => {
    const s = derivePlainZh({
      expr: 'eta = P_dc / P_rf',
      vars: { P_dc: '输出直流功率 W', P_rf: '接收射频功率 W' },
    })
    expect(s).toMatch(/效率|eta/i)
  })

  it('explainFormula 产出变量表 + 算例', () => {
    const v = explainFormula({
      expr: 'eta = P_dc / P_rf',
      vars: { P_dc: '输出直流功率 W', P_rf: '接收射频功率 W' },
      sample: { P_dc: 0.0775, P_rf: 0.1 },
      expected: 0.775,
    })
    expect(v.plainZh.length).toBeGreaterThan(4)
    expect(v.plainEn && v.plainEn.length).toBeGreaterThan(4)
    expect(v.plainEn).not.toMatch(/[\u4e00-\u9fff]/)
    expect(v.lhs).toBe('eta')
    expect(v.vars.map((r) => r.symbol).sort()).toEqual(['P_dc', 'P_rf'])
    expect(v.hasSample).toBe(true)
    expect(v.expected).toBe(0.775)
  })

  it('derivePlainEn 优先 plainEn 且无 CJK', () => {
    expect(
      derivePlainEn({
        expr: 'eta = a/b',
        vars: {},
        plainEn: 'DC output power over incident RF power.',
      }),
    ).toBe('DC output power over incident RF power.')
  })

  it('formulaVarMeaning en maps common Chinese unit strings', () => {
    expect(formulaVarMeaning('电流 A', 'zh')).toBe('电流 A')
    expect(formulaVarMeaning('电流 A', 'en')).toMatch(/current/i)
    expect(formulaVarMeaning('电流 A', 'en')).not.toMatch(/[\u4e00-\u9fff]/)
    expect(formulaVarMeaning('光速 m/s', 'en')).toMatch(/light/i)
  })

  it('formulaVarMeaning en keeps descriptive words not unit-only stubs', () => {
    const samples = [
      ['半径 m', /radius/i],
      ['库仑力 N', /coulomb|force/i],
      ['洛伦兹力 N', /lorentz|force/i],
      ['质量亏损 kg', /mass|defect/i],
      ['0 K 外推带隙 eV', /bandgap|extrapolat/i],
      ['半衰期 yr', /half[- ]?life/i],
      ['Grüneisen 参数', /grüneisen|gruneisen/i],
      ['Förster 半径 nm', /förster|forster|radius/i],
      ['α 沉积功率 W', /deposit|α|alpha|power/i],
      ['发光速率 1/s', /emission|luminesc|rate/i],
      // Q residual: wrong/truncated stubs that once leaked into FormulaBlock EN
      ['圆周率', /pi|π/i],
      ['损耗角正切', /loss\s*tangent/i],
      ['往返损耗量级', /round[- ]?trip|loss/i],
      ['平均无量纲优值', /figure of merit|dimensionless/i],
      ['库仑对数', /coulomb/i],
      ['力 N', /force/i],
      ['第 m 级强度 a.u.', /order|intensity|diffraction/i],
      ['转移电子数', /electron/i],
      ['马德隆常数', /madelung/i],
      ['斯皮策预因子', /spitzer/i],
      ['输入齿数', /tooth|gear/i],
      ['能隙 eV 或任意同单位', /gap|eV/i],
      ['噪声系数 dB', /noise figure|dB/i],
      ['消耗的三线态激发能 J', /triplet|excitation/i],
      ['三线态储能 eV', /triplet|eV/i],
      // Q residual thin glosses: unit splits / truncated stubs
      ['0 K 外推带隙 eV', /bandgap|eV/i],
      ['条纹可见度 1', /fringe|visibility/i],
      ['斯特列尔比 1', /strehl/i],
      ['切断比 1', /cutoff|ratio/i],
      ['功函数 eV', /work function|eV/i],
      ['每 100 eV 产额', /yield|100 eV/i],
      ['电子温度 eV', /electron temperature|eV/i],
      ['正向功率透射 1', /forward|transmission|power/i],
      ['荧光量子产率', /fluorescence|quantum yield/i],
      ['He-4 结合能/核子 (MeV)', /binding|MeV|nucleon/i],
      // Q residual more thin: joined tokens / leading-slash / stub nouns
      ['动能份额 1', /kinetic|energy|fraction/i],
      ['吸收份额 1', /absorb/i],
      ['透射份额 1', /transmit/i],
      ['勒夫数 1', /love\s*number/i],
      ['理想反射辐射力 N', /radiation|force/i],
      ['阿贝最小半宽 m', /abbe|half[- ]?width/i],
      ['约束时间标度 s', /confinement|time/i],
      ['能量约束时间 s', /confinement|time/i],
      ['功放→有效 B1 场功率效率 1', /B1|RF|amp|efficiency/i],
      ['势能→动能转换效率 1', /potential|kinetic|efficiency/i],
      ['每秒裂变数 (1/s)', /fission|per\s*second|1\/s/i],
      ['每焦耳产额 mol/J', /yield|joule|mol/i],
      ['离子温度 keV', /ion|temperature|keV/i],
      ['沉积能量 MeV', /deposit|energy|MeV/i],
      ['每次裂变总能量 MeV', /fission|energy|MeV/i],
      ['入射/馈入电磁功率 W', /incident|electromagnetic|power/i],
      ['单线态氧/ROS 量子产率因子 1', /singlet|ROS|quantum/i],
      ['珀塞尔因子 1', /purcell/i],
      ['系间窜越产率 1', /intersystem|crossing|yield/i],
      ['集–射电压 V', /collector|emitter|voltage/i],
      // Q residual thin-again: joined/truncated Efficiency/Voltage/Electrical stubs
      ['电压驻波比 1', /standing[- ]?wave|VSWR|voltage/i],
      ['星座点数 1', /constellation|point/i],
      ['转移电子数 1', /electron|transfer/i],
      ['峰均比线性 1', /peak|mean|ratio/i],
      ['机械指数 1', /mechanical|index/i],
      ['压比', /pressure\s*ratio/i],
      ['完全吸收时力 N', /force|absorption/i],
      ['初压 Pa', /initial|pressure/i],
      ['电离份额 1', /ionization|fraction/i],
      ['跨膜电位 V', /transmembrane|potential/i],
      ['驻点\/静压比 1', /stagnation|static|pressure/i],
      ['水力功率 W', /hydraulic|power/i],
      ['天线辐射效率 1', /antenna|radiation|efficiency/i],
      ['孔径效率 1', /aperture|efficiency/i],
      ['品质因数 1', /quality\s*factor/i],
      // Q residual thin remain: bare Efficiency/Electrical + wrong trunc glosses
      ['效率', /efficiency/i],
      ['效率 1', /efficiency/i],
      ['注入效率', /injection|efficiency/i],
      ['实测效率', /measured|efficiency/i],
      ['系统效率近似', /system|efficiency|approximate/i],
      ['静态介电', /static|permittivity|dielectric/i],
      ['高频介电', /high[- ]?frequency|permittivity|dielectric/i],
      ['隧穿电流份额 1', /tunnel|current|fraction/i],
      ['线圈匝数', /coil|turns/i],
      ['终容积 m3', /final|volume/i],
      ['冲量 N·s', /impulse/i],
      ['物理口径 m²', /physical|aperture|area/i],
      ['辐射压力 N', /radiation|pressure|force/i],
      ['界面化学反应净储能\/键能变化 J', /chemical|bond|energy|interfacial/i],
      ['静电力 N', /electrostatic|force/i],
      ['有效接收口径 m²', /effective|receiving|aperture/i],
      ['磁通量子 Wb', /flux\s*quantum|Wb/i],
      ['阿尔芬速度 m\/s', /alfv[eé]n|speed/i],
      // Q residual thin remain2: joined/truncated/wrong calques
      ['入射 RF', /incident\s*RF/i],
      ['内损', /internal\s*loss/i],
      ['净产额', /net\s*yield/i],
      ['初容积 m3', /initial\s*volume/i],
      ['可用直流功率 W', /available|DC power/i],
      ['吸收射频能量 J', /absorbed\s*RF/i],
      ['吸收微波能 J', /absorbed\s*microwave/i],
      ['天线接收射频能量 J', /antenna|received\s*RF/i],
      ['太阳辐照 W\/m\^2', /solar\s*irradiance/i],
      ['实际 JT 温降 K', /joule|thomson|JT/i],
      ['对流量 W', /convective/i],
      ['导体长 m', /conductor\s*length/i],
      ['底物反应 1\/s', /substrate/i],
      ['放射性原子数', /radioactive|atom/i],
      ['敏化剂吸收的激发通量 mol\/\(L·s\)', /sensitizer|excitation\s*flux/i],
      ['有效化学能\/带隙尺度 J', /chemical\s*energy|bandgap/i],
      ['有用通道 1\/s', /useful\s*channel|channel\s*flux/i],
      ['泄漏电阻 Ω', /leakage\s*resistance/i],
      ['泵浦波长 m', /pump\s*wavelength/i],
      ['涡流等效电阻 Ω', /eddy/i],
      ['激光通量 J\/m\^2', /fluence|laser/i],
      ['激发波长 m', /excitation\s*wavelength/i],
      ['灵敏体积内沉积能量份额', /sensitive\s*volume|deposited/i],
      ['物质的量 mol', /amount of substance/i],
      ['特征频率 Hz', /characteristic\s*frequency/i],
      ['生成 ROS 当量数 mol', /ROS\s*equivalent/i],
      ['电压增益幅度 1', /voltage.?gain|amplitude/i],
      ['电阻率', /resistivity/i],
      ['相对下游高程 \(m\)', /elevation|downstream/i],
      ['碎片电荷 C', /fragment\s*charge/i],
      ['积累电荷 C', /accumul/i],
      ['空气密度 kg\/m³', /air\s*density/i],
      ['第二维里 m³', /virial/i],
      ['等效电容 F', /equivalent\s*capacitance/i],
      ['等效转换质量 kg', /equivalent.*mass/i],
      ['管长 m', /tube\s*length|pipe/i],
      ['粘滞阻尼', /viscous\s*damping/i],
      ['线圈电阻 Ω', /coil\s*resistance/i],
      ['细胞条件下 \|ΔG_ATP\| J\/mol', /ATP|cellular|in-?vivo/i],
      ['绕组电阻 Ω', /winding\s*resistance/i],
      ['翻倒角 rad', /flip\s*angle/i],
      ['耦合 RF 功率 W', /coupled\s*RF/i],
      ['耦合射频能量 J', /coupled\s*RF\s*energy/i],
      ['膜电容 F', /membrane\s*capacitance/i],
      ['自由基数代理', /radical|proxy/i],
      ['自由空间率', /free[- ]space/i],
      ['表面反射率', /surface\s*reflectance/i],
      ['转动惯量 kg·m\^2', /moment of inertia|inertia/i],
      ['转移电荷 C', /transfer.*charge|charge.*transfer/i],
      ['辐射电阻 Ω', /radiation\s*resistance/i],
      ['过机水质量 kg', /water\s*mass|throughput/i],
      ['过电位当量 eV', /overpotential/i],
      ['进入自旋系统功率 W', /spin\s*system/i],
      ['选通带宽 nm', /gat(e|ing).*bandwidth|bandwidth.*gat/i],
      ['量子亏损上限 1', /quantum[- ]defect/i],
      ['阳离子电荷数 1', /cation/i],
      ['阴离子电荷数 1', /anion/i],
      ['阻力系数', /drag\s*coefficient/i],
      ['阻尼损 W', /damping\s*loss/i],
      ['音圈导线长 m', /voice[- ]coil|wire\s*length/i],
      ['驱动频率 Hz', /drive\s*frequency/i],
      // Q residual thin remain3: joined/truncated/wrong Electrical·Capacitance calques
      ['伸长量 m', /elongat|extension/i],
      ['净水头 m', /net\s*hydraulic\s*head/i],
      ['初温 K', /initial\s*temperature/i],
      ['升降温速率 K\/s', /temperature|ramp|rate/i],
      ['有效羟基当量 mol', /hydroxyl|effective/i],
      ['瑞利指数(>0即声放大)', /rayleigh/i],
      ['电容储能 J', /capacitiv|stored\s*energy/i],
      ['电容初始储能 J', /initial|capacitiv|stored/i],
      ['电容梯度 F\/m', /capacitance\s*gradient/i],
      ['电容静电能 J', /capacitiv|electrostatic/i],
      ['电极电位差 V', /electrode\s*potential/i],
      ['电极静电能 J', /electrode|electrostatic/i],
      ['电池电动势 V', /electromotive|EMF|cell/i],
      ['目标温升 K', /target\s*temperature\s*rise/i],
      ['目标温度 K', /target\s*temperature/i],
      ['磁压 Pa', /magnetic\s*pressure/i],
      ['聚变功率 W', /fusion\s*power/i],
      ['聚变率 \(reactions\/s\)', /fusion\s*rate/i],
      ['衰变能 J', /decay\s*energy/i],
      ['裂变率 fissions\/s', /fission\s*rate/i],
      ['负极标准电极电位 V', /negative|electrode|standard/i],
      ['通量 mol\/\(m\^2·s\)', /flux|molar/i],
      ['静电 J', /electrostatic\s*energy/i],
      ['驱动电压对应能量 eV', /drive|voltage|energy/i],
      ['泵浦波长 nm', /pump\s*wavelength/i],
      ['海水密度 \(kg\/m\^3\)', /seawater\s*density/i],
      ['空气密度 \(kg\/m³\)', /air\s*density/i],
      ['温升 K', /temperature\s*rise/i],
      ['火焰温度 K', /flame\s*temperature/i],
      ['燃烧室温度 K', /combustion|chamber/i],
      ['表面温度 K', /surface\s*temperature/i],
      ['霍金温度 K', /hawking/i],
      ['终压 Pa', /final\s*pressure/i],
      ['终温 K', /final\s*temperature/i],
      ['电阻率代表量（相对单位\/Ω·m 标度）', /resistivity/i],
      // Q residual thin remain3b: Productrate/Bulk/Force joins + wrong Electrical calques
      ['体内吸收因子', /in-?body|internal|absorption\s*factor/i],
      ['过机水量 (kg)', /water|throughput|mass/i],
      ['重力势能 J', /gravitational|potential\s*energy/i],
      ['阻力耗散功率 W', /drag|dissipat/i],
      ['注量 J\/m\^2', /fluence/i],
      ['谱效率 bit\/s\/Hz', /spectral\s*efficiency/i],
      ['生成化学键能\/焓 J', /chemical\s*bond|enthalpy|formed/i],
      ['水轮发电效率', /hydro|turbine|generator/i],
      ['水轮机×发电机综合效率', /turbine|generator|combined/i],
      ['热→静电能效率 1', /thermal|electrostatic/i],
      ['化学→静电能效率', /chemical|electrostatic/i],
      ['静电能→光能效率 1', /electrostatic|optical/i],
      ['质能→静电能效率 1', /mass|electrostatic/i],
      ['发电机效率 1', /generator\s*efficiency/i],
      ['机电效率 1', /electromechanical/i],
      ['风→电整机效率 1', /wind|electric/i],
      ['电弧功率 W', /arc\s*power/i],
      ['电弧电流 A', /arc\s*current/i],
      ['集电极电流 A', /collector\s*current/i],
      ['吸积率 kg\/s', /accretion\s*rate/i],
      ['线膨胀量 m', /linear\s*expansion/i],
      ['量子比特衰宽', /qubit|decay\s*width/i],
      ['瞬时摩擦功率 W', /friction|instantaneous/i],
      ['电场储能 J', /electric[- ]field|stored/i],
      ['单次潮周期电能 (J)', /tidal\s*cycle|electrical\s*energy/i],
      ['相电阻 Ω', /phase\s*resistance/i],
    ] as const
    for (const [zh, re] of samples) {
      const en = formulaVarMeaning(zh, 'en')
      expect(en, zh).toMatch(re)
      expect(en, zh).not.toMatch(/[\u4e00-\u9fff]/)
      expect(en, zh).not.toMatch(
        /gr neisen|productpower|Productrate|Tripletnumber|stageintensity|Tripletexcitation|\be V\b|Me V\b|ke \(V\)|Can 1|Ratio 1|Ideal N|Number 1|Initialvalue|Initialpressure|energyfraction|Absorbedfraction|Reflectedfraction|Transmittedfraction|Pressureratio|Pointnumber|Peakmean|Widthparameter|Absorbedtimeforce|Waterforcepower|Line turns|Product m3|Chemical\/J|Radial \(m|Amount N|Electrical N|Netyield|Forcecoefficient|Incident R F|In power|Numberproxy|Free spacerate|Watermass|Wateramount|Linelength|Viscousdamping|Bulklength|Bulkinternal|Etc mass|Volume energy|Electrical eV|Mol\/ \(|Lengthamount|Line amount|Amount ratio|Nethydraulic|Forcepotential|Forcedissipated|Initialtemperature|Temperaturerate|Fusionpower|Fusionrate|Decayenergy|Fissionrate|Targettemperature|Capacitance \(J\)|Electrical electrical|Efficiency bit|Magnetic \(Pa\)|Effective \(mol\)|Index\(>0|reactio\s|fissio\s|Period electrical|^\//i,
      )
      // unit-split e(V)/Me(V) only when not a normal "voltage (V)" phrase
      if (!/voltage/i.test(en)) {
        expect(en, zh).not.toMatch(/\be \(V\)|Me \(V\)/i)
      }
    }
  })

  it('explainFormula locale=en localizes var meanings', () => {
    const v = explainFormula(
      {
        expr: 'eta = P_dc / P_rf',
        vars: { P_dc: '输出直流功率 W', P_rf: '接收射频功率 W' },
        sample: { P_dc: 0.0775, P_rf: 0.1 },
        expected: 0.775,
      },
      'en',
    )
    const meanings = v.vars.map((r) => r.meaning).join(' ')
    expect(meanings).toMatch(/DC|RF|power/i)
    expect(meanings).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('formatSampleNumber 大数用科学记数', () => {
    expect(formatSampleNumber(1.635e8)).toMatch(/10\^/)
    expect(formatSampleNumber(0.775)).toBe('0.775')
  })

  it('formatSampleNumber 科学记数分支与定点一致：修剪尾零、保留指数符号', () => {
    expect(formatSampleNumber(1e6)).toBe('1×10^6')
    expect(formatSampleNumber(1.635e8)).toBe('1.635×10^8')
    expect(formatSampleNumber(2.5e-4)).toBe('2.5×10^-4')
    expect(formatSampleNumber(-5e-4)).toBe('-5×10^-4')
  })
})
