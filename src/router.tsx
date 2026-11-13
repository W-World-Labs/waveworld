import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy } from 'react'
import { Layout } from './components/Layout'

// 导航数据单一事实源在 nav.ts（无 React），供 UI / e2e 共用。
export { DOMAINS, ALL_LEAVES, WEBGPU_PATHS, findDomain } from './nav'
export type { Leaf, LeafEntry } from './nav'

// 懒加载：每个页面（含其数据/仿真核心）按需分块加载，缩小首屏。
const named = <K extends string>(p: Promise<Record<K, React.ComponentType>>, k: K) =>
  p.then((m) => ({ default: m[k] }))

// 枢纽 · 着陆
const Home = lazy(() => named(import('./pages/Home'), 'Home'))
const DomainHub = lazy(() => named(import('./pages/DomainHub'), 'DomainHub'))
const Matrix = lazy(() => named(import('./pages/Matrix'), 'Matrix'))
const Paths = lazy(() => named(import('./pages/Paths'), 'Paths'))
const PathExperiments = lazy(() => named(import('./pages/PathExperiments'), 'PathExperiments'))
const Graph = lazy(() => named(import('./pages/Graph'), 'Graph'))
const Phenomena = lazy(() => named(import('./pages/Phenomena'), 'Phenomena'))
const PhenomenonDetail = lazy(() => named(import('./pages/PhenomenonDetail'), 'PhenomenonDetail'))
const Controversies = lazy(() => named(import('./pages/Controversies'), 'Controversies'))
const MethodDepth = lazy(() => named(import('./pages/MethodDepth'), 'MethodDepth'))
const Methods = lazy(() => named(import('./pages/Methods'), 'Methods'))
const WorldMap = lazy(() => named(import('./pages/WorldMap'), 'WorldMap'))
const Taxonomy = lazy(() => named(import('./pages/Taxonomy'), 'Taxonomy'))
const Electromagnetic = lazy(() => named(import('./pages/Electromagnetic'), 'Electromagnetic'))
const Sound = lazy(() => named(import('./pages/Sound'), 'Sound'))
const Vibration = lazy(() => named(import('./pages/Vibration'), 'Vibration'))
// 天线 · 电波
const EMWave3D = lazy(() => named(import('./pages/EMWave3D'), 'EMWave3D'))
const Antenna3D = lazy(() => named(import('./pages/Antenna3D'), 'Antenna3D'))
const AntennaPattern = lazy(() => named(import('./pages/AntennaPattern'), 'AntennaPattern'))
const AntennaCatalog = lazy(() => named(import('./pages/AntennaCatalog'), 'AntennaCatalog'))
// 仿真 · 场/流体
const Convection = lazy(() => named(import('./pages/Convection'), 'Convection'))
const WindTunnel = lazy(() => named(import('./pages/WindTunnel'), 'WindTunnel'))
const BatchJobs = lazy(() => named(import('./pages/BatchJobs'), 'BatchJobs'))
const MyProjects = lazy(() => named(import('./pages/MyProjects'), 'MyProjects'))
const Comsol = lazy(() => named(import('./pages/Comsol'), 'Comsol'))
const Ansys = lazy(() => named(import('./pages/Ansys'), 'Ansys'))
const Abaqus = lazy(() => named(import('./pages/Abaqus'), 'Abaqus'))
const OpticStudio = lazy(() => named(import('./pages/OpticStudio'), 'OpticStudio'))
const Dymola = lazy(() => named(import('./pages/Dymola'), 'Dymola'))
const StarCcm = lazy(() => named(import('./pages/StarCcm'), 'StarCcm'))
const Cst = lazy(() => named(import('./pages/Cst'), 'Cst'))
const Ripple = lazy(() => named(import('./pages/Ripple'), 'Ripple'))
const Fluid = lazy(() => named(import('./pages/Fluid'), 'Fluid'))
const Sim = lazy(() => named(import('./pages/Sim'), 'Sim'))
// 物质 · 微观
const MD = lazy(() => named(import('./pages/MD'), 'MD'))
const Particles = lazy(() => named(import('./pages/Particles'), 'Particles'))
const Ising = lazy(() => named(import('./pages/Ising'), 'Ising'))
const Heaterfc = lazy(() => named(import('./pages/Heaterfc'), 'Heaterfc'))
// 电路 · 电磁
const Fdtd = lazy(() => named(import('./pages/Fdtd'), 'Fdtd'))
const Rlc = lazy(() => named(import('./pages/Rlc'), 'Rlc'))
const Mutual = lazy(() => named(import('./pages/Mutual'), 'Mutual'))
const Transient = lazy(() => named(import('./pages/Transient'), 'Transient'))
const Faraday = lazy(() => named(import('./pages/Faraday'), 'Faraday'))
const SmithChart = lazy(() => named(import('./pages/SmithChart'), 'SmithChart'))
// 探测 · 定位
const SignalArray = lazy(() => named(import('./pages/SignalArray'), 'SignalArray'))
const RadarScope = lazy(() => named(import('./pages/RadarScope'), 'RadarScope'))
const Localization = lazy(() => named(import('./pages/Localization'), 'Localization'))
const TDOA = lazy(() => named(import('./pages/TDOA'), 'TDOA'))
const NLJD = lazy(() => named(import('./pages/NLJD'), 'NLJD'))
const PhasedArray = lazy(() => named(import('./pages/PhasedArray'), 'PhasedArray'))
// 成像 · 显微
const Ultrasound = lazy(() => named(import('./pages/Ultrasound'), 'Ultrasound'))
const STM = lazy(() => named(import('./pages/STM'), 'STM'))
const AFM = lazy(() => named(import('./pages/AFM'), 'AFM'))
// 器件 · 发光
const Laser = lazy(() => named(import('./pages/Laser'), 'Laser'))
const Display = lazy(() => named(import('./pages/Display'), 'Display'))
const OpticsLab = lazy(() => named(import('./pages/OpticsLab'), 'OpticsLab'))
// 生物电
const ECG = lazy(() => named(import('./pages/ECG'), 'ECG'))
const EMG = lazy(() => named(import('./pages/EMG'), 'EMG'))
const EEG = lazy(() => named(import('./pages/EEG'), 'EEG'))
const Neuron = lazy(() => named(import('./pages/Neuron'), 'Neuron'))
const BioPipeline = lazy(() => named(import('./pages/BioPipeline'), 'BioPipeline'))
// 工具
const Transducers = lazy(() => named(import('./pages/Transducers'), 'Transducers'))
const Sensing = lazy(() => named(import('./pages/Sensing'), 'Sensing'))
const NodeBudget = lazy(() => named(import('./pages/NodeBudget'), 'NodeBudget'))
const Converter = lazy(() => named(import('./pages/Converter'), 'Converter'))
const AiChain = lazy(() => named(import('./pages/AiChain'), 'AiChain'))
const Article = lazy(() => named(import('./pages/Article'), 'Article'))
const Applications = lazy(() => named(import('./pages/Applications'), 'Applications'))
const ApplicationDetail = lazy(() => named(import('./pages/ApplicationDetail'), 'ApplicationDetail'))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'd/:key', element: <DomainHub /> },
      { path: 'matrix', element: <Matrix /> },
      { path: 'paths', element: <Paths /> },
      { path: 'path-experiments', element: <PathExperiments /> },
      { path: 'graph', element: <Graph /> },
      { path: 'phenomena', element: <Phenomena /> },
      { path: 'phenomena/:id', element: <PhenomenonDetail /> },
      { path: 'controversies', element: <Controversies /> },
      { path: 'method-depth', element: <MethodDepth /> },
      { path: 'methods', element: <Methods /> },
      { path: 'world', element: <WorldMap /> },
      { path: 'taxonomy', element: <Taxonomy /> },
      { path: 'electromagnetic', element: <Electromagnetic /> },
      { path: 'sound', element: <Sound /> },
      { path: 'vibration', element: <Vibration /> },
      { path: 'emwave3d', element: <EMWave3D /> },
      { path: 'antenna3d', element: <Antenna3D /> },
      { path: 'antennapattern', element: <AntennaPattern /> },
      { path: 'antennas', element: <AntennaCatalog /> },
      { path: 'convection', element: <Convection /> },
      { path: 'windtunnel', element: <WindTunnel /> },
      { path: 'lab-cfd', element: <Navigate to="/windtunnel" replace /> },
      { path: 'batch-jobs', element: <BatchJobs /> },
      { path: 'my-projects', element: <MyProjects /> },
      { path: 'comsol', element: <Comsol /> },
      { path: 'ansys', element: <Ansys /> },
      { path: 'abaqus', element: <Abaqus /> },
      { path: 'opticstudio', element: <OpticStudio /> },
      { path: 'dymola', element: <Dymola /> },
      { path: 'star-ccm', element: <StarCcm /> },
      { path: 'cst', element: <Cst /> },
      { path: 'ripple', element: <Ripple /> },
      { path: 'fluid', element: <Fluid /> },
      { path: 'sim', element: <Sim /> },
      { path: 'md', element: <MD /> },
      { path: 'particles', element: <Particles /> },
      { path: 'pedotpss', element: <Navigate to="/particles" replace /> },
      { path: 'ising', element: <Ising /> },
      { path: 'heaterfc', element: <Heaterfc /> },
      { path: 'fdtd', element: <Fdtd /> },
      { path: 'rlc', element: <Rlc /> },
      { path: 'mutual', element: <Mutual /> },
      { path: 'transient', element: <Transient /> },
      { path: 'faraday', element: <Faraday /> },
      { path: 'smith', element: <SmithChart /> },
      { path: 'radar', element: <RadarScope /> },
      { path: 'signal-array', element: <SignalArray /> },
      { path: 'localization', element: <Localization /> },
      { path: 'tdoa', element: <TDOA /> },
      { path: 'nljd', element: <NLJD /> },
      { path: 'phasedarray', element: <PhasedArray /> },
      { path: 'ultrasound', element: <Ultrasound /> },
      { path: 'stm', element: <STM /> },
      { path: 'afm', element: <AFM /> },
      { path: 'laser', element: <Laser /> },
      { path: 'display', element: <Display /> },
      { path: 'optics-lab', element: <OpticsLab /> },
      { path: 'ecg', element: <ECG /> },
      { path: 'emg', element: <EMG /> },
      { path: 'eeg', element: <EEG /> },
      { path: 'neuron', element: <Neuron /> },
      { path: 'biopipeline', element: <BioPipeline /> },
      { path: 'transducers', element: <Transducers /> },
      { path: 'sensing', element: <Sensing /> },
      { path: 'node-budget', element: <NodeBudget /> },
      { path: 'converter', element: <Converter /> },
      { path: 'ai-chain', element: <AiChain /> },
      { path: 'article', element: <Article /> },
      { path: 'apps', element: <Applications /> },
      { path: 'apps/:id', element: <ApplicationDetail /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
