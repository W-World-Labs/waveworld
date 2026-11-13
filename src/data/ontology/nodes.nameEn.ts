/**
 * English display names for energy nodes (id → nameEn).
 * Chinese `name` stays the source field on each node; this map is merged at load.
 * Never rewrite machine ids.
 */
export const NODE_NAME_EN: Readonly<Record<string, string>> = {
  // top-level
  electromagnetic: 'Electromagnetic energy',
  electric: 'Electrical energy',
  mechanical: 'Mechanical energy',
  thermal: 'Thermal energy',
  chemical: 'Chemical energy',
  nuclear: 'Nuclear energy',
  acoustic: 'Acoustic / mechanical-wave energy',
  radiant: 'Radiant energy',
  gravitational: 'Gravitational energy',
  mass: 'Mass–energy',

  // EM bands
  'em-radio': 'Radio waves',
  'em-micro': 'Microwaves',
  'em-ir': 'Infrared',
  'em-visible': 'Visible light',
  'em-uv': 'Ultraviolet',
  'em-xray': 'X-rays',
  'em-gamma': 'Gamma rays',

  // electric subforms
  'el-static': 'Electrostatic energy',
  'el-current': 'Current electrical energy',
  'el-field': 'Electric-field energy',

  // chemical frontier
  'chemical-excited-triplet': 'Triplet excited state',
  'chemical-ros': 'Reactive oxygen species',

  // mechanical subforms (JSON)
  'mechanical-kinetic': 'Translational kinetic energy',
  'mechanical-rotational': 'Rotational kinetic energy',
  'mechanical-gravitational-pe': 'Gravitational potential energy',
  'mechanical-elastic-pe': 'Elastic potential energy',
  'mechanical-vibrational': 'Vibrational energy',

  // thermal
  'thermal-sensible': 'Sensible heat',
  'thermal-latent': 'Latent heat',
  'thermal-internal': 'Internal energy',
  'thermal-radiant-heat': 'Thermal radiation',

  // chemical
  'chemical-bond': 'Bond energy',
  'chemical-combustion': 'Combustion enthalpy (fuel chemical energy)',
  'chemical-electrochemical': 'Electrochemical (redox) energy',
  'chemical-biochemical': 'Biochemical energy (ATP / metabolism)',

  // nuclear
  'nuclear-binding': 'Nuclear binding energy',
  'nuclear-fission': 'Nuclear fission energy',
  'nuclear-fusion': 'Nuclear fusion energy',
  'nuclear-decay': 'Radioactive decay energy',

  // acoustic
  'acoustic-infrasound': 'Infrasound',
  'acoustic-audible': 'Audible sound',
  'acoustic-ultrasound': 'Ultrasound',

  // radiant
  'radiant-solar': 'Solar radiation',
  'radiant-blackbody': 'Blackbody / thermal radiation',
  'radiant-laser': 'Coherent laser radiation',
  'radiant-luminescence': 'Luminescence / fluorescence',

  // gravitational
  'gravitational-potential': 'Gravitational potential energy',
  'gravitational-hydro': 'Hydropower (head potential)',
  'gravitational-tidal': 'Tidal energy',
  'gravitational-wave': 'Gravitational-wave energy',

  // mass
  'mass-rest': 'Rest mass–energy',
  'mass-binding-defect': 'Mass defect / binding energy',
  'mass-annihilation': 'Annihilation energy',
  'mass-fission': 'Fission mass–energy',
  'mass-fusion': 'Fusion mass–energy',
}
