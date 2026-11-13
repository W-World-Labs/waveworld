# Deep-Research：统一转换模块图 —— 前人成果调研

> 来源：Claude Code deep-research workflow `wf_f4ad4c5c-d8b`（2026-06-20，waveworld 会话 4987b0db）  
> 流水线：规划 → 6 路搜索 → 24 路 claim 抽取 → 75 路 3-票对抗核实 → 综合。全部 findings 为 high confidence、3-0 一致裁决。

## TL;DR（综合结论）

There is a rich, mature body of work to borrow from, and the project should adopt rather than reinvent in three layers. (1) For the ENERGY channel, the canonical answer is port-based modeling / bond graphs / port-Hamiltonian (pH) systems: type each energy port by a (flow, effort) conjugate pair whose product is power, match ports on power conjugacy, and represent cross-domain transducers with exactly two ideal primitives — the transformer and gyrator — composed via Dirac structures that give a proven compositionality guarantee (interconnecting pH modules yields a pH system). The energy-domain I/O taxonomy itself is the long-standing six-domain (mechanical, thermal, electrical, magnetic, radiant, chemical) Middelhoek/NAP sensor matrix, with an orthogonal self-generating-vs-modulating dimension and explicit multi-step chaining through intermediate domains. (2) For the MATTER channel, adopt OntoCAPE's process-engineering conceptualization (materials, reactions, unit operations) and ingest OntoRXN, an openly-available OWL/RDF reaction-network ontology with a live SPARQL endpoint and a node/edge schema (species/stage/reaction-step) that maps directly onto a matter-conversion module graph. (3) For the INFORMATION channel and the generalized "one module type" abstraction, adopt the SSN/SOSA precedent (Sensor/Actuator/Sampler as subtypes of one System that implements a reusable Procedure) and the "sensors-as-information-transducers" ETP decomposition (four elemental processes C/D/M/P with per-step transfer functions) for the mechanism field. To ground conditions in first-principles limits, Exergetic Port-Hamiltonian Systems reinterpret the storage function as exergy, structurally encoding the second law. The main gap: no single existing framework unifies energy + matter + information in one composable port formalism — pH covers energy natively but treats information as power-less signals and matter only via the exergy/chemical-potential extension — so the project's novel contribution is the cross-channel unification, which it should build on top of these adopted pieces rather than from scratch.

> **关键缺口（= 本项目的新颖贡献）**：没有任何现成框架把 **能量+物质+信息** 统一进一个可组合的端口形式化里。
> port-Hamiltonian 原生只覆盖能量（信息=无功率信号键，物质仅靠 EPHS 㶲/化学势扩展）；物质本体(OntoCAPE/OntoRXN)与信息通道(SSN/SOSA, ETP)来自互不相通的社区。跨通道统一 = 我们要建的东西，应**架在下列已采纳件之上**，而非从零造。

## 核实统计

- 抽取 claim：24 组 ｜ 核实：75 条 ｜ ✅ 确认 **73** ｜ ❌ 推翻/受限 **2**

## 规划 angles

- **transducer taxonomy** — `transducer classification energy-domain conversion matrix sensor taxonomy review`
- **port formalism** — `bond graph port-Hamiltonian gyrator transformer transducer Modelica energy port`
- **matter process ontology** — `OntoCAPE process systems ontology chemical reaction network flowsheet stoichiometry DWSIM`
- **information sensor FoM** — `SSN SOSA semantic sensor ontology responsivity NEP detectivity Landauer`
- **reusable datasets** — `SAREF EMMO materials ontology energy device knowledge graph NREL NIST RDF OWL`
- **unifying theory** — `exergy information thermodynamics energy matter information Petri net process algebra`

## ✅ 10 条高置信采纳建议（findings，逐条带证据+出处）

### F1. 能量·分类  ·  confidence=high  ·  vote=5 claims, all 3-0

**Claim：** Adopt the six-domain energy-form taxonomy (mechanical, thermal, electrical, magnetic, radiant, chemical) as the energy I/O channel typing, with a 6x6 input(primary)->output(secondary) conversion matrix, an orthogonal self-generating-vs-modulating dimension, and explicit multi-step chaining through intermediate domains.

