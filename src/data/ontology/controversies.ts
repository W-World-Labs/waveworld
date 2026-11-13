import type { Controversy } from './types'

// 附录 A 的元层面争议（不归属单一节点）。
export const CONTROVERSIES: Controversy[] = [
  {
    id: 'forms-fundamental',
    title: '「能量形式」分类是否基础',
    titleEn: 'Are “energy forms” a fundamental classification?',
    layer: 'meta',
    relatedNodeIds: [],
    consensus: {
      status: 'contested',
      summary: '《美国物理杂志》2019 能量专刊并列五种相互竞争的能量教学模型，学界存在友好分歧。',
      summaryEn:
        'AJP 2019 energy issue juxtaposes five competing teaching models of energy—friendly scholarly disagreement.',
      viewpoints: [
        {
          stance:
            '总能量是单一守恒量（动能+势能+内能），「化学能/热能/弹性能」是宏观记账；摩擦本质是保守的电磁力。',
          stanceEn:
            'Total energy is one conserved quantity (KE+PE+internal); “chemical/thermal/elastic” are macro bookkeeping; friction is ultimately conservative EM force.',
          proponents: ['Chabay/Sherwood/Titus', 'Suarez et al'],
          source: 'AJP 87(7):504 (2019); arXiv:2007.09480',
        },
        {
          stance: '应以「能量载体」替代「能量形式」。',
          stanceEn: 'Prefer “energy carriers” over “energy forms”.',
          proponents: ['Falk/Herrmann/Schmid (Karlsruhe)'],
          source: 'Am J Phys 51(12):1074 (1983)',
        },
        {
          stance:
            '把能量建模为"类物质量"在教学上有效——但仅作隐喻；字面"能量是实体物质"已被否决。',
          stanceEn:
            'Modeling energy as “substance-like” can help teaching—as metaphor only; literal “energy is stuff” is rejected.',
          proponents: ['Brewe (2011)', 'Sabo et al (2016)'],
          source: 'Phys Rev ST PER 7,020106; PRPER 12,010126',
        },
      ],
    },
  },
  {
    id: 'mass-energy-distinct',
    title: '质能 E=mc² / 光能-辐射能-电磁能 是否单列',
    titleEn: 'Should mass–energy / light–radiant–EM be listed separately?',
    layer: 'conventional',
    relatedNodeIds: ['mass', 'electromagnetic', 'radiant'],
    consensus: {
      status: 'convention',
      confidence: 'medium',
      summary: '高度重叠，单列与否属约定；分层模型用"子形态归属+跨类边"回避硬分类。',
      summaryEn:
        'Highly overlapping; separate listing is conventional. Layered model uses subforms + cross edges instead of hard partitions.',
    },
  },
  {
    id: 'information-energy',
    title: '信息 ↔ 能量 ↔ 熵',
    titleEn: 'Information ↔ energy ↔ entropy',
    layer: 'frontier',
    relatedNodeIds: ['thermal'],
    consensus: {
      status: 'contested',
      confidence: 'medium',
      summary:
        '兰道尔原理（擦除 1 比特至少耗 kT·ln2）、麦克斯韦妖、西拉德引擎；"信息是否物理"。',
      summaryEn:
        'Landauer’s principle (≥kT ln2 per bit erased), Maxwell’s demon, Szilard engine; “is information physical?”',
      viewpoints: [
        {
          stance: '信息擦除有最小热力学代价 kT·ln2，信息是物理的。',
          stanceEn: 'Erasing information costs ≥kT ln2; information is physical.',
          proponents: ['Landauer', 'Bennett'],
          source: 'arXiv:physics/0210005; PNAS 10.1073/pnas.1406966111',
        },
      ],
    },
  },
  {
    id: 'negative-energy',
    title: '负能量 / 奇异物质',
    titleEn: 'Negative energy / exotic matter',
    layer: 'frontier',
    relatedNodeIds: ['mass'],
    consensus: {
      status: 'open',
      confidence: 'medium',
      summary: '卡西米尔、虫洞所需负能量；量子场论允许局部负能量密度但受量子不等式约束。',
      summaryEn:
        'Casimir and wormhole-needed negative energy; QFT allows local negative density under quantum inequalities.',
      viewpoints: [
        {
          stance: '量子不等式限制负能量的时空分布。',
          stanceEn: 'Quantum inequalities constrain the spacetime distribution of negative energy.',
          source: 'Phys Rev D 60,104018',
        },
      ],
    },
  },
]
