# HQ 仿真功能模块：独立设计 + 逐个替换 L0

> **状态**：规划生效 · 2026-07-28  
> **产品决策**：每个工程向仿真能力做成 **独立 HQ 3D 模块**（对标 `apps/lab`），**逐个替换**现有 Atlas 网页 2D 小仿真；不在原 Canvas 页上「修修补补」冒充升级。  
> **关联**：`docs/sim-platform-upgrade.md`（分层 / 结算 / HQ bar）· Gitea #30 workstream  
> **参考实现**：`apps/lab`（WebGPU LBM · 模型 · 体渲染 · 批算 JobSpec）


> **引擎平面（2026-08-04）**：共享计算/结算/Kit 契约已立项 **W-Sim** → `legacy source` (historical internal reference) · 说明见 [`docs/w-sim.md`](./w-sim.md)。tuanliu 仍是第一块参考实现。

---

## 1. 为什么要「单独设计模块」

| 旧做法 | 问题 |
|--------|------|
| 每个叶子一个 `src/pages/*.tsx` + `src/lib/sim/*.ts` 2D demo | 交互/求解/可视化深度不够；无法复用 3D 管线 |
| 在 2D 页上加 Three.js 点缀 | 仍是 demo 叙事，达不到 tuanliu 级「模型 + 场 + 结算」 |
| 一次大改 40 个叶子 | 无验收、无复用、易烂尾 |

**新做法**：

1. **先抽共享 HQ Lab Kit**（从 tuanliu 固化的能力）  
2. **每个物理族一个独立 Lab 模块**（目录、版本、验证、job kind 自洽）  
3. **按波次替换路由**：同一 URL 从 L0 页切到 HQ 模块；`?legacy=1` 过渡期保留旧页  
4. **catalog 标注 `tier`**：`legacy` | `hq` | `gateway` — 导航与验收只认 tier  
5. **文案诚实**：`legacy` = **L0 teaching**（教学轻仿真），**不是**工程 CFD/EM；`hq` = **L2 engineering Lab**；批算板 = **L3**。禁止把 L0 叶子标成工程结算能力  

**tuanliu 是第一块砖，不是唯一例外。** 热 / EM / 声学 / MD … 都按同一模块合同交付。

### Catalog tier ↔ 产品层（诚实映射 · B0 / #51）

| catalog `tier` | 产品层 | 角色 | 可否算工程 DoD / settlement credit |
|----------------|--------|------|-------------------------------------|
| `legacy` | **L0** | Browser teaching demos（Atlas 叶子 2D / 简易 demo） | **否** — 仅教学与认路 |
| `hq`（且 `hqDefaultLive`） | **L2** | Engineering HQ Lab 默认路由（tuanliu-class） | 产品面 **是 Lab**；仍 ≠ `@w-sim/solvers-*` DoD 自动达标 |
| `gateway`（`antennas` / 族目录） | **L2** | Lab / catalog 入口 | 入口本身不计 solver 完成度 |
| `gateway`（`batch-jobs` / `my-projects`） | **L3** | 批算 / 结算板 | 结算平面，不是教学 canvas |
| `?legacy=1` on live HQ path | **L1** | Teaching 2D 风洞等（如 `/windtunnel?legacy=1`） | **否** — 明确教学回退 |

权威策略（毕业 / 保留）：W-Sim `ATLAS_L0_POLICY.md` (historical internal reference) · 本仓镜像说明 [`docs/w-sim.md`](./w-sim.md)。  
代码守卫：`src/lib/sim/simCapabilityCatalog.ts` → `assertCatalogTierHonesty` + L0 smoke 测试。

### Module maturity + implementation owner（镜像 ATLAS_L0_POLICY §7 · w-sim #16）

> This section is a retained historical migration snapshot. W-Sim owns current
> solver package maturity and residual inventory; WaveWorld no longer mirrors
> those release facts in executable catalog code.

Policy labels (do not blur): **L0 / teaching** · **smoke** · **engineering** · **integrated** · **product-presentation**.  
**Hard ban**: L0/teaching never counts toward `@w-sim/solvers-*` DoD or solver-completion metrics.

**Honesty after S-solvers package land (do not blur)**:

| Claim | True? |
|-------|-------|
| `@w-sim/solvers-*` packages **exist** (thermal / em-fdtd / acoustics / md / lbm / structural / path-experiment / export-report) | **Yes** — W-Sim owns package README `owner:` + meta maturity (mostly **smoke**; LBM still shell+CPU ref) |
| Atlas catalog leaves for those families are **graduated** engineering | **No** — still `tier=legacy` L0 teaching; product does **not** import packages for those leaves |
| Package **smoke** maturity = engineering DoD complete | **No** |
| Numerical residual depth (sealed **wave43 multi-package residual** tip `cb4f5ec` (S24bt `c77a418` · S19bu `b60d9cb` · S20bw `cb4f5ec` · S27cr `02afe21` · S28cs `15d00a6` · S26cm `fab0297` · S29cj `1226964` · export 426 `1c9acda`); sealed **wave42 multi-package residual** tip `c86b40b` (S24bs `c86b40b` · S19bt `be777c9` · **S20bv** `626140e` · S27cq `f4dc940` · S28cr `8438771` · S26cl `63ddcbd` · S29ci `b8738c4` · export 425 `36f2391`); sealed **wave41 multi-package residual** tip `cfe8685` (S24br `cfe8685` · S19bs `65f6251` · S27cp `95b4828` · S28cq `f275f05` · S26ck `f8d58a2` · S29ch `55b92b1` · export 424 `543d26f`; **S20bv path-experiment miss** — closed in wave42 as `626140e`); sealed **wave40 multi-package residual** tip `c1e1024` (S24bq `827d9b8` · S19br `d5c87b7` · S20bu `0d6e3b5` · S27co `07f9568` · S28cp `c1e1024` · S26cj `0e8836c` · S29cg `42a9eb0` · export 423 `795feee`); sealed wave42: S24bs / S19bt / S20bv / S27cq / S28cr / S26cl / S29ci / export-425; sealed wave41: S24br / S19bs / S27cp / S28cq / S26ck / S29ch / export-424 (**S20bv miss→closed wave42**); sealed wave40: S24bq / S19br / S20bu / S27co / S28cp / S26cj / S29cg / export-423; sealed wave39: S24bp / S19bq / S20bt / S27cn / S28co / S26ci / S29cf / export-422; sealed wave38: S24bo / S19bp / S20bs / S27cm / S28cn / S26ch / S29ce / export-421; sealed wave37: S24bn / S19bo / S20br / S27cl / S28cm / S26cg / S29cd / export-419; sealed wave36: S24bm / S19bn / S20bq / S27ck / S28cl / S26cf / S29cc / export-418; sealed wave35: S24bl / S19bm / S20bp / S27cj / S28ck / S26ce / S29cb / export-417; sealed wave34: S24bk / S19bl / S20bo / S27ci / S28cj / S26cd / S29ca / export-415; sealed wave33: S24bj / S19bk / S29bz / S26cc / S27ch / S28ci / S20bn / export-414; sealed wave32: S24bi / S19bj / S29by / S26cb / S27cg / S28ch / S20bm / export-413; sealed wave31: S24bh / S19bi / S29bx / S26ca / S27cf / S28cg / S20bl / export-412; sealed wave30: S24bg / S19bh / S29bw / S26bz / S27ce / S28cf / S20bk / export-411; sealed wave29: S24bf / S19bg / S29bv / S26by / S27cd / S28ce / S20bj / export-410; sealed wave28: S24be / S19bf / S29bu / S26bx / S27cc / S28cd / S20bi / export-409; sealed wave27: S24bd / S19be / S29bt / S26bw / S27cb / S28cc / S20bh / export-408; sealed wave26: S24bc / S19bd / S29bs / S26bv / S27ca / S28cb / S20bg / export-405; sealed wave25: S24bb / S19bc / S29br / S26bu / S27bz / S28ca / S20bf / export-404; sealed wave24: S24ba / S19bb / S29bq / S26bt / S27by / S28bz / S20be / export-403; sealed wave23: S24az / S19ba / S29bp / S26bs / S27bx / S28by / S20bd / export-402; sealed wave22: S24ay / S19az / S29bo / S26br / S27bw / S28bx / S20bc / export-401; prior sealed **wave21 multi-package residual** tip `c98a0d9` (S24ax/S19ay/S29bn/S26bq/S27bv/S28bw/S20bb/export-400); prior sealed **wave20 multi-package residual** tip `0756ce1`; sealed wave20: S24aw thermal Dragomir B₁₄/B₁₅ · S19ax LBM eng dual · S29bm MD honesty · S26bp Mindlin peak consistency×aspect×t / peak thickness×κ rotary dual · S27bu veca-dense · S28bv uda-dense · S20ba octodecuple · export 502 empty-body; sealed mid export-304 · wave19 S24av/S19aw/S29bl/S26bo/S27bt/S28bu/S20az/export-503 · sealed mid wave19 S24au/S19av/S29bk/S26bn/S27bs/S28bt/S20ay/export-429 · wave18 S24at/S19au/S29bj/S26bm/S27br/S28bs/S20ax/export-406; contracts tip `17f86c3` is not a solvers residual) = eng DoD / Atlas graduation | **No** — residual expand **deepens smoke only**; maturity stays **smoke** until true graduation gates; **smoke residual expand ≠ engineering DoD / Atlas graduation** (**smoke ≠ eng DoD** for thermal · EM · acoustics · MD · structural · LBM); true Atlas graduation still open for thermal · EM · acoustics · MD (structural engine-plane-only; LBM production still tuanliu) |
| Production LBM D3Q19 lives solely in `@w-sim/solvers-lbm` | **No** — live path still `apps/lab` until extract; package admits kind / stub+CPU refs only |

