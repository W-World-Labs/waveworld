export interface Band {
  name: string
  nameEn?: string
  range: string
  freq: string
  color: string
  desc: string
  descEn?: string
  apps: string[]
  appsEn?: string[]
}

export interface Spectrum {
  id: string
  title: string
  titleEn?: string
  subtitle: string
  subtitleEn?: string
  icon: string
  bands: Band[]
}

export const ELECTROMAGNETIC: Spectrum = {
  id: 'electromagnetic',
  title: '电磁波谱',
  titleEn: 'Electromagnetic spectrum',
  subtitle: '从无线电到伽马射线，同一种电磁振动横跨 19 个数量级的频率。',
  subtitleEn:
    'From radio to gamma rays—the same electromagnetic oscillation spans ~19 orders of magnitude in frequency.',
  icon: '📡',
  bands: [
    {
      name: '无线电波',
      nameEn: 'Radio waves',
      range: '> 1 m',
      freq: '< 300 MHz',
      color: '#ff6b6b',
      desc: '波长最长、能量最低，可绕过障碍远距离传播。',
      descEn: 'Longest wavelength, lowest energy; can diffract around obstacles for long-range links.',
      apps: ['广播', '调幅/调频', '航海航空通信'],
      appsEn: ['Broadcast', 'AM/FM', 'Maritime & aviation comms'],
    },
    {
      name: '微波',
      nameEn: 'Microwaves',
      range: '1 mm – 1 m',
      freq: '300 MHz – 300 GHz',
      color: '#ffa94d',
      desc: '能被水分子吸收产生热效应，方向性强。',
      descEn: 'Absorbed by water molecules (heating); strong directionality.',
      apps: ['无线局域网 / 移动通信', '雷达', '微波炉', '卫星通信'],
      appsEn: ['Wi‑Fi / mobile', 'Radar', 'Microwave ovens', 'Satellite'],
    },
    {
      name: '红外线',
      nameEn: 'Infrared',
      range: '700 nm – 1 mm',
      freq: '300 GHz – 430 THz',
      color: '#ffd43b',
      desc: '热辐射的主要波段，一切有温度的物体都在发射。',
      descEn: 'Main band of thermal radiation; every warm body emits here.',
      apps: ['热成像', '遥控器', '夜视', '光纤通信'],
      appsEn: ['Thermal imaging', 'Remote controls', 'Night vision', 'Fiber comms'],
    },
    {
      name: '可见光',
      nameEn: 'Visible light',
      range: '400 – 700 nm',
      freq: '430 – 750 THz',
      color: '#69db7c',
      desc: '人眼可感知的极窄窗口，生命演化的能量入口。',
      descEn: 'The narrow window humans see—and life’s evolutionary energy gateway.',
      apps: ['视觉', '光合作用', '照明', '显示'],
      appsEn: ['Vision', 'Photosynthesis', 'Lighting', 'Displays'],
    },
    {
      name: '紫外线',
      nameEn: 'Ultraviolet',
      range: '10 – 400 nm',
      freq: '750 THz – 30 PHz',
      color: '#4dabf7',
      desc: '能量足以破坏化学键，杀菌也致癌。',
      descEn: 'Energetic enough to break chemical bonds—sterilizing and carcinogenic.',
      apps: ['消毒', '荧光', '光刻', '维生素 D 合成'],
      appsEn: ['Disinfection', 'Fluorescence', 'Photolithography', 'Vitamin D'],
    },
    {
      name: 'X射线',
      nameEn: 'X-rays',
      range: '0.01 – 10 nm',
      freq: '30 PHz – 30 EHz',
      color: '#748ffc',
      desc: '强穿透力，可穿过软组织。',
      descEn: 'Strong penetration; can pass soft tissue.',
      apps: ['医学影像', '安检', '晶体衍射'],
      appsEn: ['Medical imaging', 'Security screening', 'Crystal diffraction'],
    },
    {
      name: '伽马射线',
      nameEn: 'Gamma rays',
      range: '< 0.01 nm',
      freq: '> 30 EHz',
      color: '#da77f2',
      desc: '能量最高，来自核反应与宇宙极端事件。',
      descEn: 'Highest energy; from nuclear reactions and extreme cosmic events.',
      apps: ['放疗', '核医学', '天体物理'],
      appsEn: ['Radiotherapy', 'Nuclear medicine', 'Astrophysics'],
    },
  ],
}