**Evidence：** The NAP 'Illustrative Sensor Taxonomy' states sensors are classified by 'the energy form in which signals are received and generated (mechanical, thermal, electrical, magnetic, radiant, or chemical)' and that 'both input and output signals can be in any one of these six forms of energy, giving rise to a six-by-six matrix of primary (input) and secondary (output) signals' (Table 1-3). A third orthogonal dimension distinguishes 'self-generating' transducers (no auxiliary power, e.g. thermocouple) from 'modulating' transducers (require auxiliary energy, e.g. strain gauge), preferred over passive/active. Middelhoek & Audet's textbook independently defines the identical six signal domains. Busch-Vishniac/Smart-Sensor-Systems show multi-step chaining: a thermal sensor 'first... transduced into a thermal signal, which is then transduced into the electrical output signal' — thermal is a common intermediate. CAVEAT: these are energy/signal domains for sensors converting INTO electrical; matter and information as separate channels are the project's own additions, not in Middelhoek; radiant/magnetic are arguably subsets of electromagnetic, so the six-domain set is a modeling convention.

**Sources：**
- https://nap.nationalacademies.org/read/4782/chapter/16
- https://link.springer.com/chapter/10.1007/978-1-4612-1434-2_1

### F2. 能量·形式化  ·  confidence=high  ·  vote=4 claims, all 3-0

**Claim：** Adopt port-based / port-Hamiltonian modeling as the unified energy formalism: energy/power is the 'lingua franca' across physical domains, each port carries a conjugate (flow f, effort e) pair whose product e^T f is instantaneous power, and ports compose only when these power variables match — directly giving the project's energy port schema (type by (flow,effort), match on power conjugacy).

**Evidence：** van der Schaft & Jeltsema (Foundations and Trends in Systems and Control, 2014): 'Port-based modeling is aimed at providing a unified framework for the modeling of systems belonging to different physical domains (mechanical, electrical, hydraulic, thermal, etc.)... by recognizing energy as the lingua franca between physical domains, and by identifying ideal system components (energy-storage, energy-dissipation, energy-routing).' Bonds carry 'pairs of variables, whose product equals power... voltages and currents, velocities and forces, flows and pressures.' Junction semantics (0-junction equates efforts, 1-junction equates flows, net zero power) implement port matching on power conjugacy. Lopezlena & Carrillo (IEEE Access 2020) confirm energy 'can be used as a common language to interconnect different port-Hamiltonian systems while maintaining the structure, even when they originate in different physical domains.' CAVEAT: pH is fundamentally energy/power-based; in its native form information appears only as power-less 'activated/signal bonds' and matter only via thermodynamic extensions — it validates the energy channel, not the matter/information channels.

**Sources：**
- https://people.math.ethz.ch/~hiptmair/Seminars/PHS_24/VSJ14.pdf
- https://www.researchgate.net/publication/342023174_Port-Hamiltonian_Modeling_of_Multiphysics_Systems_and_Object-Oriented_Implementation_With_the_Modelica_Language

### F3. 能量·原语  ·  confidence=high  ·  vote=3 claims, all 3-0

**Claim：** Use the two ideal two-port primitives — transformer (across->across, through->through) and gyrator (across->through) — as the canonical representation of any energy transducer; an ideal transducer is lossless+static+linear, making power conservation (P1+P2 = f1*v1 + f2*v2 = 0) an explicit algebraic constraint, and a domain-agnostic device table (motors/generators, rack-and-pinion, piezoelectric, magnetohydrodynamic, pumps/turbines) maps real converters onto these two primitives.

