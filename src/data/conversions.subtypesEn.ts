/**
 * English energy subtype labels for conversions.json energy_types.*.subtypes.
 * Chinese name/description/examples remain source of truth.
 * Keys: `${energyTypeKey}/${subtypeKey}`.
 */
export type EnergySubtypeEn = {
  nameEn: string
  descriptionEn: string
  examplesEn: readonly string[]
}

export const ENERGY_SUBTYPE_EN: Readonly<Record<string, EnergySubtypeEn>> = {
  'acoustic/music': {
    nameEn: 'Music',
    descriptionEn: 'Organized sound',
    examplesEn: ['Music-powered generation', 'Acoustic conversion', 'Audio analysis'],
  },
  'acoustic/noise_control': {
    nameEn: 'Noise control',
    descriptionEn: 'Utilizing noise energy',
    examplesEn: ['Noise power generation', 'Acoustic absorption', 'Vibration/noise reduction'],
  },
  'acoustic/sound': {
    nameEn: 'Sound energy',
    descriptionEn: 'Audible acoustic energy',
    examplesEn: ['Acoustic generation', 'Noise energy harvesting', 'Acoustic sensing'],
  },
  'acoustic/ultrasound': {
    nameEn: 'Ultrasound',
    descriptionEn: 'High-frequency sound',
    examplesEn: ['Ultrasonic generation', 'Medical ultrasound', 'Ultrasonic cleaning'],
  },
  'chemical/battery': {
    nameEn: 'Battery',
    descriptionEn: 'Electrochemical energy storage',
    examplesEn: ['Li-ion batteries', 'Fuel cells', 'Flow batteries'],
  },
  'chemical/chemical_reaction': {
    nameEn: 'Chemical reaction',
    descriptionEn: 'Energy released by chemical reactions',
    examplesEn: ['Oxidation reactions', 'Exothermic reactions', 'Chemical synthesis'],
  },
  'chemical/fuel': {
    nameEn: 'Fuel',
    descriptionEn: 'Combustible substances',
    examplesEn: ['Fossil fuels', 'Biomass fuels', 'Rocket propellants'],
  },
  'chemical/hydrogen': {
    nameEn: 'Hydrogen',
    descriptionEn: 'Hydrogen fuel energy',
    examplesEn: ['H₂ fuel cells', 'H₂ ICEs', 'Hydrogen storage materials'],
  },
  'electrical/ac': {
    nameEn: 'Alternating current',
    descriptionEn: 'Current that reverses periodically',
    examplesEn: ['Grid power', 'Household appliances', 'Industrial motors'],
  },
  'electrical/dc': {
    nameEn: 'Direct current',
    descriptionEn: 'Current of constant direction',
    examplesEn: ['Battery power', 'Solar DC', 'Electronic circuits'],
  },
  'electrical/electricity': {
    nameEn: 'Electricity',
    descriptionEn: 'General electrical energy',
    examplesEn: ['Grid power', 'Electronics', 'Motor drives'],
  },
  'electrical/high_voltage': {
    nameEn: 'High voltage',
    descriptionEn: 'Transmission & distribution voltages',
    examplesEn: ['Power transmission', 'Industrial power', 'Traction power'],
  },
  'electrical/low_voltage': {
    nameEn: 'Low voltage',
    descriptionEn: 'Safety / low voltage',
    examplesEn: ['Electronics', 'LED lighting', 'Sensor power'],
  },
  'electromagnetic/infrared': {
    nameEn: 'Infrared',
    descriptionEn: 'Thermal radiation',
    examplesEn: ['Thermal imaging', 'Remote controls', 'IR heating'],
  },
  'electromagnetic/microwave': {
    nameEn: 'Microwaves',
    descriptionEn: 'Microwave radiation',
    examplesEn: ['Microwave links', 'Heating', 'Remote sensing'],
  },
  'electromagnetic/radio': {
    nameEn: 'Radio waves',
    descriptionEn: 'RF energy',
    examplesEn: ['Wireless communications', 'Broadcast', 'Radar'],
  },
  'electromagnetic/solar': {
    nameEn: 'Solar energy',
    descriptionEn: 'Solar radiation energy',
    examplesEn: ['Photovoltaics', 'Solar thermal power', 'Photosynthesis'],
  },
  'electromagnetic/ultraviolet': {
    nameEn: 'Ultraviolet',
    descriptionEn: 'UV radiation',
    examplesEn: ['Disinfection', 'UV curing', 'Medical therapy'],
  },
  'electromagnetic/visible': {
    nameEn: 'Visible light',
    descriptionEn: 'Light visible to the human eye',
    examplesEn: ['Lighting', 'Displays', 'Optical communications'],
  },
  'mechanical/flow': {
    nameEn: 'Fluid flow',
    descriptionEn: 'Kinetic energy of fluid motion',
    examplesEn: ['Hydrokinetic power', 'Wind energy', 'Pipeline energy harvesting'],
  },
  'mechanical/impact': {
    nameEn: 'Impact energy',
    descriptionEn: 'Impulse / impact energy',
    examplesEn: ['Piezo impact generation', 'Shock-absorber harvesting', 'Footstep generation'],
  },
  'mechanical/pressure': {
    nameEn: 'Pressure energy',
    descriptionEn: 'Pressure in fluids or solids',
    examplesEn: ['Hydraulic generation', 'Pressure sensors', 'Compressed-air storage'],
  },
  'mechanical/rotation': {
    nameEn: 'Rotational energy',
    descriptionEn: 'Energy of rotational motion',
    examplesEn: ['Wind power', 'Hydropower', 'Flywheel storage'],
  },
  'mechanical/vibration': {
    nameEn: 'Vibrational energy',
    descriptionEn: 'Periodic mechanical motion',
    examplesEn: ['Piezoelectric generation', 'Vibration energy harvesting', 'Acoustic energy'],
  },
  'thermal/geothermal': {
    nameEn: 'Geothermal',
    descriptionEn: 'Earth\'s internal heat',
    examplesEn: ['Geothermal power', 'Geothermal heating', 'Hot-spring use'],
  },
  'thermal/heat': {
    nameEn: 'Heat energy',
    descriptionEn: 'Thermal motion of matter',
    examplesEn: ['Thermoelectric generation', 'Heat engines', 'Heating systems'],
  },
  'thermal/temperature_difference': {
    nameEn: 'Temperature difference',
    descriptionEn: 'Energy from a temperature gradient',
    examplesEn: ['Thermoelectric generation', 'Heat pumps', 'Thermoelectric generators'],
  },
  'thermal/waste_heat': {
    nameEn: 'Waste heat',
    descriptionEn: 'Industrial residual heat',
    examplesEn: ['Waste-heat recovery', 'Thermoelectric generation', 'Waste-heat utilization'],
  },
}

