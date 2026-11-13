import { NativeSoftwareCases, createNativeSoftwareJobInput, createNativeSoftwareResultReport, parseNativeSoftwareEditorInput } from '../components/NativeSoftwareCases'
import { COMSOL_NATIVE_CASES, toComsolNativeCaseInput, type ComsolNativeCase } from '../data/comsolCases'
import type { SwModuleInput } from '../lib/sim/module-compute'
import { PemfcStudyPanel } from '../components/electrochemistry/PemfcStudyPanel'
import { ComsolJouleHeatingStudyPanel } from '../components/comsol/ComsolJouleHeatingStudyPanel'
import { ComsolMaterialTableStudyPanel } from '../components/comsol/ComsolMaterialTableStudyPanel'
import { ComsolPipeFlowStudyPanel } from '../components/comsol/ComsolPipeFlowStudyPanel'
import { ComsolRheologyStudyPanel } from '../components/comsol/ComsolRheologyStudyPanel'
import { CanteraNasa7ThermoPanel } from '../components/cantera/CanteraNasa7ThermoPanel'

type ComsolCase = ComsolNativeCase

// Keep the existing page helpers exported for callers and tests.
export function parseComsolEditorInput(raw: string, expectedModule: string): SwModuleInput | null {
  return parseNativeSoftwareEditorInput(raw, expectedModule, 'sw-comsol-')
}

export function createComsolJobInput(example: ComsolCase, raw: string): SwModuleInput {
  return createNativeSoftwareJobInput(example, raw, 'sw-comsol-')
}

export function createComsolResultReport(example: ComsolCase, input: SwModuleInput, result: unknown, jobId: string | null): string {
  return createNativeSoftwareResultReport(example, input, result, jobId)
}

export function Comsol() {
  return <>
    <PemfcStudyPanel />
    <ComsolJouleHeatingStudyPanel />
    <ComsolMaterialTableStudyPanel />
    <CanteraNasa7ThermoPanel />
    <ComsolPipeFlowStudyPanel />
    <ComsolRheologyStudyPanel />
    <NativeSoftwareCases
      cases={COMSOL_NATIVE_CASES.map(example => ({ ...example, input: toComsolNativeCaseInput(example) }))}
      prefix="sw-comsol-"
      software="COMSOL"
      title="COMSOL 原生案例"
      titleEn="COMSOL native cases"
      subtitle="选择已接入的原生多物理场模块，检查其输入边界后提交为统一计算任务。"
      subtitleEn="Choose an admitted native multiphysics module, review its input boundary, and submit it as a shared compute job."
      scopeZh="这些是 W-Sim 原生数值模块提供的具体算例入口，并非 COMSOL Desktop 的完整建模环境；不读取或生成 .mph 文件。每个算例都会列出当前实现边界。提交只会运行所选的一项任务。"
      scopeEn="These are concrete case entry points backed by W-Sim native numerical modules, not the full COMSOL Desktop modeling environment. They do not read or create .mph files. Each case lists its current implementation limits. Submitting runs only the selected job."
      searchPlaceholderZh="例如：热传递、边界条件、param sweep"
      searchPlaceholderEn="For example: heat transfer, boundary, param sweep"
    />
  </>
}
