// 常用天线图鉴：波长/物理尺寸随频率反比变化（λ=c/f）。
// 频率越低→波长越长→天线越大：FM ¼波 0.75m，AM ¼波达 75m（故 AM 改用磁棒环/长线）。
// nameEn/bandEn/typeEn/useEn 为 i18n 叠层，不覆盖中文源。
const C = 3e8 // m/s

export const wavelength = (fHz: number) => C / fHz          // m
export const quarterWave = (fHz: number) => wavelength(fHz) / 4
export const halfWave = (fHz: number) => wavelength(fHz) / 2

export interface AntennaType {
  id: string
  name: string
  nameEn?: string
  band: string
  bandEn?: string
  fMHz: number          // 代表频率
  type: string          // 形态
  typeEn?: string
  gainDbi: number
  use: string
  useEn?: string
}

// 由低频到高频排列（尺寸由大到小）
export const ANTENNAS: AntennaType[] = [
  {
    id: 'vlf',
    name: '超长波天线',
    nameEn: 'VLF antenna',
    band: '甚低频 3–30 kHz',
    bandEn: 'VLF 3–30 kHz',
    fMHz: 0.02,
    type: '长线/巨型塔阵（数百 m–数 km）',
    typeEn: 'Long-wire / giant tower arrays (hundreds of m – km)',
    gainDbi: 1,
    use: '潜艇通信、授时（穿透海水/地表）',
    useEn: 'Submarine comms, timing (seawater/ground penetration)',
  },
  {
    id: 'lw',
    name: '长波天线',
    nameEn: 'Long-wave antenna',
    band: '低频 30–300 kHz',
    bandEn: 'LF 30–300 kHz',
    fMHz: 0.1,
    type: '长线/T 型/伞形',
    typeEn: 'Long-wire / T / umbrella',
    gainDbi: 1,
    use: 'BPC 授时、导航信标',
    useEn: 'BPC timing, navigation beacons',
  },
  {
    id: 'am',
    name: '中波收音天线',
    nameEn: 'AM broadcast antenna',
    band: '中波 530–1700 kHz',
    bandEn: 'MW 530–1700 kHz',
    fMHz: 1.0,
    type: '磁棒环天线 / 长线（¼波太长无法做）',
    typeEn: 'Ferrite loop / long-wire (λ/4 impractical)',
    gainDbi: -10,
    use: '中波广播接收（机内磁棒）',
    useEn: 'AM radio receive (internal ferrite rod)',
  },
  {
    id: 'sw',
    name: '短波天线',
    nameEn: 'Shortwave antenna',
    band: '高频 3–30 MHz',
    bandEn: 'HF 3–30 MHz',
    fMHz: 10,
    type: '偶极子/长线/八木',
    typeEn: 'Dipole / long-wire / Yagi',
    gainDbi: 5,
    use: '短波广播、业余无线电、远距离',
    useEn: 'SW broadcast, amateur radio, DX',
  },
  {
    id: 'fm',
    name: '调频广播天线',
    nameEn: 'FM broadcast antenna',
    band: '甚高频 88–108 MHz',
    bandEn: 'VHF 88–108 MHz',
    fMHz: 100,
    type: '拉杆鞭状（¼波约 0.75 m）/偶极子',
    typeEn: 'Whip (λ/4 ≈ 0.75 m) / dipole',
    gainDbi: 2,
    use: '调频广播接收',
    useEn: 'FM broadcast receive',
  },
  {
    id: 'vhf',
    name: '甚高频对讲/电视',
    nameEn: 'VHF radio / TV',
    band: '甚高频 100–300 MHz',
    bandEn: 'VHF 100–300 MHz',
    fMHz: 150,
    type: '鞭状/八木',
    typeEn: 'Whip / Yagi',
    gainDbi: 3,
    use: '对讲机、航空、老电视',
    useEn: 'Walkie-talkie, aviation, legacy TV',
  },
  {
    id: 'lora',
    name: '远距离物联网 433 MHz',
    nameEn: 'Long-range IoT 433 MHz',
    band: '特高频 433/470 MHz',
    bandEn: 'UHF 433/470 MHz',
    fMHz: 433,
    type: '弹簧鞭/螺旋',
    typeEn: 'Spring whip / helical',
    gainDbi: 2,
    use: '物联网远距离通信、遥控',
    useEn: 'Long-range IoT, remote control',
  },
  {
    id: 'zwave',
    name: '智能家居亚吉赫兹',
    nameEn: 'Smart-home sub-GHz',
    band: '特高频 868/908 MHz',
    bandEn: 'UHF 868/908 MHz',
    fMHz: 908,
    type: '弹簧鞭/印制板',
    typeEn: 'Spring whip / PCB',
    gainDbi: 2,
    use: '智能家居（美 908.4 / 欧 868）、近场物联网',
    useEn: 'Smart home (US 908.4 / EU 868), near-field IoT',
  },
  {
    id: 'gps',
    name: '卫星导航天线',
    nameEn: 'GNSS antenna',
    band: 'L 波段 1.575 GHz',
    bandEn: 'L-band 1.575 GHz',
    fMHz: 1575,
    type: '陶瓷贴片',
    typeEn: 'Ceramic patch',
    gainDbi: 3,
    use: '卫星定位接收',
    useEn: 'Satellite positioning receive',
  },
  {
    id: 'gsm',
    name: '蜂窝移动天线',
    nameEn: 'Cellular antenna',
    band: '特高频 0.7–2.6 GHz',
    bandEn: 'UHF 0.7–2.6 GHz',
    fMHz: 1800,
    type: '平面倒 F / 内置柔性板',
    typeEn: 'PIFA / flex internal',
    gainDbi: 2,
    use: '手机蜂窝通信',
    useEn: 'Mobile cellular',
  },
  {
    id: 'wifi24',
    name: '2.4 GHz 无线局域网/蓝牙',
    nameEn: '2.4 GHz WLAN / Bluetooth',
    band: '2.4 GHz 工业科学医疗频段',
    bandEn: '2.4 GHz ISM',
    fMHz: 2450,
    type: '印制板倒 F / 鞭状（¼波约 3 cm）',
    typeEn: 'PCB IFA / whip (λ/4 ≈ 3 cm)',
    gainDbi: 2,
    use: '无线局域网、蓝牙、近场物联网、无人机图传',
    useEn: 'WLAN, Bluetooth, near-field IoT, drone video',
  },
  {
    id: 'wifi58',
    name: '5.8 GHz 无线局域网/图传',
    nameEn: '5.8 GHz WLAN / video link',
    band: '5.8 GHz 工业科学医疗频段',
    bandEn: '5.8 GHz ISM',
    fMHz: 5800,
    type: '印制板/全向/蘑菇头',
    typeEn: 'PCB / omni / mushroom',
    gainDbi: 3,
    use: '无线局域网、第一人称图传',
    useEn: 'WLAN, FPV video',
  },
  {
    id: 'phased',
    name: '相控阵天线',
    nameEn: 'Phased-array antenna',
    band: '毫米波 24–40 GHz 等',
    bandEn: 'mmWave 24–40 GHz etc.',
    fMHz: 28000,
    type: '阵列（多振子电子扫描）',
    typeEn: 'Array (electronic multi-element scan)',
    gainDbi: 22,
    use: '毫米波波束成形、雷达（见「相控阵波束成形」）',
    useEn: 'mmWave beamforming, radar (see phased-array beamforming)',
  },
]

export const fmt = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(m * 100 >= 10 ? 1 : 2)} cm`
