/**
 * English blurbs for top-level application profiles (i18n).
 * Chinese `blurb` in applications.data.ts remains source for zh locale;
 * this map only adds en without overwriting.
 */
export const APPLICATION_BLURBS_EN: Record<string, string> = {
  'app-solar-cell':
    'Solar radiation → electricity: drill from plant systems down to p–n carrier physics and material levels. Every layer hangs real conversion edges and try-run methods.',
  'app-tpv':
    'Thermal / IR radiation → electricity: the same photovoltaic-junction stack, but the source is blackbody/burner/waste-heat radiation instead of the sun.',
  'app-thermoelectric-seebeck':
    'Temperature difference → electricity: not a PV junction, but the Seebeck effect in thermoelectric materials. Peltier cooling is the same coupling run in reverse.',
  'app-peltier-cooler':
    'Electricity → heat pump: the same thermoelectric coupling as Seebeck, reversed—current absorbs heat at the cold end and rejects it at the hot end.',
  'app-led-display':
    'Electricity → visible light: drill from drive circuits to band-gap recombination and polarizer filtering (with a parallel LCD path).',
  'app-ultrasound-imaging':
    'Electrical pulse → piezoelectric acoustic emission → tissue reflection → receive imaging. Sensing chains meet wave methods.',
  'app-nuclear-power':
    'Nuclear → thermal → mechanical → electrical: fission heat drives a Rankine turbine, then a generator to the grid. System ledger and exergy limits at a glance.',
  'app-li-ion-battery':
    'Chemical energy ↔ electricity: charge/discharge runs redox and ion transport at electrode–electrolyte interfaces. Drill from pack BMS to interfacial kinetics.',
  'app-mri':
    'Nuclear spin resonance in a static field: RF excitation → relaxation radiation → coil receive as electric signal → image reconstruction. EM spectrum meets signal processing.',
  'app-fiber-optic':
    'Electrical signal → laser/modulated light → fiber guided wave → photodetection back to electricity. Link budget and dispersion/nonlinearity are the core ledger.',
  'app-piezo-harvest':
    'Ambient vibration / impact mechanical energy → piezoelectric strain → AC → rectify and store. Typical microwatt–milliwatt path for self-powered sensing.',
  'app-steg':
    'Solar radiation → heat → electricity: an absorber makes a hot-side ΔT, then Seebeck couples generate power—not a p–n PV cell, but nested “solar thermal + TE”.',
  'app-rtg':
    'Nuclear / rest mass → decay heat → electricity: Pu-238 (etc.) decay heat through Seebeck couples. The standard static power source when deep space has no sunlight.',
  'app-fuel-cell':
    'Chemical energy → electricity: fuel is oxidized electrochemically at electrodes; electrons take the external circuit, ions the electrolyte—no combustion heat engine, not Carnot-bound the same way.',
  'app-wind-turbine':
    'Wind kinetic energy → rotor rotation → electricity: blades capture flow KE (Betz limit), then electromagnetic generation to the grid.',
  'app-hydro-plant':
    'Reservoir head (gravitational PE) → penstock KE → turbine rotation → generator electricity: classic multi-hop gravity→mechanical→electric, not a Rankine heat engine.',
  'app-mhd-generator':
    'Hot conductive fluid (thermal/combustion plasma) races through a magnetic field; Lorentz force separates charge → electrodes harvest current: thermal/chemical → electric with no rotating shaft.',
  'app-photoacoustic-imaging':
    'Pulsed light → tissue absorption heating → thermoelastic pressure waves → ultrasonic detection: optical contrast plus acoustic resolution in a hybrid modality.',
  'app-diesel-genset':
    'Diesel chemical energy → compression-ignition heat → piston/crank work → generator electricity: classic ICE–genset path, Carnot-bounded as a heat engine.',
  'app-pro-osmotic':
    'Fresh–salt chemical exergy → semi-permeable PRO pressure → pressurized draw-solution turbine → electricity: pressure-retarded osmosis salinity-gradient power.',
  'app-thermionic-converter':
    'Hot-cathode thermionic emission (Richardson–Dushman) → electrons cross the gap to a cool anode → external current: thermal → electric with no rotating intermediate shaft.',
  'app-orc-plant':
    'Low/mid-grade waste heat or geothermal → organic-fluid evaporation → expander shaft work → generator: ORC swaps water Rankine for low-boiling organics to eat waste-heat grade.',
  'app-alphavoltaic':
    'Alpha-decay nuclear energy → energetic alphas ionize a semiconductor junction → EH pairs collected as current: direct nuclear battery conversion, no heat-engine middle, micropower ultra-long life.',
  'app-kalina-cycle':
    'Low/mid waste heat → NH3–H2O mixture boil/separate → expander shaft work → generator: Kalina uses a variable-boiling mixture to shrink heat-transfer ΔT on waste-heat exergy.',
  'app-hall-thruster':
    'Spacecraft electricity → ionize propellant → E×B Hall-channel ion acceleration → vehicle KE: electric propulsion turns electrical energy into jet mechanical energy.',
  'app-spectrometer-grating':
    'Broadband radiation → slit/collimation → diffraction-grating dispersion → order/wavelength select → photodetection: classic optical instrument chain turning spectra into quantified electrical signals.',
  'app-rf-link-vswr':
    'RF electrical energy → match/feed (reflection, VSWR) → antenna radiates EM → free-space link → receive/detect back to electricity: read a wireless link with VSWR and Friis bookkeeping.',
  'app-fiber-link':
    'Electrically driven pump/laser → NA coupling into fiber → guided attenuation (Beer–Lambert) → photodetection: read a fiber energy link with NA and loss.',
  'app-fabry-perot-sensor':
    'Incident radiation → Fabry–Pérot multi-beam cavity (FSR / finesse) → wavelength/cavity-length select → photodetection: classic interferometric chain turning spectral or strain info into electricity.',
  'app-sagnac-gyro':
    'Vehicle angular rate (mechanical rotation) → fiber-coil Sagnac phase → interference intensity → photodetection: a reciprocal fiber loop that turns Ω into an electrical readout.',
  'app-pid-servo':
    'Electricity → motor/EM force → mechanical displacement: PID (and Ziegler–Nichols tuning) closes the loop on position/velocity error for classic electromechanical servo tracking.',
  'app-tokamak-lawson':
    'Magnetically confined fusion: plasma meeting Lawson → fusion nuclear energy → blanket heat → heat engine/generator → electricity. Read a not-yet-commercial nuclear→electric path via Lawson and MHD/Alfvén lenses.',
  'app-sc-cavity':
    'RF electrical energy → superconducting accelerating/resonant cavity (ultra-high Q, London penetration) → EM standing-wave storage → couple out to electricity: a cavity link read via Q and London depth.',
  'app-nmr-rabi':
    'RF electromagnetic energy → Larmor resonance and Rabi flips of nuclear spins → FID/echo induction as electricity: Bloch, ω0=γB0, and Rabi Ω narratives for an EM→spin→electric pulse chain.',
  'app-sc-qubit-cavity':
    'Bias electricity → Josephson nonlinear qubit → coupled SC cavity mode (high Q, London wall) → microwave photon/readout EM: Ic, Q, and Purcell factor for a simplified circuit-QED archive.',
  'app-radar-link':
    'RF EM transmit → free-space propagation and target RCS scatter → echo receive as electricity: radar equation Pr∝1/R⁴, FSPL, and SNR/link-budget ledger for a detection chain.',
  'app-atomic-clock-ramsey':
    'Electrically driven microwave/optical fields → Rabi π/2 pulses and free-evolution Ramsey interference → readout lock to electricity: Larmor, Rabi, and Ramsey fringes for an atomic frequency standard.',
  'app-convective-cooling':
    'Heat-source thermal energy → boundary-layer/channel convection → cold sink: Re, Nu, Pr, and Fourier conduction ledger for a thermal→thermal convective path (fluid machinery as medium).',
  'app-squid-magnetometer':
    'External magnetic field → superconducting loop / Josephson interference (flux quantum Φ0) → voltage/current electrical readout: SQUID, Josephson, and London penetration for ultra-sensitive magnetometry.',
}
