import { useId, useState, type ChangeEvent } from 'react'
import { EPW_MAX_FILE_BYTES } from '../../lib/epw-validation'

export const EPW_MAX_FILE_COUNT = 4

export type EpwFileSelection = {
  file: File
  identity: {
    name: string
    sizeBytes: number
    lastModifiedMs: number
    mediaType: string
  }
  provenance: {
    kind: 'local-file-picker'
    relativePath: string | null
  }
}

type Props = {
  onSelectionChange: (files: EpwFileSelection[]) => void
}

function identify(file: File): EpwFileSelection {
  return {
    file,
    identity: {
      name: file.name,
      sizeBytes: file.size,
      lastModifiedMs: file.lastModified,
      mediaType: file.type,
    },
    provenance: {
      kind: 'local-file-picker',
      relativePath: file.webkitRelativePath || null,
    },
  }
}

/** Select bounded local EnergyPlus weather files; parsing is owned by the caller. */
export function EpwFileSelection({ onSelectionChange }: Props) {
  const inputId = useId()
  const [selected, setSelected] = useState<EpwFileSelection[]>([])
  const [error, setError] = useState<string | null>(null)

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    input.value = ''
    setError(null)

    if (files.length > EPW_MAX_FILE_COUNT) {
      setSelected([])
      onSelectionChange([])
      setError(`Choose at most ${EPW_MAX_FILE_COUNT} EPW files at a time.`)
      return
    }
    const invalid = files.find((file) => !/\.epw$/i.test(file.name))
    if (invalid) {
      setSelected([])
      onSelectionChange([])
      setError(`${invalid.name} is not an .epw file.`)
      return
    }
    const oversized = files.find((file) => file.size > EPW_MAX_FILE_BYTES)
    if (oversized) {
      setSelected([])
      onSelectionChange([])
      setError(`${oversized.name} exceeds the ${EPW_MAX_FILE_BYTES / 1024 / 1024} MiB per-file limit.`)
      return
    }

    const next = files.map(identify)
    setSelected(next)
    onSelectionChange(next)
  }

  const clear = () => {
    setSelected([])
    setError(null)
    onSelectionChange([])
  }

  return <section className="space-y-3 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby={`${inputId}-title`}>
    <header>
      <h2 id={`${inputId}-title`} className="text-lg font-semibold text-slate-100">EnergyPlus weather files / EnergyPlus 天气文件</h2>
      <p className="mt-1 text-sm text-slate-400">Select up to {EPW_MAX_FILE_COUNT} local .epw files (32 MiB each maximum). Files are passed to the caller without parsing. / 最多选择 {EPW_MAX_FILE_COUNT} 个本地 .epw 文件（每个最大 32 MiB），文件将原样交给调用方，不在此处解析。</p>
    </header>
    <label htmlFor={inputId} className="block text-sm text-slate-300">
      EPW files / EPW 文件
      <input id={inputId} type="file" accept=".epw" multiple onChange={selectFiles} className="mt-1 block w-full text-sm" />
    </label>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {selected.length > 0 && <div className="space-y-2" aria-live="polite">
      <ul className="space-y-2 text-sm text-slate-300">
        {selected.map(({ identity, provenance }) => <li key={`${identity.name}:${identity.lastModifiedMs}:${identity.sizeBytes}`} className="rounded-lg border border-edge bg-surface p-3">
          <p className="break-all font-medium">{identity.name}</p>
          <p className="mt-1 text-xs text-slate-400">{(identity.sizeBytes / 1024 / 1024).toFixed(2)} MiB · modified {identity.lastModifiedMs ? new Date(identity.lastModifiedMs).toLocaleString() : 'unknown'} · source: {provenance.kind}</p>
        </li>)}
      </ul>
      <button type="button" onClick={clear} className="btn border border-edge text-slate-300">Clear / 清除</button>
    </div>}
  </section>
}
