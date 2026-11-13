import { NativeSoftwareCases } from '../components/NativeSoftwareCases'
import { CstArrayFactorStudy } from '../components/cst/CstArrayFactorStudy'
import { TouchstoneImportPanel } from '../components/circuit/TouchstoneImportPanel'
import { CstWaveguideStudy } from '../components/cst/CstWaveguideStudy'
import { CST_NATIVE_CASES } from '../data/cstCases'

const CST_MODULES = new Set(CST_NATIVE_CASES.map(example => example.module))

export function Cst() {
  return <>
    <CstArrayFactorStudy />
    <NativeSoftwareCases
    cases={CST_NATIVE_CASES}
    prefix="sw-em"
    allowedModules={CST_MODULES}
    software="CST Studio Suite"
    title="CST Studio Suite 能力案例"
    titleEn="CST Studio Suite capability cases"
    subtitle="按电磁功能概念浏览映射的 W-Sim 案例，检查实际输入和实现限制，再提交单项 Host 任务。"
    subtitleEn="Browse W-Sim cases mapped to electromagnetic capabilities, inspect their actual inputs and limits, and submit one Host job at a time."
    scopeZh="这些案例是 W-Sim 中现有电磁模块的独立实现，按 CST Studio Suite 功能概念映射与分类；它们不调用 CST，不读取或写入 .cst 工程文件，也不代表 CST 求解器或数值等价。每个案例列出实际输入、激活选择器和实现限制。输入中的 backend: host 表示 Host 计算；模块声明 CUDA 时，外层任务可使用原生二进制传输要求，但计算仍按实际后端报告，不代表 GPU 求解。"
    scopeEn="These cases are independent implementations in existing W-Sim electromagnetic modules, mapped to CST Studio Suite feature concepts. They do not invoke CST, read or write .cst project files, or claim CST solver or numerical equivalence. Each case lists its actual inputs, activating selector, and implementation limits. Inline backend: host means Host computation; where a module declares CUDA, the outer job may retain its native-binary transport requirement, while computation reports its actual backend and makes no GPU claim."
    searchPlaceholderZh="例如：端口、S 参数、材料、天线、网格"
    searchPlaceholderEn="For example: ports, S-parameters, materials, antennas, mesh"
    showProductFilter
    productFilterLabel={{ zh: '电磁功能领域', en: 'Electromagnetic feature area', ariaLabel: 'Filter CST Studio Suite mapped cases by feature area' }}
    submitLabelZh="提交所选 W-Sim 案例到 Host"
    submitLabelEn="Submit selected W-Sim case to Host"
    submitAriaLabel="Submit W-Sim CST-mapped case to Host"
    />
    <TouchstoneImportPanel />
    <CstWaveguideStudy />
  </>
}
