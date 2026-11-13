/** English control/note pairs aligned by index with CONTROL_HINTS in simMethodNarrative.ts */
export const CONTROL_HINTS_EN: Readonly<Record<string, readonly { controlEn: string; noteEn: string }[]>> = {
  'ripple': [
    { controlEn: 'Damping slider', noteEn: 'Raise damping: each leapfrog step scrapes more wave height so ripples die faster (dissipation term).' },
    { controlEn: 'Click / drag canvas', noteEn: 'A tap on the water drops a source that spreads ripples outward.' },
    { controlEn: 'Playback speed', noteEn: 'Only changes viewing pace: more substeps per frame; the equations stay the same.' },
    { controlEn: 'Hard-wall reflection (fixed BC)', noteEn: 'Walls block exit; reflected waves stack into standing waves and echoes.' },
  ],
  'optics-lab': [
    { controlEn: 'Mirror / lens pose', noteEn: 'Move optics: refraction angles follow Snell’s law from the two indices.' },
    { controlEn: 'Refractive index / media', noteEn: 'Change media: Fresnel relations split how much light reflects vs transmits.' },
    { controlEn: 'On-screen power reading', noteEn: 'Read screen power: at normal incidence, intuition for reflected vs transmitted share.' },
    { controlEn: 'Optical path presets', noteEn: 'Pick a preset: snap-together fold/reflection paths like building blocks.' },
  ],
  'fdtd': [
    { controlEn: 'Field evolve / play', noteEn: 'Play: E and H leapfrog on staggered half-cells like checkers pushing EM waves.' },
    { controlEn: 'Source drive', noteEn: 'Soft source: gently add a waveform into the grid instead of hard-overwriting field points.' },
    { controlEn: 'Boundary (Mur / PEC)', noteEn: 'Mur absorbs outgoing waves; PEC reflects like a metal wall.' },
    { controlEn: 'CFL / stability', noteEn: 'Too-large time steps explode the field; Δt must match grid spacing to stay stable.' },
    { controlEn: 'Energy monitor', noteEn: 'Watch total energy: conservation, dissipation, or continuous source injection.' },
  ],
  'md': [
    { controlEn: 'Particle motion / integrate', noteEn: 'Motion: force → half-step velocity → move → correct with new force (velocity Verlet).' },
    { controlEn: 'Interaction potential', noteEn: 'Pair push–pull: strong repulsion when too close, mild attraction farther out (LJ).' },
    { controlEn: 'Temperature / thermostat', noteEn: 'Pin temperature: rescale velocities to target T so kinetic energy stays on track.' },
    { controlEn: 'Neighbor list', noteEn: 'Speed neighbor search with cell lists—avoid brute-forcing every pair.' },
  ],
  'rlc': [
    { controlEn: 'Damping ratio ζ', noteEn: 'Small ζ rings, ζ≈1 is critically damped, large ζ creeps to rest (series RLC regimes).' },
    { controlEn: 'Phase plane / strip chart', noteEn: 'Coarser Euler trajectories of the same circuit can be checked against finer RK4.' },
    { controlEn: 'Initial stored energy', noteEn: 'Capacitor volts and inductor amps set the circuit’s starting state.' },
  ],
  'laser': [
    { controlEn: 'Pump strength', noteEn: 'Only a strong enough pump “lasers”: below threshold mostly spontaneous emission.' },
    { controlEn: 'Time evolution', noteEn: 'One step: inverted population and photon number push each other (rate equations).' },
    { controlEn: 'Steady reading', noteEn: 'Wait long enough: photon number settles—continuous output brightness.' },
  ],
  'ising': [
    { controlEn: 'Temperature T', noteEn: 'Hotter means more bold flips: Metropolis accepts uphill moves more often at high T.' },
    { controlEn: 'Spin-flip sweep', noteEn: 'Each step proposes flipping one spin, then accepts or rejects.' },
    { controlEn: 'Heat-bath update (contrast)', noteEn: 'Alternate path: sample a new spin from the conditional—no Metropolis walk.' },
    { controlEn: 'Onsager exact check', noteEn: '2D Ising has analytic magnetization—use it to audit Monte Carlo.' },
  ],
  'fluid': [
    { controlEn: 'Dye / velocity advection', noteEn: 'Dye follows the flow: semi-Lagrangian backtrace sampling.' },
    { controlEn: 'Viscous diffusion', noteEn: 'Viscosity smears sharp shear: the velocity field blurs a little.' },
    { controlEn: 'Incompressible projection', noteEn: 'Solve pressure to project velocity toward div≈0.' },
    { controlEn: 'Full-frame pipeline', noteEn: 'Frame order: diffuse → project → advect (Stable Fluids assembly).' },
  ],
  'ultrasound': [
    { controlEn: 'Acoustic impedance / interfaces', noteEn: 'Larger tissue impedance contrast → stronger echoes.' },
    { controlEn: 'A-line pulse–echo', noteEn: 'One depth line: fire → listen → time axis is depth.' },
    { controlEn: 'B-mode collage', noteEn: 'Stack many A-lines into a gray cross-section image.' },
  ],
  'phasedarray': [
    { controlEn: 'Element phase / steering', noteEn: 'Change phases so the main beam steers (array factor).' },
    { controlEn: 'Pattern readout', noteEn: 'Read the pattern: main-lobe width and sidelobe height.' },
  ],
  'antennapattern': [
    { controlEn: 'Pattern drawing', noteEn: 'Relative gain vs angle: where the antenna is more sensitive.' },
    { controlEn: 'Link-budget contrast', noteEn: 'How range and frequency together eat power (Friis).' },
  ],
  'antennas': [
    { controlEn: 'Link / gain parameters', noteEn: 'Farther and higher frequency weaken RX power; antenna gain recovers some.' },
    { controlEn: 'Beam concept', noteEn: 'Beamforming overview: how arrays point and links chain together.' },
  ],
  'antenna3d': [
    { controlEn: '3D pattern', noteEn: 'Gain over solid angle: which directions the antenna favors.' },
    { controlEn: 'Beamforming family', noteEn: 'Array steering + link budget in one method family.' },
  ],
  'stm': [
    { controlEn: 'Tunnel current', noteEn: 'A tiny closer tip→sample gap multiplies current exponentially (extreme gap sensitivity).' },
    { controlEn: 'Constant-height scan', noteEn: 'Fix height; map I(x,y) like a conductance image.' },
    { controlEn: 'Constant-current feedback', noteEn: 'Fix current; tip height tracks topography.' },
  ],
  'afm': [
    { controlEn: 'Tip force / deflection', noteEn: 'Tip–sample forces bend the cantilever; bend ≈ force.' },
    { controlEn: 'SPM family', noteEn: 'STM/AFM share near-field tip scanning of surfaces.' },
  ],
  'tdoa': [
    { controlEn: 'Time difference of arrival', noteEn: 'Who heard first and by how much → hyperbolic intersection for position.' },
    { controlEn: 'Localization family', noteEn: 'Overview entry for TDOA vs trilateration.' },
  ],
  'localization': [
    { controlEn: 'Multi-anchor ranging', noteEn: 'Intersect range circles/spheres from known anchors for coordinates.' },
    { controlEn: 'TDOA channel', noteEn: 'Without absolute range, arrival-time differences still locate.' },
  ],
  'ai-chain': [
    { controlEn: 'PUE slider', noteEn: 'Facility power ÷ IT power: higher PUE means more cooling/distribution waste.' },
    { controlEn: 'Supply / end-to-end efficiency', noteEn: 'Generation→grid→GPU→inference: stage η multiplies down to tokens.' },
    { controlEn: 'Token economics readout', noteEn: 'How joules convert to token throughput—energy ledger to inference output.' },
  ],
  'faraday': [
    { controlEn: 'Flux change / induction', noteEn: 'Faster flux change → larger induced EMF: coil voltage follows.' },
    { controlEn: 'Lumped-circuit frame', noteEn: 'Induced EMF sits in an R–L loop like an added voltage source.' },
  ],
  'mutual': [
    { controlEn: 'Coupling / mutual inductance', noteEn: 'Tighter flux linkage → larger mutual inductance, transformer-like coupling.' },
    { controlEn: 'Lumped-circuit family', noteEn: 'Mutual inductance is a magnetic edge linking two loops in a lumped net.' },
  ],
  'transient': [
    { controlEn: 'RC/RL time constant', noteEn: 'Charge/discharge pace is the time constant: after a few τ you are near steady state.' },
    { controlEn: 'Lumped-circuit family', noteEn: 'Transients are the full climb/fall curves of V and I vs time.' },
  ],
  'heaterfc': [
    { controlEn: 'Semi-infinite T(x,t) curve', noteEn: 'After a surface heat jump, temperature soaks inward; erfc gives the analytic T(x,t).' },
    { controlEn: 'Heat-diffusion family', noteEn: 'Compare numeric heat diffusion: grid FTCS vs analytic erfc.' },
  ],
  'nljd': [
    { controlEn: 'Nonlinear polynomial', noteEn: 'Junction I–V is not linear: nonlinearity “mixes” harmonics.' },
    { controlEn: '2f/3f classification', noteEn: 'Use 2nd/3rd harmonic ratios to guess junction type.' },
  ],
  'particles': [
    { controlEn: 'Molecular integrate step', noteEn: 'Molecules move with the same velocity-Verlet core as generic MD.' },
    { controlEn: 'Species and interactions', noteEn: 'User-supplied LJ and charge parameters define the interactions; material names are metadata.' },
  ],
  'eeg': [
    { controlEn: 'Rhythm bands', noteEn: 'α/β etc. bands: teaching EEG rhythm waveforms.' },
    { controlEn: 'Mains notch DSP', noteEn: 'Notch out 50/60 Hz hum to clean the EEG view.' },
  ],
  'ecg': [
    { controlEn: 'Lead waveforms', noteEn: 'Compose P–QRS–T morphology for ECG feature waves.' },
    { controlEn: 'Mains notch', noteEn: 'ECG chains also need mains-interference removal.' },
  ],
  'emg': [
    { controlEn: 'EMG signal', noteEn: 'Many motor units superpose into a noise-like potential.' },
    { controlEn: 'DSP chain', noteEn: 'Filter → rectify → envelope: turn spiky potentials into a usable envelope.' },
  ],
  'neuron': [
    { controlEn: 'Excitability parameters', noteEn: 'How spikes rise and recover: FitzHugh–Nagumo two-variable teaching model.' },
    { controlEn: 'Bioelectric family', noteEn: 'From membrane potential to macro-electrode recording as one family.' },
  ],
  'sound': [
    { controlEn: 'Sound spectrum bands', noteEn: 'Audible bands: energy vs frequency for timbre and loudness intuition.' },
    { controlEn: 'Spectrum-viewer family', noteEn: 'Same spectrum lens for sound, vibration, and EM.' },
    { controlEn: 'Band comparison', noteEn: 'Wave frequency-domain view: learn FD first, then read spectral meaning.' },
  ],
  'vibration': [
    { controlEn: 'Vibration spectrum', noteEn: 'Mechanical vibration: which bands shake and where energy concentrates.' },
    { controlEn: 'Spectrum-viewer family', noteEn: 'Shares the same spectrum-viewer shell with sound and EM.' },
    { controlEn: 'Vs sound contrast', noteEn: 'Vibration often couples to sound—compare spectra for shake→loud.' },
  ],
  'windtunnel': [
    { controlEn: 'Oncoming flow / advection', noteEn: 'Dye follows the wind: velocity blows ink downstream.' },
    { controlEn: 'Obstacle', noteEn: 'Solid body: flow cannot penetrate—separation and wake start here.' },
    { controlEn: 'Projection (incompressible)', noteEn: 'Correct velocity toward div≈0 so fluid is not created from nothing.' },
  ],
  'convection': [
    { controlEn: 'Buoyancy drive', noteEn: 'Hot fluid is lighter and rises: ΔT becomes a body force (Boussinesq).' },
    { controlEn: 'Advect–project pipeline', noteEn: 'Frame still assembles diffuse→project→advect, with an extra buoyancy term.' },
    { controlEn: 'Viscous diffusion', noteEn: 'Momentum is smeared by viscosity: sharp shear dulls over time.' },
  ],
  'emwave3d': [
    { controlEn: '3D field update', noteEn: 'In 3D, E/H still leapfrog like 2D FDTD.' },
    { controlEn: 'CFL constraint', noteEn: '3D grids also explode if Δt is too large.' },
    { controlEn: 'Source & boundary intuition', noteEn: 'Soft sources and open/reflect BCs match planar FDTD.' },
  ],
  'radar': [
    { controlEn: 'Range equation', noteEn: 'Farther targets return weaker echoes: power falls roughly as R⁻⁴.' },
    { controlEn: 'Localization contrast', noteEn: 'Multi-station TDOA can also estimate position (contrast with ranging radar).' },
    { controlEn: 'Path-loss contrast', noteEn: 'Free-space link: range and frequency eat power together (Friis).' },
  ],
  'display': [
    { controlEn: 'LED wavelength', noteEn: 'Change band gap ≈ change color: semiconductor Eg sets emission wavelength scale.' },
    { controlEn: 'LCD polarization modulate', noteEn: 'Twist polarizer angle: transmittance follows Malus—LCD gray levels.' },
    { controlEn: 'OLED mix', noteEn: 'RGB subpixels emit in ratios that synthesize the screen color.' },
  ],
  'matrix': [
    { controlEn: 'Pick from→to cell', noteEn: 'Click a cell: which paths turn this energy form into that one.' },
    { controlEn: 'Efficiency bar / COP badge', noteEn: 'η asks how much energy remains; exergy η asks how much useful work remains—two rulers.' },
    { controlEn: 'Formula block (plain + example)', noteEn: 'When heat becomes work: grade φ and Carnot scale help read the formula.' },
    { controlEn: 'Sort by efficiency', noteEn: 'When many paths share a form pair, compare efficiency ranges.' },
  ],
  'paths': [
    { controlEn: 'Source / target energy', noteEn: 'Pick A→B: which intermediate conversions the graph needs.' },
    { controlEn: 'Best-efficiency mode', noteEn: 'Find lowest-loss chains: efficiency-weighted cumulative best path.' },
    { controlEn: 'Browse-all mode', noteEn: 'Enumerate candidate chains before forcing a global optimum.' },
    { controlEn: 'Energy / exergy rows', noteEn: 'Of 100 units in: how much energy remains vs how much useful work remains.' },
    { controlEn: 'Monte Carlo robustness', noteEn: 'When η is a range: sample a few times and see path-η distribution stability.' },
  ],
  'graph': [
    { controlEn: 'Select top-level energy', noteEn: 'Open an energy form: its subforms and in/out conversion edges.' },
    { controlEn: 'Conversion-edge cards', noteEn: 'Each edge is a graph arrow—search longer paths from there.' },
    { controlEn: 'Related controversies', noteEn: 'When taxonomy is disputed: multi-explanation entries on nodes/edges.' },
  ],
  'phenomena': [
    { controlEn: 'Phenomenon step axis', noteEn: 'Split photo/sonosensitization into steps that hang energy edges.' },
    { controlEn: 'Jablonski shell', noteEn: 'Electronic-state jumps: rate-equation teaching shell (absorb, fluoresce, ISC).' },
    { controlEn: 'SDT parallel hypotheses', noteEn: 'Cavitation / sonoluminescence / piezo stand side by side—no single truth crowned here.' },
  ],
  'converter': [
    { controlEn: 'Source / target energy dropdowns', noteEn: 'Pick source then target—same “from→to” thinking as the matrix; underlying ids may differ.' },
    { controlEn: 'Scheme card efficiency bars', noteEn: 'Card η ranges use the same readout as the matrix for engineering numbers.' },
    { controlEn: 'Materials & maturity tags', noteEn: 'Mature / emerging / research are rollout narratives, not “more physical truth”.' },
    { controlEn: 'Link to conversion matrix', noteEn: 'Jump to the ontology matrix for formulas, exergy, consensus; no silent electrical/electric merge.' },
  ],
  'transducers': [
    { controlEn: 'Transducer card from→to', noteEn: 'Each card is a device-level conversion channel—one edge or edge class on the energy graph.' },
    { controlEn: 'Ontology node links', noteEn: 'Click into energy nodes; outlets not yet in the ontology (info/intelligence) live under Controversies.' },
    { controlEn: 'Typical efficiency bars', noteEn: 'Encyclopedia η ranges share matrix formatting so numbers read consistently.' },
    { controlEn: 'Application tags', noteEn: 'Use cases set the “can do work” context—not joules alone.' },
  ],
  'apps': [
    { controlEn: 'Application family list', noteEn: 'Each app embeds a conversion chain in a user story; same family = source/sink swap variants.' },
    { controlEn: 'Drill into levels', noteEn: 'Each level can hang edges and methods down to try-run algorithms.' },
    { controlEn: 'Goal energy from→to', noteEn: 'Goal interface is an energy-form pair; read efficiency with grade so waste heat is not misjudged.' },
    { controlEn: 'Family source/sink swap', noteEn: 'Deep methods reusable; surface energy interfaces rewired—multi-explanations coexist.' },
  ],
  'controversies': [
    { controlEn: 'Controversy cards / viewpoints', noteEn: 'Multiple viewpoints side by side; no silent deletion of minorities or merge into one truth.' },
    { controlEn: 'Consensus badge', noteEn: 'Established / conventional / disputed / open: describes status, does not crown winners.' },
    { controlEn: 'Related energy nodes', noteEn: 'Disputes often sit on form boundaries (heat grade, whether information is energy).' },
    { controlEn: 'Layer tags meta/conventional/frontier', noteEn: 'Taxonomy-layer debates vs unclosed frontier issues are shown separately.' },
  ],
  'methods': [
    { controlEn: 'Browse method catalog', noteEn: 'Foundational-method spine: family / algorithm / step / parallel-variant roles.' },
    { controlEn: 'Filter by kind', noteEn: 'Wave · particle · continuum… are lens classes, not mutually exclusive truths.' },
    { controlEn: 'Link to sims / world map', noteEn: 'Methods hang on concrete sim pages—open them to turn knobs and compare.' },
  ],
  'taxonomy': [
    { controlEn: 'Taxonomy swimlanes', noteEn: 'Method trees by disciplinary kind: parent/child is refinement, not overwrite.' },
    { controlEn: 'Prerequisite edges', noteEn: 'Learning path: know B before A—orthogonal to physical conversion edges.' },
    { controlEn: 'Parallel-variant groups', noteEn: 'One slot can host multiple explanations shown side by side—disagreements stay visible.' },
  ],
  'world': [
    { controlEn: 'World map / timeline', noteEn: 'Spatiotemporal layout of methods and energy nodes—ops view, not sole doctrine.' },
    { controlEn: 'Select method node', noteEn: 'Drill into algorithm steps and try-run demos.' },
    { controlEn: 'Year anchors', noteEn: 'Years are teaching timeline anchors, not importance or correctness rankings.' },
  ],
  'sensing': [
    { controlEn: 'Measurand energy form', noteEn: 'A sensor is a conversion chain turning the measurand into a readable electrical signal.' },
    { controlEn: 'Harvest η order / deployability order', noteEn: 'Harvest sorts by ∏η; selection sorts by maturity—different intents.' },
    { controlEn: 'Conversion path cards', noteEn: 'Read efficiency with final-state grade so low-grade heat is not treated as high-grade work.' },
    { controlEn: 'Device / product models', noteEn: 'device/products from ontology edges—same data spine as the conversion matrix.' },
  ],
}