**Evidence：** MIT 2.14 handout (Rowell & Wormley, 'Linear Graph Modeling: Two-Port Energy Transducing Elements'): an ideal energy transduction is 'Lossless... Static — relationships between power variables are algebraic and independent of time,' and the lossless condition forces 'P1(t)+P2(t)=f1 v1 + f2 v2 = 0.' Imposing lossless+linear+static on the general 2x2 coupling matrix yields exactly two nontrivial power-transferring solutions: transformer (v1=TF*v2, f1=-(1/TF)*f2) and gyrator (v1=GY*f2, f1=-(1/GY)*v2) — 'the only nontrivial solutions with power transfer.' A device taxonomy maps physical transducers onto these (rack-and-pinion for translation<->rotation, motors/generators for electrical<->rotation, electromagnetic/piezoelectric for electrical<->translation, magnetohydrodynamic for electrical<->fluid, pumps/turbines for fluid<->rotation). Corroborated by Oregon State bond-graph notes. NUANCE: nonlinear/time-varying transducers use modulated MTF/MGY (same two forms, variable modulus) plus R/I/C storage; a transformer can be synthesized from two gyrators, so gyrator is arguably the single more-fundamental generator — but exactly two distinct ideal forms stands.

**Sources：**
- https://web.mit.edu/2.14/www/Handouts/TwoPorts.pdf

### F4. 能量·组合性  ·  confidence=high  ·  vote=4 claims (incl. one shared with EPHS), all 3-0

**Claim：** Adopt the Dirac-structure compositionality guarantee: module interconnection is power-conserving (<e|f>=0 for all (f,e) in D, dim D = dim F), composing Dirac structures yields another Dirac structure, so chaining port-Hamiltonian modules through their external ports again yields a port-Hamiltonian system — a rigorous compositionality guarantee for the project's module graph.

**Evidence：** van der Schaft & Jeltsema: 'compositions of Dirac structures are again Dirac structures. This has the crucial consequence that the power-conserving interconnection of port-Hamiltonian systems (through their external ports) is again a port-Hamiltonian system; a fundamental property for network modeling and control.' The canonical theorem (Cervera, van der Schaft & Banos, Automatica 2007): a Dirac structure is D⊂F×F* with D=D⊥; closure (D_A || D_B is a Dirac structure) is proven for finite-dimensional linear spaces with no separability precondition; the composed system has Dirac structure = composition, Hamiltonian = sum of Hamiltonians, resistive relations combined. Lohmayer et al. confirm 'Dirac structures model a power-conserving interconnection... since the net power e_i f_i vanishes due to skew-symmetry of J(x).' SCOPE CAVEAT: the clean closure theorem is for finite-dimensional constant (linear) Dirac structures — exactly the lumped module-graph case; manifold-modulated and infinite-dimensional Stokes-Dirac cases are subtler. A WebSearch claim that 'separability conditions matter' was a misreading (regularity is a separate property, not a precondition).

**Sources：**
- https://people.math.ethz.ch/~hiptmair/Seminars/PHS_24/VSJ14.pdf
- https://www.researchgate.net/publication/342023174_Port-Hamiltonian_Modeling_of_Multiphysics_Systems_and_Object-Oriented_Implementation_With_the_Modelica_Language
- https://arxiv.org/pdf/2008.04091

### F5. 能量·词汇/实现  ·  confidence=high  ·  vote=2 claims, all 3-0

**Claim：** Borrow the bond-graph typed diagrammatic vocabulary (storage / energy-routing(Dirac) / resistive-dissipative components) and the Modelica object-oriented implementation pattern (inheritance + composition for cross-domain component reuse) as the implementation substrate for the module graph.

**Evidence：** Lohmayer et al. (arXiv:2008.04091): 'physical systems are ultimately comprised of energy storage components, energy routing components, and (free) energy dissipating components,' where 'Dirac structures model reversible exchange of power, generalizing ideal wires,' with a typed color vocabulary (blue=storage, green=Dirac, red=resistive). Lopezlena & Carrillo (IEEE 2020) deliver a concrete Modelica library: 'A Modelica library with fundamental components for modeling a wide variety of multiphysics systems has been implemented,' where 'inheritance and composition of Modelica facilitate the modeling and reuse of components in different domains of Physics.' This gives the project both a node-typing scheme (storage/routing/dissipative) and a proven OO reuse pattern. CAVEAT: full Modelica component list could not be independently enumerated (IEEE/ResearchGate fetch blocked); only library existence + reuse mechanism are confirmed.

