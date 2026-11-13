import { useLocale } from '../../lib/i18n'
import type { LensStudyResult } from '../../lib/sim/lens-study-result'

const format = (value: number) => Number(value.toPrecision(6)).toLocaleString(undefined, { maximumSignificantDigits: 6 })

/** Displays the native per-ray outcome. Failed-ray last positions are never presented as image coordinates. */
export function LensRayTable({ result }: { result: LensStudyResult }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const headers = zh
    ? ['光线 #', '状态', '光程 / mm', '像面 X / mm', '像面 Y / mm', '最后位置 X / mm', '最后位置 Y / mm', '最后位置 Z / mm', '方向 X', '方向 Y', '方向 Z']
    : ['Ray #', 'Status', 'OPL / mm', 'Image X / mm', 'Image Y / mm', 'Last position X / mm', 'Last position Y / mm', 'Last position Z / mm', 'Direction X', 'Direction Y', 'Direction Z']

  return <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label={zh ? '逐光线结果表（可滚动）' : 'Per-ray results table (scrollable)'}>
    <table data-testid="lens-ray-table" className="w-full whitespace-nowrap text-right text-xs" aria-label={zh ? '逐光线结果' : 'Per-ray results'}>
      <thead className="sticky top-0 bg-panel text-slate-300"><tr>{headers.map((header, index) => <th key={index} scope="col" className="px-3 py-2 font-medium">{header}</th>)}</tr></thead>
      <tbody className="font-mono text-slate-300">
        {result.rays.map((ray, index) => <tr key={index} className="border-t border-edge">
          <td className="px-3 py-2">{index + 1}</td>
          <td className="px-3 py-2">{ray.status}</td>
          <td className="px-3 py-2">{format(ray.opticalPathLength)}</td>
          <td className="px-3 py-2">{ray.imageSpot === null ? '—' : format(ray.imageSpot[0])}</td>
          <td className="px-3 py-2">{ray.imageSpot === null ? '—' : format(ray.imageSpot[1])}</td>
          {ray.lastPosition.map((value, axis) => <td key={axis} className="px-3 py-2">{format(value)}</td>)}
          {ray.direction.map((value, axis) => <td key={axis} className="px-3 py-2">{format(value)}</td>)}
        </tr>)}
      </tbody>
    </table>
    <p className="mt-2 text-xs text-slate-400">{zh
      ? '像面坐标仅对有效光线提供；失败光线的最后位置是追迹终止位置，并非像面截点。'
      : 'Image coordinates are available only for valid rays. A failed ray’s last position is where tracing stopped, not an image intercept.'}</p>
  </div>
}
