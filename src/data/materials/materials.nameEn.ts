/**
 * English display names for MD materials and categories.
 * Chinese `name` / category `label` remain source of truth.
 */
export const MATERIAL_NAME_EN: Readonly<Record<string, string>> = {
  氩: 'Argon',
  氖: 'Neon',
  氪: 'Krypton',
  氙: 'Xenon',
  'TIP3P 氧位点': 'TIP3P oxygen site',
  'TIP3P 氢位点': 'TIP3P hydrogen site',
  'SPC/E 氧位点': 'SPC/E oxygen site',
  'SPC/E 氢位点': 'SPC/E hydrogen site',
  'SPC 氧位点': 'SPC oxygen site',
  'SPC 氢位点': 'SPC hydrogen site',
  '粗粒化水（单球参考）': 'Coarse-grained water (1-bead)',
  钠离子: 'Sodium ion',
  钾离子: 'Potassium ion',
  氯离子: 'Chloride ion',
  芳环碳: 'Aromatic carbon',
  芳环氢: 'Aromatic hydrogen',
  噻吩环硫: 'Thiophene-ring sulfur',
  '磺酸基硫': 'Sulfonate sulfur',
  '磺酸基氧': 'Sulfonate oxygen',
  苯乙烯骨架碳: 'Styrene backbone carbon',
  'Martini 3 常规珠': 'Martini 3 regular bead',
}

export const MATERIAL_CATEGORY_LABEL_EN: Readonly<Record<string, string>> = {
  'noble-gas': 'Noble gases (LJ reference fluids)',
  'water-models': 'Water models (multi-site LJ + charge)',
  ions: 'Ions (Joung–Cheatham 2008)',
  'organic-polymer': 'Organics / polymers (OPLS-AA / CG)',
}

/**
 * Short English notes for MD materials (Chinese `notes` remain source of truth).
 * Keys = Chinese material `name`.
 */
