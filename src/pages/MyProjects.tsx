import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useLocale } from '../lib/i18n'
import {
  createProject,
  deleteProject,
  devLogin,
  fetchAuthConfig,
  fetchMe,
  fetchMyProjects,
  getStoredUserToken,
  hostApiBase,
  logout,
  oidcStartHref,
  type HostProject,
} from '../lib/hostApi'

/**
 * User project manager — create / list / archive own CFD lab projects.
 * Auth: dev-login → store Bearer usr_* → GET /api/v1/me + projects.
 */
export function MyProjects() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [token, setToken] = useState<string | null>(() => getStoredUserToken())
  const [userName, setUserName] = useState('wave-user')
  const [userId, setUserId] = useState<string | null>(null)
  const [projects, setProjects] = useState<HostProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [auth, setAuth] = useState<{ devLogin: boolean; oidc: boolean } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await fetchAuthConfig()
      setAuth({ devLogin: !!cfg.devLogin, oidc: !!cfg.oidc.configured })
    } catch {
      setAuth(null)
    }
    try {
      const me = await fetchMe()
      setUserName(me.name)
      setUserId(me.id)
      if (!getStoredUserToken()) setToken('session')
      const list = await fetchMyProjects()
      setProjects(list)
    } catch (err) {
      setUserId(null)
      setProjects([])
      if (getStoredUserToken()) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, token])

  const onLogin = async () => {
    setBusy(true)
    setError(null)
    try {
      const { token: t, user } = await devLogin(userName.trim() || 'wave-user')
      setToken(t)
      setUserName(user.name)
      setUserId(user.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onLogout = async () => {
    setBusy(true)
    try {
      await logout()
    } catch {
      /* still clear local */
    } finally {
      setToken(null)
      setUserId(null)
      setProjects([])
      setBusy(false)
    }
  }

  const onCreate = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createProject({ name: newName.trim() })
      setNewName('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    if (!confirm(zh ? '确认删除该项目？' : 'Delete this project?')) return
    setBusy(true)
    try {
      await deleteProject(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4" data-sim-stage="my-projects">
      <PageHeader
        title="我的项目"
        titleEn="My projects"
        subtitle="管理你的项目，查看模型和关联的计算任务。"
        subtitleEn="Manage your projects, models, and linked compute jobs."
        icon="📁"
        showMethods={false}
      />

      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-200 space-y-3">
        <p>
          API <code className="text-cyan-300">{hostApiBase()}</code>
          {!token && (
            <span className="ml-2 text-amber-400">
              {zh ? '· 请先登录' : '· sign in required'}
            </span>
          )}
          {token && (
            <span className="ml-2 text-emerald-400">
              {zh ? `· 已登录 ${userName}` : `· signed in as ${userName}`}
              {userId && (
                <span className="ml-1 text-slate-500 font-mono text-xs" title={userId}>
                  ({userId.slice(0, 12)}…)
                </span>
              )}
            </span>
          )}
          {loading && (
            <span className="ml-2 text-slate-400 animate-pulse">
              {zh ? '加载中…' : 'Loading…'}
            </span>
          )}
        </p>

        {!token ? (
          <div className="flex flex-wrap gap-2 items-center">
            {auth?.oidc !== false && (
              <a
                href={oidcStartHref('/my-projects')}
                className="rounded-lg bg-cyan-700 px-3 py-1.5 text-white hover:bg-cyan-600"
              >
                {zh ? '使用 W-ID 登录' : 'Sign in with W-ID'}
              </a>
            )}
            {auth?.devLogin && (
              <>
                <input
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder={zh ? '用户名（开发登录）' : 'Display name (dev login)'}
                  className="rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-slate-100"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onLogin()}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-slate-100 hover:bg-white/5 disabled:opacity-40"
                >
                  {busy ? (zh ? '登录中…' : 'Signing in…') : zh ? '开发登录' : 'Dev login'}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={zh ? '新项目名称' : 'New project name'}
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-slate-100 min-w-[200px]"
            />
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() => void onCreate()}
              className="rounded-lg bg-cyan-700 px-3 py-1.5 text-white hover:bg-cyan-600 disabled:opacity-40"
            >
              {zh ? '新建项目' : 'Create project'}
            </button>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void refresh()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              {zh ? '刷新' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-slate-300 hover:bg-white/5"
            >
              {zh ? '退出' : 'Sign out'}
            </button>
            <Link to="/batch-jobs" className="text-cyan-400 hover:underline">
              {zh ? '批算任务 →' : 'Batch jobs →'}
            </Link>
            <Link to="/windtunnel" className="text-cyan-400 hover:underline">
              {zh ? '工程风洞 →' : 'Lab →'}
            </Link>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-950/50 px-3 py-2.5 text-sm text-red-200 space-y-1"
        >
          <div className="font-medium text-red-300">
            {zh ? '暂时无法连接计算服务' : 'Cannot connect to the compute service'}
          </div>
          <p className="font-mono text-xs text-red-200/90 break-all">{error}</p>
          <p className="text-xs text-red-400/80">
            {zh
              ? '请检查网络连接和登录状态，然后重试。'
              : 'Check your connection and sign-in status, then try again.'}
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm text-slate-200">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Visibility</th>
              <th className="px-3 py-2">Jobs</th>
              <th className="px-3 py-2">Models</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && projects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-cyan-500/70" />
                    {zh ? '正在从宿主加载项目…' : 'Loading projects from host…'}
                  </span>
                </td>
              </tr>
            )}
            {!loading && projects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center">
                  <div className="mx-auto max-w-md space-y-2 text-slate-400">
                    <div className="text-2xl opacity-60">📁</div>
                    {token ? (
                      <>
                        <p className="text-slate-300 font-medium">
                          {zh ? '还没有项目' : 'No projects yet'}
                        </p>
                        <p className="text-sm">
                          {zh
                            ? '在上方输入名称并点「新建项目」。创建后可把批算任务关联到项目。'
                            : 'Enter a name above and create one. You can then attach batch jobs to the project.'}
                        </p>
                        <p className="text-xs text-slate-500">
                          <Link to="/batch-jobs" className="text-cyan-400 hover:underline">
                            {zh ? '批算任务' : 'Batch jobs'}
                          </Link>
                          {' · '}
                          <Link to="/windtunnel" className="text-cyan-400 hover:underline">
                            {zh ? '工程风洞' : 'Lab'}
                          </Link>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-300 font-medium">
                          {zh ? '登录后管理你的项目' : 'Sign in to manage your projects'}
                        </p>
                        <p className="text-sm">
                          {zh
                            ? '登录后可创建风洞 / 批算工作单元。'
                            : 'Sign in to create wind-tunnel / batch work units.'}
                        </p>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {projects.map((p) => (
              <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="px-3 py-2">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-slate-500 font-mono">{p.id.slice(0, 8)}…</div>
                  {p.description && (
                    <div className="text-xs text-slate-400 mt-0.5">{p.description}</div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{p.visibility}</td>
                <td className="px-3 py-2 font-mono">{p.jobCount ?? 0}</td>
                <td className="px-3 py-2 font-mono">{p.modelCount ?? 0}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {new Date(p.updatedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onDelete(p.id)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    {zh ? '删除' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