**Sources：**
- https://arxiv.org/pdf/2008.04091
- https://www.researchgate.net/publication/342023174_Port-Hamiltonian_Modeling_of_Multiphysics_Systems_and_Object-Oriented_Implementation_With_the_Modelica_Language

### F6. 能量·第一性原理  ·  confidence=high  ·  vote=1 claim, 3-0 (plus shared Dirac claim)

**Claim：** Ground module 'conditions' in first-principles thermodynamic limits using Exergetic Port-Hamiltonian Systems (EPHS): reinterpret the Hamiltonian/storage function as EXERGY (defined relative to a reference environment via energy, entropy, volume, mass, chemical potential), so the framework structurally encodes BOTH the first and second laws of thermodynamics, not just energy balance.

**Evidence：** Lohmayer, Kotyczka & Leyendecker (Math. and Computer Modelling of Dynamical Systems, 2021; arXiv:2008.04091): 'The Hamiltonian is traditionally thought of as energy, although its meaning is exergy,' and 'cyclo-passivity is synonymous with degradation of energy and follows from the first and the second law of thermodynamics being encoded as structural properties.' The exergy Hamiltonian is defined relative to reference-environment temperature/pressure/chemical-potential, so 'entropy appears next to energy.' This is an active research line (follow-ups arXiv:2402.17640 EPHS Modeling Language, 2402.18095, 2204.05135). Directly relevant: the reference-environment exergy formulation is exactly how the project can attach first-principles (Carnot/second-law/chemical-potential) limits to a module's conditions field. Coexists with (does not refute) Irreversible PHS and GENERIC.

**Sources：**
- https://arxiv.org/pdf/2008.04091

### F7. 信息·统一模块  ·  confidence=high  ·  vote=1 claim, 3-0

**Claim：** For the INFORMATION channel and the generalized single-module abstraction, adopt the SSN/SOSA ontology precedent: Sensor, Actuator, and Sampler are subtypes of one common 'System' abstraction that each 'implements' a reusable Procedure — a direct, W3C-standard precedent for treating sensors/generators/transducers/reactors as one generalized I/O module type with a pluggable mechanism.

