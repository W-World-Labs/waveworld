import { NativeSoftwareCases } from '../components/NativeSoftwareCases'
import { PidStudyPanel } from '../components/DymolaControl/PidStudyPanel'
import { DymolaMatResultBrowser } from '../components/DymolaControl/DymolaMatResultBrowser'
import { ModelicaTableFilePanel } from '../components/DymolaControl/ModelicaTableFilePanel'
import { EpwWeatherWorkflow } from '../components/energyplus/EpwWeatherWorkflow'
import { ExchangerStudyPanel } from '../components/thermal/ExchangerStudyPanel'
import { DYMOLA_NATIVE_CASES } from '../data/dymolaCases'

const DYMOLA_MODULES = new Set(DYMOLA_NATIVE_CASES.map(example => example.module))

export function Dymola() {
  return <>
    <ExchangerStudyPanel />
    <PidStudyPanel />
    <ModelicaTableFilePanel />
    <EpwWeatherWorkflow />
    <DymolaMatResultBrowser />
    <NativeSoftwareCases
    cases={DYMOLA_NATIVE_CASES}
    prefix="sw-openmodelica-"
    allowedModules={DYMOLA_MODULES}
    software="Dymola"
    title="Dymola 能力案例"
    titleEn="Dymola capability cases"
    subtitle="按 Dymola 建模与仿真功能浏览映射案例，检查输入与实现边界，并提交单项 Host 任务。"
    subtitleEn="Browse mapped cases by Dymola modeling and simulation feature, review inputs and implementation limits, and submit one Host job at a time."
    scopeZh="这些案例使用 W-Sim 中独立实现的 OpenModelica 相关原生模块，按 Dymola 功能概念映射和分类。它们不调用 Dymola，不导入或导出商业 Dymola 工程，也不代表 Modelica 语言或 Dymola 求解器等价。每项案例列出实际输入、官方功能来源和实现限制。提交运行所选模块及新操作选择器的 Host 任务；GPU 二进制负责调度，计算仍报告为 host-f64，不表示 GPU 求解。结果和下载报告绑定提交时的案例与输入。"
    scopeEn="These cases use independently implemented W-Sim native modules associated with OpenModelica and are mapped to Dymola feature concepts. They do not call Dymola, import or export commercial Dymola projects, or claim Modelica-language or Dymola-solver equivalence. Each case lists its actual inputs, official feature sources, and implementation limits. Submission runs the selected module and new operation selector as a Host job; the GPU binary provides dispatch while the computation reports host-f64, with no GPU-solver claim. Results and downloaded reports stay bound to the submitted case and input."
    searchPlaceholderZh="例如：方程、连接器、DAE、优化、状态空间"
    searchPlaceholderEn="For example: equations, connectors, DAE, optimization, state space"
    submitLabelZh="提交所选 W-Sim 案例到 Host"
    submitLabelEn="Submit selected W-Sim case to Host"
    submitAriaLabel="Submit W-Sim Dymola case to Host"
    />
  </>
}
