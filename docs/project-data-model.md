# 用户项目管理 · 数据模型

> WaveWorld Host Phase 3 · 用户可管理自己的项目  
> 持久化：与任务队列共用 SQLite（`data/tasks.db`）

## 概念层级

```
Workspace (workspace_id)          租户 / 团队（默认 "default"）
  └── User (user_id)              登录用户（dev-login / 未来 W-ID）
        └── Project               用户拥有的工作单元
              ├── project_models  几何/预设引用
              ├── jobs            批算任务（jobs.project_id）
              ├── members         可选协作（owner/editor/viewer）
              └── settings        默认 CFD / UI 参数
```

## 表结构

### `projects`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PK | UUID |
| `owner_user_id` | TEXT | 所有者 |
| `workspace_id` | TEXT | 工作区 |
| `name` | TEXT | 显示名 |
| `description` | TEXT | 描述 |
| `status` | TEXT | `active` \| `archived` \| `deleted` |
| `visibility` | TEXT | `private` \| `workspace` |
| `settings` | TEXT JSON | `ProjectSettings` |
| `thumbnail_url` | TEXT? | 缩略图 |
| `created_at` / `updated_at` | TEXT ISO | |

### `project_members`

| 列 | 说明 |
|----|------|
| `(project_id, user_id)` PK | |
| `role` | `owner` \| `editor` \| `viewer` |
| `user_name` | 可选展示名 |

### `project_models`

| 列 | 说明 |
|----|------|
| `id` | UUID |
| `project_id` | FK 逻辑 |
| `source` | `preset` \| `artifact` \| `url` |
| `preset_id` / `artifact_id` / `url` | 按 source 选用 |
| `metadata` | JSON |
| `is_active` | 当前选用模型 |

Agent downloads for `source=url` accept public HTTP(S) destinations only. Private,
loopback, link-local and special-purpose addresses are rejected, including DNS
answers and redirect targets. URL credentials are not accepted. Downloads allow
at most five redirects, 50 MiB and 30 seconds total. Use an authenticated artifact
upload and `source=artifact` for models stored on a private network.

### `jobs` 扩展

| 列 | 说明 |
|----|------|
| `project_id` | 可选，关联项目 |

### `artifacts` 扩展

| 列 | 说明 |
|----|------|
| `project_id` | 可选，项目作用域 |
| `owner_user_id` | 可选，上传用户（agent 上传可为空） |
| `job_id` | 可选，关联任务 |
| `storage_key` | 相对 `ARTIFACT_ROOT` 的安全路径（无 `..`） |
| `kind` / `content_type` / `bytes` | 元数据 |

磁盘根目录：`ARTIFACT_ROOT`（默认 `data/artifacts`）。大小上限：`ARTIFACT_MAX_BYTES`（默认 32MiB；兼容 `MAX_ARTIFACT_BYTES`），超限 → **413**。

## API

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/v1/projects` | 我的项目列表（需用户 token） |
| `POST` | `/api/v1/projects` | 创建 |
| `GET` | `/api/v1/projects/:id` | 详情（models + members + recent jobs） |
| `PATCH` | `/api/v1/projects/:id` | 更新 |
| `DELETE` | `/api/v1/projects/:id` | 软删除（仅 owner） |
| `POST` | `/api/v1/projects/:id/models` | 添加模型引用（`source=artifact` 须同项目 artifact） |
| `DELETE` | `/api/v1/projects/:id/models/:modelId` | 删除模型引用 |
| `GET` | `/api/v1/projects/:id/jobs` | 项目下任务 |
| `POST` | `/api/v1/projects/:id/jobs` | `{ jobId }` 挂载已有任务 |
| `POST` | `/api/v1/jobs` | body 可带 `projectId` 创建时挂载 |
| `POST` | `/api/v1/artifacts` | 上传（agent 或用户；JSON base64 或 raw + `x-artifact-kind` / `x-project-id`） |
| `GET` | `/api/v1/artifacts?projectId=&jobId=` | 列表（生产需 auth；用户按项目成员过滤） |
| `GET` | `/api/v1/artifacts/:id` | 下载（owner / project 成员 / agent） |

## 权限

| 操作 | owner | editor | viewer | workspace 可见 |
|------|-------|--------|--------|----------------|
| 读 | ✓ | ✓ | ✓ | ✓（visibility=workspace） |
| 改 settings/models | ✓ | ✓ | | |
| 删项目 | ✓ | | | |
| 挂 job | ✓ | ✓ | | |
| 上传 artifact（带 projectId） | ✓ | ✓ | | |
| 下载/列表项目 artifact | ✓ | ✓ | ✓ | ✓ |

### Artifact 规则

- **鉴权**：生产（`NODE_ENV=production`）或 `ARTIFACT_REQUIRE_AUTH=1` 时，list/download/upload 需 agent Bearer 或用户 `usr_*` / cookie。本地默认开放。
- **source=artifact 模型**：`artifactId` 必填；artifact 的 `project_id` 必须为空或等于当前项目，否则 **403**；绑定未作用域 artifact 时会写入 `project_id`。
- **路径**：`storage_key` 仅允许安全段名，解析后必须落在 `ARTIFACT_ROOT` 下。

## 示例

```bash
# 登录（dev；user.id 对 name+workspace 稳定，重登不丢项目）
curl -X POST :3001/api/v1/auth/dev-login -H 'Content-Type: application/json' \
  -d '{"name":"alice","workspaceId":"default"}'
# → { token: "usr_...", user: { id: "dev_…", name, workspaceId } }
# 另设 HttpOnly Cookie: ww_session（同源 host UI）

# 当前用户
curl :3001/api/v1/me -H "Authorization: Bearer usr_..."

# 建项目（Atlas / 客户端统一用 Authorization: Bearer usr_…）
curl -X POST :3001/api/v1/projects -H "Authorization: Bearer usr_..." \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ahmed 验证","description":"25° 斜背","settings":{"gridPreset":"fast"}}'

# 加预设模型
curl -X POST :3001/api/v1/projects/$PID/models -H "Authorization: Bearer usr_..." \
  -d '{"name":"cylinder","source":"preset","presetId":"cylinder","isActive":true}'

# 批算并挂到项目
curl -X POST :3001/api/v1/jobs -H "Authorization: Bearer usr_..." \
  -d '{"projectId":"'"$PID"'","spec":{...JobSpecV1...}}'
```
