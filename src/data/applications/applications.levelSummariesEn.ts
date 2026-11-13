/**
 * English summaries for application levels (i18n).
 * Chinese `summary` in applications.data.ts remains the zh source.
 */
export const APPLICATION_LEVEL_SUMMARIES_EN: Record<string, string> = {
  'pv-system': 'Irradiance → DC → inverter AC → grid. Focus on capacity factor, orientation, shading, and a plant-level “system ledger”—not junction physics.',
  'pv-module': 'Series/parallel cells: current matching, bypass diodes, packaging losses (EVA, glass, resistance). Module η is usually below cell η.',
  'pv-cell': 'Photons → electron–hole pairs → built-in field separation → work in the external circuit. η = Isc × Voc × FF / Pin.',
  'pv-optics': 'Which AM1.5 photons are absorbed? ARC, light trapping, bandgap match. Above-Eg thermalization is a major loss.',
  'pv-bandgap': 'Semiconductor bands: Eg sets the absorption cutoff. Shockley–Queisser comes from detailed balance + spectrum.',
  'pv-carriers': 'Continuity and drift–diffusion: lifetime, diffusion length, and surface recombination set collection. Heat/diffusion equations are teaching analogues.',
  'pv-losses': 'Unused absorption, thermalization, recombination, series R, inverter… split the black-box percent with η products and exergy.',
  'tpv-bandgap-sq': 'IR photons need lower Eg; SQ/detailed balance shares the deep solar-PV method stack, only the spectrum is emitter blackbody/filter.',
  'steg-system': 'Sunlight → absorber heating → cold-side rejection → TE stack drives the load. Path η = optical/thermal collect η × Seebeck η; split with η product and exergy.',
  'steg-collector': 'Selective coatings / concentration turn solar radiation into hot-side internal energy; optical intercept and (Tm−Ta)/G heat loss set instantaneous collect η.',
  'steg-teg': 'Hot/cold ends clamp p–n TE couples: V∝αΔT. Same structure as the Seebeck app—swap the heat source, not the Onsager coupling.',
  'steg-couple': 'ZT=α²σT/κ and thermal-resistance matching: absorber, TE module, heat sink in series. Heat diffusion and η products reuse TE-family methods.',
  'steg-vs-pv': 'Same solar source: PV is photon→carrier; STEG adds a heat hop; TPV is heat→IR→PV junction. Path MC and exergy compare nesting cost.',
  'rtg-system': 'GPHS + TE string + radiators/heat pipes. Overall η≈6%; output decays with half-life. Split with path η and TE η.',
  'rtg-heat-source': 'α/β particles thermalize in fuel and clad: decay → heat; mass-defect edges also read E=mc² deposited power. Pu-238 ~0.54 W/g.',
  'rtg-teg': 'PbTe / SiGe couples turn ΔT into DC; share thermal→current Seebeck edges with the Seebeck app device layer.',
  'rtg-materials': 'Hot-side materials and ZT curves set extractable electric power; heat diffusion describes the steady hot–cold gradient.',
  'rtg-lifetime': 'P(t)=P₀e^(−λt): electric power follows source decay; mission planning books BOL/EOL power with shielding and mass.',
  'fc-system': 'Fuel processing, air/humidification, thermal management, and DC output. Net η = stack η − parasitics; path η reports fuel chemical exergy to the grid point.',
  'fc-stack': 'Low-T PEM: high power density and cold start; high-T SOFC: internal reforming, higher electric η. Both chemical→current; device and temperature band differ.',
  'fc-mea': 'Anode oxidation / cathode ORR, proton or O²⁻ migration, electrons externally. Activation, ohmic, and concentration overpotentials set the I–V curve.',
  'fc-materials': 'Pt-group ORR catalysts, hydrated polymer membranes, or YSZ high-T oxygen conductors. MD/DFT give micro transport and adsorption intuition.',
  'fc-waste-heat': 'TΔS and overpotentials dump heat: PEM needs cooling; SOFC can CHP. Waste-heat edges complement electric η bookkeeping.',
  'wt-farm': 'Wind resource → unit output → collection and grid. Capacity factor and wake losses are farm-level; unit path is KE→rotation→electric.',
  'wt-rotor': 'P = Cp·½ρAv³ with Cp≤Betz 0.593. Airfoil L/D, tip-speed ratio, and yaw set practical Cp≈0.35–0.45.',
  'wt-drive': 'Low-speed high-torque rotor matches the generator: multi-stage gearbox step-up or permanent-magnet direct drive.',
  'wt-generator': 'Shaft work → electromagnetic induction → line/variable-frequency electricity. Faraday and lumped circuits are try-run atoms.',
  'wt-loss-ledger': 'Uncaptured flow KE, wake interference, copper/iron loss, converter loss… split nameplate Cp with η products.',
  'hp-plant': 'Storage and head → unit output → step-up and grid. Ledger is hydro PE → KE → rotation → electric; path η and exergy unpack the water-use factor.',
  'hp-reservoir': 'Head H sets available PE ~ρgQH. Storage organizes gravitational PE into hydraulic-head books.',
  'hp-penstock': 'Penstock/tunnel accelerates head into jet/pipe KE: hydraulic head → mechanical KE. Friction and local losses are the first η stage.',
  'hp-turbine': 'Blades turn flow KE into rotational shaft work (Francis/Kaplan/Pelton). Same KE→rotation as wind, working fluid is water.',
  'hp-generator': 'Shaft work → induction → line-frequency electricity. Shares Faraday and RLC atoms with nuclear/wind generators.',
  'hp-loss-ledger': 'Unused head, cavitation and tailwater KE, bearings, copper/iron… split design water-use with η products; noise edges book cavitation.',
  'mhd-system': 'Heat source/burner → conductive flow acceleration → MHD channel → electrodes and inverter. Path thermal (or chemical) → electric; path η and exergy vs turbine nesting.',
  'mhd-source': 'Combustion or external heat ionizes the working fluid so σ rises; alkali seeding optional. Chemical routes hang chemical→MHD; pure heat routes hang thermal MHD edges.',
  'mhd-channel': 'Fast conductive flow through B: j = σ(E + v×B). Faraday/Hall topologies set electrode layout; fluid and EM fields couple strongly.',
  'mhd-electrodes': 'Lorentz-separated charge leaves through electrodes into the load. Lumped circuits and mutual inductance describe matching; Faraday gives v×B EMF intuition.',
  'mhd-loss-ledger': 'Joule heat, near-wall layers, Hall leakage, unrecovered flow KE… η products and exergy loss unpack “ideal MHD”.',
  'pai-system': 'Source–illumination–absorption–acoustic emission–receive–reconstruct. Top edge radiant→acoustic (photoacoustic); path η links optical dose to detectivity.',
  'pai-illumination': 'Pulsed laser/LED absorption at chromophores locally heats tissue. Radiant/visible/IR → thermal is hop one; spectrum sets contrast (Hb, melanin, agents).',
  'pai-thermoelastic': 'Constrained thermal expansion yields initial pressure p₀∝Γ·μ_a·Φ (Grüneisen × absorption × fluence). Photoacoustic and thermoacoustic edges describe the hop.',
  'pai-propagate-detect': 'Broadband ultrasound propagates and attenuates; piezo/CMUT probes turn sound into electricity—same receive chain idea as B-mode.',
  'pai-reconstruct': 'Delay-and-sum, model inversion, or frequency-domain rebuild maps multi-channel pressure to absorption images; array factor and B-frame atoms reuse ultrasound methods.',
  'dg-system': 'Fuel chemical energy → ICE shaft work → generator → distribution. Ledger chemical→thermal→mechanical→electric; η products and exergy vs nameplate fuel use and Carnot.',
  'dg-fuel-chem': 'Diesel chemical bond energy / LHV is the source ledger. Spray and AFR set combustion completeness; bond→combustion heat is hop one.',
  'dg-combustion': 'Compression ignition after injection: chemical→thermal (hot working fluid). Diesel cycle models isobaric heat addition vs Otto isochoric; diesel-cycle methods apply.',
  'dg-expansion': 'Hot high-P gas expands on the piston; crankshaft outputs rotational work. Thermal→mechanical expansion and chemical→mechanical ICE edges; friction and cooling are mid η.',
  'dg-generator': 'Crankshaft work → induction → line/variable-frequency electricity. Shares Faraday/RLC atoms with wind/hydro generators.',
  'dg-loss-ledger': 'Exhaust/coolant heat, mechanical friction, copper/iron, conversion… split g/kWh with diesel-cycle η, Carnot bound, and η products.',
  'pro-system': 'Fresh + seawater/draw → membrane modules → pressurized turbine → grid. Goal chemical→electric; path η and exergy bring extractable salinity work to the bus.',
  'pro-salinity': 'Mixing free energy / van ’t Hoff π≈iCRT is the source ledger. Dilution/concentrate flow ratio sets the extractable-work ceiling.',
  'pro-membrane': 'Water crosses into pressurized draw side: Δπ drives volume flow Q; power atom P≈η·Δπ·Q. Concentration polarization and membrane resistance dominate loss.',
  'pro-hydro': 'Pressurized draw fluid through a turbine/energy-recovery device → rotational work. Same as hydro turbines; pressure from osmosis, not reservoir head.',
  'pro-generator': 'Turbine shaft → induction → electricity. Shares Faraday atoms with hydro/diesel; full chain chemical→mechanical→electric.',
  'pro-loss-ledger': 'Polarization, feed-pump parasitics, fouling, turbine and copper/iron… η products unpack theoretical mixing work into net output.',
  'tic-system': 'Heat → cathode emission → gap transport → anode collect → load. Top edge thermal→electric thermionic; path η and Carnot/exergy vs nameplate 5–20% η.',
  'tic-heat-source': 'Combustion, concentration, nuclear decay, or waste heat hold the cathode at ~1500–2000 K. Thermal grade sets Carnot; nuclear thermionics can hang nuclear-thermionic edges.',
  'tic-emission': 'J = A T² exp(−φ/kT): work function and cathode T set saturation current density. Richardson-current algorithm is a try-run atom.',
  'tic-gap': 'Vacuum or low-P Cs vapor: space-charge barrier limits net current; neutralization and gap spacing are engineering cores. Particle-mesh is a teaching analogy.',
  'tic-collector': 'Cool anode collects electrons; external circuit carries current. Contact potential and load matching set the operating point; lumped circuits describe I–V.',
  'tic-loss-ledger': 'Cathode radiation, gap barrier, conduction, load Joule heat… η products and exergy loss unpack ideal Richardson into device net η.',
  'orc-system': 'Waste heat → evaporator → expander–generator → condenser reject. Ledger thermal→mechanical→electric; η bounded by Carnot and organic relative η; Rankine/path/exergy split the books.',
  'orc-waste-heat': 'Flue, jacket water, geothermal brine—mid/low heat is the source. Th sets Carnot 1−Tc/Th; ORC eats grades steam Rankine cannot.',
  'orc-evaporator': 'Waste heat preheats/evaporates/superheats organic fluid: heat→heat exchange is the first irreversibility. Finite-ΔT transfer is a main ORC exergy loss.',
  'orc-expander': 'High-P organic vapor expands in turbine/screw/scroll to rotational work. ORC/Rankine thermal→mechanical edges; isentropic η and leakage are mid losses.',
  'orc-generator': 'Expander shaft → induction → line/variable-frequency electricity. Shares Faraday/RLC with wind/hydro/diesel generators.',
  'orc-loss-ledger': 'Condenser reject, HX ΔT, expander isentropic η, pump work, electrical loss… ideal Rankine η, Carnot, and η products unpack waste-heat utilization.',
  'av-system': 'Isotope α source + semiconductor junction + leads. Overall η often single-digit; output follows half-life slowly. Direct nuclear→electric; α-voltaic power atoms vs β-voltaic edges.',
  'av-source': '²⁴¹Am, ²³⁸Pu, etc. release ~5 MeV α kinetic energy. Activity A and Eα bound theoretical power; self-absorption and packaging eat a share.',
  'av-transport': 'α range in solids is only tens of µm: energy deposits locally. Source thickness, passivation, and junction depth must match range or dead-layer losses dominate.',
  'av-junction': 'α creates many EH pairs in the depletion region; built-in field collects current—like β-voltaics/PV but with harsh dE/dx and damage. Wide-gap SiC/diamond ages better.',
  'av-load': 'Junction current feeds MEMS/sensors through matching networks. Copper loss and leakage matter at nW–µW; same circuit atoms as commercial β-voltaics.',
  'av-loss-ledger': 'Self-absorption, dead layer, radiation defects, recombination, Joule heat… α-power algorithms and η products unpack A×Eα into deliverable watts.',
  'kalina-system': 'Waste heat → NH3–H2O boil/separator → rich-vapor expander–generator → absorb/condense recuperation. Thermal→mechanical→electric; Rankine/Carnot/path/exergy vs ORC mixture gains.',
  'kalina-waste-heat': 'Flue, geothermal brine, process jackets—mid/low heat source. Th sets Carnot; Kalina’s sliding boiling point hugs the heat-source cool-down curve to cut HX exergy loss.',
  'kalina-boiler-separator': 'Waste heat heats aqueous ammonia: partial boil then vapor–liquid split—rich vapor to expander, lean liquid throttled after recuperation into the absorber. Heat→heat exchange edges prepare enthalpy for work.',
  'kalina-expander': 'High-P rich vapor expands in turbine/screw to rotational work. Without a dedicated Kalina edge, hang ORC/Rankine/heat-engine neighbors; wet vapor and leakage are mid η.',
  'kalina-generator': 'Expander shaft → induction → electricity. Shares Faraday/RLC with ORC/hydro/wind/diesel; absorber–condenser pump work subtracts from net.',
  'kalina-loss-ledger': 'HX finite ΔT, separation irreversibility, expander isentropic η, pump work, absorber mixing, electrical loss… Rankine η, Carnot, η products unpack the NH3–H2O gain.',
  'ht-system': 'PPU electricity → discharge ionization → Hall-channel acceleration → plume thrust. Goal electric→mechanical (jet KE); path η and MHD/Hall atoms vs “inverse MHD generator” narrative.',
  'ht-ppu': 'Bus DC through the PPU feeds anode HV, cathode, and magnets. Joule heat and conversion η are first electrical losses; lumped circuits describe matching.',
  'ht-ionization': 'Xe/Kr enter the anode region; electron-impact ionization makes plasma. Particle-mesh/Vlasov describe charged particles; Hall family gives E×B drift intuition.',
  'ht-channel': 'Radial B and axial E: electrons Hall-drift, ions accelerate axially—main electric→mechanical KE conversion. Inverse of MHD generation: same Lorentz ledger, opposite power direction.',
  'ht-plume': 'Ion momentum flux is thrust F≈ṁ·ve; Isp=ve/g0. Cathode electrons neutralize spacecraft charge. Off-axis KE, divergence, and charge exchange cut propulsive η.',
  'ht-loss-ledger': 'Ionization cost, wall erosion and secondaries, beam divergence, Joule heat, PPU chain… η products and exergy unpack ideal exhaust speed into engineering thruster η.',
  'sg-system': 'Source–entrance slit–collimation–grating–focus/exit slit–detector. Goal radiant→electric; path η links optical throughput to QE.',
  'sg-source': 'D2/W lamps, lasers, or sunlight provide the incident spectrum. Thermal→radiant blackbody or electric→visible lamps are common source assemblies.',
  'sg-slit-collimate': 'Entrance slit trades etendue vs resolution; collimator makes a parallel beam on the grating. Ray optics and Fresnel losses describe geometric flux.',
  'sg-grating': 'Grating equation d sinθ = mλ maps wavelength to angle; line density and blaze set dispersion and efficiency. Young’s double slit is the multi-slit teaching limit.',
  'sg-order-select': 'Stage/exit slit selects principal order m; filters suppress overlapping orders. sinθ=mλ/d gives channel λ; resolution limited by slits and grating width.',
  'sg-detector': 'CCD/CMOS/PMT/photodiode turn selected band power into current or charge packets. Radiant/EM→electric edges match fiber receivers; FFT optional post-process.',
  'rfl-system': 'TX port → match/feed → antenna → propagation → RX antenna → detect/rectify. Goal electric→EM→electric; VSWR and path η split mismatch vs space loss.',
  'rfl-source-pa': 'RF source or PA lifts baseband/IF energy onto the carrier port. Joule heat and lumped RLC describe drive loss; Bode plots gain flatness and bandwidth.',
  'rfl-match-feed': 'Conjugate match drives Γ→0; VSWR=(1+|Γ|)/(1−|Γ|) is the field-readable mismatch metric. Impedance match and VSWR are this layer’s lenses.',
  'rfl-antenna-rad': 'A well-matched antenna radiates the radiation-resistance share as far-field Poynting flux. Electric→EM radiation edges; pattern/array factor set gain.',
  'rfl-propagate-rx': 'Friis free-space turns range and gains into Pr/Pt; receive/rectenna antennas restore EM/radio to electricity. Full electric→electric loop with mismatch and path loss in η products.',
  'fl-system': 'Electric port → pump/laser → NA couple → guided attenuation → photodetect. Goal electric→optical→electric; NA and path η split acceptance angle vs loss.',
  'fl-source-pump': 'Pump/laser diodes turn current into IR EM / laser radiation. Fiber-pump edges share the communications TX story; Joule heat is wall-plug loss.',
  'fl-na-couple': 'NA=√(n_core²−n_clad²) or n sinθ sets acceptance/exit cones; Fresnel reflection and misalignment set couple η. Differentiating lens vs the communications dossier.',
  'fl-guide-atten': 'P=P₀ e^{−αL}; fiber attenuation matches Beer–Lambert form. Dispersion optional for high-speed links; absorption leaks radiant energy to heat.',
  'fl-detector': 'PIN photodiodes turn core exit power into current, closing electric→electric. Same as spectrometer/comms receive; path η sums NA×atten×QE.',
  'fp-system': 'Source–collimate–FP cavity–transmit/reflect mode select–detector. Goal radiant→electric; FSR and path η link cavity geometry to QE.',
  'fp-source': 'Broadband lamps or narrow lasers provide the incident spectrum. Thermal→radiant or electric→laser sources; linewidth vs FSR sets resolvable modes.',
  'fp-cavity': 'Two high-R mirrors form Airy transmission peaks; finesse follows reflectivity. Young/Michelson are two-beam teaching limits.',
  'fp-fsr-select': 'FSR=c/(2nL) is adjacent peak spacing; tune L or n for scan/sense. Michelson Δ=2d is a dual-arm contrast.',
  'fp-detector': 'PD/PMT/CCD turn FP transmit (or reflect) power into current. Same as grating spectrometers; spectral/order post-process optional.',
  'fog-system': 'Mechanical rotation → SLED/laser into fiber → multi-turn coil → Sagnac phase → interference to electricity. Goal mechanical→electric via radiant mid-hop; path η chains optical contrast and QE.',
  'fog-rotation': 'Measurand is mechanical rotation. Loop area A and turns set scale factor; mechanical→radiant edges describe weak motion–phase coupling (no net mechanical pumping of the field).',
  'fog-source': 'Broadband SLED or narrow laser turns current into IR EM / laser light, cutting coherent Rayleigh and Kerr errors. Same pump family as fiber links; Joule heat is wall-plug loss.',
  'fog-coil': 'Multi-turn PM/SM coil: NA and end-face coupling set in-loop power; Beer–Lambert / fiber loss set coil loss and reciprocity. Length budgets serve phase scale, not bit rate.',
  'fog-detector': 'CW/CCW recombination: PD reads I∝cos(δφ); open-loop phase or closed-loop nulling. Michelson/Mach–Zehnder photo edges are neighbors; path η sums couple×atten×contrast×QE.',
  'ps-system': 'Setpoint → PID → power stage → motor/EM actuator → mechanical load; encoder closes the loop. Goal electric→mechanical; Bode/path η trade bandwidth vs loss.',
  'ps-controller': 'e=sp−y; u=Kp e+Ki∫e+Kd ė. Discrete-step atoms try first-order tracking; anti-windup and sample period set numerical stability.',
  'ps-zn-tune': 'Critical gain Ku and period Pu → Kp=0.6Ku, Ti=0.5Pu, Td=0.125Pu. Teaching entry; retune from Bode margins on hardware.',
  'ps-actuator': 'Power-stage current through motors or linear EM actuators turns electricity into work/torque. Motor, EM-force, Lorentz edges; copper Joule heat is the main loss.',
  'ps-plant': 'Inertia, friction, and compliance form the plant; position/velocity feedback from encoders. First-order lag teaching models vs real two-mass plants; closed loop tracks the setpoint.',
  'tk-system': 'Plasma heat & confine → fusion energy → blanket heat → heat engine–generator to grid. Goal nuclear→electric via thermal; path η and exergy vs auxiliary heating, fusion Q, house loads.',
  'tk-plasma-lawson': 'n, τE, T form the triple product; net fusion power narratives need DT-peak thresholds. Edges hang nuclear→thermal fusion plasma and fusion→heat subforms.',
  'tk-mhd-confinement': 'Toroidal/poloidal B confines plasma; Alfvén speed vA=B/√(μ0ρ) sets MHD-wave and ideal-MHD timescales. Shares Lorentz/MHD lenses with open-channel MHD generation, but B confines rather than extracts.',
  'tk-blanket': '14 MeV neutrons and α energy deposit as exportable heat in breeding blankets and coolant; fusion→thermal blanket heat is the main edge.',
  'tk-power-cycle': 'Hot coolant drives Rankine/Brayton → shaft work → sync generator. Same sink side as fission nuclear; Faraday and lumped circuits are generator try-run atoms.',
  'sc-system': 'RF source/PA → coupler → SC cavity storage → extract/beam load or receive detect. Goal electric→EM→electric; Q and path η split wall loss, coupling, and mismatch.',
  'sc-source-drive': 'Solid-state sources, klystrons, or Josephson junctions push electricity onto the carrier port. Lumped RLC and Joule heat describe the drive; Josephson frequency is a superconducting source contrast.',
  'sc-cavity-q': 'Nb/Al SC cavities store accepted power as EM modes; Q=ωU/P and f0/Δf measure storage lifetime. Fabry–Pérot FSR/finesse is the optical analogue.',
  'sc-london-wall': 'Meissner-state fields decay within λL; surface resistance Rs and residual loss set intrinsic Q0. Skin depth is the normal-metal contrast; T enters thermal load via BCS/residual R.',
  'sc-couple-out': 'Power couplers, antennas, or beam loads restore cavity fields to an electric port (or useful accelerating work). VSWR/Γ describe external coupling; full electric→electric loop.',
  'nmr-system': 'B0 → RF transmit (electric→RF field) → nuclear Rabi flips → FID/echo radiation → receive coil to electricity. Goal EM→electric; Larmor and Rabi own the timing.',
  'nmr-b0-larmor': 'SC or permanent main field sets Zeeman splitting; ω0=γB0 fixes the RF carrier and chemical-shift reference. Nuclear and RF energy align at Larmor.',
  'nmr-rf-rabi': 'PA current drives the TX coil to build B1; on resonance Ω=γB1 and flip angle α=Ωτ calibrates 90°/180°. Main energy sink is tissue SAR heat.',
  'nmr-bloch-receive': 'After flip, transverse magnetization freely precesses and T2-decays; FID/echo Faraday-induce the receive coil. Bloch equations close spin dynamics.',
  'sqc-system': 'Cryogenic bias and microwave control ports → Josephson qubit → cavity/resonator mode → readout line takes microwave EM. Goal electric→EM; Q, Ic, and Purcell split coherence vs dissipation.',
  'sqc-josephson-qubit': 'SIS/SNS Ic and EJ define nonlinear inductance; transmon/flux qubits store electrical energy as qubit levels. AC Josephson f=2eV/h is a microwave-source contrast.',
  'sqc-cavity-q': '3D or CPW resonators store microwave photons; Q=ωU/P and London penetration set wall loss and coherence timescales. Same high-Q idea as accelerator cavities, different volume/coupling.',
  'sqc-purcell-readout': 'Dispersive/resonant coupling: cavity enhances or suppresses qubit decay (Purcell Fp∝Q/V); readout pulses map qubit state to output microwave EM. Closes electric→EM goal.',
  'rlk-system': 'TX builds RF EM → antenna radiates → free-space round trip and target scatter → RX restores echo to electricity and decides detection. Goal EM→electric; radar equation, FSPL, SNR, and link budget are the four pillars.',
  'rlk-tx-antenna': 'PA and TX antenna turn electricity into far-field EM; gain Gt enters the radar equation and link budget. Joule heat and mismatch split on the TX side.',
  'rlk-propagate-rcs': 'One-way FSPL and round-trip R⁴ convert range to power ratio; target RCS σ enters the radar equation. This layer is where radar-range and FSPL methods meet.',
  'rlk-rx-detect': 'RX antenna and front end turn the echo into electric power; SNR and Smin decide detectability; link budget writes Pr in dBm. Chain closes at the detection decision.',
  'acr-system': 'LO electric port → microwave/optical interrogation → atomic Rabi drive and Ramsey free evolution → state readout steers the LO. Goal electric→EM→electric; Larmor sets transition, Rabi pulses, Ramsey fringes.',
  'acr-lo-drive': 'Quartz/dielectric LO and synthesizers raise the electric oscillation to the interrogation frequency; PA/coils build B1 or optical fields. Main energy edges are Rabi drive and near-field coils.',
  'acr-ramsey-interrogation': 'First π/2 Rabi pulse splits a coherent superposition; free evolution T accumulates φ=δω·T; second π/2 maps phase to population. Ramsey fringe width ∝1/T.',
  'acr-readout-lock': 'Fluorescence/absorption or spin readout turns fringe slope into an error voltage that locks the LO. Optional Shannon capacity contrasts loop SNR with stability information rate.',
  'cc-system': 'Hot wall → fluid boundary layer/channel convection → cold sink. Goal thermal→thermal; fluid KE is the medium, not the end. Re sets laminar/turbulent, Nu gives h, Pr couples momentum and heat; wall still closes with Fourier conduction.',
  'cc-forced-flow': 'Channel/external flow speed U, length L, viscosity μ form Re=ρUL/μ. Laminar/transition/turbulent switch boundary-layer thickness and mixing—first independent variable of Nu correlations; pumps/fans supply mechanical KE medium.',
  'cc-nusselt-pr': 'Nu=hL/k nondimensionalizes h; Pr=ν/α=μcp/k is the momentum/heat diffusivity ratio. Engineering Nu=C·Re^m·Pr^n ties regime and properties to designable h for the thermal→thermal share.',
  'cc-wall-fourier': 'Solid wall/fin conduction q=−k∇T moves heat from the device core to the convection surface, series with Nu BCs. Fourier thermal→thermal is pure-conduction contrast; contact R and lateral leak enter the loss ledger.',
  'sqm-system': 'External B couples into the pickup loop → SQUID (Φ0) → bias/feedback electrical readout. Goal EM→electric; Josephson junctions, London shielding, and flux quanta split sensitivity and dynamic range.',
  'sqm-pickup-london': 'SC pickup and shields use London equations to confine external fields to a λL surface layer; Meissner redirect turns incident magnetic energy into screening supercurrents. λL and loop geometry set effective mutual inductance and CMRR.',
  'sqm-josephson': 'dc/rf SQUID one or two Josephson junctions modulate loop flux into Ic/voltage; f=2eV/h and Ic set the bias point. Bias must sit near Ic; thermal noise and shunt R enter the electrical budget.',
  'sqm-flux-readout': 'n=Φ/Φ0 quantizes external flux; lock-in/flux-lock maps interference fringes to voltage or feedback current, closing EM→electric. SNR and bandwidth are constrained by Φ0 and the noise spectrum.',
  // Progressive fill for levels that had nameEn but no summaryEn yet
  'tpv-system':
    'Heat source warms a selective emitter → IR photons → TPV cell → electricity. Can hang waste heat, fuel, or nuclear decay heat.',
  'tpv-emitter':
    'Blackbody / selective emitters turn heat into an IR spectrum matched to the cell band gap; Wien’s displacement sets the peak wavelength.',
  'tpv-cell':
    'Same photovoltaic effect as solar cells, redder spectrum: lower-Eg materials or spectral filtering. Deep band gap / SQ methods are shared with the solar family.',
  'tpv-shared-physics':
    'Generation–recombination–collection, thermalization, and exergy ledgers are isomorphic to solar PV—you swap the incident spectrum, not the quantum mechanics.',
  'teg-system':
    'Hot reservoir and cold sink clamp a thermopile; open-circuit voltage ∝ ΔT; under load η is limited by ZT and the thermal-resistance network.',
  'teg-couple':
    'Seebeck α, conductivity σ, and thermal conductivity κ combine into ZT=α²σT/κ; many couples in series raise voltage.',
  'teg-nested-rtg':
    'Source can nest again: nuclear decay heat→TEG, or sunlight→absorber→TEG (solar thermoelectric). Source edges change; thermocouple layer does not.',
  'tec-system':
    'Current-driven: cold face absorbs heat; hot face must reject Q or the ΔT collapses.',
  'tec-couple':
    'Q_p = ΠI − ½I²R ± KΔT: Peltier term, Joule heat, and thermal backflow coexist.',
  'tec-vs-seebeck':
    'Same α, κ, σ: open-circuit ΔV/ΔT is Seebeck; cooling a short thermal end is Peltier. Jumping to “ΔT generation” inside the family is only a different operating point.',
  'led-system':
    'DC drive → LED chip / OLED pixel / LCD backlight + liquid crystal.',
  'led-junction':
    'Injected carriers recombine and emit; band gap sets color coordinates; efficiency is limited by non-radiative recombination.',
  'led-optics-out':
    'In-chip TIR, package index, microstructures for extraction; Snell/Fresnel set the optical part of external quantum efficiency.',
  'led-band-material':
    'InGaN / AlGaInP alloys tune the gap for color; non-radiative recombination and Auger limit IQE—DFT intuition for band edges is a useful contrast.',
  'led-lcd-path':
    'White backlight + LC birefringence + polarizers: Malus’s law governs transmittance—a light-valve chain unlike direct LED emission.',
  'us-system':
    'Excitation–transmit–reflect–receive–beamform–B-mode frame.',
  'us-piezo':
    'Electrostriction / direct piezo: the device atom that interconverts mechanical strain and electric field.',
  'us-propagation':
    'Acoustic impedance mismatch makes echoes; attenuation rises with frequency. A-line depth = time × c/2—the geometry base of B-mode.',
  'us-beamform-image':
    'Multi-element delay-and-sum / dynamic focus builds scan lines; envelope detection stitches gray-scale B frames.',
  'np-plant':
    'Core heat → primary/secondary loops → turbine–generator → grid. Plant η is bounded by Carnot and the cold end; path-η product splits the ledger.',
  'np-core-heat':
    'Fission-fragment KE thermalization + delayed decay heat: nuclear binding deficit becomes extractable thermal power. Coolant delivers heat to the steam generator.',
  'np-secondary-loop':
    'High-pressure steam (or gas working fluid) expands and does work: heat→mechanical. Exergy efficiency tracks hot/cold T ratio and irreversibilities.',
  'np-generator':
    'Turbine shaft work → EM induction → grid electricity. Faraday induction and lumped resonant circuits are hands-on generator-side atoms.',
  'np-loss-ledger':
    'Condenser heat rejection, pumping, house loads, decay-heat management… unpack “nameplate thermal η” into explainable loss terms.',
  'bat-pack':
    'Series/parallel packs, thermal management, and SOC estimation. Discharge: chemical→electric; charge: electric→chemical. Round-trip η and safety bounds matter.',
  'bat-cell':
    'Intercalation potential difference drives external current; internal R, SEI, and polarization set usable capacity and heating. Lumped RC is the engineering first-order model.',
  'bat-interface':
    'Butler–Volmer-type charge transfer + solid/liquid diffusion: rates track overpotential and concentration gradients. Diffusion equations and KMC are teaching analogues.',
  'bat-materials':
    'Li sites and migration barriers in layered oxides / olivine frameworks; electrolyte solvent–salt coordination. MD and DFT supply microscopic intuition.',
  'bat-thermal-safety':
    'I²R heat + side-reaction heat can cascade; heat diffusion and path η help reason about temperature rise and thermal-runaway thresholds.',
  'mri-system':
    'Main magnet + gradients + RF TX/RX + shielding and patient table. Goal: turn spatially encoded RF echoes into diagnostic slices.',
  'mri-spin-physics':
    'Nuclear moments precess in B₀; RF matched to Larmor flips magnetization. T1/T2 set contrast; energy exchanges between nuclear spins and the EM field.',
  'mri-rf-chain':
    'PA drives the TX coil; RX coil senses weak RF voltage through LNA and mixers into sampling. Antennas and mutual inductance are device atoms.',
  'mri-recon':
    'Gradient encoding maps position to k-space trajectories; FFT recovers the image. Spectral methods, wavelet denoise, and Kalman filters are signal-processing contrasts.',
  'fo-link':
    'TX–fiber–amplifier–RX. Full electric–optical–electric loop for BER and power budget; Friis/path η are abstract contrasts.',
  'fo-tx':
    'Semiconductor laser threshold and rate equations set side modes and chirp; electrical injection → stimulated photon flow.',
  'fo-fiber-guide':
    'Core–cladding TIR confines modes; index profile sets dispersion and loss. BPM / ABCD / ray optics are hands-on tools.',
  'fo-rx-dsp':
    'Photodiodes turn optical power into current; equalization, FFT spectra, and filtering fight dispersion and noise.',
  'ph-system':
    'Vibration coupling → piezo transduction → rectifier/PMIC → load or cap storage. Match impedance, duty, and average power—not peak open-circuit voltage.',
  'ph-structure':
    'Turn ambient acceleration into strain: resonant beams, proof masses, elastic PE buffers. Mechanical modes set the harvestable band.',
  'ph-transduction':
    'Strain changes electric dipole → charge separation between electrodes. d₃₃/d₃₁ and the load circuit jointly set instantaneous power.',
  'ph-power-cond':
    'AC piezo source through bridge rectification and cap filtering; impedance matching and synchronous switching raise average η.',
  'ph-material':
    'PZT perovskite domain switching and PVDF molecular dipoles; aging, depoling, and mechanical fatigue limit lifetime.',
}

