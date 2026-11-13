import { Link } from 'react-router-dom'
import { ALL_LEAVES } from '../nav'
import { pickLocaleString, useLocale } from '../lib/i18n'

const FEATURED = ['optics-lab', 'windtunnel', 'fdtd', 'ecg']

export function Home() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  return (
    <div className="space-y-10 sm:space-y-12">
      <section className="grid gap-6 rounded-2xl border border-edge bg-panel/60 p-6 sm:p-8 lg:grid-cols-[1.5fr_1fr] lg:items-center">
        <div>
          <p className="text-sm font-medium text-cyan-300">{zh ? '计算、仿真与数据回放' : 'Simulation, computation, and data replay'}</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-white sm:text-4xl">{zh ? '从模型与数据，开始一次计算。' : 'Start with a model or a dataset.'}</h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">{zh ? '搭建光路、观察气流、探索电磁波，或重放真实采集的数据。' : 'Build an optical path, explore airflow and electromagnetic waves, or replay recorded data.'}</p>
          <Link to="/d/sim" className="btn mt-5 inline-flex items-center gap-3 bg-cyan-300 text-slate-950 hover:bg-cyan-200">{zh ? '浏览全部实验' : 'Browse all experiments'} <span aria-hidden="true">→</span></Link>
        </div>
        <ol className="grid grid-cols-3 gap-3 border-t border-edge pt-6 lg:grid-cols-1 lg:gap-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          {(zh ? [ ['模型与输入', '选择示例、搭建场景或导入数据'], ['计算位置', '在已接入的模块选择本机或后端'], ['结果与回放', '查看场分布、曲线与采集记录'] ]
            : [ ['Model and inputs', 'Choose an example, build a scene, or import data'], ['Compute location', 'Use local or backend compute where supported'], ['Results and replay', 'Explore fields, curves, and recorded signals'] ]).map(([title, detail], i) => (
            <li key={title} className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-sm text-cyan-200">{i + 1}</span><div><span className="font-medium text-white">{title}</span><p className="hidden text-sm text-slate-400 lg:block">{detail}</p></div></li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="start-title">
        <h2 id="start-title" className="text-xl font-semibold text-white">{zh ? '你想探索什么？' : 'What would you like to explore?'}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {FEATURED.map((path) => {
            const item = ALL_LEAVES.find((leaf) => leaf.path === path)!
            return <Link key={path} to={`/${path}`} className="group flex items-start gap-4 rounded-2xl border border-edge bg-panel/60 p-5 transition-colors hover:border-cyan-300/50 hover:bg-panel">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-2xl" aria-hidden="true">{item.icon}</span>
              <div className="min-w-0"><h3 className="text-lg font-semibold text-white">{pickLocaleString(item.label, item.labelEn, locale)}</h3><p className="mt-2 text-sm leading-relaxed text-slate-300">{pickLocaleString(item.description!, item.descriptionEn, locale)}</p><span className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-cyan-300">{zh ? '打开实验' : 'Open experiment'} <span aria-hidden="true">→</span></span></div>
            </Link>
          })}
        </div>
      </section>
      <section className="grid gap-5 border-t border-edge pt-7 sm:grid-cols-2" aria-label={zh ? '继续探索' : 'Explore further'}>
        <div><h2 className="font-semibold text-white">{zh ? '想了解背后的原理？' : 'Curious about the underlying science?'}</h2><p className="mt-2 text-sm text-slate-400">{zh ? '查找物理定律、计算方法，以及它们之间的联系。' : 'Find physical laws, numerical methods, and the connections between them.'}</p><Link to="/d/atlas" className="btn mt-2 inline-flex items-center gap-2 pl-0 text-cyan-300">{zh ? '查看原理与方法' : 'Explore principles and methods'} <span aria-hidden="true">→</span></Link></div>
        <div><h2 className="font-semibold text-white">{zh ? '想知道它能用在哪里？' : 'Where is the science used?'}</h2><p className="mt-2 text-sm text-slate-400">{zh ? '从传感器、电子设备到能源系统，了解实际应用。' : 'Explore applications in sensors, electronic devices, and energy systems.'}</p><Link to="/d/apps" className="btn mt-2 inline-flex items-center gap-2 pl-0 text-cyan-300">{zh ? '查看应用案例' : 'Explore applications'} <span aria-hidden="true">→</span></Link></div>
      </section>
    </div>
  )
}
