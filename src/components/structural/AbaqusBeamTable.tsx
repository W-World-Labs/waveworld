import { useLocale } from '../../lib/i18n'
import type { AbaqusBeamStudyResult } from '../../lib/sim/abaqus-beam-study-result'

function format(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }).format(value)
}

/** Presents the nodal, support-reaction, and element-end values returned by the native solver. */
export function AbaqusBeamTable({ result }: { result: AbaqusBeamStudyResult }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const empty = zh ? '原生结果未返回行' : 'No rows were returned by the native result'

  return (
    <div className="space-y-5">
      <section aria-labelledby="abaqus-beam-nodes-heading">
        <h3 id="abaqus-beam-nodes-heading" className="mb-2 text-sm font-semibold text-slate-200">
          {zh ? '节点位移与转角' : 'Nodal displacements and rotation'}
        </h3>
        <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label={zh ? '节点结果表（可滚动）' : 'Nodal results table (scrollable)'}>
          <table data-testid="abaqus-beam-nodes-table" className="w-full whitespace-nowrap text-right text-xs" aria-label={zh ? '原生返回的节点结果' : 'Native returned nodal results'}>
            <caption className="sr-only">{zh ? '每个原生返回节点的坐标、轴向位移、横向位移和转角' : 'Native returned node coordinates, axial and transverse displacement, and rotation'}</caption>
            <thead className="sticky top-0 bg-panel text-slate-300"><tr>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '节点' : 'Node'}</th>
              <th scope="col" className="px-3 py-2 font-medium">x / m</th>
              <th scope="col" className="px-3 py-2 font-medium">u / m</th>
              <th scope="col" className="px-3 py-2 font-medium">v / m</th>
              <th scope="col" className="px-3 py-2 font-medium">θ / rad</th>
            </tr></thead>
            <tbody className="font-mono text-slate-300">
              {result.nodes.length ? result.nodes.map(node => <tr key={node.index} className="border-t border-edge">
                <th scope="row" className="px-3 py-2 font-normal">{node.index}</th>
                <td className="px-3 py-2">{format(node.x, locale)}</td><td className="px-3 py-2">{format(node.u, locale)}</td>
                <td className="px-3 py-2">{format(node.v, locale)}</td><td className="px-3 py-2">{format(node.theta, locale)}</td>
              </tr>) : <tr><td colSpan={5} className="px-3 py-3 text-left">{empty}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="abaqus-beam-reactions-heading">
        <h3 id="abaqus-beam-reactions-heading" className="mb-2 text-sm font-semibold text-slate-200">
          {zh ? '支座反力' : 'Support reactions'}
        </h3>
        <div className="max-h-56 overflow-auto" tabIndex={0} role="region" aria-label={zh ? '支座反力表（可滚动）' : 'Support reactions table (scrollable)'}>
          <table data-testid="abaqus-beam-reactions-table" className="w-full whitespace-nowrap text-right text-xs" aria-label={zh ? '原生返回的支座反力' : 'Native returned support reactions'}>
            <caption className="sr-only">{zh ? '支座节点各自由度的原生反力' : 'Native reaction values for each support degree of freedom'}</caption>
            <thead className="sticky top-0 bg-panel text-slate-300"><tr>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '节点' : 'Node'}</th>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '自由度' : 'DOF'}</th>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '反力 / 力矩' : 'Reaction / moment'}</th>
            </tr></thead>
            <tbody className="font-mono text-slate-300">
              {result.reactions.length ? result.reactions.map((reaction, index) => <tr key={`${reaction.node}-${reaction.dof}-${index}`} className="border-t border-edge">
                <th scope="row" className="px-3 py-2 font-normal">{reaction.node}</th>
                <td className="px-3 py-2">{reaction.dof}</td>
                <td className="px-3 py-2">{format(reaction.value, locale)} {reaction.dof === 'theta' ? 'N·m' : 'N'}</td>
              </tr>) : <tr><td colSpan={3} className="px-3 py-3 text-left">{empty}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="abaqus-beam-element-forces-heading">
        <h3 id="abaqus-beam-element-forces-heading" className="mb-2 text-sm font-semibold text-slate-200">
          {zh ? '单元端力（局部坐标）' : 'Element end forces (local coordinates)'}
        </h3>
        <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label={zh ? '单元端力表（可滚动）' : 'Element end forces table (scrollable)'}>
          <table data-testid="abaqus-beam-element-forces-table" className="w-full whitespace-nowrap text-right text-xs" aria-label={zh ? '原生返回的单元端力' : 'Native returned element end forces'}>
            <caption className="sr-only">{zh ? '每个单元两端按轴力、剪力、弯矩顺序排列的原生端力' : 'Native element end forces ordered as axial force, shear force, and moment at each end'}</caption>
            <thead className="sticky top-0 bg-panel text-slate-300"><tr>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '单元' : 'Element'}</th>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '节点 i → j' : 'Nodes i → j'}</th>
              {['Nᵢ / N', 'Vᵢ / N', 'Mᵢ / N·m', 'Nⱼ / N', 'Vⱼ / N', 'Mⱼ / N·m'].map(label => <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}
            </tr></thead>
            <tbody className="font-mono text-slate-300">
              {result.elements.length ? result.elements.map(element => <tr key={element.index} className="border-t border-edge">
                <th scope="row" className="px-3 py-2 font-normal">{element.index}</th>
                <td className="px-3 py-2">{element.nodes[0]} → {element.nodes[1]}</td>
                {element.endForces.map((value, index) => <td key={index} className="px-3 py-2">{format(value, locale)}</td>)}
              </tr>) : <tr><td colSpan={8} className="px-3 py-3 text-left">{empty}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
