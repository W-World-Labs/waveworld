import { useState } from 'react'
import { useLocale } from '../lib/i18n'
import { NativeSoftwareCases } from '../components/NativeSoftwareCases'
import { AnsysHarmonicResponse } from '../components/AnsysHarmonicResponse'
import { AnsysModalStudyPanel } from '../components/AnsysModalStudyPanel'
import { AnsysThermalStudyPanel } from '../components/AnsysThermalStudyPanel'
import { ANSYS_NATIVE_CASES } from '../data/ansysCases'

export function Ansys() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [view, setView] = useState<'guided' | 'modal' | 'thermal' | 'catalog'>('catalog')
  return <div className="space-y-5">
    <nav className="flex flex-wrap gap-2" aria-label="Ansys workflows">
      <button type="button" data-testid="ansys-harmonic-tab" aria-label="Guided Mechanical harmonic response" className={`btn ${view === 'guided' ? 'bg-cyan-300 text-slate-950' : 'border border-edge'}`} aria-pressed={view === 'guided'} onClick={() => setView('guided')}>{zh ? 'Mechanical 谐响应向导' : 'Guided Mechanical harmonic response'}</button>
      <button type="button" data-testid="ansys-modal-tab" aria-label="Guided Mechanical modal analysis" className={`btn ${view === 'modal' ? 'bg-cyan-300 text-slate-950' : 'border border-edge'}`} aria-pressed={view === 'modal'} onClick={() => setView('modal')}>{zh ? 'Mechanical 模态研究' : 'Guided Mechanical modal study'}</button>
      <button type="button" data-testid="ansys-thermal-tab" aria-label="Guided Mechanical thermal conduction and MAPDL import" className={`btn ${view === 'thermal' ? 'bg-cyan-300 text-slate-950' : 'border border-edge'}`} aria-pressed={view === 'thermal'} onClick={() => setView('thermal')}>{zh ? 'Mechanical 热研究 / MAPDL 导入' : 'Thermal study / MAPDL import'}</button>
      <button type="button" className={`btn ${view === 'catalog' ? 'bg-cyan-300 text-slate-950' : 'border border-edge'}`} aria-pressed={view === 'catalog'} onClick={() => setView('catalog')}>{zh ? 'Ansys 能力目录' : 'Ansys capability catalog'}</button>
    </nav>
    {view === 'guided' ? <AnsysHarmonicResponse /> : view === 'modal' ? <AnsysModalStudyPanel /> : view === 'thermal' ? <AnsysThermalStudyPanel /> : <NativeSoftwareCases
    cases={ANSYS_NATIVE_CASES}
    prefix="sw-ansys-"
    software="Ansys"
    title="Ansys 能力案例"
    titleEn="Ansys capability cases"
    subtitle="按 Ansys 产品能力查看对应的 W-Sim 原生数值案例，并提交单项计算任务。"
    subtitleEn="Browse W-Sim native numerical cases corresponding to Ansys product capabilities, then submit one compute job at a time."
    scopeZh="这些条目展示的是 W-Sim 模块对应的 Ansys 能力案例，不是 Ansys 商业软件的替代或等价实现。页面不连接 Ansys 安装，也不读取或生成 .wbpj、.cas/.dat、.aedt 等项目文件。每项列出当前输入和实现边界；提交只会将所选 W-Sim 模块作为一个 Host 任务运行。"
    scopeEn="These entries are W-Sim cases corresponding to Ansys capability areas, not replacements for or equivalent implementations of Ansys commercial software. This page does not connect to an Ansys installation or read/create .wbpj, .cas/.dat, or .aedt project files. Each case lists its input and implementation limits; submission runs only the selected W-Sim module as one Host job."
    searchPlaceholderZh="例如：Fluent、热传递、Maxwell、边界条件"
    searchPlaceholderEn="For example: Fluent, heat transfer, Maxwell, boundary conditions"
    showProductFilter
    submitLabelZh="提交所选 W-Sim 案例到 Host"
    submitLabelEn="Submit selected W-Sim case to Host"
    submitAriaLabel="Submit W-Sim case to Host"
  />}
  </div>
}