export const SOUND: Spectrum = {
  id: 'sound',
  title: '声波频谱',
  titleEn: 'Sound spectrum',
  subtitle: '从次声波到超声波，机械波在介质中以压缩与稀疏传递能量。',
  subtitleEn:
    'From infrasound to ultrasound—mechanical waves carry energy as compression and rarefaction in a medium.',
  icon: '🔊',
  bands: [
    {
      name: '次声波',
      nameEn: 'Infrasound',
      range: '> 17 m',
      freq: '< 20 Hz',
      color: '#5c7cfa',
      desc: '人耳听不到，可传播极远，火山地震大象都在用。',
      descEn: 'Inaudible to humans; travels far—volcanoes, quakes, and elephants use it.',
      apps: ['地震监测', '动物通信', '核试验探测'],
      appsEn: ['Seismic monitoring', 'Animal communication', 'Nuclear-test detection'],
    },
    {
      name: '低频声波',
      nameEn: 'Low-frequency sound',
      range: '1.7 – 17 m',
      freq: '20 – 200 Hz',
      color: '#3bc9db',
      desc: '低音与节奏，能强烈引起身体共振。',
      descEn: 'Bass and rhythm; strongly couples to body resonance.',
      apps: ['低音乐器', '声学振动', '建筑共振'],
      appsEn: ['Bass instruments', 'Acoustic vibration', 'Building resonance'],
    },
    {
      name: '中频声波',
      nameEn: 'Mid-frequency sound',
      range: '17 cm – 1.7 m',
      freq: '200 Hz – 2 kHz',
      color: '#69db7c',
      desc: '人声与多数乐器的主能量区，语言可懂度核心。',
      descEn: 'Main energy band for speech and most instruments—core of intelligibility.',
      apps: ['语音', '音乐', '电话'],
      appsEn: ['Speech', 'Music', 'Telephony'],
    },
    {
      name: '高频声波',
      nameEn: 'High-frequency sound',
      range: '1.7 – 17 cm',
      freq: '2 – 20 kHz',
      color: '#ffd43b',
      desc: '亮度与细节所在，随年龄上限下降。',
      descEn: 'Brightness and detail; upper hearing limit falls with age.',
      apps: ['高音', '音质细节', '听力测试'],
      appsEn: ['Treble', 'Audio detail', 'Hearing tests'],
    },
    {
      name: '超声波',
      nameEn: 'Ultrasound',
      range: '< 1.7 cm',
      freq: '> 20 kHz',
      color: '#ff8787',
      desc: '超出人耳上限，蝙蝠海豚的回声定位之声。',
      descEn: 'Above human hearing—echolocation for bats and dolphins.',
      apps: ['超声影像', '清洗', '测距', '无损检测'],
      appsEn: ['Medical ultrasound', 'Cleaning', 'Ranging', 'NDT'],
    },
  ],
}

export const VIBRATION: Spectrum = {
  id: 'vibration',
  title: '振动频谱',
  titleEn: 'Vibration spectrum',
  subtitle: '从量子涨落到天体振荡，振动是物质运动最普遍的语言。',
  subtitleEn:
    'From quantum fluctuations to stellar oscillations—vibration is matter’s most universal motion language.',
  icon: '〰️',
  bands: [
    {
      name: '量子振动',
      nameEn: 'Quantum vibration',
      range: '原子尺度',
      freq: '10¹²–10¹⁵ Hz',
      color: '#da77f2',
      desc: '原子与电子的零点能与晶格声子，绝对零度也不停歇。',
      descEn: 'Zero-point motion and lattice phonons—active even at absolute zero.',
      apps: ['声子', '热容', '量子计算'],
      appsEn: ['Phonons', 'Heat capacity', 'Quantum computing'],
    },
    {
      name: '分子振动',
      nameEn: 'Molecular vibration',
      range: '化学键尺度',
      freq: '10¹³–10¹⁴ Hz',
      color: '#748ffc',
      desc: '化学键的伸缩与弯曲，红外光谱的指纹。',
      descEn: 'Bond stretch and bend—the fingerprints of infrared spectroscopy.',
      apps: ['红外光谱', '分子识别', '温室效应'],
      appsEn: ['IR spectroscopy', 'Molecular ID', 'Greenhouse effect'],
    },
    {
      name: '声振动',
      nameEn: 'Acoustic vibration',
      range: '宏观介质',
      freq: '20 Hz–20 kHz',
      color: '#69db7c',
      desc: '可听声范围内的机械振动，能量在介质中传递。',
      descEn: 'Mechanical vibration in the audible band; energy travels in the medium.',
      apps: ['乐器', '扬声器', '声学'],
      appsEn: ['Instruments', 'Loudspeakers', 'Acoustics'],
    },
    {
      name: '机械振动',
      nameEn: 'Structural vibration',
      range: '结构尺度',
      freq: '0.1 Hz–1 kHz',
      color: '#ffd43b',
      desc: '机器、桥梁、地壳的振动，共振是工程的双刃剑。',
      descEn: 'Machines, bridges, crust—resonance is engineering’s double-edged sword.',
      apps: ['故障诊断', '抗震设计', '能量收集'],
      appsEn: ['Condition monitoring', 'Seismic design', 'Energy harvesting'],
    },
    {
      name: '天体振荡',
      nameEn: 'Astrophysical oscillation',
      range: '宇宙尺度',
      freq: '< 10⁻³ Hz',
      color: '#ff8787',
      desc: '恒星脉动、引力波，时空本身的振动。',
      descEn: 'Stellar pulsations and gravitational waves—spacetime itself vibrating.',
      apps: ['星震学', '引力波探测', '宇宙学'],
      appsEn: ['Asteroseismology', 'GW detection', 'Cosmology'],
    },
  ],
}

export const SPECTRA: Record<string, Spectrum> = {
  electromagnetic: ELECTROMAGNETIC,
  sound: SOUND,
  vibration: VIBRATION,
}
