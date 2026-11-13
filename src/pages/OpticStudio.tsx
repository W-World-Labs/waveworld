import { NativeSoftwareCases } from '../components/NativeSoftwareCases'
import { CoatingStudyPanel } from '../components/optics/CoatingStudyPanel'
import { LensStudyPanel } from '../components/optics/LensStudyPanel'
import { OpticStudioWavefrontPanel } from '../components/optics/OpticStudioWavefrontPanel'
import { OPTICSTUDIO_NATIVE_CASES } from '../data/opticstudioCases'

const OPTICSTUDIO_MODULES = new Set(OPTICSTUDIO_NATIVE_CASES.map(example => example.module))

export function OpticStudio() {
  return <>
  <NativeSoftwareCases
    cases={OPTICSTUDIO_NATIVE_CASES}
    prefix="sw-optics-"
    allowedModules={OPTICSTUDIO_MODULES}
    software="Ansys Zemax OpticStudio"
    title="Ansys Zemax OpticStudio 能力案例"
    titleEn="Ansys Zemax OpticStudio capability cases"
    subtitle="按光学工作流浏览 W-Sim 原生案例，检查实际输入与限制，并提交单项 Host 任务。"
    subtitleEn="Browse W-Sim native cases by optical workflow, review actual inputs and limits, and submit one Host job at a time."
    scopeZh="这些案例运行 W-Sim 中独立实现的原生光学模块，并按具体光学工作流组织。它们不调用商业 Ansys Zemax OpticStudio，不导入或导出 Zemax 文件，也不代表 OpticStudio 求解器等价。每项案例列出实际输入和实现限制；提交会运行所选 W-Sim 原生模块的 Host 任务，报告绑定提交时保存的案例和输入。"
    scopeEn="These cases run independently implemented W-Sim native optics modules, organized by optical workflow. They do not call commercial Ansys Zemax OpticStudio, import or export Zemax files, or claim solver equivalence. Each case lists its actual inputs and implementation limits. Submission runs the selected W-Sim native module as a Host job, and the report stays bound to the saved submitted case and input."
    searchPlaceholderZh="例如：成像、像差、干涉、光线追迹"
    searchPlaceholderEn="For example: imaging, aberration, interferometry, ray tracing"
    submitLabelZh="提交所选 W-Sim 光学案例到 Host"
    submitLabelEn="Submit selected W-Sim optics case to Host"
    submitAriaLabel="Submit W-Sim OpticStudio case to Host"
  />
  <LensStudyPanel />
  <CoatingStudyPanel />
  <OpticStudioWavefrontPanel />
  </>
}