export const MATERIAL_NOTES_EN: Readonly<Record<string, string>> = {
  氩: 'Classic LJ reference fluid. σ=0.3405 nm, ε/kB=119.8 K are the most-cited 12-6 parameters—good for reduced-unit teaching and benchmarks.',
  氖: 'kB check: 36.83 K × 0.0083145 = 0.30622 kJ/mol; σ=0.2789 nm. Caveat: Ne nuclear quantum effects matter; classic 12-6 is only an effective shallow-well approx.',
  氪: 'kB check: 164.0 K × 0.0083145 = 1.36358 kJ/mol; σ=0.3633 nm. Heavier atom; nuclear QE negligible; two-body 12-6 is a reliable bulk-Kr quantitative fit (effective pair picture).',
  氙: 'σ=0.4100 nm confirmed by independent sources (LibreTexts + HBC). ε scatters: LibreTexts ~1.77 kJ/mol (~212.9 K) vs HBC viscosity ~229 K—this library prefers the HBC viscosity fit.',
  'TIP3P 氧位点': '3-site rigid water. Only oxygen carries LJ + point charge; hydrogens are charge-only (no LJ).',
  'TIP3P 氢位点': 'Original TIP3P hydrogens have no LJ (σ=ε=0), only +0.417 e. Listed separately so they are not mistaken for single-site LJ reductions. CHARMM-modified TIP3P adds tiny H LJ—different parameter set.',
  'SPC/E 氧位点': '3-site rigid water; LJ only on oxygen. ε=0.650194 kJ/mol → 78.20 K. Geometry r(O–H)=1.0 Å, angle 109.47°. Charges −0.8476 / +0.4238. Same LJ as SPC; larger charges model self-polarization.',
  'SPC/E 氢位点': 'No LJ (σ=ε=0); carries +0.4238 e only.',
  'SPC 氧位点': '3-site rigid water; LJ only on oxygen. Shares LJ with SPC/E; differs only in charges (qO=−0.82, qH=+0.41).',
  'SPC 氢位点': 'No LJ; carries +0.41 e only.',
  '粗粒化水（单球参考）': 'Distortion warning: real water is not one neutral LJ bead. Flattening oxygen LJ into a CG bead loses H-bond directionality and charge structure—qualitative monoatomic proxy only.',
  钠离子: 'Pair 12-6 LJ from AMBER Rmin/2 (Joung–Cheatham TIP3P set). Parameters are water-model dependent—do not mix TIP3P and SPC/E ion tables.',
  钾离子: 'Pair 12-6 LJ (Joung–Cheatham TIP3P). SPC/E-tuned counterparts differ substantially; keep water model consistent.',
  氯离子: 'Pair 12-6 LJ with large σ / small ε (soft polarizable anion signature). Water-model dependent (TIP3P vs SPC/E).',
  芳环碳: 'OPLS-AA aromatic carbon type for benzene/styrene rings and base aryl carbon for thiophene/EDOT. LJ robust across ring carbons; charges vary with ring environment.',
  芳环氢: 'OPLS-AA aromatic H. United-atom CG models omit explicit H; kept here for all-atom PEDOT/PSS-style rings.',
  噻吩环硫: 'OPLS-AA heteroaryl sulfur suitable for PEDOT thiophene S (σ ~3.55 Å, ε 0.250 kcal/mol).',
  磺酸基硫: 'Proxy: OPLS-AA has no dedicated sulfonate S; sulfone SY LJ is commonly borrowed for PSS/SDS. Geometry/formal charge need rederivation for true SO3−.',
  磺酸基氧: 'Proxy sulfone oxygen for sulfonate O (same caveats as sulfonate S). Widely used LJ for SO3− oxygen; charges reassigned for sulfonate stoichiometry.',
  苯乙烯骨架碳: 'OPLS-AA alkene backbone carbon related to PSS styrene (vinyl/polymer backbone) units.',
  'Martini 3 常规珠': 'Distortion note: ε left 0/unknown because Martini uses discrete interaction levels (I–V), not a continuous classic LJ well—use Martini tables for nonbonded levels.',
}

/** Chinese forcefield label → English (source Chinese strings stay untouched). */
export const MATERIAL_FORCEFIELD_EN: Readonly<Record<string, string>> = {
  '经典 12-6 伦纳德–琼斯参考集': 'Classic 12-6 Lennard–Jones reference set',
  '经典 12-6 伦纳德–琼斯': 'Classic 12-6 Lennard–Jones',
  'TIP3P 水模型（Jorgensen 等，1983）': 'TIP3P water (Jorgensen et al., 1983)',
  'SPC/E 扩展点电荷水（Berendsen 等，1987）': 'SPC/E extended simple point charge (Berendsen et al., 1987)',
  'SPC 简单点电荷水（Berendsen 等，1981）': 'SPC simple point charge water (Berendsen et al., 1981)',
  '粗粒化单点近似（单球伦纳德–琼斯）': 'Coarse-grained 1-site approximation (single LJ bead)',
  '郑–奇瑟姆 一价离子参数（TIP3P 水系）': 'Joung–Cheatham monovalent ions (TIP3P water set)',
  'OPLS全原子 芳环碳类型': 'OPLS-AA aromatic carbon type',
  'OPLS全原子 芳环氢类型': 'OPLS-AA aromatic hydrogen type',
  'OPLS全原子 芳杂环硫类型': 'OPLS-AA heteroaryl sulfur type',
  'OPLS全原子 砜/磺酸硫类型（PSS 代理）': 'OPLS-AA sulfone/sulfonate S type (PSS proxy)',
  'OPLS全原子 砜/磺酸氧类型（PSS 代理）': 'OPLS-AA sulfone/sulfonate O type (PSS proxy)',
  'OPLS全原子 烯烃骨架碳类型': 'OPLS-AA alkene backbone carbon type',
  'Martini 3 粗粒化常规珠': 'Martini 3 coarse-grained regular bead',
}
