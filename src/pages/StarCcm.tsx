import { NativeSoftwareCases } from '../components/NativeSoftwareCases'
import { STAR_CCM_NATIVE_CASES } from '../data/starCcmCases'
import { StarCcmSurfaceLoadsPanel } from '../components/starccm/StarCcmSurfaceLoadsPanel'
import { StarCcmTurboStudy } from './StarCcmTurboStudy'
import { StarCcmConvergenceStudy } from './StarCcmConvergenceStudy'
import { StarCcmCflPanel } from '../components/starccm/StarCcmCflPanel'
import { StarCcmSu2MeshImportPanel } from '../components/starccm/StarCcmSu2MeshImportPanel'

const STAR_CCM_MODULES = new Set(STAR_CCM_NATIVE_CASES.map(example => example.module))

export function StarCcm() {
  return <div className="space-y-6">
    <StarCcmTurboStudy />
    <StarCcmConvergenceStudy />
    <StarCcmCflPanel />
    <StarCcmSurfaceLoadsPanel />
    <StarCcmSu2MeshImportPanel />
    <NativeSoftwareCases
    cases={STAR_CCM_NATIVE_CASES}
    prefix="sw-openfoam-"
    allowedModules={STAR_CCM_MODULES}
    software="STAR-CCM+"
    title="STAR-CCM+ 能力案例"
    titleEn="STAR-CCM+ capability cases"
    subtitle="按 Simcenter STAR-CCM+ 功能概念浏览映射案例，检查实际输入和实现边界，并提交单项 Host 任务。"
    subtitleEn="Browse cases mapped to Simcenter STAR-CCM+ feature concepts, inspect their inputs and implementation limits, and submit one Host job at a time."
    scopeZh="这些案例是 W-Sim 中现有 OpenFOAM/SU2 相关原生模块的独立实现，按 Simcenter STAR-CCM+ 功能概念映射与分类；它们不调用 STAR-CCM+，不读写其商业工程文件，也不代表 Siemens 求解器或数值等价。每个案例列出实际输入、功能选择器和实现限制。输入中的 backend: host 保持为 Host 原生计算；外层任务仍按模块要求选择传输后端，选择 CUDA 传输不代表 GPU 求解。结果与报告绑定提交时的案例和输入。"
    scopeEn="These cases are independent implementations in existing W-Sim OpenFOAM/SU2-related native modules, mapped to Simcenter STAR-CCM+ feature concepts. They do not invoke STAR-CCM+, read or write its commercial project files, or claim Siemens solver or numerical equivalence. Each case lists its actual inputs, operation selector, and implementation limits. The separate SU2 ASCII mesh panel only preflights a bounded native mesh and reports geometry summary data; it does not import STAR-CCM+ .sim files or run CFD. The inline backend: host remains Host-native computation; the outer job still follows the module's backend requirements, and CUDA transport does not imply GPU solving. Results and reports stay bound to the submitted case and input."
    searchPlaceholderZh="例如：网格、边界、湍流、传热、颗粒"
    searchPlaceholderEn="For example: mesh, boundaries, turbulence, heat transfer, particles"
    showProductFilter
    productFilterLabel={{ zh: '功能领域', en: 'Feature area', ariaLabel: 'Filter STAR-CCM+ mapped cases by feature area' }}
    submitLabelZh="提交所选 W-Sim 案例到 Host"
    submitLabelEn="Submit selected W-Sim case to Host"
    submitAriaLabel="Submit W-Sim STAR-CCM+ mapped case to Host"
    />
  </div>
}
