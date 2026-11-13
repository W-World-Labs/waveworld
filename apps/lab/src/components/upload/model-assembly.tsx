'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, CornerLeftUp, Search } from 'lucide-react';
import type { ModelGeometry, ModelSourcePart } from '@/types/model';

/** Browsing and highlighting never change the model submitted to the solver. */
export function ModelAssembly({ geometry, selectedId, onSelect }: {
  geometry: ModelGeometry;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [parentId, setParentId] = useState<string | undefined>();
  const [visibleCount, setVisibleCount] = useState(80);
  const parts = geometry.sourceParts;
  const tree = useMemo(() => {
    const byId = new Map<string, ModelSourcePart>();
    const children = new Map<string | undefined, ModelSourcePart[]>();
    for (const part of parts ?? []) {
      byId.set(part.id, part);
      const siblings = children.get(part.parentId) ?? [];
      siblings.push(part);
      children.set(part.parentId, siblings);
    }
    return { byId, children };
  }, [parts]);
  if (!parts?.length) return null;

  // Skip wrapper chains on first open, while keeping their names in the source path.
  let parent = parentId ? tree.byId.get(parentId) : undefined;
  let children = tree.children.get(parent?.id) ?? [];
  if (!parentId) while (children.length === 1 && tree.children.has(children[0].id)) {
    parent = children[0];
    children = tree.children.get(parent.id)!;
  }
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle ? parts.filter(part => part.name.toLocaleLowerCase().includes(needle)) : children;
  const selected = selectedId ? tree.byId.get(selectedId) : undefined;
  const path: ModelSourcePart[] = [];
  for (let part = selected; part; part = part.parentId ? tree.byId.get(part.parentId) : undefined) path.unshift(part);

  return <section aria-label="源模型装配" className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/40 p-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-medium text-white">源模型装配</h3>
      <span className="text-xs text-zinc-400">{parts.length} 个节点</span>
    </div>
    <label className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-950 px-2">
      <Search className="size-4 shrink-0 text-zinc-400" />
      <input aria-label="搜索部件名称" value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(80); }}
        placeholder="搜索名称，如 FAN、PCB" className="min-w-0 flex-1 bg-transparent py-2 text-sm text-zinc-100 outline-none" />
    </label>
    {!needle && parent && <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
      <button type="button" aria-label="返回上级装配" disabled={!parent.parentId} onClick={() => { setParentId(parent?.parentId); setVisibleCount(80); }}
        className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30"><CornerLeftUp className="size-4" /></button>
      <button type="button" title={parent.name} className="min-w-0 truncate text-cyan-300 hover:underline" onClick={() => onSelect(parent!.id)}>{parent.name}</button>
    </div>}
    <div role="group" aria-label="部件列表" className="max-h-64 overflow-y-auto rounded border border-zinc-800">
      {matches.slice(0, visibleCount).map(part => <div key={part.id} className="flex border-b border-zinc-800 last:border-b-0">
        <button type="button" aria-pressed={selectedId === part.id} title={part.name}
          onClick={() => onSelect(part.id)}
          className={`min-w-0 flex-1 px-2 py-2 text-left text-xs hover:bg-zinc-800 ${selectedId === part.id ? 'bg-amber-400/10 text-amber-200' : 'text-zinc-200'}`}>
          <span className="block truncate">{part.name}</span>
          <span className="mt-1 block text-zinc-500">{part.triangleCount.toLocaleString()} 面{tree.children.has(part.id) ? ' · 装配' : ' · 部件'}</span>
        </button>
        {tree.children.has(part.id) && <button type="button" aria-label={`展开 ${part.name}`} onClick={() => { setQuery(''); setParentId(part.id); setVisibleCount(80); }}
          className="px-2 text-zinc-400 hover:bg-zinc-800"><ChevronRight className="size-4" /></button>}
      </div>)}
      {matches.length === 0 && <p className="p-3 text-xs text-zinc-400">未找到部件，请尝试源文件中的名称。</p>}
    </div>
    {matches.length > visibleCount && <button type="button" onClick={() => setVisibleCount(count => count + 80)}
      className="text-xs text-cyan-300 underline">显示更多部件（已显示 {visibleCount} / {matches.length}）</button>}
    {selected && <div aria-label="已选源部件" className="space-y-2 text-xs">
      <p className="break-all text-amber-200">已选：{selected.name} · {selected.triangleCount.toLocaleString()} 面</p>
      <div className="flex max-h-24 flex-wrap gap-1 overflow-auto text-zinc-400" aria-label="部件来源路径">
        {path.map((part, index) => <span key={part.id} className="break-all">
          {index > 0 && ' / '}<button type="button" className="hover:text-cyan-300 hover:underline" onClick={() => onSelect(part.id)}>{part.name}</button>
        </span>)}
      </div>
      <button type="button" className="text-cyan-300 underline" onClick={() => onSelect(null)}>取消选取</button>
    </div>}
    <p className="text-xs leading-relaxed text-zinc-400">选取会在模型视图中高亮。名称来自源文件；材料、热源和风扇仍需在参数中设置。</p>
  </section>;
}
