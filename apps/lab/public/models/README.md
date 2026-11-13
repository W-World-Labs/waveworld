# 模型下载与制作说明（public/models/）

源码分发先从仓库根显式执行 `node scripts/prepare-source-assets.mjs`。它仅解包三个
逐字节校验的已审 gzip 素材，复用现有自建 Ahmed 程序化生成器，并生成实际模型清单；
不联网、不安装模型或引擎。原下载 Ahmed 网格、未确权 PR2 参考和超限原始 X-57 GLB
不随源码分发；X-57 的实际 solid 预设仍保留。原始许可见根目录 `THIRD-PARTY-NOTICES.md`。


实验室「模型」页优先读取本目录的预设文件。文件加载失败时，仅有对应程序化生成器的预设
可以回退，并显示原因；文件专用预设会显示错误并保留当前模型，不会换成其他车辆或飞机。

可用脚本重新生成程序化 STL（含朝向修正）：

```bash
node scripts/generate-preset-stls.mjs
```

只重建改动的几何时可指定文件名，例如：

```bash
node scripts/generate-preset-stls.mjs cylinder.stl sphere.stl airplane.stl
node scripts/write-models-manifest.mjs
```

## 一、文件名 ↔ 预设对照表

**文件名必须和下表完全一致**（含大小写、扩展名），放错名字不会被识别。

