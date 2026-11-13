# 平台分层：W-Sim 通用计算 × 知识化参数 × 验收

> **目的**：把「计算组件」与「可调用知识」分清职责，给出后续开发顺序与完备验收条件。  
> **Epic 映射**：#50 A (historical internal reference) · #51 B (historical internal reference) · #48 C (historical internal reference) · #40 D (historical internal reference)  
> **相关**：[`w-sim.md`](./w-sim.md) · [`wlang.md`](./wlang.md) · [`knowledge-pipeline.md`](./knowledge-pipeline.md) · [`hq-sim-modules.md`](./hq-sim-modules.md)

---

## 0. 决策摘要（存哪、谁展示、如何扩）

本文的分层说明软件与数据职责。物理能力的建设与追溯顺序见
[`knowledge-db.md` 的计算规范](./knowledge-db.md#按物理依赖组织按实际算例建设)：
物理量与参数 → 模型 → 数值方法 → 求解实现 → 耦合组件 → 应用算例。
按当前算例补齐依赖，不把这些层次直接复制成软件目录或产品导航。

| 问题 | 决定 |
|------|------|
| **w-sim 是什么** | **计算平面**：kind / JobSpec / kit / runtime / 参数 **schema** / 测试 fixture |
| **waveworld 是什么** | **产品 + 知识 + 展示**：Atlas UI、Host、ontology、**KnowledgeRelease 真理库**、resolveJob 组装 |
| **技术知识 / 默认参数存哪** | **权威在 WaveWorld Knowledge DB**（`data/knowledge.db` + released claims），**不在** w-sim config |
| **主升级** | **#52 EPIC K** (historical internal reference) · 设计 [`knowledge-db.md`](./knowledge-db.md) · DDL [`sql/knowledge-schema.sql`](./sql/knowledge-schema.sql) |
| **w-sim 里允许的「参数」** | 仅 **schema 形状**、**conformance fixture 数值**（测契约用，非科学真理）、推荐键列表 |
| **单点 → 全局** | **可以且应当**：先 seed DB + 1 条 API 读路径，再切默认、再 resolveJob；禁止一次搬空 |

模拟、建模、本机计算、本地结果导出与数据重放免登录。本机运行直接使用内存中的参数、几何和求解结果，不创建 Host 任务或上传文件。只有用户点击「发布计算任务」才检查登录，包括发布到本机 Agent 或后端 Agent；复用同一求解器，已发布任务及其私有模型、结果继续执行所有权校验。

### 0.1 为什么权威知识不进 w-sim config

1. **证据与版本**：物性/默认工况要绑定 SourceSnapshot、sha256 release、争议集——这是 #48 的职责，不是引擎包职责。  
2. **多产品复用**：w-sim 应保持「无业务真理」；别的产品可挂自己的知识源。  
3. **热更新**：换空气粘度默认值应发 knowledge release，而不是发 npm `@w-sim/contracts`。  
4. **展示与审阅**：Atlas 只读 released；若参数埋在 w-sim，UI 无法统一审阅/争议。

### 0.2 允许放在 w-sim 的「非权威」参数

| 类型 | 位置 | 标签 |
|------|------|------|
| 参数字段定义（key、unit、min/max、type） | `@w-sim/kit` `ParamField` / kind shell | **schema** |
| 单测 / CI 用固定数 | `kind-shells.ts` `fixtureSpec` | **fixture**，注释标明 non-authoritative |
| 非法输入拒绝规则 | `acceptJobSpec` / validate | **结构门禁** |

```text
权威默认（生产 resolve）  →  WaveWorld KnowledgeRelease  (sim.param_pack / sim.material)
结构与测例（引擎自洽）    →  w-sim schema + fixture
用户一次覆盖              →  JobSpec.parameters / project settings（钉在 job provenance）
```

### 0.3 仓库边界（一句话）

```text
w-sim      = 计算组件「怎么跑」
waveworld  = 知识「信什么」+ 界面「怎么看/怎么点」+ 组装 resolveJob
tuanliu    = 第一块 L4 求解实现（仍属 waveworld monorepo 模块）
```

---

## 1. 核心命题

| 命题 | 含义 |
|------|------|
| **计算是通用组件** | 求解器 / 结算 / Lab 表面在 **W-Sim + 模块实现** 里，按 `kind` 插拔，不绑死某一业务页 |
| **参数与物性是知识** | 默认参数、材料、边界、效率区间、公式、能力描述进入 **知识平面**，经 release 后可被计算 **按 id 调用** |
| **一次运行是绑定** | `JobSpec` = 选哪个组件（kind）+ 解析哪些知识引用 + 用户覆盖 + 运行预算 → `JobResult` + provenance |

不要把默认 `inletVelocity` 写死在 UI 常量里当「真理」；也不要把 LBM 求解器塞进 knowledge JSON。

```
┌──────────────────────────────────────────────────────────────────┐
│ L5  产品壳  Atlas nav / Host 项目 / 文案 / 权限                   │
├──────────────────────────────────────────────────────────────────┤
│ L4  模块实现  tuanliu · labs/*  (Geometry/Solver/Viz 的真代码)    │
├──────────────────────────────────────────────────────────────────┤
│ L3  运行时    @w-sim/runtime  claim-loop · backend match          │
├──────────────────────────────────────────────────────────────────┤
│ L2  组件契约  @w-sim/contracts + kit  kind · JobSpec · M1–M8      │
├──────────────────────────────────────────────────────────────────┤
│ L1  可调用知识  KnowledgeRelease：参数包/物性/公式/能力声明        │
├──────────────────────────────────────────────────────────────────┤
│ L0  符号表    ontology nodes/edges（id 空间，非运行真理）         │
└──────────────────────────────────────────────────────────────────┘
         ▲ 只读 released                    ▲ 只认 contracts
         │                                  │
    知识管道 #48                      新 kind 先改 w-sim #50
```

---

## 2. 两平面契约（必须分开演进）

### 2.1 计算平面（W-Sim）—「能跑什么、怎么结算」

| 对象 | 职责 | 不负责 |
|------|------|--------|
| `JobSpecV1.kind` | 选中哪类计算组件 | 物性来自哪篇论文 |
| `JobParameters` | **已解析后的**数值/枚举袋（可进 runner） | 长期权威默认值库 |
| `acceptJobSpec` / lifecycle | 结构合法、状态机、幂等结算 | 物理是否「科学正确」 |
| `HostCapability` | 浏览器/后端能否跑该 kind | 用户项目权限 |
| Kit surfaces | Geometry / Solver / Params **schema 形状** / Results / Settlement | Three/WebGPU 绑定 |

**组件（Component）定义**（登记在 w-sim，实现可在 tuanliu）：

```text
SimComponent = {
  kind,                    // 稳定 id，如 lbm-d3q19
  hostClass,               // browser | backend
  parameterSchema,         // 键、单位、范围（结构）
  requiredKnowledgeRefs?,  // 可选：运行前必须解析的知识 id 类型
  outputs.kpis,            // 承诺产出的 KPI 键
  settle: JobSpec → JobResult
}
```

### 2.2 知识平面 —「默认与证据从哪来、能否引用」

把「可被仿真调用」的知识收成明确 **claim kinds**（在 #48 / WLang Phase 1 收敛），例如：

| Claim kind（建议） | 内容 | 谁消费 |
|--------------------|------|--------|
| `sim.param_pack` | 某 kind 的默认参数包（含单位、条件） | JobSpec 组装器 |
| `sim.material` | ρ、μ、k、ε 等物性 + 条件（T、介质） | 参数解析 |
| `sim.boundary` | 边界/工况模板 | Lab 预设 / job |
| `conversion.efficiency` 等 | 已有转换事实 | Atlas；仿真可读作约束/对照 |
| `sim.capability` | 「平台宣称支持 kind X @ tier」 | catalog / UI，**不是** runner 替代 |
| `sim.formula` | 可计算式 + sample/expected | L0 / 校验；可进预检 |

每条 released claim 必须能：

1. **引用**：稳定 `id` + `subjectId`（如 `kind:lbm-d3q19` 或 `material:air-std`）  
2. **绑定证据**：`EvidenceBinding` → `SourceSnapshot`  
3. **过门禁**：量纲、范围、冲突不覆盖  
4. **进 release**：`KnowledgeRelease.sha256` 可复验  

### 2.3 组装点（唯一允许的「交叉层」）

```text
resolveJob(input) → JobSpecV1
  1. 选 kind（用户 / catalog / 路由）
  2. 拉取 KnowledgeRelease（固定 version 或 latest released）
  3. 按 refs 解析 param_pack / material → 数值袋
  4. 应用用户覆盖（UI / API）
  5. 结构校验 acceptJobSpec + 量纲/范围 gate
  6. 写入 provenance：releaseId、claimIds、overrides
  7. submit → runtime/module settle → JobResult
```

**硬规则**

- Runner **只收**已解析 `JobParameters`（纯数据），不在热路径里读 ontology TS 文件。  
- 换知识 release **不得**静默改变已 settled job 的结论（历史 job 钉死 releaseId）。  
- 未 `released` 的 claim **禁止**进入生产 `resolveJob`。

---

## 3. 目录与改动所有权

| 层 | 仓库 / 路径 | 允许改什么 |
|----|-------------|------------|
| L2–L3 契约与运行时 | `w-sim` packages | kind 注册、JobSpec 字段、kit 接口、claim-loop |
| L4 流体参考实现 | `apps/lab` | LBM、模型、Lab UI、agent adapter |
| L4 其他族 | `modules/labs/*`（规划） | 热 / FDTD / … |
| L1 知识 | `src/lib/knowledge/**` · releases 目录 | claim 类型、gates、ingest、发布 |
| L0 符号 | `src/data/ontology/**` | id 空间、展示、公式壳 |
| L5 壳 | `src/` Atlas · `apps/host` | 路由、项目、jobs API、展示 release |

**新增一个仿真能力的正确顺序**

1. **w-sim**：`kind` + parameterSchema + capability +（如需）KPI 键  
2. **知识**：`sim.param_pack` / material 草案 → gate → release  
3. **模块**：Solver/Geometry 实现 + kit 装配  
4. **Host/Agent**：可 claim 该 kind  
5. **Atlas**：catalog `tier=hq` 仅当 live surface 存在  
6. **验收**：见 §5 该 kind 的清单全绿  

禁止：只在页面写死参数就宣称「内置仿真能力」。

---

## 4. 分层开发顺序（路线，不是并行乱战）

### Phase α — 钉死组装与 provenance（#50 + #48 交叉）

- [ ] 文档化 `resolveJob` 输入输出（可先 TS 函数 + 单测）  
- [x] `JobResult` / job spec experiment 含 `knowledgeDbReleaseId` + `claimIds[]` + `paramOverrideKeys`（#69 assemble path）  
- [ ] 现有 tuanliu 默认参数 **迁移一条** 为 `sim.param_pack` sample release（哪怕手写）  

### Phase β — 组件完备（#50 · #49）

- [ ] Lab 可靠性（#49）  
- [ ] 真算 backend ≠ teaching（A4）  
- [ ] capability registry 与生产 agent 一致  

### Phase γ — 知识可调用（#48 C1–C4）

- [ ] claim schema for `sim.param_pack` / `sim.material`  
- [ ] 统一 checker（WLang Phase 1）  
- [ ] 生产 release 挂载；Atlas/Lab 只读 verified  

### Phase δ — 按族替换（#51）

- [ ] 每族重复「1 kind + 1 param_pack + 1 模块 + 验收包」  
- [ ] L0 仅作 legacy / 教学，不假冒 HQ  

### Phase ε — 科研合同（#40 · #47）

- [ ] 黄金案例钉死 JobSpec + release + 预注册阈值  
- [ ] 独立复核只依赖发布包，不依赖开发者机器习惯  

---

## 5. 完备验收条件（Definition of Done）

按 **对象** 验收，而不是按「写了多少代码」。

### 5.1 单个 `SimComponent`（一个 kind）

| # | 条件 | 自动/人工 |
|---|------|-----------|
| C1 | `kind` 在 `@w-sim/contracts` 注册；未知 kind → `acceptJobSpec` 拒绝 | 自动 |
| C2 | `parameterSchema` 每个字段有 **单位或无量纲标记** 与有限范围 | 自动 |
| C3 | 至少 1 个 `sim.param_pack` **released** 可解析出合法 JobParameters | 自动 |
| C4 | browser 与/或 backend capability 声明与真实 runner 一致（不虚报） | 自动+抽检 |
| C5 | 固定 seed/输入 → KPI 在容差内可重复（N≥3 或契约写明随机性） | 自动 |
| C6 | 失败路径：坏参数 / 缺知识 ref / 无 backend → **可读错误**，不静默 NaN | 自动 |
| C7 | settlement 幂等：重复 complete 不双写 | 自动 |
| C8 | M1–M8 对 HQ 模块可勾选（见 hq-sim-modules）；L0 不冒充 | 清单 |

### 5.2 单条可调用知识（param_pack / material）

| # | 条件 | 自动/人工 |
|---|------|-----------|
| K1 | `state=released` 且在某一 `KnowledgeRelease` 内 | 自动 |
| K2 | 量纲/范围 gate 通过；效率类 η∈[0,1] 等 | 自动 |
| K3 | ≥1 条 `EvidenceBinding`；可反查 snapshot（或明确 locator-only 债务标签） | 自动 |
| K4 | 冲突进入 `ConflictSet`，不覆盖旧 released | 自动 |
| K5 | 固定 release 字节 → 同一 sha256 | 自动 |
| K6 | `resolveJob` 引用该 id 得到的 JobSpec 可被 accept | 自动 |

### 5.3 一次端到端运行（Lab 或 batch）

| # | 条件 | 自动/人工 |
|---|------|-----------|
| R1 | UI/API 提交 → job 终态 succeeded/failed 明确 | 自动 |
| R2 | Result 含有限 KPI + provenance（releaseId、kind、backend、git/build 若可得） | 自动 |
| R3 | 用户覆盖参数在 result 中可区分于知识默认 | 自动 |
| R4 | 生产路径：iframe/Lab 无整页崩溃（#49 相关场景） | e2e/人工 |
| R5 | 无 WebGPU / 无 agent 时降级文案正确，不假装已真算 | 人工+e2e |

### 5.4 知识管道（发布面）

| # | 条件 |
|---|------|
| P1 | Atlas **零路径**读 non-released 工作集 |
| P2 | 伪造效率、无证据、撤稿源有负测 |
| P3 | 新来源可不改 ontology TS 卡片进入 candidate |
| P4 | 定时 ingest 失败可重试/降级，不腐蚀已有 release |

### 5.5 黄金科研（R1）

| # | 条件 |
|---|------|
| G1 | 预注册阈值在运行前冻结；失败不回写放宽 |
| G2 | 发布包 + 隔离复核命令；非实现者可复现 |
| G3 | 篡改数据/模型/结论负测红 |
| G4 | CPU/GPU 合同版本化（#47）；旧失败结论不可抹 |

### 5.6 平台级「内置仿真能力」宣称门槛

只有同时满足才可在 UI/文档写「内置 / 可调用仿真」：

1. C1–C8 对该 kind 绿  
2. 至少一条 K* param_pack released  
3. R1–R3 在 CI 或 staging 有证据  
4. catalog `tier` 与真实入口一致（禁止 gateway 文案骗进空壳）  

---

## 6. 每圈开发检查单（给 agent / 人）

开始改代码前回答四问：

1. **我在改哪一层？**（L0–L5）跨层是否只走 `resolveJob` / release / JobSpec？  
2. **新数字是组件默认还是知识？** 长期默认 → claim；一次实验覆盖 → overrides。  
3. **验收表哪几行会变绿？** 写进 issue 评论的 Done。  
4. **失败时用户看到什么？** 禁止只 `console.error`。  

Done 句模板：

```text
Done: kind=<id> 满足 C1–C6；param_pack=<claimId> 入 release <kr-id>；
      e2e/单测=<命令> 绿；provenance 含 releaseId。
```

---

## 7. 反模式（明确禁止）

| 反模式 | 为何坏 |
|--------|--------|
| 在 `src/pages` 写死物理默认当真理 | 无法版本化、无法证据化、无法复用 |
| knowledge JSON 里塞 WASM/求解器 | 知识平面不可审、不可替换实现 |
| 每个模块私有 JobSpec | 结算与 Host 分裂 |
| `tier=hq` 但无 live 模块 | 欺骗用户 |
| 用放宽 KPI 阈值「修绿」黄金案例 | 破坏科研合同 |
| Runner 热路径读未校验 URL 当物性 | 不可复现 |

---

## 8. 与现有代码的落点（现状 → 目标）

| 现状 | 目标 |
|------|------|
| `JobParameters` 开放袋 + 注释键 | 保留袋；**默认来源**改为 knowledge resolve |
| `ParamField` 在 kit | schema 形状在 kit；**默认值**来自 released pack |
| ontology `Formula` + sample | 可升为 `sim.formula` claim 或继续作符号层自洽闸 |
| tuanliu 预设模型 | 几何仍模块侧；工况/流体默认知识化 |
| #48 release 已通 offline 链 | 增加 sim.* claim kinds + resolveJob |

---

## 9. 开发计划：单点 → 全局迁移

**原则**：先竖切一条「可调用内置能力」全绿，再横向复制模板；每扩一族只加 kind + pack + 模块 + 验收包。

### 9.1 阶段表

| 阶段 | 名称 | 范围 | 主要仓 | 退出条件（验收） |
|------|------|------|--------|------------------|
| **M0** | 边界钉死 | 本文档 §0 + Epic 评论对齐 | docs | 团队按「知识在 WW、schema 在 w-sim」改代码 |
| **M1** | 单点竖切 | 1 kind（建议 `lbm-d3q19`）+ 1 `sim.param_pack` + resolve + 1 提交路径 | WW knowledge + tuanliu；w-sim 仅必要时加 schema 字段 | **partial shipped:** Host POST `/api/v1/jobs` + Atlas `submitDemoJob` + tuanliu leftover POST assemble when `knowledge{}` present；stamp `knowledgeDbReleaseId`. Not every L0 default migrated. |
| **M2** | 物性扩展 | + `sim.material`（如 air / N2）被 pack 引用 | WW knowledge | material 可单独升级 release 而不改 kind 代码 |
| **M3** | 默认源切换 | tuanliu/Lab/UI 默认走 resolve；硬编码默认标 `@deprecated` 或删除 | tuanliu + Atlas | **not shipped as global default.** When `knowledge{}` is sent, provenance field is **`knowledgeDbReleaseId`** (not `knowledgeReleaseId`). |
| **M4** | 全局迁移波次 | 按清单迁移其余 kind / L0 公式默认 / catalog 声明 | WW + 各模块 | 迁移表 100% 勾完或标「故意 legacy」 |
| **M5** | HQ 族复制 | thermal / FDTD… 每族重复 M1 模板（#51） | w-sim kind + WW pack + modules/labs | 每族满足 §5.6「内置仿真」门槛 |
| **M6** | 科研钉死 | R1 job 钉 release + 预注册（#40/#47） | research/ | G1–G4 绿 |

### 9.2 单点竖切（M1）任务清单

```text
[x] WW：resolveJobSpecFromKnowledge({ kind, releaseId, packClaimId, overrides })
[x] WW：Host / Atlas / tuanliu leftover POST 可带 `knowledge{}` 组装；provenance 字段是 `knowledgeDbReleaseId`
[x] 单测：固定 release → 同一 JobSpec 参数摘要；坏 ref / 未 release → 拒绝
[ ] w-sim：确认 lbm-d3q19 schema/recommended keys 够用（缺字段才改 contracts，不塞权威默认）
[ ] 每一个 L0 教学默认都迁走（仍故意 legacy）
[ ] 文档：本 kind 的「内置能力」验收勾选贴到 #50+#48
```

### 9.3 全局迁移清单（M4 模板）

对每个「今天写死在代码里的默认/物性/工况」填一行：

| id | 当前位置 | 目标 claim | release | 代码删除 PR | 验收 |
|----|----------|------------|---------|-------------|------|
| e.g. air ρ=1.225 | tuanliu defaults / fixture | sim.material:air-std | kr-… | #… | K*+C3 |

规则：

- **先加 released 源，再切读路径，最后删旧常量**（三步，禁止只删不迁）。  
- fixture 可留在 w-sim，但 CI 注明与 production pack **允许数值不同**。  
- 切不过的标 `legacy` + issue，不得假装已知识化。

### 9.4 波次优先级（全局）

1. **批算默认**（JobSpec 路径）— 影响可复核结果  
2. **Lab 面板默认** — 用户所见「内置」  
3. **L0 Formula sample** — 可升 sim.formula 或保留符号层自洽  
4. **转换边效率等** — 已有 #48 主链，与仿真 pack 并行不阻塞  

### 9.5 建议的下一刀（M1 最小完备）

1. WaveWorld：`resolveJobSpecFromKnowledge` + 单测  
2. 手写一条 LBM 默认 `sim.param_pack` → sample `KnowledgeRelease`  
3. tuanliu 提交批算 feature flag 走 resolve  
4. 验收：C1–C3、K1–K6、R2 对该路径全绿  

**不**在 w-sim 新增 `config/materials.json` 当真理库。

---

## 10. 验收总表（发布门禁速查）

| 门禁 | 通过标准 |
|------|----------|
| **M1 完成** | 至少 1 个 kind 生产可 resolve；result 带 releaseId |
| **M3 完成** | 主批算路径无「无 provenance 的默认」 |
| **M4 完成** | 迁移表无未处理行（或仅 legacy 标注） |
| **可宣传「内置仿真」** | §5.6 全满足 |
| **可宣传「知识驱动参数」** | 默认来自 released pack；overrides 可审计 |

---

## 11. FAQ

**Q：w-sim 的 fixture 里已经有 `fluidDensity: 1.225`，算知识吗？**  
A：不算。那是 **conformance fixture**。生产默认必须来自 WW release；两者可以碰巧同数，但升级权威只改 release。

**Q：能否把 knowledge store 做成 w-sim 子包？**  
A：不建议。证据管道、Atlas 展示、ingest 属于产品知识面。若多产品共享，可抽 **独立 knowledge 包**，仍不要塞进「计算引擎」语义的 w-sim。

**Q：用户项目自定义参数呢？**  
A：落在 Host `project.settings` / 单次 JobSpec overrides，**钉进该 job 的 provenance**；不自动升格为全局 released 知识，除非走候选→校验→发布流程。