| Module (`hqModuleId` / path) | Maturity (policy label) | Implementation owner | Catalog `tier` today | Catalog paths (sync · 41 total) | Notes |
|------------------------------|-------------------------|----------------------|----------------------|----------------------------------|-------|
| **Atlas L0 algorithms** (`src/lib/sim/**`, leaf teaching pages) | **L0 / teaching** | **WaveWorld** | `legacy` ×37 | all `L0_SMOKE_SAMPLE_PATHS` (full parity) | Default retention; not graduated; excluded from solver metrics |
| **tuanliu** (`apps/lab`) | **product-presentation** (HQ Lab UI) + **production numerical core still WW-owned** | **WaveWorld** `apps/lab`; package shell `@w-sim/solvers-lbm` (**smoke**/stub · W-Sim) | `hq` ×1 + `legacy` ×1 | `windtunnel` (hq); `fluid` (legacy — unified 2D); `lab-cfd` no longer a catalog row | Package **exists** but is **not** sole production owner (RB-LBM-0). CPU Ghia residual incl Re=1000 (S19l/m/n · Ghia1k) + Re=3200 table stub (S19o) + D2Q9 MRT collision/lid/Ghia Re=100 (S19p/q/r) + fine-grid Ghia Re=100 (S19s) + MRT Ghia Re=400 (S19t/u) + MRT Ghia Re=1000 smoke (S19v) + MRT fine Ghia Re=1000 eng (S19w) + MRT Ghia Re=3200 table stub (S19x) + multi-Re Ghia matrix smoke (S19y) + multi-Re dual U/V floors (S19z) + Ghia Re=5000 table stub (S19aa) + matrix Re=5000 stub floors residual (S19ab) + S19ac Ghia Re=7500 table stub polish + S19ad Ghia Re=10000 table stub + force-channel refine (S19ae–S19af) + **S19ag force-channel eng residual** (`613c066`) + **S19ah force-channel viscous wall-shear** (`2c1f299`) + **S19ah fine viscous-shear expand** (`00d224e`) + **S19ai dual viscous/MEA shear** (`9cde8a6`) + **S19aj friction matrix/f·Re/G_eff residual** (`8b971ad`) + **S19ak body-force dual/shape/viscosity residual** (`1578343`) + **S19al viscosity residual matrix/shape-factor/bulk shear residual** (`beab26d`) + **S19am** (`402654c`) + **S19an peak/Re residual** (`f15457f`) + **S19ao mean/Re residual matrix** (`3fe37d7`) + **S19ap wall-shear/body-force recovery residual matrix** (`07a074e`) + **S19aq friction/viscosity recovery residual matrix** (`7f5cf5d`) + **S19ar shape/f·Re recovery residual matrix** (`f84d962`) + **S19as residual** (`727307e`) + **S19at mean/friction/mean-from-peak recovery residual** (`a936cef`) + **S19au peak-from-mean/f·Re residual** (`a3d2558`) + **S19av mean-from-peak/Re-from-friction residual** (`868307d`) + **S19aw bulk↔peak consistency / matched friction×Re residual** (`49cc304`) + **S19ax cross matched friction×Re / bulk–peak–friction Re residual** (`f96b394`); **S19ay** triple-matched friction×Re residual (`c98a0d9`) + **S19az residual** (`9b358be`); **S19ba residual** (`04c4074`) + **S19bb residual** (`c5f5e2b`) + **S19bc residual** (`66130ee`) + **S19bd residual** (`72b4802`); **S19be residual** (`445a5e7`) + **S19bf residual** (`78c4850`); **S19bg residual** (`e967fe2`); **S19bh residual** (`04f2d04`); **S19bi residual** (`c4694f2`); **S19bj residual** (`f220feb`); **S19bk residual** (`30e64c2`); **S19bl residual** (`2cbbf63`); **S19bm residual** (`349ca5b`); **S19bn residual** (`065581a`); **S19bo residual** (`1653d4c`); **S19bp residual** (`1fe79a7`); **S19bq residual** (`d24b12d`); **S19br residual** (`d5c87b7`); **S19bs residual** (`65f6251`); **S19bt residual** (`be777c9`); **S19bu residual** (`b60d9cb`) — does not cut over WebGPU. After full graduate → import package, no forked production core. **HqLabKit** via `@w-sim/kit` — §2.2 |
| **tuanliu** `?legacy=1` teaching 2D | **L0 / teaching** | **WaveWorld** pages (`WindTunnel` etc.) | teaching fallback on HQ paths | (query flag; not a catalog tier row) | Allowed teaching fork; never engineering settlement |
| **thermal** (planned `labs/thermal`) | **L0 / teaching** (Atlas) · package **smoke** (W-Sim) | **WaveWorld** leaves `src/lib/sim/**` + heat pages; **W-Sim** `@w-sim/solvers-thermal` | `legacy` ×3 | `sim`, `heaterfc`, `convection` | Package smoke + Foster/Cauer (S24h/i) + layer/cum Zθ (S24k/l) + pulse/cool (S24m) + Foster↔Cauer (S24n) + multi-pulse duty (S24o–S24t) + energy/var/skew/CV/IQR/trimmed (S24u–S24z) + S24aa Winsorized-mean/Shannon-entropy + S24ab Gini-HPD + S24ac Lorenz/concentration + S24ad–S24af + S24ag duty Tsallis/CvM + S24ah Hellinger/JS + **S24ai Bhattacharyya/W1** (`8b40541`) + **S24aj residual** (`1a9fb7f`) + **S24ak χ²/Jeffreys residual** (`9de7341`) + **S24al Neyman-χ²/triangular residual** (`3485179`) + **S24am** (`6796847`) + **S24an LeCam/Clark residual** (`73b3dda`) + **S24ao Taneja/Kumar-Johnson residual** (`9a2e940`) + **S24ap Jain–Srivastava/Dragomir residual** (`985a869`) + **S24aq Dragomir B₂/B₃ residual** (`430fdd7`) + **S24ar Dragomir B₄/B₅ residual** (`4c45ede`) + **S24as Dragomir B₆/B₇ residual** (`8d6d282`) + **S24at Dragomir B₈/B₉ residual** (`8720cc8`) + **S24au Dragomir B₁₀/B₁₁ residual** (`f41e46c`) + **S24av Dragomir B₁₂/B₁₃ residual** (`e6cd05e`) + **S24aw Dragomir B₁₄/B₁₅ residual** (`0756ce1`); **S24ax Dragomir B₁₆/B₁₇ residual** (`d7f0016`); **S24ay residual** (`e28e103`); **S24az residual** (`3e90b04`); **S24ba residual** (`8b914f4`) + **S24bb residual** (`e1b2f74`) + **S24bc residual** (`a3d67b8`); **S24bd residual** (`1a5445e`) + **S24be residual** (`5f8211b`); **S24bf residual** (`7bf9246`); **S24bg residual** (`a41e6ee`); **S24bh residual** (`b526d79`); **S24bi residual** (`250ab1e`); **S24bj residual** (`6cc6569`); **S24bk residual** (`4886205`); **S24bl residual** (`35766ed`); **S24bm residual** (`b5f3957`); **S24bn residual** (`78ad914`); **S24bo residual** (`0eca182`); **S24bp residual** (`1199a16`); **S24bq residual** (`827d9b8`); **S24br residual** (`cfe8685`); **S24bs residual** (`c86b40b`); **S24bt residual** (`c77a418`); **not** Atlas-imported; HQ Lab not live; catalog stays teaching (smoke package-land ≠ eng DoD; smoke ≠ eng DoD) |
| **em-fdtd** (planned `labs/em-fdtd`) | **L0 / teaching** (Atlas) · package **smoke** (W-Sim) | **WaveWorld** leaves; **W-Sim** `@w-sim/solvers-em-fdtd` | `legacy` ×3 | `fdtd`, `emwave3d`, `electromagnetic` | Package smoke + mur/mur2 multi-D ABC + CPML-lite multi-face + Roden–Gedney ψ suite through S27az CFS α / S27ba–S27bb mur2-t multi-face + S27bc ABC energy matrix + S27bd multi-CFL/longer-run/second-grid + **S27be denser-CFL/third-grid multi-pulse** (`928eafe`) + **S27bf residual** (`dced5a3`) + **S27bg residual** (`05e1448`) + **S27bh residual** (`cb7fdd1`) + **S27bi** (`e4de0a5`) + **S27bj tera-dense residual** (`51a736d`) + **S27bk peta-dense residual** (`bf5e846`) + **S27bl exa-dense residual** (`d2a0bd1`) + **S27bm zetta-dense residual** (`98c3eac`) + **S27bn yotta-dense residual** (`2d35234`) + **S27bo ronna-dense residual** (`b822c95`) + **S27bp residual** (`4ac7554`) + **S27bq xenna-dense residual** (`79e2a85`) + **S27br weka-dense residual** (`4981267`) + **S27bs vunda-dense residual** (`c585ce2`) + **S27bt xona-dense residual** (`26ee967`) + **S27bu veca-dense residual** (`2ef66bb`); **S27bv residual** (`f5f29b6`); **S27bw residual** (`d6c4674`); **S27bx residual** (`3db6e2d`); **S27by residual** (`bdf4077`) + **S27bz residual** (`d61d351`) + **S27ca residual** (`09ca975`); **S27cb residual** (`77e2599`) + **S27cc residual** (`ed0f10c`); **S27cd residual** (`8b497fe`); **S27ce residual** (`ca0ebe0`); **S27cf residual** (`04703dc`); **S27cg residual** (`1fac0d8`); **S27ch residual** (`81fe3b0`); **S27ci residual** (`967a073`); **S27cj residual** (`78b51d4`); **S27ck residual** (`7ba0562`); **S27cl residual** (`285b4dd`); **S27cm residual** (`1d56541`); **S27cn residual** (`03471a2`); **S27co residual** (`07f9568`); **S27cp residual** (`95b4828`); **S27cq residual** (`f4dc940`); **wave43 sealed** S27cr (`02afe21`) (+ prior S27ay all-face CPML-ψ / S27ax dual-z ψ / …); Host may settle kinds via package runners — leaves still L0; Atlas graduation open (smoke package-land ≠ eng DoD; smoke ≠ eng DoD) |
| **antenna** (planned `labs/antenna`) | **L0 / teaching** + catalog gateway | **WaveWorld** | `legacy` ×3 + `gateway` ×1 | `antenna3d`, `antennapattern`, `phasedarray`; gateway `antennas` | No dedicated `@w-sim/solvers-antenna` yet; HQ module not live |
| **acoustics** (planned `labs/acoustics`) | **L0 / teaching** (Atlas) · package **smoke** (W-Sim) | **WaveWorld** leaves; **W-Sim** `@w-sim/solvers-acoustics` | `legacy` ×4 | `sound`, `vibration`, `ripple`, `ultrasound` | Package smoke + mur/mur2 multi + impedance-wall + mur2 transverse suite through S28aw multi-face Z + S28ax–S28ba hybrids + S28bb multi-CFL energy floors + S28bc denser multi-CFL + S28bd Eng-MIN dual denser multi-CFL + **S28be ultra-dense multi-CFL/multi-seed/pmlFraction** (`759df3e`) + **S28bf residual** (`fdd0f41`) + **S28bg residual** (`fd083db`) + **S28bh residual** (`6d0af4f`) + **S28bi** (`d22a5cc`) + **S28bj giga-dense residual** (`062772a`) + **S28bk tera-dense residual** (`c41b4f7`) + **S28bl residual** (`00648c6`) + **S28bm residual** (`d4ec5fc`) + **S28bn zetta-dense residual** (`059b948`) + **S28bo yotta-dense residual** (`4aae2c5`) + **S28bp ronna-dense residual** (`40ee148`) + **S28bq residual** (`13cab68`) + **S28br xenna-dense residual** (`cfe44fc`) + **S28bs weka-dense residual** (`9cde05f`) + **S28bt vunda-dense residual** (`d7985b2`) + **S28bu xona-dense residual** (`9138718`) + **S28bv uda-dense residual** (`467585a`); **S28bw residual** (`639b476`); **S28bx residual** (`0bd6d13`); **S28by residual** (`125e7ef`); **S28bz residual** (`c15336f`) + **S28ca residual** (`21499c7`) + **S28cb residual** (`34a55e4`); **S28cc residual** (`33adc17`) + **S28cd residual** (`095e893`); **S28ce residual** (`797a106`); **S28cf residual** (`dc3536a`); **S28cg residual** (`20959e9`); **S28ch residual** (`ea176d2`); **S28ci residual** (`1644aec`); **S28cj residual** (`1578499`); **S28ck residual** (`f020765`); **S28cl residual** (`95a2e52`); **S28cm residual** (`07a5299`); **S28cn residual** (`70b666a`); **S28co residual** (`3cc7fc8`); **S28cp residual** (`c1e1024`); **S28cq residual** (`f275f05`); **S28cr residual** (`8438771`); **wave43 sealed** S28cs (`15d00a6`) (+ prior S28av Z+mur2-t / S28au corner/edge / S28as all-face / S28ar–ap dual-axis); catalog leaves not graduated; smoke package-land ≠ eng DoD; smoke ≠ eng DoD |
| **md** (planned `labs/md`) | **L0 / teaching** (Atlas) · package **smoke** (W-Sim) | **WaveWorld** leaves; **W-Sim** `@w-sim/solvers-md` | `legacy` ×3 | `md`, `particles`, `ising` | Package smoke + cell-list/PBC/NVT/NPT-lite/Verlet/triclinic suite through S29ao abs delayed-rebuild multi-step + S29ap–S29ar + S29as shear h-NPT stub + S29at dual diag/shear pressure-window + S29au dual temp/box-volume γ-ramp + **S29av dual pressure/volume multi-window shear** (`5ec77d0`) + **S29aw residual** (`9e45bfb`) + **S29ax residual** (`fcdffa8`) + **S29ay residual** (`f02b59e`) + **S29az** (`b33d6a8`) + **S29ba residual floors** (`002923e`) + **S29bb multi-window honesty floors** (`abd48b9`) + **S29bc residual** (`d9935ac`) + **S29bd residual** (`83de6e8`) + **S29be residual** (`179040f`) + **S29bf honesty matrix residual** (`88a67e3`) + **S29bg max↔mean/max↔RMS/CV sealed honesty residual** (`f348b9d`) + **S29bh residual** (`1ff87a7`) + **S29bi bound multi-window honesty residual** (`5a68ea4`) + **S29bj capped multi-window honesty residual** (`c2d8e2f`) + **S29bk mean↔MAD/rms↔MAD/Jarque–Bera clamped honesty residual** (`d695187`) + **S29bl mean↔IQR/AD/Shapiro fastened honesty residual** (`f787957`) + **S29bm rms↔IQR/KS/CvM bolted honesty residual** (`027e62e`); **S29bn riveted honesty residual** (`53bf516`); **S29bo residual** (`290e283`); **S29bp residual** (`e040e39`); **S29bq residual** (`1671315`) + **S29br residual** (`8fd1758`) + **S29bs residual** (`07a4607`); **S29bt residual** (`1196735`) + **S29bu residual** (`dc74b1a`); **S29bv residual** (`af6728b`); **S29bw residual** (`9e0ed41`); **S29bx residual** (`deb7a1e`); **S29by residual** (`bfe2401`); **S29bz residual** (`cb3f5bb`); **S29ca residual** (`2f38efa`); **S29cb residual** (`d2882b4`); **S29cc residual** (`7ef2e1e`); **S29cd residual** (`a036af7`); **S29ce residual** (`6614480`); **S29cf residual** (`d8a64d3`); **S29cg residual** (`42a9eb0`); **S29ch residual** (`55b92b1`); **S29ci residual** (`b8738c4`); **wave43 sealed** S29cj (`1226964`) (+ prior S29an multi-step energy / S29am micro-step+h-μ / S29al one-step Verlet / S29ak abs force/energy / S29aj delayed-rebuild / S29ai virial); catalog leaves not graduated; Atlas graduation open (smoke package-land ≠ eng DoD; smoke ≠ eng DoD) |
| **structural** (engine plane only) | package **smoke** (W-Sim) · **no** Atlas leaves | **W-Sim** `@w-sim/solvers-structural` | n/a | — | Sparse/AMG/Kirchhoff/SuperLU + S26al Mindlin analytic + S26am aspect/energy + S26an expand + S26ao point-load + S26ap line-load + S26aq–S26as + S26at forced-harmonic energy + S26au Mindlin FOSD expand + S26av Mindlin multi-mode forced + **S26aw Mindlin rotary dual/damping ladder/κ-phase** (`9d715ed`) + **S26ax strip damping dual residual** (`f6a79b5`) + **S26ay free-edge dual/κ-sweep residual** (`3e0032d`) + **S26az free-edge/κ dual residual** (`85ef8a4`) + **S26ba ζ-ladder dual residual** (`8ee1023`) + **S26bb** (`76236ed`) + **S26bc ζ-ladder bandwidth residual** (`612f13f`) + **S26bd half-power Δω/Q residual** (`c446a39`) + **S26be residual** (`313b5c7`) + **S26bf energy half-power Q×aspect residual** (`a9484ae`) + **S26bg |w| half-power Q×aspect residual** (`c107be6`) + **S26bh residual** (`dae768f`) + **S26bi |w|/energy peak residual** (`b144ded`) + **S26bj peak-freq×aspect residual** (`eb1896c`) + **S26bk peak-freq×κ residual** (`f21bd35`) + **S26bl peak-freq×t residual** (`831f65d`) + **S26bm peak-freq rotary dual / peak×aspect×κ residual** (`540f920`) + **S26bn peak consistency×aspect×κ / peak×t×κ residual** (`93fa289`) + **S26bo peak consistency×t×κ / peak×aspect×t residual** (`0cbb02f`) + **S26bp peak consistency×aspect×t / peak thickness×κ rotary dual residual** (`f456a31`); **S26bq residual** (`835512e`); **S26br residual** (`aa9c18e`); **S26bs residual** (`e9cded8`); **S26bt residual** (`078f62a`) + **S26bu residual** (`e4efd3e`) + **S26bv residual** (`e5812a1`); **S26bw residual** (`dd4a17b`) + **S26bx residual** (`7603870`); **S26by residual** (`7ec3893`); **S26bz residual** (`24c9311`); **S26ca residual** (`10dee8d`); **S26cb residual** (`260bb96`); **S26cc residual** (`b0fff2d`); **S26cd residual** (`3626e95`); **S26ce residual** (`2af1d6a`); **S26cf residual** (`d76a654`); **S26cg residual** (`ca09977`); **S26ch residual** (`34f05d1`); **S26ci residual** (`bf2ed9d`); **S26cj residual** (`0e8836c`); **S26ck residual** (`f8d58a2`); **S26cl residual** (`63ddcbd`); **wave43 sealed** S26cm (`fab0297`). **Not** an Atlas catalog family; do not invent `hqModuleId=structural` leaves; smoke package-land ≠ eng DoD; smoke ≠ eng DoD |
| **path-experiment** (engine plane) | package **smoke** (W-Sim) · **no** Atlas leaves | **W-Sim** `@w-sim/solvers-path-experiment` | n/a | — | Agent may prefer package (S20h–S20z uncertainty suite + S20aa discrimination + S20ab skill + S20ac resolution + S20ad uncertainty decomp + S20ae–S20ag + S20ah reliability slope skill + S20ai Brier/slope dual skill + S20aj log/ignorance skill dual + **S20ak Brier/ignorance skill dual** (`0e4bdca`) + **S20al residual** (`7149f4e`) + **S20am Brier/ignorance/slope/AUC residual** (`f991dd7`) + **S20an Brier/ignorance/slope/AUC/intercept quintuple residual** (`e42c7d6`) + **S20ao** (`1b00631`) + **S20ap septuple skill residual** (`a595809`) + **S20aq octuple skill residual** (`f88a1e4`) + **S20ar nonuple skill residual** (`20cf002`) + **S20as decuple skill residual** (`86a6cef`) + **S20at undecuple skill residual** (`760df7d`) + **S20au duodecuple skill residual** (`3806b40`) + **S20av residual** (`5abea69`) + **S20aw quattuordecuple skill residual** (`5c19315`) + **S20ax quindecuple skill residual** (`5ede9dc`) + **S20ay sexdecuple skill residual** (`c89f437`) + **S20az septendecuple skill residual** (`c99912e`) + **S20ba octodecuple skill residual** (`955a3f6`); **S20bb residual** (`b93e70b`); **S20bc residual** (`9eeb10c`); **S20bd residual** (`118de3c`); **S20be residual** (`e54fddb`) + **S20bf residual** (`d197d04`) + **S20bg residual** (`02fd637`); **S20bh residual** (`a416b14`) + **S20bi residual** (`12d7e75`); **S20bj residual** (`206a3da`); **S20bk residual** (`796670c`); **S20bl residual** (`c6ae862`); **S20bm residual** (`02d5bca`); **S20bn residual** (`cc7b7c5`); **S20bo residual** (`378b036`); **S20bp residual** (`ed862d3`); **S20bq residual** (`4f02fda`); **S20br residual** (`975fe9b`); **S20bs residual** (`1998d28`); **S20bt residual** (`360235a`); **S20bu residual** (`0d6e3b5`); **S20bv residual** (`626140e`); **wave43 sealed** S20bw (`cb4f5ec`)); not catalog engineering; smoke package-land ≠ eng DoD; smoke ≠ eng DoD |
| **export-report** (engine plane) | package **smoke** (W-Sim) · **no** Atlas leaves | **W-Sim** `@w-sim/solvers-export-report` | n/a | — | Host settle only; download/range/If-Range/native-range/HEAD/OPTIONS + CORS preflight + Accept + Cache-Control Vary + CORP/Permissions-Policy + Content-Digest + Digest dual + Repr-Digest + Content-Length floor + Content-Range parse floor + **Accept-Encoding identity floor** (`0376232`) + **ETag weak/strong dual floor residual** (`56b76c1`) + **Last-Modified parse floor residual** (`a21bbb9`) + **Accept-Ranges bytes floor residual** (`bd9de2a`) + **Content-Disposition floor residual** (`d286f0d`) + **Cache-Control no-transform + Vary dual** (`daa40fd`) + **CORP+nosniff dual floor residual** (`cf147ea`) + **frame-deny + no-referrer dual floor residual** (`55c9f4e`) + **COOP same-origin + COEP require-corp dual floor residual** (`8919506`) + **Permissions-Policy floor residual** (`84593c7`) + **Origin-Agent-Cluster floor residual** (`ba2c336`) + **X-Permitted-Cross-Domain-Policies none floor residual** (`0c3d66f`) + **X-Download-Options noopen floor residual** (`7c34c85`) + **X-XSS-Protection 0 floor residual** (`c9debc6`) + **416 empty-body honesty residual** (`b661822`) + **406 empty-body honesty residual** (`5dafd07`) + **429 empty-body honesty residual** (`e53116b`) + **503 empty-body honesty residual** (`31f9f6d`) + **304 empty-body honesty residual** (`38a830f`) + **502 empty-body honesty residual** (`f48bfbc`); **400 empty-body honesty residual** (`b126304`); **401 empty-body honesty residual** (`55ce134`); **402 empty-body honesty residual** (`f9190c1`); **403 empty-body honesty residual** (`4eb3c3f`) + **404 empty-body honesty residual** (`c35ac12`) + **405 empty-body honesty residual** (`b040cb4`); **export-408 empty-body honesty residual** (`867558e`) + **export-409 empty-body honesty residual** (`aee4208`); **export-410 empty-body honesty residual** (`4139a56`); **export-411 empty-body honesty residual** (`efbe017`); **export-412 empty-body honesty residual** (`f694b18`); **export-413 residual** (`194a867`); **export-414 residual** (`6353c92`); **export-415 residual** (`bcf1db5`); **export-417 residual** (`1956ff8`); **export-418 residual** (`28f418e`); **export-419 residual** (`3756efa`); **export-421 residual** (`bd24115`); **export-422 residual** (`3b8d384`); **export-423 residual** (`795feee`); **export-424 residual** (`543d26f`); **export-425 residual** (`36f2391`); **wave43 sealed** export-426 (`1c9acda`); no catalog leaves; smoke package-land ≠ eng DoD; smoke ≠ eng DoD |
| **instrument** (planned instrument labs) | **L0 / teaching** | **WaveWorld** | `legacy` ×20 | instruments: `optics-lab`, `faraday`, `rlc`, `mutual`, `transient`, `smith`, `ecg`, `emg`, `eeg`, `neuron`, `biopipeline`, `stm`, `afm`, `signal-array`, `radar`, `localization`, `tdoa`, `nljd`, `laser`, `display` | No solvers-* family; all rows have `hqKind` field/instrument/gateway |
| **labs/kit** (shared Lab shell) | planned / **smoke** when landed | **WaveWorld** `modules/labs/kit` (future) | n/a | — | UI/infra only; not a solver |
| **gateway** batch / projects | **product-presentation** / L3 settlement surface | **WaveWorld** Host + Atlas; **contracts** from `@w-sim/contracts` | `gateway` ×2 | `batch-jobs`, `my-projects` | Not solver credit; uses W-Sim JobSpec plane; honesty → L3 |
| **W-Sim solvers-\*** (engine plane inventory) | package meta: mostly **smoke** (not eng DoD complete) | **W-Sim** package README `owner:` | n/a (not Atlas catalog rows) | — | Live packages: `solvers-thermal`, `solvers-em-fdtd`, `solvers-acoustics`, `solvers-md`, `solvers-lbm` (shell+CPU ref), `solvers-structural` (Mindlin + SuperLU pivot smoke), `solvers-path-experiment`, `solvers-export-report`. sealed **wave43 multi-package residual** tip `cb4f5ec` (S24bt `c77a418` · S19bu `b60d9cb` · S20bw `cb4f5ec` · S27cr `02afe21` · S28cs `15d00a6` · S26cm `fab0297` · S29cj `1226964` · export 426 `1c9acda`); sealed **wave42 multi-package residual** tip `c86b40b` (S24bs `c86b40b` · S19bt `be777c9` · **S20bv** `626140e` · S27cq `f4dc940` · S28cr `8438771` · S26cl `63ddcbd` · S29ci `b8738c4` · export 425 `36f2391`); sealed **wave41 multi-package residual** tip `cfe8685` (S24br `cfe8685` · S19bs `65f6251` · S27cp `95b4828` · S28cq `f275f05` · S26ck `f8d58a2` · S29ch `55b92b1` · export 424 `543d26f`; **S20bv path-experiment miss** — closed in wave42 as `626140e`); sealed **wave40 multi-package residual** tip `c1e1024` (S24bq `827d9b8` · S19br `d5c87b7` · S20bu `0d6e3b5` · S27co `07f9568` · S28cp `c1e1024` · S26cj `0e8836c` · S29cg `42a9eb0` · export 423 `795feee`). Prior sealed **wave39 multi-package residual** tip `1199a16` (S24bp `1199a16` · S19bq `d24b12d` · S20bt `360235a` · S27cn `03471a2` · S28co `3cc7fc8` · S26ci `bf2ed9d` · S29cf `d8a64d3` · export 422 `3b8d384`); prior sealed **wave38 multi-package residual** tip `1fe79a7` (S24bo `0eca182` · S19bp `1fe79a7` · S20bs `1998d28` · S27cm `1d56541` · S28cn `70b666a` · S26ch `34f05d1` · S29ce `6614480` · export 421 `bd24115`). Prior sealed **wave37 multi-package residual** tip `1653d4c` (S24bn `78ad914` · S19bo `1653d4c` · S20br `975fe9b` · S27cl `285b4dd` · S28cm `07a5299` · S26cg `ca09977` · S29cd `a036af7` · export 419 `3756efa`). Prior sealed **wave35 multi-package residual** tip `349ca5b` (S24bl `35766ed` · S19bm `349ca5b` · S20bp `ed862d3` · S27cj `78b51d4` · S28ck `f020765` · S26ce `2af1d6a` · S29cb `d2882b4` · export 417 `1956ff8`). Prior sealed **wave34 multi-package residual** tip `4886205` (S24bk `4886205` · S19bl `2cbbf63` · S20bo `378b036` · S27ci `967a073` · S28cj `1578499` · S26cd `3626e95` · S29ca `2f38efa` · export 415 `bcf1db5`). Prior sealed **wave33 multi-package residual** tip `6cc6569` (S24bj `6cc6569` · S19bk `30e64c2` · S29bz `cb3f5bb` · S26cc `b0fff2d` · S27ch `81fe3b0` · S28ci `1644aec` · S20bn `cc7b7c5` · export 414 `6353c92`). Prior sealed **wave32 multi-package residual** tip `f220feb` (S24bi `250ab1e` · S19bj `f220feb` · S29by `bfe2401` · S26cb `260bb96` · S27cg `1fac0d8` · S28ch `ea176d2` · S20bm `02d5bca` · export 413 `194a867`). Prior sealed **wave30 multi-package residual** tip `a41e6ee` (S24bg `a41e6ee` · S19bh `04f2d04` · S29bw `9e0ed41` · S26bz `24c9311` · S27ce `ca0ebe0` · S28cf `dc3536a` · S20bk `796670c` · export 411 `efbe017`). Prior sealed **wave29 multi-package residual** tip `7bf9246` (S24bf `7bf9246` · S19bg `e967fe2` · S29bv `af6728b` · S26by `7ec3893` · S27cd `8b497fe` · S28ce `797a106` · S20bj `206a3da` · export 410 `4139a56`). Prior sealed **wave28 multi-package residual** tip `5f8211b` (S24be `5f8211b` · S19bf `78c4850` · S29bu `dc74b1a` · S26bx `7603870` · S27cc `ed0f10c` · S28cd `095e893` · S20bi `12d7e75` · export 409 `aee4208`). Prior sealed **wave27 multi-package residual** tip `445a5e7` (S24bd `1a5445e` · S19be `445a5e7` · S29bt `1196735` · S26bw `dd4a17b` · S27cb `77e2599` · S28cc `33adc17` · S20bh `a416b14` · export 408 `867558e`). Prior sealed **wave26 multi-package residual** tip `09ca975` (S24bc `a3d67b8` · S19bd `72b4802` · S29bs `07a4607` · S26bv `e5812a1` · S27ca `09ca975` · S28cb `34a55e4` · S20bg `02fd637` · export 405 `b040cb4`). Prior sealed **wave25 multi-package residual** tip `66130ee` (S24bb `e1b2f74` · S19bc `66130ee` · S29br `8fd1758` · S26bu `e4efd3e` · S27bz `d61d351` · S28ca `21499c7` · S20bf `d197d04` · export 404 `c35ac12`). Prior sealed **wave24 multi-package residual** tip `c5f5e2b` (S24ba `8b914f4` · S19bb `c5f5e2b` · S29bq `1671315` · S26bt `078f62a` · S27by `bdf4077` · S28bz `c15336f` · S20be `e54fddb` · export 403 `4eb3c3f`). Prior sealed **wave23 multi-package residual** tip `04c4074` (S24az `3e90b04` · S19ba `04c4074` · S29bp `e040e39` · S26bs `e9cded8` · S27bx `3db6e2d` · S28by `125e7ef` · S20bd `118de3c` · export 402 `f9190c1`). Prior sealed **wave22 multi-package residual** tip `e28e103` (S24ay `e28e103` · S19az `9b358be` · S29bo `290e283` · S26br `aa9c18e` · S27bw `d6c4674` · S28bx `0bd6d13` · S20bc `9eeb10c` · export 401 `55ce134`). Prior sealed **wave21 multi-package residual** tip `c98a0d9` (S24ax `d7f0016` · S19ay `c98a0d9` · S29bn `53bf516` · S26bq `835512e` · S27bv `f5f29b6` · S28bw `639b476` · S20bb `b93e70b` · export 400 `b126304`). Prior sealed **wave20 multi-package residual** tip `0756ce1` (S24aw `0756ce1` · S19ax `f96b394` · S29bm `027e62e` · S26bp `f456a31` · S27bu `2ef66bb` · S28bv `467585a` · S20ba `955a3f6` · export 502 `f48bfbc` · sealed wave19 tip `e6cd05e` S24av/S19aw/S29bl/S26bo/S27bt/S28bu/S20az/export-503 · prior waves …). Residual expand ≠ graduation; **smoke residual expand ≠ engineering DoD / Atlas graduation** (**smoke ≠ eng DoD** for thermal · EM · acoustics · MD · structural · LBM). True Atlas **graduation** still open for thermal · EM · acoustics · MD; structural engine-plane-only; LBM production still tuanliu |