**Evidence：** W3C SSN/SOSA Recommendation (https://www.w3.org/TR/vocab-ssn/): 'System is a unit of abstraction for pieces of infrastructure that implement Procedures,' with Sensor, Actuator, and Sampler each declared 'Sub class of ssn:System' and each carrying 'ssn:implements MIN 1' against a Procedure ('Relation between an entity that implements a Procedure in some executable way and the Procedure'). The 2023 edition specializes Procedure into ObservingProcedure/ActuatingProcedure/SamplingProcedure (still subclasses of one sosa:Procedure). Mapping for the project: System = generalized conversion module; implements-Procedure = the mechanism abstraction. Highest source quality (W3C Recommendation + OGC standard), current. CAVEAT: the 'one generalized I/O module type for reactors too' is the project's analogical extension; SSN itself only covers sensor/actuator/sampler.

**Sources：**
- https://www.w3.org/TR/vocab-ssn/

### F8. 信息·机理  ·  confidence=high  ·  vote=2 claims, all 3-0

**Claim：** For the mechanism field and sequential composition, adopt the 'sensors-as-information-transducers' framework: each transducer decomposes into a sequence of four elemental transduction processes (ETPs) — energy conversion (C), dispersion (D), modulation (M), modulation of a material/physical property (P) — each with its own transfer function, response-time, distortion and nonlinearity; sensing is information transduction subject to the data-processing inequality (cannot add information).

**Evidence：** Zook & Schroeder, 'Sensors as Information Transducers' (Encyclopedia of Sensors, 2008; arXiv:0804.0814): 'We identify four distinct ETPs: energy conversion (C), energy dispersion (D), energy modulation (M) and modulation of a material property (P)... a complete set for describing information transduction in sensing systems' (posited, not proven). 'The flow of information through a sensing subsystem is a sequence of identifiable steps which we call elemental transduction processes'; concrete sequences given (thermistor=PM, silicon pressure transducer=C-PM, video camera=M-D-D-C). Each ETP has 'a transfer function relating output to input, response-time behavior, distortion, nonlinear behavior.' Glossary: 'Information transduction: the mapping or transformation of information from one form to another. Usually the form of energy that carries the information is transformed.' The paper explicitly invokes the data-processing inequality: 'Sensing cannot add information but can only reduce the amount of information available.' This validates both the mechanism field (ETP sequence) and transfer-function/port semantics for the information channel.

**Sources：**
- https://arxiv.org/pdf/0804.0814

### F9. 物质·本体  ·  confidence=high  ·  vote=2 claims, all 3-0

**Claim：** For the MATTER channel, borrow OntoCAPE's mature process-engineering conceptualization: a formal, large-scale, reusable, machine-interpretable ontology (62 sub-ontologies, layered) whose general upper layers (mereotopology, systems theory, quantities/units) sit above lower layers conceptualizing materials, chemical reactions, and unit operations — i.e. the substances/stoichiometry/process-unit primitives the matter channel needs.

**Evidence：** Morbach, Wiesner & Marquardt, 'OntoCAPE — A (re)usable ontology for computer-aided process engineering' (Computers & Chemical Engineering, 2009): 'OntoCAPE is a large-scale ontology for the domain of Computer-Aided Process Engineering (CAPE),' represented in a formal machine-interpretable ontology language, partitioned into 62 sub-ontologies, with upper layers as an upper ontology ('mereotopology, systems theory, quantities and units') and 'lower layers conceptualize the domain of chemical process engineering, covering domain-specific topics such as materials, chemical reactions, or unit operations.' Companion title: 'OntoCAPE — A large-scale ontology for chemical process engineering.' ~15 years of established use, free download from RWTH Aachen. CAVEAT: chemical-process-centric; its quantities/units and systems-theory upper layers are the most directly reusable cross-domain piece, the matter-conversion primitives map to its reaction/material/unit-operation lower layers.

**Sources：**
- https://www.sciencedirect.com/science/article/abs/pii/S0098135409000362

### F10. 物质·反应网络  ·  confidence=high  ·  vote=2 claims, all 3-0

**Claim：** Directly ingest OntoRXN as the matter-channel reaction-network schema: an openly-available OWL/RDF ontology (GitLab + ontorxn-tools + live Blazegraph SPARQL endpoint) that models chemical reaction networks as undirected graphs from computational chemistry, organized around four core classes (CompCalculation, ChemSpecies, NetworkStage, ReactionStep) — a node/edge schema directly analogous to a matter-conversion module graph.

**Evidence：** Garay-Ruiz & Bo, 'Chemical reaction network knowledge graphs: the OntoRXN ontology' (Journal of Cheminformatics, 2022; PMC9153116): uses 'the OWL (Web Ontology Language) format, an ontology-oriented extension of RDF'; 'The OntoRXN ontology and the ontorxn-tools library are both available at GitLab' (https://gitlab.com/dgarayr/ontorxn, live/public); 'a custom RDF database and SPARQL endpoint has been set up as a web service' (Blazegraph). Networks 'are handled as undirected graphs, without assuming any traversal direction,' built on OntoCompChem + ioChem-BD (parsing Gaussian/ADF/VASP/MOLCAS/ORCA). Four core classes: CompCalculation (computational data store), ChemSpecies (molecules AND transition states), NetworkStage (structures considered together), ReactionStep (two linked intermediates + transition state). Node=species/stage, edge=reaction-step maps onto a matter-conversion module graph. Directly reusable/ingestable as a KG schema (OWL file + Python tooling + SPARQL all open).

**Sources：**
- https://pmc.ncbi.nlm.nih.gov/articles/PMC9153116/

## 搜索覆盖到的权威源（URL）

- [Semantic Sensor Network Ontology (W3C Recommendation / OGC standard)](https://www.w3.org/TR/vocab-ssn/) — high 
- [Semantic Sensor Network Ontology - 2023 Edition (incl. SSN-System module)](https://w3c.github.io/sdw-sosa-ssn/ssn/) — high 
- [Specific detectivity (D*) — definition and relation to NEP/responsivity](https://en.wikipedia.org/wiki/Specific_detectivity) — high 
- [How to characterize figures of merit of two-dimensional photodetectors (review)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10115793/) — high 
- [Appendix E: Figures of Merit for Infrared Photodetectors (National Academies Press)](https://nap.nationalacademies.org/read/4782/chapter/18) — medium 
- [Experimental verification of Landauer's principle linking information and thermodynamics (Nature)](https://www.nature.com/articles/nature10872) — high 

- [Exergetic Port-Hamiltonian Systems Modeling Language (arXiv 2402.17640)](https://arxiv.org/pdf/2402.17640) — high 
- [Petri Nets – A Mathematical Formalism to Analyze Chemical Reaction Networks (Koch, 2010, Molecular Informatics)](https://onlinelibrary.wiley.com/doi/10.1002/minf.201000086) — high 
- [Hierarchical Structure of Generalized Thermodynamic and Informational Entropy (Entropy / PMC7513077)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7513077/) — high 
- [Exergy Concept overview — exergy of energy, material and information (ScienceDirect Topics)](https://www.sciencedirect.com/topics/engineering/exergy-concept) — high 
- [Geometric decomposition of information flow: New insights into information thermodynamics (arXiv 2509.21985)](https://arxiv.org/pdf/2509.21985) — medium 
- [Landauer's principle (Wikipedia)](https://en.wikipedia.org/wiki/Landauer's_principle) — medium 

- [OntoCAPE — A (re)usable ontology for computer-aided process engineering (Comput. Chem. Eng.)](https://www.sciencedirect.com/science/article/abs/pii/S0098135409000362) — high 
- [OntoCAPE — A large-scale ontology for chemical process engineering (Eng. Appl. Artif. Intell.)](https://www.sciencedirect.com/science/article/abs/pii/S0952197606001199) — high 
- [Chemical reaction network knowledge graphs: the OntoRXN ontology (J. Cheminformatics, 2022)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9153116/) — high 
- [OntoCAPE (Wikipedia overview)](https://en.wikipedia.org/wiki/OntoCAPE) — medium 
- [Learning from flowsheets — CAPE-OPEN Laboratories Network (CO-LaN)](https://www.colan.org/presentation/learning-from-flowsheets/) — medium 
- [ChemOntology: A Reusable Explicit Chemical Ontology-Based Method to Expedite Reaction Path Searches (ACS Catalysis)](https://pubs.acs.org/doi/10.1021/acscatal.5c06298) — medium 

- [Port-Hamiltonian Systems Theory: An Introductory Overview (van der Schaft & Jeltsema)](https://people.math.ethz.ch/~hiptmair/Seminars/PHS_24/VSJ14.pdf) — high 
- [Port-Hamiltonian Modeling of Multiphysics Systems and Object-Oriented Implementation With the Modelica Language](https://www.researchgate.net/publication/342023174_Port-Hamiltonian_Modeling_of_Multiphysics_Systems_and_Object-Oriented_Implementation_With_the_Modelica_Language) — high 
- [Linear Graph Modeling: Two-Port Energy Transducing Elements (MIT 2.14)](https://web.mit.edu/2.14/www/Handouts/TwoPorts.pdf) — high 
- [Exergetic Port-Hamiltonian Systems: Modelling Basics](https://arxiv.org/pdf/2008.04091) — high 
- [Automated Generation of Explicit Port-Hamiltonian Models from Multi-Bond Graphs](https://arxiv.org/pdf/1909.02848) — medium 
- [Port-Hamiltonian systems with energy and power ports (van der Schaft et al.)](https://www.sciencedirect.com/science/article/pii/S240589632401036X) — medium 

- [Appendix C: An Illustrative Sensor Taxonomy — Expanding the Vision of Sensor Materials (National Academies Press)](https://nap.nationalacademies.org/read/4782/chapter/16) — high 
- [Introduction — Silicon Sensors and Microstructures / Middelhoek & Audet (Springer)](https://link.springer.com/chapter/10.1007/978-1-4612-1434-2_1) — high 
- [Sensors as Information Transducers (arXiv 0804.0814)](https://arxiv.org/pdf/0804.0814) — high 
- [A Comprehensive Sensor Taxonomy and Semantic Knowledge Representation: Energy Meter Use Case (ResearchGate)](https://www.researchgate.net/publication/263602404_A_comprehensive_sensor_taxonomy_and_semantic_knowledge_representation_Energy_meter_use_case) — medium 
- [Thermodynamics of Sensors (Sensors and Actuators, ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/0250687489870167) — medium 
- [Integrated Spectral Sensitivity as a Physics-Based Figure of Merit for Spectral Transducers in Optical Sensing (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11768777/) — low 

- [SAREF4ENER — SAREF for Energy Flexibility (ETSI OWL ontology)](https://saref.etsi.org/saref4ener/v2.1.1/) — high 
- [Battery testing ontology: an EMMO-based semantic framework (RDF/OWL)](https://www.sciencedirect.com/science/article/pii/S0166361524001313) — high 
- [NREL/PV — Solar Cell Efficiency Tables (Version 64)](https://docs.nrel.gov/docs/fy24osti/90199.pdf) — medium 
- [Extensions to the SSN Ontology (system capabilities, conditions, properties)](https://www.w3.org/TR/vocab-ssn-ext/) — medium 

## ⚠️ 缺口 / 未核实项（= 下一轮该追的）

### Caveats

SCOPE OF EVIDENCE: The verified corpus is strong on the ENERGY channel (port-Hamiltonian / bond graph / transformer-gyrator / Dirac compositionality — multiple top-tier primary sources, all unanimous) and gives solid concrete anchors for MATTER (OntoCAPE, OntoRXN) and a good precedent for the generalized module + INFORMATION channel (SSN/SOSA, Zook-Schroeder ETPs). However, several items the research question explicitly asked about were NOT covered by surviving verified claims and remain unconfirmed here: SAREF/SAREF4ENER energy ontologies; EMMO (European Materials Modelling Ontology); NIST thermochemical databases; NREL device-efficiency database; signal flow graphs; concrete sensor figure-of-merit standards (responsivity, NEP, D*); Landauer/information-thermodynamics quantitative limits; SysML; Petri-net/process-algebra formalisms for transformation networks; and general chemical reaction network (CRN) theory and flowsheet tools (Aspen/DWSIM). Absence here means "not verified in this run," not "does not exist or is irrelevant" — these are precisely the items to chase in a follow-up.

SOURCE-QUALITY/ACCESS NOTES: Two key sources (the IEEE/Modelica paper and MIT 2.14 handout) could not be machine-fetched directly (IEEE/ResearchGate 403; MIT Akamai 403; ScienceDirect OntoCAPE paywalled) and were verified via exact-phrase search + independent mirrors/corroboration — the load-bearing quotes are confirmed but full-text component enumeration for the Modelica library is not.

TIME-SENSITIVITY: The six-domain sensor taxonomy (NAP 1995, Middelhoek 1989) is old but definitional and stable. Port-Hamiltonian/Dirac theory is mature (1961-2014) and uncontested. EPHS and the EPHS modeling language are an ACTIVELY MOVING research line (2020-2026) — adopt the concept but expect the formalism/tooling to still be evolving. SSN/SOSA has a 2023 edition that added per-type Procedure specializations.

INTERPRETIVE BRIDGES: Several "directly analogous to the project" / "directly usable as I/O channel taxonomy" framings are the claim authors' mappings onto the WaveWorld project, not statements in the sources. They are reasonable but should be treated as design recommendations, not established facts. Critically, NONE of the sources unify energy + matter + information in one formalism: pH/bond-graph natively covers energy only (information = power-less signal bonds; matter only via the exergy/chemical-potential EPHS extension); the matter ontologies (OntoCAPE/OntoRXN) and the information precedent (SSN/SOSA, ETPs) come from disjoint communities. The cross-channel unification is the project's genuine novel contribution, not something to be ingested wholesale.

### Open questions

- Is there an existing single formalism or ontology that genuinely co-models energy + matter + information in one composable port abstraction, or must the project bridge port-Hamiltonian (energy) + CRN/OntoCAPE-OntoRXN (matter) + SSN-SOSA/ETP (information) itself? (No surviving claim found a unified one — this appears to be the project's core gap and contribution.)
- For the INFORMATION channel's figures of merit and first-principles limits: which concrete standards (responsivity, NEP, D*) and quantitative bounds (Landauer kT ln2, data-processing inequality, channel capacity) should typify the information port, and is there a machine-readable schema for them? (Asked in the research goal but not covered by verified claims.)
- Are SAREF/SAREF4ENER, EMMO, NIST thermochemistry, and NREL device-efficiency databases directly ingestable (do they ship reusable RDF/OWL schemas or structured efficiency data), and how do they align with OntoCAPE/OntoRXN to avoid duplicate matter/energy modeling? (Explicitly requested but unverified in this run.)
- How should module 'conditions' (environment/operating regime) be structured so they both (a) gate port compatibility/composition and (b) attach to first-principles limits — e.g. EPHS reference-environment (T,p,chemical potential) for energy/matter — and is there a Petri-net or process-algebra layer better suited than Dirac-structure composition for the matter and information channels where power-conservation is not the binding constraint?
---

## 第二轮：缺口补齐（深挖 journal 原始 claim/核实）

综合报告的 caveats 把若干项标为「本轮未核实」——但深挖 24 路 claim 抽取 + 75 路核实的原始日志后，**发现多数其实有核实数据**（只是没进 top-10 综合）。已全部逐个落进 `src/lib/module-graph/` 第二轮（6 新文件 + 30 测试，全绿）：

| 缺口项 | journal claim-group | 落地文件 | 核实状态 |
|---|---|---|---|
| 传感器 FoM（responsivity/NEP/D*/BLIP 1.8e10 Jones/QE） | 0/2/5 | `sensing.ts` | ✅ 已核实 |
| Landauer 定量（kT·ln2，300K=2.87e-21J=0.018eV，2016 纳磁实验 4.2e-21J） | 3/7 | `sensing.ts`+`information.ts` | ✅ 已核实 |
| Shannon 信道容量 + 传感器 bit-rate（Gaussian 广播信道） | 22 | `information.ts` | ✅ 已核实 |
| Petri 网（place=species/关联阵=计量矩阵/P-不变量=守恒/T-不变量=稳态环） | 11 | `petri.ts` | ✅ 已核实 |
| CRN + port-Hamiltonian 桥（ẋ=Sv，S=ZB，H=Gibbs） | 17 | `crn.ts` | ✅ 已核实 |
| SAREF/SAREF4ENER（PowerLimit 族/时间约束；**不**采纳其设备模型） | 4/20 | `ontologies.ts` | ✅ 已核实 |
| EMMO 生态（BTO/CHAMEO/BDO/EDO 分层，RDF/OWL ingest 模式） | 23 | `ontologies.ts` | ✅ 已核实 |
| 信号流图 Mason 增益 | — | `signal-flow.ts` | ⚠️ 本轮未核实（学界公认成熟，待下轮） |
| NIST 热化学 / NREL 效率 / SysML | — | `ontologies.ts` DATA_SOURCES | ⚠️ 本轮未核实（仅登记 ingest 指针） |

**关键发现（claim-group 17）**：port-Hamiltonian 形式化**直接扩展到物质/化学通道**——isothermal mass-action CRN 的动力学 ẋ=S·v(x) 天然是 pH 系统，Hamiltonian=Gibbs 自由能。这意味着**物质通道可复用能量通道同一套 (flow,effort)/Dirac/Transformer-Gyrator 形式化**，不必另起一套——只把 Hamiltonian 从「储能」换成「Gibbs」，flow=反应速率，effort=化学势差。守恒律由 S 的左零空间（Petri P-不变量）结构化编码。

**SAREF 采纳决策**：SAREF4ENER 显式「不」按端口/I-O 通道建模（用 FlexibilityProfile/PowerProfile/PowerSequence），与我们的 pH 端口 + SSN/SOSA System 冲突——故**只**借其 PowerLimit/PowerConstraint/时间约束词汇挂到 conditions 的调度/柔性面，**不**采纳其设备模型。

仅余 4 项真未核实（信号流图 Mason、NIST、NREL、SysML），已固化为 `DATA_SOURCES` 里的 `verified:false` 指针，留待第三轮。
