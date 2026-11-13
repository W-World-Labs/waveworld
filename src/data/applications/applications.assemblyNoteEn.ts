/**
 * English assembly notes for application profiles (swap source/sink narratives).
 * Keys = application id. Chinese `assemblyNote` remains source of truth.
 */
export const APPLICATION_ASSEMBLY_NOTE_EN: Readonly<Record<string, string>> = {
  'app-solar-cell':
    'Baseline assembly: source = solar radiation, sink = electricity. Deep band gap / carriers / Shockley–Queisser are shared with TPV. Swap the source to heat→IR then PV and you get thermophotovoltaics. Swap the whole stack to Seebeck junctions instead of p–n photogeneration and you enter the thermoelectric family.',
  'app-tpv':
    'Vs solar cells: source swaps from solar radiation to thermal energy (via IR EM radiation). Still uses p–n / multi-junction photon absorption with an extra heat→IR hop. Deep SQ / band gap / carrier methods reuse.',
  'app-thermoelectric-seebeck':
    'Thermoelectric stack: ΔT → voltage (Seebeck). Reverse = Peltier cooling under drive current. Nestable with PV: sun→heat→TEG (solar thermoelectric), or RTG decay heat→TEG.',
  'app-peltier-cooler':
    'Vs Seebeck generation: goal swapped (electricity→heat). Same thermocouple materials; equations are Onsager reciprocal reverse effects. A Joule heating branch can nest resistive heating edges.',
  'app-led-display':
    'Same semiconductor-junction family as PV, reverse direction: PV light→electricity, LED electricity→light. Deep band-gap methods are shared.',
  'app-fiber-optic':
    'Vs fiber NA-coupling link: same electricity→light→electricity loop and guided modes, but this dossier stresses modulation, dispersion, and DSP bit errors—not NA coupling and Beer–Lambert attenuation ledgers.',
  'app-steg':
    'Vs PV family: same solar radiation source, but mid-path becomes radiation→thermal collection; sink uses thermocouples instead of p–n photogeneration. Vs thermoelectric family: TEG device layer unchanged, source swaps from waste/nuclear heat to a solar absorber. Contrast TPV (heat→IR→PV junction) with STEG (heat→ΔT→Seebeck).',
  'app-rtg':
    'Vs Seebeck TEG: thermocouple layer unchanged; source becomes nuclear decay / mass decay heat. Vs nuclear plants: no Rankine turbine—direct heat→electricity, lower η, no moving parts, multi-decade life. Mass-radioactive-decay edges book “mass defect→heat.”',
  'app-hydro-plant':
    'Vs pumped-storage discharge: same gravitational PE→electricity, but this dossier is a one-way generation chain (reservoir→penstock→turbine→machine). Vs wind turbines: same rotating generator + induction sink; source swaps from wind KE to head / gravitational PE.',
  'app-mhd-generator':
    'Vs turbogenerators: skips heat→rotating machinery; hot/chemical conducting fluid × B → electricity directly. Vs Seebeck: also shaftless quiet generation, but via bulk Lorentz force rather than solid ΔT diffusion. Combustion MHD can attach a chemical source.',
  'app-photoacoustic-imaging':
    'Vs ultrasound B-mode: same acoustic propagation + piezo receive chain, but the source is modulated/pulsed optical absorption instead of electrically driven piezo. Vs pure optical imaging: the mid carrier becomes acoustic energy—penetration and contrast reorganize.',
  'app-diesel-genset':
    'Vs gasoline Otto: same reciprocating ICE→generator, but bookkept as Diesel cycle (isobaric heat, cutoff ratio rc). Vs gas turbines: same chemical combustion source; expander is reciprocating pistons not a turbine. Sink shares induction generators with hydro/wind.',
  'app-pro-osmotic':
    'Vs reverse electrodialysis: same salinity-gradient chemical exergy→electricity, but via osmotic pressure→hydraulic work→turbine→generator instead of ion-selective membrane electrochemistry. Vs hydro: same turbine + induction sink; source swaps from head PE to concentration-difference chemical exergy.',
  'app-thermionic-converter':
    'Vs Seebeck: also quiet heat→electricity, but via thermal electron emission and gap transport rather than solid diffusion EMF. Photon-enhanced thermionic emission can be a source-swap variant; nuclear thermionic is a nuclear-source parallel assembly.',
  'app-orc-plant':
    'Vs steam Rankine (nuclear/fossil heat engines): same evaporate–expand–condense–pump topology, but working fluid is low-boiling organics (R245fa/pentane…), hot end often 80–300 °C. Vs Stirling: both heat→mechanical, but ORC is Rankine phase-change not a closed gas cycle. Sink shares induction generators with hydro/wind.',
  'app-alphavoltaic':
    'Vs betavoltaics: same junction collection / carrier ledger; source particle swaps β electrons for α (He²⁺, MeV-scale, short range, high ionization density). Vs RTG: same isotope power source, but no decay-heat→Seebeck—particles generate charge directly in the junction. Mass→electricity edges book the mass-defect ledger.',
  'app-kalina-cycle':
    'Vs ORC plants: same waste-heat→Rankine-family→generation assembly, but working fluid is NH₃–H₂O non-azeotropic mixture; evaporation/condensation glide matches the heat-source curve, with vapor–liquid separation and dilute-solution recuperation. Heat→mechanical edges still hang ORC/Rankine/Stirling (nearest neighbors when no dedicated Kalina edge); sink shares the generator layer.',
  'app-hall-thruster':
    'Vs MHD generation: same conducting fluid × B / Lorentz ledger, but energy arrow flips—generation is heat/KE→electricity; thruster/MHD pump is electricity→mechanical KE. Vs gridded ion thrusters: Hall uses annular E×B electron confinement without accel grids; edges hang EM force / MHD-pump neighbors.',
  'app-spectrometer-grating':
    'Vs fiber links: same radiant mid-path and photodetection sink, but core is grating-equation dispersion and order selection—not guided-mode comms. Vs photoacoustics: same optical dose source; sink becomes direct electrical detection rather than thermoelastic sound. Beer–Lambert can hang on the sample absorption branch in parallel with dispersion.',
  'app-rf-link-vswr':
    'Vs fiber: same electricity→wave→electricity loop, but the mid carrier is radio EM instead of laser radiation; KPIs swap dispersion/BER for reflection coefficient, VSWR, and Friis. Vs NLJD/radar: shared antenna and RF front-end atoms; this dossier stresses impedance match and link budget, not nonlinear-junction detection.',
  'app-fiber-link':
    'Vs fiber communications: same electricity→radiation→electricity loop, but core is numerical aperture / core coupling / acceptance angle and Beer–Lambert / fiber attenuation ledgers; Fresnel–Snell describes end-face reflection. Vs RF links: mid carrier swaps radio for laser radiation / IR EM.',
  'app-fabry-perot-sensor':
    'Vs grating spectrometers: same radiation→electricity optical-instrument family, but core is Fabry–Pérot multi-beam interference and free spectral range—not grating dispersion. Michelson can serve as amplitude-split two-arm contrast. Vs fiber links: mid-path can be a fiber FP cavity; sink remains a photodiode.',
  'app-sagnac-gyro':
    'Vs fiber links: same guided modes, NA, and laser–photodiode loop, but core is closed/open-loop FOG non-reciprocal Sagnac phase δφ∝AΩ—not NA coupling budgets. Vs Fabry–Pérot/Michelson instruments: same optical-interference family; topology becomes a co-path rotation ring; mechanical edges weakly couple Michelson paths as “motion→optical path”; sink still a photodiode.',
  'app-pid-servo':
    'Vs Hall thrusters/MHD pumps: same electricity→mechanical energy and EM-force/motor edges, but core is closed-loop error regulation and ultimate-gain tuning—not plasma jets. Vs PID as ancillary wind-drive control: here PID/Ziegler–Nichols is the main lens; sink is a stage/shaft work, not generation.',
  'app-tokamak-lawson':
    'Vs fission plants: same blanket/primary-loop heat→Rankine/Brayton→sync generator sink, but source is fusion and D–T plasma; main lens swaps fission heat release for Lawson nτT and MHD confinement. Vs MHD generation: shared plasma×B / Alfvén ledgers, but the goal is fusion nuclear→electricity, not open-channel direct electricity.',
  'app-sc-cavity':
    'Vs RF link VSWR: same electricity→EM→electricity match/reflection ledger, but core is cavity-mode Q and superconducting wall loss (London penetration)—not free-space Friis. Vs Fabry–Pérot sensors: fine structure / FSR are isomorphic; carrier swaps optical radiation for microwave/RF EM; Josephson edges can neighbor as SC-junction RF sources.',
  'app-nmr-rabi':
    'Vs clinical MRI: same EM→electricity RF chain family, but this dossier drills to Larmor carriers and Rabi flip-angle calibration (pulse area)—not k-space reconstruction. Bloch free precession and T1/T2 relaxation form the shared spin-dynamics layer.',
  'app-sc-qubit-cavity':
    'Vs SC accelerator / high-Q cavities: same SC-wall London penetration and cavity Q family, but core is Josephson Ic nonlinear qubit + cavity-coupled readout (Purcell enhance/suppress); goal is electricity→EM control/readout rather than electricity→electricity storage rings.',
  'app-radar-link':
    'Vs RF comms links: same antenna radiation and Friis/FSPL ledger, but core is two-way 1/R⁴ radar equation and target RCS; goal is EM→electricity (echo sensing), not pure comms electricity→electricity loops. VSWR/match layers reuse; main lenses become radar-equation methods and SNR.',
  'app-atomic-clock-ramsey':
    'Vs NMR/MRI Rabi pulses: shared Larmor carriers, electricity→EM Rabi-drive edges, and spin/two-level dynamics, but goal is electricity→EM→electricity clock-transition lock (Ramsey two-zone interference)—not imaging/spectral reconstruction. Shannon capacity can hang as a stability/info-theory side note.',
  'app-convective-cooling':
    'Vs pure Fourier conduction: same thermal→thermal spatial-transport family; convection adds enthalpy advection.',
  'app-squid-magnetometer':
    'Vs SC cavities and circuit-QED qubits: same Josephson junctions, London penetration, and Ic family, but goal is external flux→electrical readout (sensing)—not cavity storage or qubit control. Flux quantum Φ₀ and n=Φ/Φ₀ are the metrology atoms.',
}