**Catalog flag rule (honesty)**: every `SIM_CAPABILITY_CATALOG` row has non-empty `hqModuleId` + `hqKind` (unit-gated). Counts above must stay isomorphic with `src/lib/sim/simCapabilityCatalog.ts`. W-Sim package maturity and package-only families are owned by W-Sim and do not belong in this runtime catalog.

**Graduation reminder** (full gates in ATLAS_L0_POLICY): headless core + units + stable schema + validation + failure semantics + committed W-Sim owner **and** JobKind demand or approved contract. **Package land ≠ graduation. Smoke residual expand ≠ engineering DoD / Atlas graduation.** Residual smoke depth (sealed **wave43 multi-package residual** tip `cb4f5ec` (S24bt `c77a418` · S19bu `b60d9cb` · S20bw `cb4f5ec` · S27cr `02afe21` · S28cs `15d00a6` · S26cm `fab0297` · S29cj `1226964` · export 426 `1c9acda`); sealed **wave42 multi-package residual** tip `c86b40b` (S24bs `c86b40b` · S19bt `be777c9` · **S20bv** `626140e` · S27cq `f4dc940` · S28cr `8438771` · S26cl `63ddcbd` · S29ci `b8738c4` · export 425 `36f2391`); sealed **wave41 multi-package residual** tip `cfe8685` (S24br `cfe8685` · S19bs `65f6251` · S27cp `95b4828` · S28cq `f275f05` · S26ck `f8d58a2` · S29ch `55b92b1` · export 424 `543d26f`; **S20bv path-experiment miss** — closed in wave42 as `626140e`); sealed **wave40 multi-package residual** tip `c1e1024` (S24bq `827d9b8` · S19br `d5c87b7` · S20bu `0d6e3b5` · S27co `07f9568` · S28cp `c1e1024` · S26cj `0e8836c` · S29cg `42a9eb0` · export 423 `795feee`); sealed **wave39 multi-package residual** tip `1199a16` (S24bp `1199a16` · S19bq `d24b12d` · S20bt `360235a` · S27cn `03471a2` · S28co `3cc7fc8` · S26ci `bf2ed9d` · S29cf `d8a64d3` · export 422 `3b8d384`); sealed **wave38 multi-package residual** tip `1fe79a7` (S24bo `0eca182` · S19bp `1fe79a7` · S20bs `1998d28` · S27cm `1d56541` · S28cn `70b666a` · S26ch `34f05d1` · S29ce `6614480` · export 421 `bd24115`); sealed **wave37 multi-package residual** tip `1653d4c`: S24bn `78ad914` · S19bo `1653d4c` · S20br `975fe9b` · S27cl `285b4dd` · S28cm `07a5299` · S26cg `ca09977` · S29cd `a036af7` · export 419 `3756efa`; sealed **wave36 multi-package residual** tip `b5f3957`: S24bm `b5f3957` · S19bn `065581a` · S20bq `4f02fda` · S27ck `7ba0562` · S28cl `95a2e52` · S26cf `d76a654` · S29cc `7ef2e1e` · export 418 `28f418e`; sealed **wave35 multi-package residual** tip `349ca5b`: S24bl `35766ed` · S19bm `349ca5b` · S20bp `ed862d3` · S27cj `78b51d4` · S28ck `f020765` · S26ce `2af1d6a` · S29cb `d2882b4` · export 417 `1956ff8`; sealed **wave34 multi-package residual** tip `4886205`: S24bk `4886205` · S19bl `2cbbf63` · S20bo `378b036` · S27ci `967a073` · S28cj `1578499` · S26cd `3626e95` · S29ca `2f38efa` · export 415 `bcf1db5`; sealed **wave33 multi-package residual** tip `6cc6569`: S24bj `6cc6569` · S19bk `30e64c2` · S29bz `cb3f5bb` · S26cc `b0fff2d` · S27ch `81fe3b0` · S28ci `1644aec` · S20bn `cc7b7c5` · export 414 `6353c92`; sealed **wave32 multi-package residual** tip `f220feb`: S24bi `250ab1e` · S19bj `f220feb` · S29by `bfe2401` · S26cb `260bb96` · S27cg `1fac0d8` · S28ch `ea176d2` · S20bm `02d5bca` · export 413 `194a867`; sealed **wave31 multi-package residual** tip `c4694f2`: S24bh `b526d79` · S19bi `c4694f2` · S29bx `deb7a1e` · S26ca `10dee8d` · S27cf `04703dc` · S28cg `20959e9` · S20bl `c6ae862` · export 412 `f694b18`; sealed **wave30 multi-package residual** tip `a41e6ee`: S24bg `a41e6ee` · S19bh `04f2d04` · S29bw `9e0ed41` · S26bz `24c9311` · S27ce `ca0ebe0` · S28cf `dc3536a` · S20bk `796670c` · export 411 `efbe017`; sealed **wave29 multi-package residual** tip `7bf9246`: S24bf `7bf9246` · S19bg `e967fe2` · S29bv `af6728b` · S26by `7ec3893` · S27cd `8b497fe` · S28ce `797a106` · S20bj `206a3da` · export 410 `4139a56`; sealed **wave28 multi-package residual** tip `5f8211b`: S24be `5f8211b` · S19bf `78c4850` · S29bu `dc74b1a` · S26bx `7603870` · S27cc `ed0f10c` · S28cd `095e893` · S20bi `12d7e75` · export 409 `aee4208`; sealed **wave27 multi-package residual** tip `445a5e7`: S24bd `1a5445e` · S19be `445a5e7` · S29bt `1196735` · S26bw `dd4a17b` · S27cb `77e2599` · S28cc `33adc17` · S20bh `a416b14` · export 408 `867558e`; sealed **wave26 multi-package residual** tip `09ca975`: S24bc `a3d67b8` · S19bd `72b4802` · S29bs `07a4607` · S26bv `e5812a1` · S27ca `09ca975` · S28cb `34a55e4` · S20bg `02fd637` · export 405 `b040cb4`; sealed **wave25 multi-package residual** tip `66130ee`: S24bb `e1b2f74` · S19bc `66130ee` · S29br `8fd1758` · S26bu `e4efd3e` · S27bz `d61d351` · S28ca `21499c7` · S20bf `d197d04` · export 404 `c35ac12`; sealed **wave24 multi-package residual** tip `c5f5e2b`: S24ba `8b914f4` · S19bb `c5f5e2b` · S29bq `1671315` · S26bt `078f62a` · S27by `bdf4077` · S28bz `c15336f` · S20be `e54fddb` · export 403 `4eb3c3f`; sealed **wave23 multi-package residual** tip `04c4074`: S24az `3e90b04` · S19ba `04c4074` · S29bp `e040e39` · S26bs `e9cded8` · S27bx `3db6e2d` · S28by `125e7ef` · S20bd `118de3c` · export 402 `f9190c1`; sealed **wave22 multi-package residual** tip `e28e103`: S24ay `e28e103` · S19az `9b358be` · S29bo `290e283` · S26br `aa9c18e` · S27bw `d6c4674` · S28bx `0bd6d13` · S20bc `9eeb10c` · export 401 `55ce134`; prior sealed **wave21 multi-package residual** tip `c98a0d9`: S24ax `d7f0016` · S19ay `c98a0d9` · S29bn `53bf516` · S26bq `835512e` · S27bv `f5f29b6` · S28bw `639b476` · S20bb `b93e70b` · export 400 `b126304`; prior sealed **wave20 multi-package residual** tip `0756ce1`: S24aw Dragomir B₁₄/B₁₅ · S19ax LBM eng dual · S29bm rms↔IQR/KS/CvM bolted honesty · S26bp peak residual · S27bu veca-dense · S28bv uda-dense · S20ba octodecuple · export 502 empty-body · sealed wave19 S24av/S19aw/S29bl/S26bo/S27bt/S28bu/S20az/export-503 · prior …) still ≠ eng DoD. **smoke ≠ eng DoD** for thermal · EM · acoustics · MD · structural · LBM; true Atlas graduation still open for thermal · EM · acoustics · MD (no false Lab usable claim while #49 open; structural has no Atlas leaves; LBM production still tuanliu). This table is the WaveWorld residual for #16 AC “records each module’s maturity and implementation owner” — keep in sync when kinds graduate, residual depth advances, or Atlas starts importing packages. **Principle-depth product migration** (`src/lib/principle-depth/**`, methods pages/nav): **WIP unstaged — not claimed** (do not treat as landed product AC). **Process**: #54/#55 process green (Done-slice re-probe); **#49 still open** (no eng Lab usable claim).

---

## 2. 「做到 tuanliu 那种 3D」= 模块合同（HQ Module Contract）

任一可替换上线的 HQ 模块必须满足（与 §2.1 HQ bar 对齐，模块级可勾选）：

| # | 能力 | tuanliu 对照 | 要求 |
|---|------|--------------|------|
| M1 | **3D 场景与几何** | STL/预设模型、voxelizer | 可参数化或导入几何；非单色方块凑数 |
| M2 | **场求解（主物理）** | `d3q19-solver` WebGPU | 浏览器粗网格预览 **或** 等价预览；工程数字可走 L3 |
| M3 | **科学可视化** | 体渲染 / 切片 / 粒子 | 伪彩、剖切、探针；可切换显示量 |
| M4 | **参数面板** | `parameter-panel` | 物理参数可调，变更驱动预览或标记 dirty |
| M5 | **结果面板** | `results-panel` | 标量 KPI + 简史；失败可读 |
| M6 | **结算对接** | `submit-batch-job` + JobSpec | 一键提交 L3；kind 注册在统一协议 |
| M7 | **验证** | `validation/*` smoke | 至少 1 条可头less/CI 的物理或契约 smoke |
| M8 | **独立边界** | 自有 `package`/目录 | 可单独构建、文档、preset；不污染其它模块源码 |

> **「tuanliu 级」≠ 每个场景都跑 LBM。**  
> 指 **同等工程产品深度**（3D 几何 + 可解场 + 可视化 + 结算 + 验证）。  
> 求解器可以是热传导 / FDTD / 声学 / MD；可视化管线与 Lab 壳复用 kit。

### 2.2 W-Sim `HqLabKit` 接线（tuanliu · w-sim #6）

Representative HQ lab **assembles** kit only through `@w-sim/kit` — **no local `HqLabKit` type**.

| Surface | Product location | W-Sim seam |
|---------|------------------|------------|
| Kit assembly | `apps/lab/src/lib/w-sim/hq-lab-adapter.ts` → `assembleTuanliuHqLabKit` / `getTuanliuHqLabKit` | `assembleHqLabKit` |
| Geometry | wraps `PRESET_MODELS` + voxel-ready native payload | `GeometryLoader` |
| Solver lifecycle | prepare / start / pause / step / cancel / dispose (+ CPU voxel prepare) | `SolverSession` / `SolverFactory` |
| Settlement | batch panel → `submitViaKitSettlement` → jobs API | `SettlementClient` |
| Capability ad | `TUANLIU_BROWSER_FLUID_CAPABILITY` (`hostClass: browser`, kind `lbm-d3q19`, WebGPU + float32) | `createHostCapabilityRegistry` / `matchCapability` |
| Lab UI entry | `/lab` page bootstraps kit; `SubmitBatchJob` posts via kit settlement | — |
| WebGPU D3Q19 | stays in `d3q19-solver` + `WindTunnelCanvas` (GPU ownership explicit) | **not** imported into `@w-sim/contracts` |

Tests: `apps/lab/src/lib/w-sim/hq-lab-adapter.test.ts` (included in `npm run test:models`).

### 不强制 3D 体渲染的模块（仍须 HQ）

部分叶子本质是 **仪器 / 电路 / 信号**（ECG、Smith、RLC…）。替换时：

- 交付 **Instrument HQ Lab**：3D 场景化仪器/电路几何 + 可调参数 + 高保真波形/轨迹 + 可结算 KPI  
- **禁止**用假体渲染糊弄；也 **禁止**无限期停留在 2D 示波条  

catalog 用 `hqKind: 'field' | 'instrument' | 'gateway'` 区分。

---

## 3. 仓库形态（独立模块）

```
modules/
  tuanliu/                 # 参考实现 · 风洞/CFD（已有）— 第一 HQ 模块
  labs/                    # 新建族（推荐）
    kit/                   # 共享：相机/体渲染/剖切/探针/参数壳/结算按钮/WebGPU bootstrap
    thermal/               # 热管理 · IGBT（替换 /sim /heaterfc /convection）
    em-fdtd/               # 电磁 FDTD 3D（替换 /fdtd /emwave3d 等）
    antenna/               # 天线 3D 工程 Lab（替换 /antenna3d /phasedarray …）
    acoustics/             # 声学/波（替换 /ripple /sound /ultrasound …）
    md/                    # 分子/材料 3D（替换 /md /ising /particles）
    instrument-*/          # 按族拆：bio / radar / spm …
```

**原则**

- **一个物理族 = 一个模块包**，不要再往 `src/pages` 堆「半 3D」  
- Atlas（Vite）只做 **路由门面 + ontology/导航**；重 Lab 可 Next 子应用或同构挂载  
- **一种 JobSpec 协议**（扩展 kind），结算平面见 `sim-platform-upgrade` P5-F  
- Kit 只抽 **稳定 UI/基础设施**；求解器留在各模块内，避免巨石耦合  

### 路由替换约定

| 阶段 | URL 行为 |
|------|----------|
| 替换前 | `/sim` → L0 `Sim.tsx` |
| 切换中 | `/sim` → HQ thermal Lab（默认）；`/sim?legacy=1` → L0 |
| 稳定后 | 去掉 L0 或迁入「教学归档」导航分区；catalog `tier: hq` |

网关页 `/lab-cfd` 长期可作为 **Lab 总入口**（多工作区：风洞 | 热 | EM …），各叶子 path 深链到对应 workspace。

---

## 4. 替换波次（按族，不是按 40 页一起改）

当前 Sim 域约 **41** 叶子（`SIM_CAPABILITY_CATALOG`）。分类如下。

### Wave 0 — 底座（阻塞一切 HQ 替换）

| 项 | 说明 | Issue 锚点 |
|----|------|------------|
| 公网 tuanliu Lab | Caddy `/app/lab` + env | #31 P5-A |
| **labs/kit** 抽取 | 从 tuanliu 固化共享壳（可渐进，先 monorepo path alias） | 本文件 P5-G |
| 结算平面 | JobSpec 多 kind + UI | #36 P5-F |
| catalog `tier` 字段 | `legacy` / `hq` / `gateway` + `hqModuleId` | #32 扩展 |

### Wave 1 — 流体（已有模块，做路由替换）

| 旧 path | HQ 模块 | 动作 |
|---------|---------|------|
| `lab-cfd` | tuanliu | 真 iframe / 深链，去掉「未公开」 |
| `windtunnel` | tuanliu | 默认进 3D Lab；`?legacy=1` 留 2D 卡门涡街 |
| `fluid` | tuanliu 或 fluid 工作区 | 教学 2D 标 legacy；主入口 HQ |

### Wave 2 — 热管理（用户点名 · 旗舰）

| 旧 path | HQ 模块 | 结算 kind（草案） |
|---------|---------|-------------------|
| `sim` | `labs/thermal` | `thermal-3d-steady` |
| `heaterfc` | 同上（解析解→验证/教学子页） | 可选 `thermal-analytic-check` |
| `convection` | 同上（共轭/自然对流工作区） | `thermal-3d-convection` |
| （新）IGBT 旗舰场景 | 同上 workspace | `electro-thermal-igbt` |

→ 对应 #35；**禁止**在 Canvas 热扩散上「加点 3D」交差。

### Wave 3 — 电磁场 / 天线

| 旧 path | HQ 模块 |
|---------|---------|
| `fdtd` | `labs/em-fdtd` 3D FDTD（升级现有 2D/WebGPU） |
| `emwave3d` | 并入 em-fdtd 或共享 EM kit（现已有 three 雏形 → 抬到合同级） |
| `antenna3d` `antennapattern` `phasedarray` | `labs/antenna` |
| `electromagnetic` | 谱教学可留 legacy；主推链到 EM Lab |
| `faraday` `rlc` `mutual` `transient` `smith` | Wave 6 仪器/电路 Lab（或 EM 子工作区） |

### Wave 4 — 波与声学

| 旧 path | HQ 模块 |
|---------|---------|
| `ripple` | `labs/acoustics` 3D 波干涉 |
| `sound` `vibration` | 谱→声学 Lab 工作区 |
| `ultrasound` | 声学/医学超声 3D |

### Wave 5 — 分子 / 统计物理

| 旧 path | HQ 模块 |
|---------|---------|
| `md` | `labs/md` 3D 分子动力学（可 WebGPU） |
| `ising` | 3D Ising / 相变 Lab |
| `particles` | 材料薄膜 3D 工作区 |

### Wave 6 — 仪器与生物电（Instrument HQ）

| 旧 path | 形态 |
|---------|------|
| `radar` `laser` `stm` `afm` `nljd` | 3D 仪器场景 + 物理模型 + KPI |
| `ecg` `emg` `eeg` `neuron` | 3D 解剖/电极 + 高保真信号链（非假场） |
| `localization` `tdoa` | 3D 空间定位场景 |
| `optics-lab` `display` | 光学台 / 显示 3D Lab |

### Wave 7 — 网关与目录（不替换为场求解）

| path | 处理 |
|------|------|
| `batch-jobs` `my-projects` | 强化为结算/项目平面（P5-F） |
| `antennas` `biopipeline` | catalog/流水线 UI；链到 HQ 模块 |
| 各 Domain 非 sim 页 | 不在本路线 |

---

## 5. 单模块交付清单（复制到每个 issue）

```markdown
## Module: labs/<id>
### 替换 path
- [ ] /old-a 默认 → HQ
- [ ] /old-b …
### Contract
- [ ] M1 几何  M2 求解  M3 可视化  M4 参数  M5 结果  M6 结算  M7 验证  M8 边界
### Job kinds
- [ ] kind 名注册 + agent 认领
### Catalog
- [ ] tier=hq, hqModuleId, hqKind
### 不做
- [ ] 未达 contract 不改默认路由
- [ ] 不用 L0 页顶替验收
```

---

## 6. 与现有 Phase 5 的关系

| Phase | 角色（更新后） |
|-------|----------------|
| P5-A | **第一个模块**（tuanliu）公网可达 — 替换样板 |
| P5-B | catalog / 体验：扩展 **tier + hqModuleId**；legacy 切片仍做 |
| P5-C | 真 agent：服务所有模块 kind |
| P5-D | 导航：按族展示 HQ 模块，legacy 降权 |
| P5-E | **thermal 模块**（含 IGBT）= Wave 2 旗舰 |
| P5-F | 跨模块结算平面 |
| **P5-G** | **本文件**：HQ 模块体系 + kit + **逐个替换节奏** |

实施顺序原则：

```
Wave0 kit + 公网 tuanliu
    → 每完成一个模块 contract，立刻切换对应 path 默认路由
    → 不并行开 5 个半成品模块
```

**推荐开工序**：Wave0 → Wave1 路由切 tuanliu → Wave2 thermal/IGBT → Wave3 EM → …

---

## 7. Catalog 扩展（已落地 · 诚实标签）

`SimCapability`（`src/lib/sim/simCapabilityCatalog.ts`）字段：

```ts
tier: 'legacy' | 'hq' | 'gateway'   // @w-sim/contracts SimTier
hqModuleId?: string                 // 'tuanliu' | 'thermal' | …
hqKind?: 'field' | 'instrument' | 'gateway'
// product honesty helpers (not stored per-row; derived):
// catalogTierHonestyFor(tier, path) → L0 teaching | L2 engineering Lab | L3 batch
```

- 新增 HQ 模块上线：**同 commit** 更新 catalog + registry + nav 文案  
- 结构测试：`tier=hq` 的 path 必须有 `hqModuleId` 且 `hqDefaultLive`  
- **诚实测试**：`assertCatalogTierHonesty` — `legacy` 不得标 engineering credit；`hq` 不得读成 L0 teaching-only  
- **L0 smoke**：`L0_SMOKE_SAMPLE_PATHS` + `assertL0SmokeSampleHonesty` — **全量** catalog `tier=legacy` 叶子 parity（floor ≥30 / 当前 37；visible stage + engine 文件 + 非 HQ default；teaching≠engineering 对照；新增 legacy 行须同 commit 入 smoke 集），CI 可回归  

---

## 8. 明确不做

- 在 40 个 2D 页上分别「加点 Three.js」假装全部升级  
- 无 kit、无 contract 就批量改路由  
- 为每个模块新建一套 jobs 队列  
- 仪器类叶子强行套 LBM 体渲染  
- 未达标模块占用默认路由（必须先 `?legacy` 或并行 URL）  

---

## 9. Issue 索引

| Issue | 主题 |
|-------|------|
| #30 (historical internal reference) | WORKSTREAM 总览 |
| #31 (historical internal reference) | tuanliu 公网（Wave0/1 样板底座） |
| #35 (historical internal reference) | **thermal 模块** / IGBT（Wave 2 · 替换热 L0） |
| #36 (historical internal reference) | 结算平面 |
| **#37 (historical internal reference)** | **P5-G** 本文件 · kit + 替换节奏 + catalog tier |
| #38 (historical internal reference) | Wave1 路由：`/windtunnel` `/lab-cfd` `/fluid` → tuanliu |
| #39 (historical internal reference) | Wave3 **labs/em-fdtd** 模块（替换 `/fdtd` `/emwave3d`） |
| 后续 | antenna / acoustics / md / instrument… 一模块一 issue |
