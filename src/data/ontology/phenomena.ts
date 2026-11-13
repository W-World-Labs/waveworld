import { isFrontierPhenomenon, type FrontierPhenomenon } from './types'
import data from './phenomena.data.json'

// 前沿现象/通路（一等对象）。首条 = 声动力治疗 SDT（超声→三线态→ROS）。
// 数据整理（非研究）：四假说 + 真实档案按已知常识性内容填入，机理争议留现象层不入 EDGES。
// 设计见 docs/superpowers/specs/2026-05-31-frontier-phenomenon-sdt-design.md（§3.4）。
// 加载时 isFrontierPhenomenon 结构校验——坏数据直接 throw（对拍护栏）。
const raw = data as unknown
if (!Array.isArray(raw)) {
  throw new Error('phenomena.data.json: expected array')
}
export const PHENOMENA: FrontierPhenomenon[] = raw.map((p, i) => {
  if (!isFrontierPhenomenon(p)) {
    const id = p && typeof p === 'object' && 'id' in p ? String((p as { id: unknown }).id) : '?'
    throw new Error(`phenomena.data.json[${i}] id=${id}: invalid FrontierPhenomenon`)
  }
  return p
})
