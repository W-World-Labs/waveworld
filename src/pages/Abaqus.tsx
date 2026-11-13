import { NativeSoftwareCases } from '../components/NativeSoftwareCases'
import { AbaqusBeamStudyPanel } from '../components/structural/AbaqusBeamStudyPanel'
import { AbaqusMaterialPointPanel } from '../components/structural/AbaqusMaterialPointPanel'
import { AbaqusMatrixStudyPanel } from '../components/structural/AbaqusMatrixStudyPanel'
import { AbaqusAmplitudeImportPanel } from '../components/structural/AbaqusAmplitudeImportPanel'
import { AbaqusOrthotropicElasticImportPanel } from '../components/structural/AbaqusOrthotropicElasticImportPanel'
import { ABAQUS_NATIVE_CASES } from '../data/abaqusCases'
import { labUiBase } from '../lib/hostApi'
import { useLocale } from '../lib/i18n'

const ABAQUS_MODULES = new Set(ABAQUS_NATIVE_CASES.map(example => example.module))

export function Abaqus() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  return <>
    <NativeSoftwareCases
      cases={ABAQUS_NATIVE_CASES}
      prefix="sw-calculix-"
      allowedModules={ABAQUS_MODULES}
      software="Abaqus"
      title="Abaqus 能力案例"
      titleEn="Abaqus capability cases"
      subtitle="按 Abaqus 产品与分析功能浏览映射的 W-Sim 案例，检查输入边界后提交单项计算任务。"
      subtitleEn="Browse W-Sim cases mapped to Abaqus products and analysis features, review their input limits, and submit one job at a time."
      scopeZh="这些案例使用 W-Sim 中独立实现的 sw-calculix 原生模块，并映射到相应 Abaqus 功能概念。它们不是商业 Abaqus 求解，也不代表一般 CalculiX/Abaqus 等价或完整求解器一致性。页面不会读写 Abaqus 项目文件；每项列出其实际输入与限制。提交只运行所选 W-Sim 原生模块的单项 Host 任务，报告绑定提交时保存的案例和输入。"
      scopeEn="These cases use independently implemented W-Sim sw-calculix native modules mapped to corresponding Abaqus feature concepts. They are not commercial Abaqus execution and do not imply general CalculiX/Abaqus parity or full solver equivalence. This page does not read or write Abaqus project files. Each case lists its actual inputs and limits. Submission runs one selected W-Sim native module as a Host job, and its report stays bound to the saved submitted case and input."
      searchPlaceholderZh="例如：C3D8、接触、热膨胀、声学"
      searchPlaceholderEn="For example: C3D8, contact, thermal expansion, acoustics"
      showProductFilter
      productFilterLabel={{ zh: 'Abaqus 产品 / 分析', en: 'Abaqus product / analysis', ariaLabel: 'Abaqus product and analysis filter' }}
      submitLabelZh="提交所选 W-Sim 案例到 Host"
      submitLabelEn="Submit selected W-Sim case to Host"
      submitAriaLabel="Submit W-Sim case to Host"
    />
    <AbaqusBeamStudyPanel />
    <AbaqusMaterialPointPanel />
    <section data-testid="abaqus-matrix-workflow" className="mt-6 space-y-3 rounded-xl border border-edge bg-panel/30 p-4" aria-labelledby="abaqus-matrix-workflow-title">
      <header>
        <h2 id="abaqus-matrix-workflow-title" className="text-lg font-semibold text-slate-100">{zh ? '独立工作流：已组装矩阵模态研究' : 'Separate workflow: assembled-matrix modal study'}</h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">{zh
          ? '此工作流导入已组装的矩阵，并通过独立的 W-Sim Host-f64 原生模块 sw-ansys-modal 计算；它不会执行 Abaqus、求解完整输入文件，也不声明 Ansys/Abaqus 一致性。它与上方 51 个通用能力案例及 B31 梁研究相互独立，不会替代案例目录。'
          : 'This workflow imports assembled matrices and computes with the independent W-Sim Host-f64 native module sw-ansys-modal. It does not execute Abaqus, solve a full input deck, or claim Ansys/Abaqus parity. It is separate from the 51 generic capability cases above and the B31 beam study, and does not replace the case catalog.'}</p>
      </header>
      <AbaqusMatrixStudyPanel />
    </section>
    <AbaqusAmplitudeImportPanel />
    <AbaqusOrthotropicElasticImportPanel />
    <aside className="mt-5 rounded-xl border border-edge bg-panel/40 p-4 text-sm leading-relaxed text-slate-300">
      <p>{zh ? '如需导入 `.inp` 主文件及其 `*INCLUDE` 文件，可使用 Lab 的结构模型导入器。除部分 C3D4/C3D8 线弹性结构映射外，还支持单个线性静力步中的常量面压力：C3D4 `*DLOAD P1–P4` 与 C3D8 `P1–P6`，按 ELSET 或单元编号指定；正压力指向实体内部。C3D4 三角面精确积分；C3D8 四边形面仅限平面平行四边形，现有 C3D8 刚度仍采用四面体拆分近似。翘曲面、模态/非线性步骤和基于表面的压力不支持。导入生成 W-Sim JobSpec，不会运行 Abaqus；不支持内容会诊断并阻止导出。' : 'To import an `.inp` deck and its `*INCLUDE` files, use the Lab FEM importer. Alongside a subset of linear-elastic C3D4/C3D8 structural mapping, it accepts constant face pressure in one linear static step: C3D4 `*DLOAD P1–P4` and C3D8 `P1–P6`, targeted by ELSET or element label, with positive pressure directed into the solid. C3D4 triangular faces are integrated exactly; C3D8 quadrilateral faces are limited to planar parallelograms, and the existing C3D8 stiffness mapping remains a tetra-split approximation. Warped faces, modal/nonlinear steps and surface-based pressure are unsupported. Import creates a W-Sim JobSpec and does not execute Abaqus. Unsupported content is diagnosed and blocks export.'}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        <a className="text-cyan-300 underline" href={`${labUiBase()}/import/fem`}>{zh ? '打开 Lab FEM `.inp` 导入器' : 'Open the Lab FEM `.inp` importer'}</a>
        <a className="text-cyan-300 underline" href="/datasets/fem-import/pressure-c3d8.inp" download>{zh ? '下载 C3D8 面压力示例' : 'Download the C3D8 face-pressure example'}</a>
      </div>
    </aside>
  </>
}
