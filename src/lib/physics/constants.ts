// 第一性原理物理内核：CODATA/SI 基本常数（数值）与代表默认。
// 常数作为变量传入 formula.ts 求值器（绝不内联进 expr），保证「实现==测试==canonical」三者不漂移。

export const C = 299792458              // m/s 光速
export const H = 6.62607015e-34         // J·s 普朗克常数
export const HBAR = 1.0545718176461565e-34 // J·s 约化普朗克 = H/(2π)
export const KB = 1.380649e-23          // J/K 玻尔兹曼常数
export const QE = 1.602176634e-19       // C 元电荷
export const SIGMA = 5.670374419e-8     // W/m²/K⁴ 斯特藩-玻尔兹曼常数
export const NA = 6.02214076e23         // /mol 阿伏伽德罗常数
export const F = 96485.33212            // C/mol 法拉第常数
export const T_SUN = 5778               // K 太阳黑体代表温度
export const T0_ENV = 298.15            // K 死态/环境参考温度

// 代表默认（经验物性数据接入前的占位，registry 用）
export const DEFAULT_THERMAL_TH = 800   // K 中段热源
export const DEFAULT_GAMMA = 1.4        // 空气比热比
export const THERMAL_GATE_T = 2000      // K 第二定律闸门用保守热源上界（φ≈0.851，仅挡极端越界、对真实热机不误报）