| 文件名 | 预设卡片 | 说明 | 推荐来源 | 出处/许可登记 |
|---|---|---|---|---|
| `naca0012.stl` | NACA 0012 翼型 | 经典对称翼型 | `scripts/generate-preset-stls.mjs` | 程序化 · 自建 |
| `cylinder.stl` | 圆柱体 | 基础绕流验证 | 同上 | 程序化 · 自建 |
| `sphere.stl` | 球体 | 三维绕流验证 | 同上 | 程序化 · 自建 |
| `car.stl` | 简化汽车 | 整车气动 | 同上（轿车分块体） | 程序化 · 自建 |
| `airplane.stl` | 简化飞机 | 整机气动 | 同上 | 程序化 · 自建 |
| `ahmed.stl` | Ahmed 车体 | 25° 斜背标准算例 | [nathanrooy/ahmed-bluff-body-cfd](https://github.com/nathanrooy/ahmed-bluff-body-cfd) | 下载网格未确权，不分发；显式生成已有自建教学近似 |
| `onera-m6.stl` | ONERA M6 机翼 | 跨声速机翼半模 | 程序化近似（30° 后掠 + 梯形） | 程序化 · 自建 |
| `server-chassis.stl` | 服务器机箱（结构示例） | 前后贯通、主板、双处理器散热片、内存、驱动器、电源 | 程序化 | 程序化 · 自建 |
| `heatsink.stl` | 鳍片散热器 | 直鳍散热器 | 程序化 | 程序化 · 自建 |
| `cube.stl` | 立方体 | 钝体验证 | 程序化 | 程序化 · 自建 |
| `cone.stl` | 圆锥体 | 锥形钝体 | 程序化 | 程序化 · 自建 |
| `building.stl` | 简化高楼 | 建筑绕流 | 程序化 | 程序化 · 自建 |
| `drivaer-lite.stl` | 轿车（简化） | 带轮/镜的轿车外形 | 程序化 | 程序化 · 自建 |
| `milk-truck-solid.stl` | 牛奶车 | Cesium 牛奶车（体素重网格水密版） | [Khronos glTF-Sample-Models](https://github.com/KhronosGroup/glTF-Sample-Models) | CC-BY 4.0 |
| `duck.glb` | 橡皮鸭（glTF） | Duck 示例 | Khronos 原 Sony 示例 | SCEA Shared Source License 1.0，非 MIT / CC-BY |
| `toy-car-solid.stl` | 玩具汽车 | Khronos ToyCar（体素重网格水密版） | [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | CC0 1.0 |
| `bicycle-solid.stl` | 自行车 | 双轮自行车（体素重网格水密版） | 程序化脚本（Y-up） | 自建 |
| `rocket-solid.stl` | 探测火箭 | Explorer Jupiter-C；加载后鼻尖 +Y → −X | [NASA-3D-Resources](https://github.com/nasa/NASA-3D-Resources) | 美国政府作品 · 公共域 |
| `ares-rocket-solid.stl` | Ares I | 主箭体水密重网格，已烘焙 −X 朝向与 90m 尺度 | 同上 | 公共域 |
| `space-shuttle-solid.stl` | 航天飞机 | Space Shuttle (A)；加载后机鼻 −Z → −X | 同上 | 公共域 |
| `airplane-x57-solid.stl` | X-57 电动飞机 | NASA X-57 Maxwell（减面 + 体素重网格水密版） | 同上 | 公共域 |

原始文件（保留作出处与再生成源，不挂预设卡片）：`milk-truck.glb`、`toy-car.glb`、`bicycle.stl`、`rocket.glb`、`ares-rocket.glb`、`space-shuttle.glb`、`airplane-x57.glb`（X-57 原文件约 13MB，实例展开几何约 98.6MB 超过 80MB 契约上限，故预设使用减面重网格版）。

下载的可视化网格多为非封闭面片，求解器要求水密实体；`*-solid.stl` 由体素化 + marching cubes 重建（`scripts/repair-preset-models.py` 流程，trimesh + scikit-image），外形保留、拓扑保证封闭。

额外参考文件（未挂到预设卡片，可手动上传）：

| 文件 | 说明 |
|---|---|
| `pr2_head_pan.stl` | 可选参考，因精确上游许可未确认，不随源码分发 |

**许可要求**：逐项保留原许可，不能用“学术标模”代替授权。SCEA、OWFa、CC0、CC-BY 和 NASA 声明各自独立，均不重标为 MIT；未确认精确授权的素材不得加入分发。

## OCP Olympus 1U：可下载结构预览

这些文件来自真实公开机械装配，未加入可计算预设：

- [完整机壳 GLB（约 32 MB）](olympus-1u-preview.glb)
- [去盖检查 GLB（约 32 MB）](olympus-1u-cover-removed-preview.glb)：仅断开原装配的
  `M1013179_ASSY_COVER_TOP_C2010` 顶盖子树，便于查看内部；不能作为完整机壳热计算几何。
- [来源、转换参数、文件 SHA-256 与组件清单](olympus-source.json)
- [Microsoft 原始许可声明](olympus-owfa-license.txt)

来源是 Microsoft / Open Compute Project 的 **Project Olympus**，机械包版本 **20170410**，
仓库 revision `810bc17f6ce93e3d46af24cacd205a1ad783b9ee`：
[官方硬件目录](https://github.com/opencomputeproject/Project_Olympus/tree/810bc17f6ce93e3d46af24cacd205a1ad783b9ee/HW)。
原始文件为 `ProjectOlympusComputeServer20170410.7z` 中的 `00_olympus_1u_asm.stp`。
按仓库声明使用 [OWFa 1.0](https://www.openwebfoundation.org/the-agreements/the-owf-1-0-agreements-granted-claims/owfa-1-0)，
本派生预览保留原始署名、说明和完整装配源链接；不表示 OCP 或 Microsoft 认可我们的求解结果。

离线 OCCT 8.0.1 三角化采用 0.5 mm 线性偏差与 0.7 rad 角度偏差，未做减面、布尔修补或
流体网格生成。原始坐标毫米转米，`(x,y,z) → (-z,y,x)`，Y 向朝上、X 向为机箱长轴；
该显示姿态未声明经过验证的流体边界条件。完整 GLB 保留 774 个节点及 668 个 mesh，包含
主板、CPU 安装部件、六个 40×28 风扇装配与电源等原始命名；名称不能证明旋转叶片、
热源功率、散热器材料或风扇性能已具备。

现有网页上传已验证两版均能解析：完整版约 199 万面、解析数组约 77.24 MiB，去盖版约
197 万面、76.46 MiB，均在现有 50 MiB 文件 / 80 MiB 几何额度内。导入器将几何展开为
三角网格，同时保留源节点名称、父子关系及对应面范围。工作台「模型」中的「源模型装配」
可搜索、展开、选取和聚焦部件；内部部件以透视高亮显示，也可点击三维模型选取。
装配表与几何一起保存在本机 IndexedDB，刷新后可恢复。已有计算结果可通过「模型视图 /
计算结果」切换查看，选取不会修改求解输入。旧项目若没有装配信息，需重新导入原 GLB。

导入支持静态重复网格与 GPU 实例展开，并修正镜像变换后的面绕向。动画仅取源节点的静态
姿态（不推进动画，也不取动画首帧）；蒙皮和形变目标需先烘焙成静态网格。
不从源名称或材质推断计算实体、材料、热源或风扇曲线，计算用 WGM2
格式保持不变。原 CAD 还含开放壳体和重叠零件。解析检查发现
开口、多面共边、绕向冲突和退化面，因此这两版仅作为结构查看和后续几何准备的输入，
不能直接充当有效的服务器风冷/热分析模型。六组风扇各含框架网格与四个安装橡胶件，共 15,080 面；
源文件未将叶轮独立定义为可运动部件，几何外观也不提供经过标定的风扇性能曲线。

## 二、格式要求

导入只建立三角表面，不生成有限元体单元。OBJ 支持正/负顶点索引、独立法线与纹理
索引，以及平面凹多边形三角化；非共面多边形需先三角化，单面最多 4096 个顶点。
输入坐标保存在 Float32 顶点数组中，导入不猜测单位或自动修补几何。

表面边检查统计完全重合顶点上的开口边、多面共边、绕向冲突和零面积面；不会把
相近但不同的顶点合并。通过检查不代表没有自交，也不证明体素、结构单元或物理
模型有效。机箱、飞机等组合预设可能仍有重叠组件，须按具体求解任务检查；旧模型
缺少检查记录时显示未检查。圆柱端面、球体接缝与极点已由几何回归覆盖。

- **格式**：二进制 STL 优先；也支持 ASCII STL、OBJ、glTF/GLB（扩展名按上表，换格式需在
  `src/lib/models/preset-models.ts` 里同步改 `modelUrl`）。
- **三角面数**：交互预览建议 **50 万面以下**，理想 5–20 万。硬上限为 **200 万面**，
  同时受解析后几何 **80 MiB** 额度约束；文件本身另有 **50 MiB** 上限。Ahmed 约 2.8 万面。
- **朝向（硬性要求）**：
  - 长轴沿 **x** 方向；
  - 「上」是 **+y**；
  - 车头/机头朝 **-x**（来流从 x 小的一端吹向 x 大的一端）。
  - CAD 软件导出的模型常是 Z-up：在 Blender/MeshLab 里**绕 x 轴旋转 -90°** 再导出。
- **单位**：导入保留原始坐标，不推断 CAD 单位；用户输入的参考长度（米）决定模型
  X 向包围盒的物理缩放。必须先确认原始尺度与朝向，不能把未知单位直接当成真实设备尺寸。

## 三、各模型推荐清单

- **Ahmed 车体**：不携带未确权下载 STL；显式准备使用现有自建教学近似，不作为原标模的精度或几何等价证明。
- **ONERA M6**：当前为程序化半模近似；若有 NASA/学术 STL，可覆盖 `onera-m6.stl`。
- **glTF 示例**：牛奶车、橡皮鸭用于验证 glTF 管线与趣味演示。
- **服务器机箱**：自建结构示例，20 个封闭组件、240 个三角面。去掉原先封死通风口的
  前后板；主板、处理器、散热片、内存、驱动器、电源作为气流障碍物参与同一体素占据计算。
  为让当前快速网格保留部件和间隙，壁/鳍厚人为取 12 mm、鳍间净距 24 mm；这不是实际机箱
  钣金或器件尺寸。默认 0.45 m、1 m/s 外部来流、快速网格、模型精细占域、20 步无热起始演示，
  沿用明确标记的稳定性预览黏度，不是原空气雷诺数的工程预测。未设置风扇，不能把入口来流
  称为机箱风扇驱动；零件名称也不自动赋予材料、功率或热接触参数。
  短回归验证文件、程序化回退与 WGM2 运输的体素完全一致，中央通道贯通，每个鳍间通道至少
  留两格空气。它不验证压降、温度或网格独立性。
- **真实服务器 CAD**：OCP Project Olympus 与上述自建示例是不同模型。原始 STEP 的装配、
  单位、许可和三角化应单独核对；可视化三角化成功不意味着当前流体网格能够解析钣金、
  散热器细缝或风扇。启用热模块时仍保留真实空气黏度和时间步准入检查，不能靠悄悄增黏度
  让服务器热计算通过。
- **鳍片散热器**：9 cm 恒温表面的自然对流起始演示；与服务器整机热设计结论无关。

## 四、新增模型预设（给开发）

在 `src/lib/models/preset-models.ts` 的 `PRESET_MODELS` 数组里加一条：

```ts
{
  id: 'my-model',
  name: '我的模型',
  category: 'vehicle',              // airfoil | vehicle | building | custom
  description: '一句话说明',
  thumbnailUrl: '/models/my-model.png',
  modelUrl: '/models/my-model.stl', // 对应本目录文件名
  defaultParameters: {
    angleOfAttack: 0,
    referenceArea: 1.0,
    referenceLength: 1.0,
  },
},
```

有同款程序化生成器的预设才支持文件失败回退；自行车、玩具汽车、牛奶车、鸭子与四个 NASA
文件预设没有同款生成器，加载失败会保留当前模型。新增文件预设需同时放入并校验模型文件。
若需把新几何写进 `public/models/`，在 `scripts/generate-preset-stls.mjs` 里加生成器后重跑脚本。

## 五、验证

1. `npm run dev` 启动后打开 `/lab`；
2. 左侧「模型」页点目标卡片的「加载模型」：
   - 徽标变绿「真实模型」+ 风洞里出现正确形状 → 成功；
   - 点了之后长时间卡在体素化 → 面数太多，回去减面；
   - 形状躺倒/侧翻 → 朝向不对，按第二节旋转后重新导出。


模型的实体语义：自建多组件预设在生成时声明连续三角面组，清单中的
`solidTriangleCounts` 与文件 SHA-256 一起使用。每个组内按奇偶规则保留内腔，
组间取实心并集；这是体素占据语义，不是对表面做 CAD 布尔修复。上传的
STL/OBJ/glTF 不根据名称、材质或连通片猜测实体分组，默认仍为一个边界集合。
缺失或过旧的模型清单不能用来确认实体组；有同款程序化生成器时浏览器显示回退提示，
文件专用预设则报错。
这不验证自交、流体域连通、网格独立性或结构有限元适用性。

MAC「检查计算网格」使用同一 Rust/WASM 前处理与风扇准入，在本机 Worker 中检查，
不推进时间、上传模型或生成流场结果。报告包括圆盘有效面数/面积、直径格数、相对输入圆盘
的面积与法向位置偏差，以及材料体素体积和配置热阻的共享面面积。功率区域只覆盖已有固体
体素的中心；区域外的固体仍使用默认材料和默认功率。固定温度固体单独显示，不把温度边界
冒充输入功率。未配置接触热阻的相邻材料仍按零接触热阻导热。检查失败须修正输入；检查通过
也不证明时间步稳定、细缝解析、网格独立性或稳态收敛。修改输入或启动求解会取消正在进行的检查。

计算模型上传统一写 WGM2（20 字节头部，附 uint32 实体三角面计数），
历史 WGM1 仍可读取并沿用原来的单边界语义。两种格式都使用同一个几何校验和求解入口。
公开契约见 `apps/host/openapi-simulation.yaml`；外部 Agent 需支持 WGM2 后再领取新上传模型任务。

风洞前处理检查旋转后完整模型是否位于计算域内，有无地面使用同一规则。减小模型占域比例
可以扩大物理流域；简化高楼默认使用约 1/6 流域长度，避免原默认配置截断模型。输入模型还必须
具有正 X 跨度并形成至少一个固体体素；无有效体素会明确拒绝，不能用空流场的零阻力冒充结果。
贴边几何（含地面零间隙）可以通过放置检查，但不代表流体间隙、压力基准或工程精度已验证。

探测火箭与航天飞机使用已核对原场景的固定刚体变换：分别 `(x,y,z)→(-y,x,z)` 和
`(x,y,z)→(z,y,-x)`，法线同步旋转、包围盒重算，三角拓扑和实体分组保持。磁盘原文件不改写；
预览、保存的 WGM2、浏览器与后端计算使用同一个定向后的网格，参考长度对应其 X 跨度。
不对用户上传或未知模型猜测朝向。Ares 原场景的游离部件不能靠整体旋转修复；X-57 当前超过
解析几何额度。这两个预设的限制会明确显示，不提供其他飞机作为替身。
