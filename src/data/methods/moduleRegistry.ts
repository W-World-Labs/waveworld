/**
 * Unified compute module registry: method algorithm ids → pure sample runners.
 * Wires the METHODS catalog to existing *-algos cores without editing methods.data.
 */
import { methodById } from './methods'

import {
  runSeriesRlcSample,
  runRcTransientSample,
  runMutualSample,
  LUMPED_PARENT_METHOD_ID,
} from '../../lib/sim/circuit-algos'
import { runEulerRlcSample } from '../../lib/sim/circuit-l2-algos'
import { runEnergyMonitorSample, runCflSample } from '../../lib/sim/fdtd-l2-algos'
import {
  runLjPairSample,
  runVelocityVerletSample,
  runRescaleThermostatSample,
  runHomogForceSample,
  MD_PARENT_METHOD_ID,
} from '../../lib/sim/md-algos'
import {
  runYeeUpdateSample,
  runSourceSample,
  runBoundaryParallel,
  FDTD_PARENT,
} from '../../lib/sim/fdtd-algos'
import {
  runProjectSample,
  runAdvectSample,
  runDiffuseSample,
  FLUID_PARENT,
} from '../../lib/sim/fluid-algos'
import {
  runProposeSample,
  runMetropolisSweepSample,
  runOnsagerSample,
  compareIsingParallels,
  runHeatbathSample,
  MC_PARENT,
} from '../../lib/sim/mc-algos'
import {
  runArrayFactorSample,
  runBeamwidthSample,
  runFriisSample,
  runPatternSample,
  ARRAY_PARENT,
} from '../../lib/sim/array-algos'
import {
  runReflectionSample,
  runAlineSample,
  US_PARENT,
} from '../../lib/sim/us-algos'
import {
  runTunnelSample,
  runConstHeightSample,
  runConstCurrentSample,
  runAfmForceSample,
  SPM_PARENT,
} from '../../lib/sim/spm-algos'
import {
  runTrilaterationSample,
  runTdoaSample,
  LOC_PARENT,
} from '../../lib/sim/loc-algos'
import {
  runPolySample,
  runClassifySample,
  NLJD_PARENT,
} from '../../lib/sim/nljd-algos'
import {
  runThresholdSample,
  runSteadySample,
  runStepSample,
  LASER_PARENT,
} from '../../lib/sim/laser-algos'
import {
  runLaplacianSineSample,
  runWaveCflSample,
  WAVE_PARENT,
} from '../../lib/sim/wave-algos'
import { Wave } from '../../lib/sim/wave'
import {
  runBandgapSample,
  runMalusSample,
  runOledMixSample,
  DISPLAY_PARENT,
} from '../../lib/sim/display-algos'
import {
  runPathSearchSample,
  runPathMcSample,
  runPathDijkstraSample,
  runEnergyTokenChainSample,
  runPueSample,
  runTokenThroughputSample,
  META_PATH_PARENT,
  META_TOKEN_PARENT,
} from '../../lib/sim/meta-algos'
import {
  runSnellSample,
  runDftPeakSample,
  runKalman1dSample,
  runFemPoisson1dSample,
  runLbmD1q3Sample,
  runBemGreenSample,
  runPicCicSample,
  runDftElectronicSample,
  METHOD_RAY_OPTICS,
  METHOD_SPECTRAL,
  METHOD_KALMAN,
  METHOD_FEM,
  METHOD_LBM,
  METHOD_BEM,
  METHOD_PIC,
  METHOD_DFT_ELECTRONIC,
} from '../../lib/sim/research-algos'
import {
  runHeatFtcsConserve,
  runErfcProfileSample,
  HEAT_PARENT,
} from '../../lib/sim/heat-algos'
import { runImplicitHeatSample } from '../../lib/sim/heat-l2-algos'
import { runCrankNicolsonSample } from '../../lib/sim/heat-l3-algos'
import { runLevelsetAdvectSample } from '../../lib/sim/levelset-l2-algos'
import { runLevelsetCurvatureSample } from '../../lib/sim/levelset-l3-algos'
import { runFvmLimiterSample } from '../../lib/sim/fvm-l2-algos'
import { runFvmHllcSample } from '../../lib/sim/fvm-l3-algos'
import { runUkfSigmaSample } from '../../lib/sim/ukf-algos'
import { runMonolithicResidualSample } from '../../lib/sim/multiphysics-l2-algos'
import { runExergyEfficiencySample } from '../../lib/sim/exergy-l3-algos'
import { runIbmSpreadInterpSample } from '../../lib/sim/ibm-l2-algos'
import { runBorisPushSample } from '../../lib/sim/pic-l3-algos'
import { runSemLumpedMassSample } from '../../lib/sim/sem-l2-algos'
import {
  runSphCubicSplineSample,
  runSphDensitySumSample,
  METHOD_SPH,
} from '../../lib/sim/sph-algos'
import {
  runNoseHooverSample,
  runCellListSample,
  MD_L3_PARENT,
} from '../../lib/sim/md-l3-algos'
import { runLevelsetReinitSample } from '../../lib/sim/levelset-l4-algos'
import { runFvmRoeSample } from '../../lib/sim/fvm-l4-algos'
import {
  runDemLinearSpringSample,
  runDemHertzSample,
  METHOD_DEM,
} from '../../lib/sim/dem-algos'
import {
  runSphPressureForceSample,
  runSphArtViscSample,
} from '../../lib/sim/sph-l2-algos'
import {
  runMpmPicTransferSample,
  runMpmG2pSample,
  METHOD_MPM,
} from '../../lib/sim/mpm-algos'
import {
  runDgMassLocalSample,
  runDgUpwindFluxSample,
  METHOD_DG,
} from '../../lib/sim/dg-algos'
import {
  runVlasovStreamSample,
  runVlasovPoisson1dSample,
  METHOD_VLASOV,
} from '../../lib/sim/vlasov-algos'
import { runDemCoulombSample } from '../../lib/sim/dem-l2-algos'
import { runFvmWeno3Sample } from '../../lib/sim/fvm-weno-algos'
import { runFdtdConductivitySample } from '../../lib/sim/fdtd-l3-algos'
import {
  runAllenCahnSample,
  runCahnHilliardChemSample,
  METHOD_PHASEFIELD,
} from '../../lib/sim/phasefield-algos'
import {
  runPdBondForceSample,
  runPdDilatationSample,
  METHOD_PERIDYNAMICS,
} from '../../lib/sim/peridynamics-algos'
import {
  runLbmBounceBackSample,
  runLbmMrtStubSample,
  LBM_L3_PARENT,
} from '../../lib/sim/lbm-l3-algos'
import { runFemCgSample, FEM_L3_PARENT } from '../../lib/sim/fem-l3-algos'
import { runMpmUslStressSample } from '../../lib/sim/mpm-l2-algos'
import { runDgSlopeLimitSample } from '../../lib/sim/dg-l2-algos'
import { runWaveletHardThreshSample } from '../../lib/sim/wavelet-l2-algos'
import { runPseudospectralDiffSample } from '../../lib/sim/spectral-l3-algos'
import {
  runTmmLayerSample,
  runTmmStackSample,
  METHOD_TMM,
} from '../../lib/sim/tmm-algos'
import {
  runMgRestrictSample,
  runMgVcycleSample,
  METHOD_MULTIGRID,
} from '../../lib/sim/multigrid-algos'
import {
  runBpmSplitStepSample,
  METHOD_BPM,
} from '../../lib/sim/bpm-algos'
import { runFdtdCpmlSample } from '../../lib/sim/fdtd-l4-algos'
import { runPfSystematicSample } from '../../lib/sim/pf-l3-algos'
import {
  runGmresSample,
  METHOD_GMRES,
} from '../../lib/sim/gmres-algos'
import { runPfMobilitySample } from '../../lib/sim/phasefield-l2-algos'
import { runVlasovAccelSample } from '../../lib/sim/vlasov-l2-algos'
import {
  runTdseSplitSample,
  runTdseProbSample,
  METHOD_SCHRODINGER,
} from '../../lib/sim/schrodinger-algos'
import {
  runRbfGaussSample,
  runRbfInterpSample,
  METHOD_RBF,
} from '../../lib/sim/rbf-algos'
import {
  runLieTrotterSample,
  runStrangSample,
  METHOD_SPLITTING,
} from '../../lib/sim/splitting-algos'
import {
  runBicgstabSample,
  METHOD_BICGSTAB,
} from '../../lib/sim/bicgstab-algos'
import { runBpmKerrSample } from '../../lib/sim/bpm-l2-algos'
import {
  runHelmholtzFdSample,
  METHOD_HELMHOLTZ,
} from '../../lib/sim/helmholtz-algos'
import {
  runMcrtWalkSample,
  METHOD_MCRT,
} from '../../lib/sim/mcrt-algos'
import {
  runRk4Sample,
  METHOD_RK,
} from '../../lib/sim/rk-algos'
import {
  runKmcRatesSample,
  runKmcStepSample,
  METHOD_KMC,
} from '../../lib/sim/kmc-algos'
import {
  runMomImpedanceSample,
  runMomSolveSample,
  METHOD_MOM,
} from '../../lib/sim/mom-algos'
import {
  runPinnResidualSample,
  METHOD_PINN,
} from '../../lib/sim/pinn-algos'
import {
  runPeSsfSample,
  METHOD_PE,
} from '../../lib/sim/pe-algos'
import { runTdseImagSample } from '../../lib/sim/schrodinger-l2-algos'
import { runMgWcycleSample } from '../../lib/sim/multigrid-l2-algos'
import {
  runHomogSeriesSample,
  runHomogParallelSample,
  METHOD_HOMOGENIZATION,
} from '../../lib/sim/homogenization-algos'
import {
  runPidStepSample,
  METHOD_PID,
} from '../../lib/sim/pid-algos'
import {
  runAdiHeatSample,
  runAdiSweepSample,
  METHOD_ADI,
} from '../../lib/sim/adi-algos'
import {
  runShootLinearSample,
  runShootSecantSample,
  METHOD_SHOOTING,
} from '../../lib/sim/shooting-algos'
import {
  runLqrRiccatiSample,
  METHOD_LQR,
} from '../../lib/sim/lqr-algos'
import {
  runCsrSpmvSample,
  runJacobiIterSample,
  METHOD_SPARSE,
} from '../../lib/sim/sparse-algos'
import {
  runBfgsUpdateSample,
  METHOD_BFGS,
} from '../../lib/sim/bfgs-algos'
import {
  runHppCollideSample,
  runHppStreamSample,
  METHOD_LATTICE_GAS,
} from '../../lib/sim/latticegas-algos'
import {
  runNystromQuadSample,
  METHOD_NYSTROM,
} from '../../lib/sim/nystrom-algos'
import {
  runConvDftSample,
  METHOD_CONVOLUTION,
} from '../../lib/sim/convolution-algos'
import {
  runPodSvdSample,
  runPodProjectSample,
  METHOD_POD,
} from '../../lib/sim/pod-algos'
import {
  runNmSimplexSample,
  METHOD_NELDER_MEAD,
} from '../../lib/sim/neldermead-algos'
import {
  runFftRadix2Sample,
  METHOD_FFT,
} from '../../lib/sim/fft-radix2-algos'
import {
  runBdf2Sample,
  METHOD_BDF,
} from '../../lib/sim/bdf-algos'
import {
  runChebCollocSample,
  METHOD_COLLOCATION,
} from '../../lib/sim/collocation-algos'
import {
  runSaStepSample,
  METHOD_SA,
} from '../../lib/sim/sa-algos'
import {
  runGaGenerationSample,
  METHOD_GA,
} from '../../lib/sim/ga-algos'
import {
  runUqMcSample,
  METHOD_UQ,
} from '../../lib/sim/uq-algos'
import {
  runTrCauchySample,
  METHOD_TRUST_REGION,
} from '../../lib/sim/trustregion-algos'
import {
  runPsoStepSample,
  METHOD_PSO,
} from '../../lib/sim/pso-algos'
import {
  runAdForwardSample,
  METHOD_AD,
} from '../../lib/sim/ad-algos'
import {
  runLanczosEigSample,
  METHOD_LANCZOS,
} from '../../lib/sim/lanczos-algos'
import {
  runMhSample,
  METHOD_MCMC,
} from '../../lib/sim/mcmc-algos'
import {
  runEmGmmSample,
  METHOD_EM,
} from '../../lib/sim/em-algos'
import { runRtsSmoothSample } from '../../lib/sim/rts-algos'
import {
  runCwtMexhatSample,
  METHOD_CWT,
} from '../../lib/sim/cwt-algos'
import {
  runBnbSample,
  METHOD_ILP,
} from '../../lib/sim/ilp-algos'
import {
  runSimplexSample,
  METHOD_LP,
} from '../../lib/sim/simplex-lp-algos'
import {
  runSqLimitSample,
  METHOD_SQ,
} from '../../lib/sim/shockley-queisser-algos'
import {
  runBatteryOcvSample,
  runBatteryRintSample,
  METHOD_BATTERY,
} from '../../lib/sim/battery-algos'
import {
  runBlochPrecessSample,
  METHOD_BLOCH,
} from '../../lib/sim/bloch-algos'
import {
  runFiberAttenSample,
  runFiberDispersionSample,
  METHOD_FIBER,
} from '../../lib/sim/fiber-algos'
import {
  runPiezoDirectSample,
  runPiezoConverseSample,
  METHOD_PIEZO,
} from '../../lib/sim/piezo-algos'
import {
  runRankineEtaSample,
  METHOD_RANKINE,
} from '../../lib/sim/rankine-algos'
import {
  runSeebeckVSample,
  runZTSample,
  METHOD_SEEBECK,
} from '../../lib/sim/seebeck-algos'
import {
  runBetzSample,
  runWindPowerSample,
  METHOD_WIND,
} from '../../lib/sim/wind-algos'
import {
  runNernstSample,
  runFcPolarizationSample,
  METHOD_FUELCELL,
} from '../../lib/sim/fuelcell-algos'
import {
  runShockleyDiodeSample,
  METHOD_DIODE,
} from '../../lib/sim/diode-eq-algos'
import {
  runStefanSample,
  METHOD_STEFAN,
} from '../../lib/sim/stefan-boltzmann-algos'
import {
  runReflectionGammaSample,
  METHOD_ZMATCH,
} from '../../lib/sim/impedance-match-algos'
import {
  runSmithChartSample,
  METHOD_ALGO_SMITH_CHART,
} from '../../lib/sim/smith-chart'
import {
  runNodeDutyBudgetSample,
  METHOD_NODE_BUDGET,
  METHOD_ALGO_NODE_DUTY,
} from '../../lib/nodeEnergyBudget'
import {
  runEdgeSelfPowerChainSample,
  METHOD_ALGO_EDGE_SELF_POWER_CHAIN,
} from '../../lib/edgeSelfPowerChain'
import {
  runResearch2026ClaimsSample,
  METHOD_ALGO_RESEARCH_2026,
} from '../../lib/research2026Calcs'
import {
  runCarnotEtaSample,
  runOttoEtaSample,
  METHOD_CARNOT,
  METHOD_OTTO,
} from '../../lib/sim/carnot-otto-algos'
import {
  runHallVoltageSample,
  METHOD_HALL,
} from '../../lib/sim/hall-algos'
import {
  runHydroPowerSample,
  runHydroHeadSample,
  METHOD_HYDRO,
} from '../../lib/sim/hydro-algos'
import {
  runPaPressureSample,
  METHOD_PA,
} from '../../lib/sim/photoacoustic-core-algos'
import {
  runMceDeltaTSample,
  METHOD_MCE,
} from '../../lib/sim/magnetocaloric-algos'
import {
  runComptonShiftSample,
  METHOD_COMPTON,
} from '../../lib/sim/compton-algos'
import {
  runMhdEmfSample,
  METHOD_MHD,
} from '../../lib/sim/mhd-faraday-algos'
import {
  runFresnelRSample,
  METHOD_FRESNEL,
} from '../../lib/sim/fresnel-snell-algos'
import {
  runJtMuSample,
  METHOD_JT,
} from '../../lib/sim/joule-thomson-algos'
import {
  runThomsonHeatSample,
  METHOD_THOMSON,
} from '../../lib/sim/thomson-thermoelectric-algos'
import {
  runDieselEtaSample,
  METHOD_DIESEL,
} from '../../lib/sim/diesel-cycle-algos'
import {
  runElectrostrictStrainSample,
  METHOD_ELECTROSTRICT,
} from '../../lib/sim/electrostriction-algos'
import {
  runFaradayThetaSample,
  METHOD_FARADAY_ROT,
} from '../../lib/sim/faraday-rotation-algos'
import {
  runRamanShiftSample,
  METHOD_RAMAN,
} from '../../lib/sim/raman-algos'
import {
  runProPowerSample,
  METHOD_PRO,
} from '../../lib/sim/osmotic-power-algos'
import {
  runRichardsonSample,
  METHOD_THERMIONIC,
} from '../../lib/sim/richardson-thermionic-algos'
import {
  runPockelsDnSample,
  METHOD_POCKELS,
} from '../../lib/sim/pockels-algos'
import {
  runBrillouinShiftSample,
  METHOD_BRILLOUIN,
} from '../../lib/sim/brillouin-algos'
import {
  runBeerAbsorbanceSample,
  METHOD_BEER,
} from '../../lib/sim/beer-lambert-algos'
import {
  runArrheniusKSample,
  METHOD_ARRHENIUS,
} from '../../lib/sim/arrhenius-algos'
import {
  runFickFluxSample,
  METHOD_FICK,
} from '../../lib/sim/fick-diffusion-algos'
import {
  runFourierFluxSample,
  METHOD_FOURIER,
} from '../../lib/sim/fourier-heat-algos'
import {
  runRhPressureSample,
  METHOD_RH,
} from '../../lib/sim/rankine-hugoniot-algos'
import {
  runWienPeakSample,
  runPlanckBSample,
  METHOD_WIEN,
  METHOD_PLANCK,
} from '../../lib/sim/wien-planck-algos'
import {
  runJohnsonVrmsSample,
  METHOD_JOHNSON,
} from '../../lib/sim/johnson-nyquist-algos'
import {
  runAvPowerSample,
  METHOD_ALPHAVOLTAIC,
} from '../../lib/sim/alphavoltaic-algos'
import {
  runBernoulliSample,
  METHOD_BERNOULLI,
} from '../../lib/sim/bernoulli-algos'
import {
  runPoiseuilleQSample,
  METHOD_POISEUILLE,
} from '../../lib/sim/poiseuille-algos'
import {
  runStokesForceSample,
  METHOD_STOKES,
} from '../../lib/sim/stokes-drag-algos'
import {
  runCcSlopeSample,
  METHOD_CC,
} from '../../lib/sim/clausius-clapeyron-algos'
import {
  runSahaKSample,
  METHOD_SAHA,
} from '../../lib/sim/saha-algos'
import {
  runLangmuirThetaSample,
  METHOD_LANGMUIR,
} from '../../lib/sim/langmuir-algos'
import {
  runShotIrmsSample,
  METHOD_SHOT,
} from '../../lib/sim/shot-noise-algos'
import {
  runLorentzForceSample,
  runCyclotronOmegaSample,
  METHOD_LORENTZ,
  METHOD_CYCLOTRON,
} from '../../lib/sim/lorentz-cyclotron-algos'
import {
  runDebyeLengthSample,
  runPlasmaOmegaSample,
  METHOD_DEBYE,
  METHOD_PLASMA,
} from '../../lib/sim/debye-plasma-algos'
import {
  runBrewsterSample,
  runMalusSample as runMalusLawSample,
  METHOD_BREWSTER,
  METHOD_MALUS,
} from '../../lib/sim/brewster-malus-algos'
import {
  runCoulombForceSample,
  runBiotBSample,
  METHOD_COULOMB,
  METHOD_BIOT,
} from '../../lib/sim/coulomb-biot-algos'
import {
  runPoyntingSample,
  METHOD_POYNTING,
} from '../../lib/sim/poynting-algos'
import {
  runYoungFringeSample,
  runGratingOrderSample,
  METHOD_YOUNG,
  METHOD_GRATING,
} from '../../lib/sim/young-grating-algos'
import {
  runFermiOccupationSample,
  METHOD_FERMI,
} from '../../lib/sim/fermi-dirac-algos'
import {
  runVswrSample,
  METHOD_VSWR,
} from '../../lib/sim/vswr-algos'
import {
  runBodeMagSample,
  METHOD_BODE,
} from '../../lib/sim/bode-algos'
import {
  runJosephsonFreqSample,
  METHOD_JOSEPHSON,
} from '../../lib/sim/josephson-algos'
import {
  runAirMassSample,
  runLambertIrradianceSample,
  METHOD_AIRMASS,
  METHOD_LAMBERT,
} from '../../lib/sim/air-mass-lambert-algos'
import {
  runSkinDepthSample,
  METHOD_SKIN,
} from '../../lib/sim/skin-effect-algos'
import {
  runDrudeSigmaSample,
  METHOD_DRUDE,
} from '../../lib/sim/drude-algos'
import {
  runSellmeierNSample,
  METHOD_SELLMEIER,
} from '../../lib/sim/sellmeier-algos'
import {
  runFpFsrSample,
  METHOD_FP,
} from '../../lib/sim/fabry-perot-algos'
import {
  runMichelsonFringeSample,
  METHOD_MICHELSON,
} from '../../lib/sim/michelson-algos'
import {
  runWkbTSample,
  METHOD_WKB,
} from '../../lib/sim/wkb-tunnel-algos'
import {
  runShannonCSample,
  METHOD_SHANNON,
} from '../../lib/sim/shannon-algos'
import {
  runFriisNfSample,
  METHOD_NF,
} from '../../lib/sim/noise-figure-algos'
import {
  runSteinmetzPSample,
  METHOD_STEINMETZ,
} from '../../lib/sim/steinmetz-algos'
import {
  runNaSample,
  METHOD_NA,
} from '../../lib/sim/numerical-aperture-algos'
import {
  runAbbeVSample,
  METHOD_ABBE,
} from '../../lib/sim/abbe-number-algos'
import {
  runMzISample,
  METHOD_MZ,
} from '../../lib/sim/mach-zehnder-algos'
import {
  runSagnacPhaseSample,
  METHOD_SAGNAC,
} from '../../lib/sim/sagnac-algos'
import {
  runCurieChiSample,
  METHOD_CURIE,
} from '../../lib/sim/curie-weiss-algos'
import {
  runVarshniEgSample,
  METHOD_VARSHNI,
} from '../../lib/sim/varshni-algos'
import {
  runEarlyVaSample,
  METHOD_EARLY,
} from '../../lib/sim/early-effect-algos'
import {
  runZnPidSample,
  METHOD_ZN,
} from '../../lib/sim/ziegler-nichols-algos'
import {
  runMbVrmsSample,
  METHOD_MB,
} from '../../lib/sim/maxwell-boltzmann-algos'
import {
  runEquipESample,
  runMorseVSample,
  METHOD_EQUIP,
  METHOD_MORSE,
} from '../../lib/sim/equipartition-morse-algos'
import {
  runAlfvenVSample,
  METHOD_ALFVEN,
} from '../../lib/sim/alfven-algos'
import {
  runQFactorSample,
  runFinesseSample,
  METHOD_Q,
  METHOD_FINESSE,
} from '../../lib/sim/q-factor-finesse-algos'
import {
  runLawsonNttSample,
  METHOD_LAWSON,
} from '../../lib/sim/lawson-algos'
import {
  runLondonLambdaSample,
  METHOD_LONDON,
} from '../../lib/sim/london-algos'
import {
  runColeEpsSample,
  METHOD_COLE,
} from '../../lib/sim/cole-cole-algos'
import {
  runLangevinLSample,
  METHOD_LANGEVIN,
} from '../../lib/sim/langevin-algos'
import {
  runMillerCinSample,
  METHOD_MILLER,
} from '../../lib/sim/miller-cap-algos'
import {
  runRouthStable2Sample,
  METHOD_ROUTH,
} from '../../lib/sim/routh-hurwitz-algos'
import {
  runS11DbSample,
  METHOD_SPARAM,
} from '../../lib/sim/s-param-algos'
import {
  runYukawaVSample,
  METHOD_YUKAWA,
} from '../../lib/sim/yukawa-algos'
import {
  runStrehlSample,
  METHOD_STREHL,
} from '../../lib/sim/strehl-algos'
import {
  runLarmorOmegaSample,
  METHOD_LARMOR,
} from '../../lib/sim/larmor-algos'
import {
  runRabiFreqSample,
  METHOD_RABI,
} from '../../lib/sim/rabi-algos'
import {
  runMeissnerBSample,
  runBcsGapSample,
  METHOD_MEISSNER,
  METHOD_BCS,
} from '../../lib/sim/meissner-bcs-algos'
import {
  runVirialTSample,
  METHOD_VIRIAL,
} from '../../lib/sim/virial-algos'
import {
  runSpitzerEtaSample,
  runBohmDSample,
  METHOD_SPITZER,
  METHOD_BOHM,
} from '../../lib/sim/spitzer-bohm-algos'
import {
  runDampingZetaSample,
  METHOD_ROOT_LOCUS,
} from '../../lib/sim/root-locus-algos'
import {
  runCauchyNSample,
  METHOD_CAUCHY,
} from '../../lib/sim/cauchy-dispersion-algos'
import {
  runPurcellFSample,
  METHOD_PURCELL,
} from '../../lib/sim/purcell-algos'
import {
  runIcJosephsonSample,
  METHOD_IC,
} from '../../lib/sim/critical-current-algos'
import {
  runMadelungUSample,
  METHOD_MADELUNG,
} from '../../lib/sim/madelung-algos'
import {
  runFsplDbSample,
  METHOD_FSPL,
} from '../../lib/sim/fspl-algos'
import {
  runRadarPrSample,
  METHOD_RADAR,
} from '../../lib/sim/radar-equation-algos'
import {
  runLinkRxSample,
  METHOD_LINK,
} from '../../lib/sim/link-budget-algos'
import {
  runSnrDbSample,
  METHOD_SNR,
} from '../../lib/sim/snr-algos'
import {
  runAbcdSeriesZSample,
  METHOD_ABCD,
} from '../../lib/sim/abcd-twoport-algos'
import {
  runRollettKSample,
  METHOD_ROLLETT,
} from '../../lib/sim/rollett-k-algos'
import {
  runRamseyPSample,
  METHOD_RAMSEY,
} from '../../lib/sim/ramsey-algos'
import {
  runJcVacuumRabiSample,
  METHOD_JC,
} from '../../lib/sim/jaynes-cummings-algos'
import {
  runZernikeDefocusSample,
  METHOD_ZERNIKE,
} from '../../lib/sim/zernike-algos'
import {
  runBornLandeUSample,
  METHOD_BORN_LANDE,
} from '../../lib/sim/born-lande-algos'
import {
  runGoosHanchenSample,
  METHOD_GOOS_HANCHEN,
} from '../../lib/sim/goos-hanchen-algos'
import {
  runReynoldsSample,
  METHOD_RE,
} from '../../lib/sim/reynolds-algos'
import {
  runNusseltSample,
  runPrandtlSample,
  METHOD_NU,
  METHOD_PR,
} from '../../lib/sim/nusselt-prandtl-algos'
import {
  runMachSample,
  runKnudsenSample,
  METHOD_MACH,
  METHOD_KN,
} from '../../lib/sim/mach-knudsen-algos'
import {
  runViewParallelSample,
  METHOD_VIEW,
} from '../../lib/sim/view-factor-algos'
import {
  runRayleighJeansBSample,
  METHOD_RJ,
} from '../../lib/sim/rayleigh-jeans-algos'
import {
  runMtfSample,
  METHOD_MTF,
} from '../../lib/sim/mtf-algos'
import {
  runGmSample,
  METHOD_HYBRID_PI,
} from '../../lib/sim/hybrid-pi-algos'
import {
  runBerBpskSample,
  METHOD_BER,
} from '../../lib/sim/ber-qam-algos'
import {
  runSquidFluxSample,
  METHOD_SQUID,
} from '../../lib/sim/squid-algos'
import {
  runKittelFSample,
  METHOD_KITTEL,
} from '../../lib/sim/kittel-algos'
import { runBmodeComposeSample } from '../../lib/sim/us-l2-algos'
import { runAllTargetsSample } from '../../lib/sim/nljd-l2-algos'
import {
  runFhnSpikeSample,
  BIO_PARENT,
} from '../../lib/sim/bio-algos'
import {
  runSdtVariant,
  compareSdtParallels,
  PHOTO_PARENT,
} from '../../lib/sim/photo-algos'
import { runBerendsenSample } from '../../lib/sim/md-l2-algos'
import { Fluid, IX as fluidIX } from '../../lib/sim/fluid'
import {
  inducedEMF,
  motionalEMF,
  peakEMF,
  rotatingCoilEMF,
} from '../../lib/sim/faraday'
import { ecgWaveform, rrInterval, ECG_WAVES } from '../../lib/sim/ecg'
import { emgRMS } from '../../lib/sim/emg'
import { bandPower, dominantBand, eegSample } from '../../lib/sim/eeg'
import {
  runRemoveDcSample,
  runMovingAverageSample,
  runNotchSample,
  BIO_DSP_PARENT,
} from '../../lib/sim/biodsp-algos'
import { computeChargedForces } from '../../lib/sim/interactions'
import {
  hopRate,
  type PedotPssParams,
} from '../../lib/sim/pedotpss'
import { wavelength } from '../../lib/sim/antennatypes'
import { runFresnelNormalSample, runCriticalAngleSample } from '../../lib/sim/optics-l2-algos'
import { runRadarRangeSample } from '../../lib/sim/radar-algos'
import {
  runWaveletSample,
  runHaarDwtSample,
  runWaveletThresholdSample,
} from '../../lib/sim/wavelet-algos'
import {
  runPeriodogramSample,
  runChebyshevInterpSample,
} from '../../lib/sim/spectral-l2-algos'
import { runBemCollocationSample } from '../../lib/sim/bem-l2-algos'
import { runBemDoubleLayerSample } from '../../lib/sim/bem-l3-algos'
import { runKsScfSample, runLdaExchangeSample } from '../../lib/sim/ks-scf-algos'
import {
  runFemAssembleSample,
  runFemMassMatrixSample,
} from '../../lib/sim/fem-l2-algos'
import {
  runLbmBkgSample,
  runLbmGuoForceSample,
} from '../../lib/sim/lbm-l2-algos'
import { runPicPushSample } from '../../lib/sim/pic-l2-algos'
import { runExergyLostWorkSample } from '../../lib/sim/exergy-l2-algos'
import { runPfEssSample } from '../../lib/sim/pf-l2-algos'
import { runLevelSetSample, runSdfCircleSample } from '../../lib/sim/levelset-algos'
import { runParticleFilterSample, runPf1dSample } from '../../lib/sim/pf-algos'
import { runEkfLinearSample, runEkfJacobianSample } from '../../lib/sim/ekf-algos'
import {
  runIbmSample,
  runIbmDeltaSample,
  runIbmInterpolateSample,
} from '../../lib/sim/ibm-algos'
import {
  runSemSample,
  runSemLagrangeSample,
  runGllSample,
} from '../../lib/sim/sem-algos'
import {
  runMultiphysicsSample,
  runStaggeredThermoelasticSample,
  runPartitionedCouplingSample,
} from '../../lib/sim/multiphysics-algos'
import { runSpongeAbcSample } from '../../lib/sim/wave-l2-algos'
import { runExergySample, runCarnotExergySample } from '../../lib/sim/exergy-algos'
import { runFvmSample, runFvmFluxSample } from '../../lib/sim/fvm-algos'
import { runMvdrSample, runMvdrWeightsSample } from '../../lib/sim/mvdr-algos'
import { runSpectrumBandSample } from '../../lib/sim/spectrum-algos'

export type ModuleRunner = () => unknown

export interface ModuleBinding {
  methodId: string
  family: string
  run: ModuleRunner
  label: string
}

/** Raw catalog of algorithm id → sample runner (ids must exist in METHODS). */
const BINDINGS_RAW: ModuleBinding[] = [
  {
    methodId: 'method-algo-elmergrid-convert',
    family: 'method-algo-elmergrid-convert',
    // This method is a Host workflow; the local preview only describes its input.
    run: () => ({
      status: 'requires-host',
      module: 'sw-elmer-mesh-convert-b',
      backend: 'host',
      workflow: '/method-depth?m=method-algo-elmergrid-convert',
      note: 'Use the Elmer mesh export panel to submit nodes and elements; no conversion ran in this preview.',
    }),
    label: 'ElmerGrid 转换入口（需 Host）',
  },
  // ── Wave FD ──────────────────────────────────────────────
  {
    methodId: 'method-algo-wave-laplacian',
    family: WAVE_PARENT,
    run: () => runLaplacianSineSample(),
    label: '离散拉普拉斯 ∇²',
  },
  {
    methodId: 'method-algo-wave-leapfrog',
    family: WAVE_PARENT,
    run: () => runWaveCflSample(),
    label: '波动方程蛙跳步进',
  },
  {
    methodId: 'method-algo-wave-poke',
    family: WAVE_PARENT,
    run: () => {
      const N = 40
      const w = new Wave(N, { a: 0.25, damp: 1 })
      w.poke(N / 2, N / 2, 2, 4)
      const energy0 = w.energy()
      for (let s = 0; s < 20; s++) w.step()
      return { energy0, energyF: w.energy(), finite: Number.isFinite(w.energy()) }
    },
    label: '初始扰动点源',
  },
  {
    methodId: 'method-algo-wave-obstacle',
    family: WAVE_PARENT,
    run: () => {
      const N = 40
      const IX = (x: number, y: number) => x + y * N
      const behind = (w: Wave) => {
        let e = 0
        for (let y = 1; y < N - 1; y++)
          for (let x = 28; x < N - 1; x++) e += w.u[IX(x, y)]! ** 2
        return e
      }
      const drive = (w: Wave) => {
        for (let s = 0; s < 40; s++) {
          w.u[IX(10, N / 2)]! += Math.sin(s * 0.6) * 2
          w.uPrev[IX(10, N / 2)] = w.u[IX(10, N / 2)]!
          w.step()
        }
      }
      const open = new Wave(N, { a: 0.25, damp: 1 })
      drive(open)
      const walled = new Wave(N, { a: 0.25, damp: 1 })
      const mask = new Uint8Array(N * N)
      for (let y = 0; y < N; y++) mask[IX(24, y)] = 1
      walled.setObstacle(mask)
      drive(walled)
      const eOpen = behind(open)
      const eWall = behind(walled)
      return { eOpen, eWall, ratio: eOpen > 0 ? eWall / eOpen : 0 }
    },
    label: '硬障碍反射',
  },
  {
    methodId: 'method-algo-wave-absorbing-boundary',
    family: WAVE_PARENT,
    run: () => runSpongeAbcSample(),
    label: '波动吸收边界 · 海绵层',
  },

  // ── FDTD ─────────────────────────────────────────────────
  {
    methodId: 'method-algo-yee-update',
    family: FDTD_PARENT,
    run: () => runYeeUpdateSample(),
    label: '叶氏网格蛙跳更新',
  },
  {
    methodId: 'method-algo-fdtd-source',
    family: FDTD_PARENT,
    run: () => runSourceSample(),
    label: '时域有限差分软源注入',
  },
  {
    methodId: 'method-algo-fdtd-bnd-mur',
    family: FDTD_PARENT,
    run: () => runBoundaryParallel(),
    label: '边界 · 一阶吸波',
  },
  {
    methodId: 'method-algo-fdtd-bnd-pec',
    family: FDTD_PARENT,
    run: () => runBoundaryParallel(),
    label: '边界 · 金属壁全反射',
  },

  // ── Array / beamforming ──────────────────────────────────
  {
    methodId: 'method-algo-array-factor',
    family: ARRAY_PARENT,
    run: () => runArrayFactorSample(),
    label: '阵列因子',
  },
  {
    methodId: 'method-algo-array-pattern',
    family: ARRAY_PARENT,
    run: () => runBeamwidthSample(),
    label: '方向图 / 波束宽度',
  },
  {
    methodId: 'method-algo-friis-link',
    family: ARRAY_PARENT,
    run: () => runFriisSample(),
    label: '弗里斯自由空间链路',
  },
  {
    methodId: 'method-algo-array-pattern-view',
    family: ARRAY_PARENT,
    run: () => runPatternSample(),
    label: '阵列方向图路径',
  },

  // ── Spectrum viewer (parallel band shells) ───────────────
  {
    methodId: 'method-algo-spectrum-em',
    family: 'method-spectrum-viewer',
    run: () => {
      const fHz = 2.45e9 // ISM Wi-Fi band
      const c = 2.99792458e8
      const lambda = wavelength(fHz)
      const product = fHz * lambda
      return { band: 'em', fHz, lambda, c, product, identityOk: Math.abs(product - c) / c < 1e-9 }
    },
    label: '电磁波谱观测',
  },
  {
    methodId: 'method-algo-spectrum-sound',
    family: 'method-spectrum-viewer',
    run: () => {
      const c = 343 // m/s air ~20°C
      const fHz = 1000
      const lambda = c / fHz
      return { band: 'sound', fHz, lambda, c, product: fHz * lambda }
    },
    label: '声波频谱观测',
  },
  {
    methodId: 'method-algo-spectrum-vibration',
    family: 'method-spectrum-viewer',
    run: () => {
      // String wave: c = √(T/μ); sample modal f1 = c/(2L)
      const tension = 100 // N
      const mu = 0.01 // kg/m
      const L = 0.65 // m
      const c = Math.sqrt(tension / mu)
      const f1 = c / (2 * L)
      const lambda1 = 2 * L
      return { band: 'vib', c, f1, lambda1, product: f1 * lambda1 }
    },
    label: '振动频谱观测',
  },

  // ── Laser rate equations ─────────────────────────────────
  {
    methodId: 'method-algo-laser-threshold',
    family: LASER_PARENT,
    run: () => runThresholdSample(),
    label: '激光阈值泵浦',
  },
  {
    methodId: 'method-algo-laser-step',
    family: LASER_PARENT,
    run: () => runStepSample(),
    label: '速率方程步进',
  },
  {
    methodId: 'method-algo-laser-steady',
    family: LASER_PARENT,
    run: () => runSteadySample(),
    label: '稳态光子数',
  },

  // ── Research skeleton children ───────────────────────────
  {
    methodId: 'method-algo-snell',
    family: METHOD_RAY_OPTICS,
    run: () => runSnellSample(),
    label: '斯涅尔折射',
  },
  {
    methodId: 'method-algo-dft-1d',
    family: METHOD_SPECTRAL,
    run: () => runDftPeakSample(),
    label: '一维离散傅里叶峰值',
  },
  {
    methodId: 'method-algo-kalman-1d',
    family: METHOD_KALMAN,
    run: () => runKalman1dSample(),
    label: '一维卡尔曼滤波',
  },
  {
    methodId: 'method-algo-fem-poisson-1d',
    family: METHOD_FEM,
    run: () => runFemPoisson1dSample(),
    label: '一维泊松有限元',
  },
  {
    methodId: 'method-algo-lbm-d1q3',
    family: METHOD_LBM,
    run: () => runLbmD1q3Sample(),
    label: '一维三速单松弛步进',
  },
  {
    methodId: 'method-algo-bem-green',
    family: METHOD_BEM,
    run: () => runBemGreenSample(),
    label: '格林核积分核',
  },
  {
    methodId: 'method-algo-pic-cic',
    family: METHOD_PIC,
    run: () => runPicCicSample(),
    label: '粒子网格云团分配/聚集',
  },
  {
    methodId: 'method-algo-dft-well',
    family: METHOD_DFT_ELECTRONIC,
    run: () => runDftElectronicSample(),
    label: '无限势阱密度核',
  },

  // ── Molecular dynamics ───────────────────────────────────
  {
    methodId: 'method-algo-lj-pair',
    family: MD_PARENT_METHOD_ID,
    run: () => runLjPairSample(),
    label: '伦纳德–琼斯成对力',
  },
  {
    methodId: 'method-algo-velocity-verlet',
    family: MD_PARENT_METHOD_ID,
    run: () => runVelocityVerletSample(),
    label: '速度维莱积分',
  },
  {
    methodId: 'method-algo-rescale-thermostat',
    family: MD_PARENT_METHOD_ID,
    run: () => runRescaleThermostatSample(),
    label: '速度重标定恒温',
  },
  {
    methodId: 'method-algo-ff-lj-homog',
    family: MD_PARENT_METHOD_ID,
    run: () => runHomogForceSample(),
    label: '力场 · 均质伦纳德–琼斯',
  },
  {
    methodId: 'method-algo-berendsen-barostat',
    family: MD_PARENT_METHOD_ID,
    run: () => runBerendsenSample(),
    label: '贝伦德森压浴',
  },
  {
    methodId: 'method-algo-ff-pedot',
    family: MD_PARENT_METHOD_ID,
    run: () => {
      // PEDOT:PSS charged pair forces + hop gate (real pedotpss core)
      const params: PedotPssParams = {
        kCoulomb: 1,
        epsR: 24,
        lambdaD: 3,
        hopDistMax: 1.6,
        hopBeta: 1,
        hopAttempt: 0.5,
        solvationEpsR: 50,
        washoutBeta: 1,
      }
      const dim = 2
      const N = 2
      const L = 10
      const rc = 2.5
      const pos = new Float32Array([3, 3, 4.2, 3])
      const charge = new Float32Array([+1, -1])
      const got = computeChargedForces(pos, charge, L, N, dim, rc, params)
      const rate = hopRate(1.0, 0.5, { distMax: 1.6, beta: 2, attempt: 0.8 })
      // Soft link: also surface homog LJ as baseline peer force field
      const homog = runHomogForceSample()
      return {
        potential: got.potential,
        virial: got.virial,
        force0x: got.force[0]!,
        hopRate: rate,
        homogPeak: homog,
        note: 'pedot charged + homog peer',
      }
    },
    label: '力场 · 导电聚合物异质',
  },

  // ── Monte Carlo / Ising ──────────────────────────────────
  {
    methodId: 'method-algo-mc-propose-flip',
    family: MC_PARENT,
    run: () => runProposeSample(),
    label: '蒙特卡洛提议 · 单自旋翻转',
  },
  {
    methodId: 'method-algo-mc-metropolis-accept',
    family: MC_PARENT,
    run: () => runMetropolisSweepSample(),
    label: '梅特罗波利斯接受准则',
  },
  {
    methodId: 'method-algo-mc-heatbath',
    family: MC_PARENT,
    run: () => runHeatbathSample(),
    label: '热浴更新',
  },
  {
    methodId: 'method-algo-ising-mc-run',
    family: MC_PARENT,
    run: () => runMetropolisSweepSample(40),
    label: '伊辛梅特罗波利斯扫',
  },
  {
    methodId: 'method-algo-onsager-exact',
    family: MC_PARENT,
    run: () => runOnsagerSample(),
    label: '昂萨格精确解（对拍）',
  },
  {
    methodId: 'method-algo-ising-mc-numeric',
    family: MC_PARENT,
    run: () => compareIsingParallels(),
    label: '伊辛蒙特卡洛数值路径',
  },

  // ── Heat ─────────────────────────────────────────────────
  {
    methodId: 'method-algo-heat-ftcs-step',
    family: HEAT_PARENT,
    run: () => runHeatFtcsConserve(),
    label: '热方程显式差分步进',
  },
  {
    methodId: 'method-algo-heat-erfc',
    family: HEAT_PARENT,
    run: () => runErfcProfileSample(),
    label: '半无限体误差函数解析',
  },
  {
    methodId: 'method-algo-heat-implicit',
    family: HEAT_PARENT,
    run: () => runImplicitHeatSample(),
    label: '热方程隐式步进',
  },
  {
    methodId: 'method-algo-heat-crank-nicolson',
    family: HEAT_PARENT,
    run: () => runCrankNicolsonSample(),
    label: '热方程克兰克–尼科尔森',
  },

  // ── Stable Fluids ────────────────────────────────────────
  {
    methodId: 'method-algo-fluid-diffuse',
    family: FLUID_PARENT,
    run: () => runDiffuseSample(),
    label: '速度/染料扩散',
  },
  {
    methodId: 'method-algo-fluid-advect',
    family: FLUID_PARENT,
    run: () => runAdvectSample(),
    label: '半拉格朗日平流',
  },
  {
    methodId: 'method-algo-fluid-project',
    family: FLUID_PARENT,
    run: () => runProjectSample(),
    label: '压力投影（无散）',
  },
  {
    methodId: 'method-algo-fluid-pipeline',
    family: FLUID_PARENT,
    run: () => ({
      diffuse: runDiffuseSample(),
      advect: runAdvectSample(),
      project: runProjectSample(),
    }),
    label: '稳定流体全管线',
  },
  {
    methodId: 'method-algo-fluid-buoyancy',
    family: FLUID_PARENT,
    run: () => {
      const N = 32
      const f = new Fluid(N, { thermal: true, buoyancy: 5, ambient: 0, dt: 0.1 })
      for (let j = N / 2 - 1; j <= N / 2 + 1; j++)
        for (let i = N / 2 - 1; i <= N / 2 + 1; i++) f.addTemp(i, j, 10)
      f.applyBuoyancy()
      const vy = f.vy[fluidIX(N / 2, N / 2, N)]!
      return { vy, upward: vy < 0, buoyancy: f.buoyancy }
    },
    label: '布辛涅斯克浮力',
  },
  {
    methodId: 'method-algo-fluid-obstacle',
    family: FLUID_PARENT,
    run: () => {
      const N = 32
      const f = new Fluid(N, {})
      const mask = new Uint8Array(N * N)
      const solid = fluidIX(N / 2, N / 2, N)
      mask[solid] = 1
      f.setObstacle(mask)
      f.vx[solid] = 3
      f.vy[solid] = -2
      f.dens[solid] = 9
      f.applyObstacle()
      return {
        vx: f.vx[solid]!,
        vy: f.vy[solid]!,
        dens: f.dens[solid]!,
        cleared: f.vx[solid] === 0 && f.vy[solid] === 0 && f.dens[solid] === 0,
      }
    },
    label: '固体障碍掩膜',
  },

  // ── Lumped circuit ───────────────────────────────────────
  {
    methodId: 'method-algo-series-rlc',
    family: LUMPED_PARENT_METHOD_ID,
    run: () => runSeriesRlcSample(),
    label: '串联谐振 · 四阶龙格–库塔',
  },
  {
    methodId: 'method-algo-rc-rl-transient',
    family: LUMPED_PARENT_METHOD_ID,
    run: () => runRcTransientSample(),
    label: '阻容/阻感一阶暂态',
  },
  {
    methodId: 'method-algo-mutual',
    family: LUMPED_PARENT_METHOD_ID,
    run: () => runMutualSample(),
    label: '互感 / 变压器耦合',
  },
  {
    methodId: 'method-algo-faraday',
    family: LUMPED_PARENT_METHOD_ID,
    run: () => {
      const N = 100
      const B = 0.5
      const A = 0.01
      const omega = 120 * Math.PI
      const t = Math.PI / (2 * omega) // sin(ωt)=1 → peak
      const emfPeak = peakEMF(N, B, A, omega)
      const emfT = rotatingCoilEMF(t, N, B, A, omega)
      const mot = motionalEMF(B, 0.2, 5)
      const ind = inducedEMF(0.05, N)
      return { emfPeak, emfT, motional: mot, induced: ind }
    },
    label: '法拉第感应样板',
  },

  // ── Ultrasound ───────────────────────────────────────────
  {
    methodId: 'method-algo-us-reflection',
    family: US_PARENT,
    run: () => runReflectionSample(),
    label: '声阻抗反射系数',
  },
  {
    methodId: 'method-algo-us-aline',
    family: US_PARENT,
    run: () => runAlineSample(),
    label: '幅度线脉冲回波',
  },
  {
    methodId: 'method-algo-us-bmode-compose',
    family: US_PARENT,
    run: () => runBmodeComposeSample(),
    label: '亮度模拼图 · 幅度线→栅格',
  },

  // ── SPM ──────────────────────────────────────────────────
  {
    methodId: 'method-algo-stm-tunnel',
    family: SPM_PARENT,
    run: () => runTunnelSample(),
    label: '扫描隧道显微隧穿电流',
  },
  {
    methodId: 'method-algo-afm-lj',
    family: SPM_PARENT,
    run: () => runAfmForceSample(),
    label: '原子力针尖力 / 偏转',
  },
  {
    methodId: 'method-algo-stm-const-height',
    family: SPM_PARENT,
    run: () => runConstHeightSample(),
    label: '扫描隧道显微恒高扫描',
  },
  {
    methodId: 'method-algo-stm-const-current',
    family: SPM_PARENT,
    run: () => runConstCurrentSample(),
    label: '扫描隧道显微恒流反馈',
  },

  // ── Localization ─────────────────────────────────────────
  {
    methodId: 'method-algo-tdoa-locate',
    family: LOC_PARENT,
    run: () => runTdoaSample(),
    label: '到达时差双曲线定位',
  },
  {
    methodId: 'method-algo-trilateration',
    family: LOC_PARENT,
    run: () => runTrilaterationSample(),
    label: '多锚测距三角定位',
  },

  // ── NLJD ─────────────────────────────────────────────────
  {
    methodId: 'method-algo-nljd-poly',
    family: NLJD_PARENT,
    run: () => runPolySample(),
    label: '非线性多项式传输',
  },
  {
    methodId: 'method-algo-nljd-classify',
    family: NLJD_PARENT,
    run: () => runClassifySample(),
    label: '2f/3f 谐波分类',
  },
  {
    methodId: 'method-algo-nljd-target-kinds',
    family: NLJD_PARENT,
    run: () => runAllTargetsSample(),
    label: '非线性结目标种类系数',
  },

  // ── Display opto ─────────────────────────────────────────
  {
    methodId: 'method-algo-led-bandgap',
    family: DISPLAY_PARENT,
    run: () => runBandgapSample(),
    label: '发光二极管带隙–波长',
  },
  {
    methodId: 'method-algo-lcd-malus',
    family: DISPLAY_PARENT,
    run: () => runMalusSample(),
    label: '液晶马吕斯调制',
  },
  {
    methodId: 'method-algo-oled-mix',
    family: DISPLAY_PARENT,
    run: () => runOledMixSample(),
    label: '有机发光红绿蓝混色',
  },

  // ── Bioelectric ──────────────────────────────────────────
  {
    methodId: 'method-algo-fhn-neuron',
    family: BIO_PARENT,
    run: () => runFhnSpikeSample(),
    label: '菲茨休–南云兴奋',
  },
  {
    methodId: 'method-algo-ecg-wave',
    family: BIO_PARENT,
    run: () => {
      const hr = 72
      const T = rrInterval(hr)
      const rPeak = ecgWaveform(ECG_WAVES.R.mu * T, hr)
      const baseline = ecgWaveform(0, hr)
      return { hr, rr: T, rPeak, baseline }
    },
    label: '心电导联波形',
  },
  {
    methodId: 'method-algo-emg-signal',
    family: BIO_PARENT,
    run: () => {
      let seed = 42
      const rng = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }
      const rmsRest = emgRMS(0, 200, rng)
      const rmsActive = emgRMS(0.8, 200, rng)
      return { rmsRest, rmsActive, ratio: rmsActive / Math.max(rmsRest, 1e-12) }
    },
    label: '肌电信号',
  },
  {
    methodId: 'method-algo-eeg-rhythm',
    family: BIO_PARENT,
    run: () => {
      const weights = { delta: 0.1, theta: 0.2, alpha: 1.0, beta: 0.3, gamma: 0.05 }
      let seed = 7
      const rng = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }
      const sample = eegSample(0.1, weights, rng)
      const powers = bandPower(weights)
      const dom = dominantBand(weights)
      return { sample, alphaPower: powers.alpha!, dominant: dom }
    },
    label: '脑电节律',
  },
  {
    methodId: 'method-algo-biodsp-pipeline',
    family: BIO_PARENT,
    run: () => {
      const dc = runRemoveDcSample()
      const ma = runMovingAverageSample()
      const notch = runNotchSample()
      return {
        meanAfter: dc.meanAfter,
        varAfter: ma.varAfter,
        pow50After: notch.pow50After,
        steps: 3,
      }
    },
    label: '生物电数字信号处理链路',
  },
  {
    methodId: 'method-algo-dsp-remove-dc',
    family: BIO_DSP_PARENT,
    run: () => runRemoveDcSample(),
    label: '数字信号处理 · 去直流',
  },
  {
    methodId: 'method-algo-dsp-moving-avg',
    family: BIO_DSP_PARENT,
    run: () => runMovingAverageSample(),
    label: '数字信号处理 · 滑动平均',
  },
  {
    methodId: 'method-algo-dsp-notch',
    family: BIO_DSP_PARENT,
    run: () => runNotchSample(),
    label: '数字信号处理 · 工频陷波',
  },

  // ── Photosensitization / SDT ─────────────────────────────
  {
    methodId: 'method-algo-photo-jablonski',
    family: PHOTO_PARENT,
    run: () => compareSdtParallels(),
    label: '雅布隆斯基速率方程壳',
  },
  {
    methodId: 'method-variant-sdt-cavitation',
    family: PHOTO_PARENT,
    run: () => runSdtVariant('cavitation'),
    label: '声动力假说 · 空化声化学',
  },
  {
    methodId: 'method-variant-sdt-sonoluminescence',
    family: PHOTO_PARENT,
    run: () => runSdtVariant('sonoluminescence'),
    label: '声动力假说 · 声致发光光敏',
  },
  {
    methodId: 'method-variant-sdt-piezo',
    family: PHOTO_PARENT,
    run: () => runSdtVariant('piezo'),
    label: '声动力假说 · 压电/直接三线态',
  },

  // ── Meta: path efficiency / energy→token ─────────────────
  {
    methodId: 'method-algo-path-dfs',
    family: META_PATH_PARENT,
    run: () => runPathSearchSample(),
    label: '能量路径深度优先搜索',
  },
  {
    methodId: 'method-algo-path-mc-eta',
    family: META_PATH_PARENT,
    run: () => runPathMcSample('chemical', 'electric', 400, 17),
    label: '路径效率蒙特卡洛抽样',
  },
  {
    methodId: 'method-algo-path-dijkstra-stub',
    family: META_PATH_PARENT,
    run: () => runPathDijkstraSample(),
    label: '路径最短路 Dijkstra −log η',
  },
  {
    methodId: 'method-algo-eta-product',
    family: META_TOKEN_PARENT,
    run: () => runEnergyTokenChainSample(),
    label: '环节效率连乘',
  },

  // ── Circuit / FDTD L2 (catalog siblings) ─────────────────
  {
    methodId: 'method-algo-rlc-euler',
    family: LUMPED_PARENT_METHOD_ID,
    run: () => runEulerRlcSample(),
    label: '串联 电阻电感电容 · 显式欧拉',
  },
  {
    methodId: 'method-algo-fdtd-energy-monitor',
    family: FDTD_PARENT,
    run: () => runEnergyMonitorSample(),
    label: '时域有限差分 · 场能量监视',
  },
  {
    methodId: 'method-algo-fdtd-cfl',
    family: FDTD_PARENT,
    run: () => runCflSample(),
    label: '时域有限差分 · 稳定性检查',
  },

  // ── Family roots (delegate to a representative child sample) ──
  {
    methodId: WAVE_PARENT,
    family: WAVE_PARENT,
    run: () => runWaveCflSample(),
    label: '二维波动方程 · 族',
  },
  {
    methodId: FDTD_PARENT,
    family: FDTD_PARENT,
    run: () => runYeeUpdateSample(),
    label: '时域有限差分 · 族',
  },
  {
    methodId: ARRAY_PARENT,
    family: ARRAY_PARENT,
    run: () => runArrayFactorSample(),
    label: '相控阵 / 链路 · 族',
  },
  {
    methodId: 'method-spectrum-viewer',
    family: 'method-spectrum-viewer',
    run: () => {
      const fHz = 2.45e9
      const c = 2.99792458e8
      const lambda = wavelength(fHz)
      const product = fHz * lambda
      return { band: 'em', fHz, lambda, c, product, identityOk: Math.abs(product - c) / c < 1e-9 }
    },
    label: '频谱观测 · 族',
  },
  {
    methodId: LASER_PARENT,
    family: LASER_PARENT,
    run: () => runThresholdSample(),
    label: '激光速率方程 · 族',
  },
  {
    methodId: METHOD_RAY_OPTICS,
    family: METHOD_RAY_OPTICS,
    run: () => runSnellSample(),
    label: '几何光学 · 族',
  },
  {
    methodId: METHOD_SPECTRAL,
    family: METHOD_SPECTRAL,
    run: () => runDftPeakSample(),
    label: '谱方法 / 伪谱 · 族',
  },
  {
    methodId: METHOD_KALMAN,
    family: METHOD_KALMAN,
    run: () => runKalman1dSample(),
    label: '卡尔曼滤波 · 族',
  },
  {
    methodId: METHOD_FEM,
    family: METHOD_FEM,
    run: () => runFemPoisson1dSample(),
    label: '有限元 · 族',
  },
  {
    methodId: METHOD_LBM,
    family: METHOD_LBM,
    run: () => runLbmD1q3Sample(),
    label: '格子玻尔兹曼 · 族',
  },
  {
    methodId: METHOD_BEM,
    family: METHOD_BEM,
    run: () => runBemGreenSample(),
    label: '边界元 · 族',
  },
  {
    methodId: METHOD_PIC,
    family: METHOD_PIC,
    run: () => runPicCicSample(),
    label: '粒子网格 · 族',
  },
  {
    methodId: METHOD_DFT_ELECTRONIC,
    family: METHOD_DFT_ELECTRONIC,
    run: () => runDftElectronicSample(),
    label: '密度泛函 · 族',
  },
  {
    methodId: MD_PARENT_METHOD_ID,
    family: MD_PARENT_METHOD_ID,
    run: () => runVelocityVerletSample(),
    label: '分子动力学 · 方法族',
  },
  {
    methodId: MC_PARENT,
    family: MC_PARENT,
    run: () => runMetropolisSweepSample(),
    label: '梅特罗波利斯蒙特卡洛 · 族',
  },
  {
    methodId: HEAT_PARENT,
    family: HEAT_PARENT,
    run: () => runHeatFtcsConserve(),
    label: '热扩散 · 方法族',
  },
  {
    methodId: FLUID_PARENT,
    family: FLUID_PARENT,
    run: () => runProjectSample(),
    label: '不可压缩流体 · 稳定流体族',
  },
  {
    methodId: LUMPED_PARENT_METHOD_ID,
    family: LUMPED_PARENT_METHOD_ID,
    run: () => runSeriesRlcSample(),
    label: '集总参数电路 · 方法族',
  },
  {
    methodId: US_PARENT,
    family: US_PARENT,
    run: () => runReflectionSample(),
    label: '超声亮度模 · 族',
  },
  {
    methodId: SPM_PARENT,
    family: SPM_PARENT,
    run: () => runTunnelSample(),
    label: '扫描探针显微 · 族',
  },
  {
    methodId: LOC_PARENT,
    family: LOC_PARENT,
    run: () => runTdoaSample(),
    label: '定位 · 时差/三角 · 族',
  },
  {
    methodId: NLJD_PARENT,
    family: NLJD_PARENT,
    run: () => runPolySample(),
    label: '非线性结探测 · 族',
  },
  {
    methodId: DISPLAY_PARENT,
    family: DISPLAY_PARENT,
    run: () => runBandgapSample(),
    label: '显示光电 · 族',
  },
  {
    methodId: BIO_PARENT,
    family: BIO_PARENT,
    run: () => runFhnSpikeSample(),
    label: '生物电 · 方法族',
  },
  {
    methodId: PHOTO_PARENT,
    family: PHOTO_PARENT,
    run: () => compareSdtParallels(),
    label: '光/声敏化动力学 · 族',
  },
  {
    methodId: META_PATH_PARENT,
    family: META_PATH_PARENT,
    run: () => runPathSearchSample(),
    label: '路径效率 · 族',
  },
  {
    methodId: META_TOKEN_PARENT,
    family: META_TOKEN_PARENT,
    run: () => runEnergyTokenChainSample(),
    label: '能量→令牌链 · 族',
  },

  // ── Research catalog expansion (pure *-algos runners) ────
  {
    methodId: 'method-finite-volume',
    family: 'method-finite-volume',
    run: () => runFvmSample(),
    label: '有限体积 · 族',
  },
  {
    methodId: 'method-algo-fvm-flux',
    family: 'method-finite-volume',
    run: () => runFvmFluxSample(),
    label: '有限体积面通量',
  },
  {
    methodId: 'method-algo-fvm-limiter',
    family: 'method-finite-volume',
    run: () => runFvmLimiterSample(),
    label: '有限体积斜率限制器',
  },
  {
    methodId: 'method-algo-fvm-hllc-stub',
    family: 'method-finite-volume',
    run: () => runFvmHllcSample(),
    label: 'HLLC 三波近似黎曼通量',
  },
  {
    methodId: 'method-spectral-element',
    family: 'method-spectral-element',
    run: () => runSemSample(),
    label: '谱元 · 族',
  },
  {
    methodId: 'method-algo-sem-lagrange',
    family: 'method-spectral-element',
    run: () => runSemLagrangeSample(),
    label: '拉格朗日–高斯–洛巴托谱元原子',
  },
  {
    methodId: 'method-algo-sem-gll-quadrature',
    family: 'method-spectral-element',
    run: () => runGllSample(),
    label: '高斯–洛巴托求积原子',
  },
  {
    methodId: 'method-algo-sem-lumped-mass',
    family: 'method-spectral-element',
    run: () => runSemLumpedMassSample(),
    label: '谱元集总/对角质量',
  },
  {
    methodId: 'method-level-set',
    family: 'method-level-set',
    run: () => runLevelSetSample(),
    label: '水平集 · 族',
  },
  {
    methodId: 'method-algo-sdf-circle',
    family: 'method-level-set',
    run: () => runSdfCircleSample(),
    label: '圆符号距离场原子',
  },
  {
    methodId: 'method-algo-levelset-advect',
    family: 'method-level-set',
    run: () => runLevelsetAdvectSample(),
    label: '水平集界面平流',
  },
  {
    methodId: 'method-algo-levelset-curvature',
    family: 'method-level-set',
    run: () => runLevelsetCurvatureSample(),
    label: '水平集平均曲率',
  },
  {
    methodId: 'method-immersed-boundary',
    family: 'method-immersed-boundary',
    run: () => runIbmSample(),
    label: '浸没边界 · 族',
  },
  {
    methodId: 'method-algo-ibm-delta',
    family: 'method-immersed-boundary',
    run: () => runIbmDeltaSample(),
    label: '浸没边界力散布',
  },
  {
    methodId: 'method-algo-ibm-interpolate',
    family: 'method-immersed-boundary',
    run: () => runIbmInterpolateSample(),
    label: '浸没边界速度插值',
  },
  {
    methodId: 'method-algo-ibm-spread-interp',
    family: 'method-immersed-boundary',
    run: () => runIbmSpreadInterpSample(),
    label: '浸没边界散布–插值对',
  },
  {
    methodId: 'method-wavelet',
    family: 'method-wavelet',
    run: () => runWaveletSample(),
    label: '小波 / 多分辨 · 族',
  },
  {
    methodId: 'method-algo-haar-dwt',
    family: 'method-wavelet',
    run: () => runHaarDwtSample(),
    label: '哈尔离散小波步进',
  },
  {
    methodId: 'method-kalman-ekf',
    family: METHOD_KALMAN,
    run: () => runEkfLinearSample(),
    label: '扩展卡尔曼滤波',
  },
  {
    methodId: 'method-algo-ekf-linear',
    family: METHOD_KALMAN,
    run: () => runEkfJacobianSample(),
    label: '扩展卡尔曼雅可比线性化',
  },
  {
    methodId: 'method-algo-ukf-sigma',
    family: METHOD_KALMAN,
    run: () => runUkfSigmaSample(),
    label: '无迹卡尔曼西格玛点变换',
  },
  {
    methodId: 'method-particle-filter',
    family: 'method-particle-filter',
    run: () => runParticleFilterSample(),
    label: '粒子滤波 · 族',
  },
  {
    methodId: 'method-algo-pf-1d',
    family: 'method-particle-filter',
    run: () => runPf1dSample(),
    label: '一维粒子滤波序贯重要性重采样',
  },
  {
    methodId: 'method-algo-pf-ukf-stub',
    family: 'method-particle-filter',
    run: () => runUkfSigmaSample(),
    label: 'UKF 西格玛点变换',
  },
  {
    methodId: 'method-beamforming-mvdr',
    family: ARRAY_PARENT,
    run: () => runMvdrSample(),
    label: '最小方差无畸变波束成形',
  },
  {
    methodId: 'method-algo-mvdr-weights',
    family: ARRAY_PARENT,
    run: () => runMvdrWeightsSample(),
    label: '最小方差权向量',
  },
  {
    methodId: 'method-comsol-style-multiphysics',
    family: 'method-comsol-style-multiphysics',
    run: () => runMultiphysicsSample(),
    label: '多物理场耦合目录 · 族',
  },
  {
    methodId: 'method-algo-staggered-thermoelastic',
    family: 'method-comsol-style-multiphysics',
    run: () => runStaggeredThermoelasticSample(),
    label: '交错热–弹性耦合',
  },
  {
    methodId: 'method-algo-partitioned-coupling',
    family: 'method-comsol-style-multiphysics',
    run: () => runPartitionedCouplingSample(),
    label: '分区耦合迭代',
  },
  {
    methodId: 'method-algo-monolithic-residual',
    family: 'method-comsol-style-multiphysics',
    run: () => runMonolithicResidualSample(),
    label: '单片多物理残差',
  },
  {
    methodId: 'method-exergy-analysis',
    family: 'method-exergy-analysis',
    run: () => runExergySample(),
    label: '㶲 / 可用功分析 · 族',
  },
  {
    methodId: 'method-algo-exergy-carnot',
    family: 'method-exergy-analysis',
    run: () => runCarnotExergySample(),
    label: '卡诺㶲因子原子',
  },

  // ── Optics L2 / radar pure modules ───────────────────────
  {
    methodId: 'method-algo-fresnel-normal',
    family: METHOD_RAY_OPTICS,
    run: () => runFresnelNormalSample(),
    label: '正入射菲涅耳反射',
  },
  {
    methodId: 'method-algo-critical-angle',
    family: METHOD_RAY_OPTICS,
    run: () => runCriticalAngleSample(),
    label: '全反射临界角',
  },
  {
    methodId: 'method-algo-radar-range',
    family: LOC_PARENT,
    run: () => runRadarRangeSample(),
    label: '雷达距离方程',
  },

  // ── L2 catalog children (periodogram / wavelet thresh / PUE / BEM / KS-SCF) ──
  {
    methodId: 'method-algo-fft-periodogram',
    family: METHOD_SPECTRAL,
    run: () => runPeriodogramSample(),
    label: '周期图 / 功率谱峰',
  },
  {
    methodId: 'method-algo-wavelet-soft-thresh',
    family: 'method-wavelet',
    run: () => runWaveletThresholdSample(),
    label: '小波软阈值去噪',
  },
  {
    methodId: 'method-algo-pue-factor',
    family: META_TOKEN_PARENT,
    run: () => runPueSample(),
    label: '数据中心能效比因子',
  },
  {
    methodId: 'method-algo-bem-collocation',
    family: METHOD_BEM,
    run: () => runBemCollocationSample(),
    label: '边界元配点格林和',
  },
  {
    methodId: 'method-algo-ks-scf',
    family: METHOD_DFT_ELECTRONIC,
    run: () => runKsScfSample(),
    label: '自洽场密度混合残差',
  },
  {
    methodId: 'method-algo-ks-scf-stub',
    family: METHOD_DFT_ELECTRONIC,
    run: () => runKsScfSample(),
    label: 'KS-SCF 残差自洽',
  },
  {
    methodId: 'method-algo-wavelet-threshold',
    family: 'method-wavelet',
    run: () => runWaveletThresholdSample(),
    label: '小波软阈值去噪',
  },
  {
    methodId: 'method-algo-fem-assemble',
    family: METHOD_FEM,
    run: () => runFemAssembleSample(),
    label: '有限元单元组装',
  },
  {
    methodId: 'method-algo-lbm-bgk-collide',
    family: METHOD_LBM,
    run: () => runLbmBkgSample(),
    label: '单松弛碰撞算子',
  },
  {
    methodId: 'method-algo-pic-push',
    family: METHOD_PIC,
    run: () => runPicPushSample(),
    label: '粒子网格粒子推进',
  },

  // ── L3 catalog children (chebyshev / mass / Guo / tok/J / LDA / …) ──
  {
    methodId: 'method-algo-chebyshev-interp',
    family: METHOD_SPECTRAL,
    run: () => runChebyshevInterpSample(),
    label: '切比雪夫插值节点',
  },
  {
    methodId: 'method-algo-fem-mass-matrix',
    family: METHOD_FEM,
    run: () => runFemMassMatrixSample(),
    label: '有限元质量矩阵',
  },
  {
    methodId: 'method-algo-lbm-guo-force',
    family: METHOD_LBM,
    run: () => runLbmGuoForceSample(),
    label: '郭氏外力源项',
  },
  {
    methodId: 'method-algo-lbm-force-guo',
    family: METHOD_LBM,
    run: () => runLbmGuoForceSample(),
    label: '郭氏外力项',
  },
  {
    methodId: 'method-algo-token-throughput',
    family: META_TOKEN_PARENT,
    run: () => runTokenThroughputSample(),
    label: '令牌吞吐 / 焦耳',
  },
  {
    methodId: 'method-algo-lda-exchange',
    family: METHOD_DFT_ELECTRONIC,
    run: () => runLdaExchangeSample(),
    label: '局域密度近似交换能密度',
  },
  {
    methodId: 'method-algo-exchange-lda-stub',
    family: METHOD_DFT_ELECTRONIC,
    run: () => runLdaExchangeSample(),
    label: 'LDA 交换能密度',
  },
  {
    methodId: 'method-algo-bem-double-layer',
    family: METHOD_BEM,
    run: () => runBemDoubleLayerSample(),
    label: '边界元双层势',
  },
  {
    methodId: 'method-algo-exergy-lost-work',
    family: 'method-exergy-analysis',
    run: () => runExergyLostWorkSample(),
    label: '㶲损 / 不可逆失功',
  },
  {
    methodId: 'method-algo-exergy-efficiency',
    family: 'method-exergy-analysis',
    run: () => runExergyEfficiencySample(),
    label: '㶲效率（功/输入㶲）',
  },
  {
    methodId: 'method-algo-pf-ess',
    family: 'method-particle-filter',
    run: () => runPfEssSample(),
    label: '有效样本量',
  },
  {
    methodId: 'method-algo-pic-boris',
    family: METHOD_PIC,
    run: () => runBorisPushSample(),
    label: '鲍里斯洛伦兹推进',
  },
  {
    methodId: 'method-algo-nose-hoover',
    family: MD_L3_PARENT,
    run: () => runNoseHooverSample(),
    label: '诺斯–胡佛恒温',
  },
  {
    methodId: 'method-algo-cell-list',
    family: MD_L3_PARENT,
    run: () => runCellListSample(),
    label: '元胞链表邻居',
  },
  {
    methodId: 'method-algo-fvm-roe-stub',
    family: 'method-finite-volume',
    run: () => runFvmRoeSample(),
    label: '罗伊近似黎曼通量',
  },
  {
    methodId: 'method-algo-levelset-reinit',
    family: 'method-level-set',
    run: () => runLevelsetReinitSample(),
    label: '水平集重新初始化',
  },
  {
    methodId: 'method-algo-sph-cubic-spline',
    family: METHOD_SPH,
    run: () => runSphCubicSplineSample(),
    label: '光滑粒子三次样条核',
  },
  {
    methodId: 'method-algo-sph-density-sum',
    family: METHOD_SPH,
    run: () => runSphDensitySumSample(),
    label: '光滑粒子密度求和',
  },
  {
    methodId: 'method-algo-dem-linear-spring',
    family: METHOD_DEM,
    run: () => runDemLinearSpringSample(),
    label: '离散元线性弹簧–阻尼',
  },
  {
    methodId: 'method-algo-dem-hertz',
    family: METHOD_DEM,
    run: () => runDemHertzSample(),
    label: '离散元赫兹法向接触',
  },
  {
    methodId: METHOD_SPH,
    family: METHOD_SPH,
    run: () => runSphCubicSplineSample(),
    label: '光滑粒子 · 族',
  },
  {
    methodId: METHOD_DEM,
    family: METHOD_DEM,
    run: () => runDemLinearSpringSample(),
    label: '离散元 · 族',
  },
  {
    methodId: 'method-algo-sph-pressure-force',
    family: METHOD_SPH,
    run: () => runSphPressureForceSample(),
    label: '光滑粒子压强力',
  },
  {
    methodId: 'method-algo-sph-art-visc',
    family: METHOD_SPH,
    run: () => runSphArtViscSample(),
    label: '光滑粒子人工粘性',
  },
  {
    methodId: 'method-algo-dem-coulomb',
    family: METHOD_DEM,
    run: () => runDemCoulombSample(),
    label: '离散元库仑摩擦',
  },
  {
    methodId: 'method-algo-fvm-weno3',
    family: 'method-finite-volume',
    run: () => runFvmWeno3Sample(),
    label: '加权本质无振荡界面重构',
  },
  {
    methodId: 'method-algo-fdtd-conductivity',
    family: FDTD_PARENT,
    run: () => runFdtdConductivitySample(),
    label: '时域有限差分电导损耗',
  },
  {
    methodId: METHOD_MPM,
    family: METHOD_MPM,
    run: () => runMpmPicTransferSample(),
    label: '物质点 · 族',
  },
  {
    methodId: 'method-algo-mpm-pic-transfer',
    family: METHOD_MPM,
    run: () => runMpmPicTransferSample(),
    label: '物质点质量动量散射',
  },
  {
    methodId: 'method-algo-mpm-g2p',
    family: METHOD_MPM,
    run: () => runMpmG2pSample(),
    label: '物质点速度回插',
  },
  {
    methodId: METHOD_DG,
    family: METHOD_DG,
    run: () => runDgMassLocalSample(),
    label: '间断伽辽金 · 族',
  },
  {
    methodId: 'method-algo-dg-mass-local',
    family: METHOD_DG,
    run: () => runDgMassLocalSample(),
    label: '间断伽辽金局部质量矩阵',
  },
  {
    methodId: 'method-algo-dg-upwind-flux',
    family: METHOD_DG,
    run: () => runDgUpwindFluxSample(),
    label: '间断伽辽金迎风数值通量',
  },
  {
    methodId: METHOD_VLASOV,
    family: METHOD_VLASOV,
    run: () => runVlasovStreamSample(),
    label: '弗拉索夫–泊松 · 族',
  },
  {
    methodId: 'method-algo-vlasov-stream',
    family: METHOD_VLASOV,
    run: () => runVlasovStreamSample(),
    label: '弗拉索夫相空间流送',
  },
  {
    methodId: 'method-algo-vlasov-poisson-1d',
    family: METHOD_VLASOV,
    run: () => runVlasovPoisson1dSample(),
    label: '1D 泊松自洽场',
  },
  {
    methodId: 'method-algo-mpm-usl-stress',
    family: METHOD_MPM,
    run: () => runMpmUslStressSample(),
    label: '物质点应力更新',
  },
  {
    methodId: 'method-algo-dg-slope-limit',
    family: METHOD_DG,
    run: () => runDgSlopeLimitSample(),
    label: '间断伽辽金斜率限制器',
  },
  {
    methodId: 'method-algo-lbm-bounce-back',
    family: LBM_L3_PARENT,
    run: () => runLbmBounceBackSample(),
    label: '格子玻尔兹曼反弹边界',
  },
  {
    methodId: 'method-algo-lbm-mrt-stub',
    family: LBM_L3_PARENT,
    run: () => runLbmMrtStubSample(),
    label: 'LBM 多松弛 MRT 碰撞',
  },
  {
    methodId: 'method-algo-fem-cg',
    family: FEM_L3_PARENT,
    run: () => runFemCgSample(),
    label: '有限元共轭梯度求解',
  },
  {
    methodId: 'method-algo-wavelet-hard-thresh',
    family: 'method-wavelet',
    run: () => runWaveletHardThreshSample(),
    label: '小波硬阈值去噪',
  },
  {
    methodId: 'method-algo-pseudospectral-diff',
    family: 'method-spectral-method',
    run: () => runPseudospectralDiffSample(),
    label: '伪谱导数',
  },
  {
    methodId: METHOD_PHASEFIELD,
    family: METHOD_PHASEFIELD,
    run: () => runAllenCahnSample(),
    label: '相场 · 族',
  },
  {
    methodId: 'method-algo-allen-cahn',
    family: METHOD_PHASEFIELD,
    run: () => runAllenCahnSample(),
    label: '艾伦–卡恩演化',
  },
  {
    methodId: 'method-algo-cahn-hilliard-chem',
    family: METHOD_PHASEFIELD,
    run: () => runCahnHilliardChemSample(),
    label: '卡恩–希利亚德化学势',
  },
  {
    methodId: METHOD_PERIDYNAMICS,
    family: METHOD_PERIDYNAMICS,
    run: () => runPdBondForceSample(),
    label: '近场动力学 · 族',
  },
  {
    methodId: 'method-algo-pd-bond-force',
    family: METHOD_PERIDYNAMICS,
    run: () => runPdBondForceSample(),
    label: '近场动力学键力密度',
  },
  {
    methodId: 'method-algo-pd-dilatation',
    family: METHOD_PERIDYNAMICS,
    run: () => runPdDilatationSample(),
    label: '近场动力学局部膨胀/损伤',
  },
  {
    methodId: 'method-algo-pf-mobility',
    family: METHOD_PHASEFIELD,
    run: () => runPfMobilitySample(),
    label: '相场退化迁移率',
  },
  {
    methodId: 'method-algo-vlasov-accel',
    family: METHOD_VLASOV,
    run: () => runVlasovAccelSample(),
    label: '弗拉索夫速度加速',
  },
  {
    methodId: 'method-algo-pf-systematic',
    family: 'method-particle-filter',
    run: () => runPfSystematicSample(),
    label: '粒子滤波系统重采样',
  },
  {
    methodId: 'method-algo-fdtd-cpml',
    family: FDTD_PARENT,
    run: () => runFdtdCpmlSample(),
    label: '时域有限差分完全匹配层吸收',
  },
  {
    methodId: METHOD_TMM,
    family: METHOD_TMM,
    run: () => runTmmLayerSample(),
    label: '传输矩阵 传输矩阵法 · 族',
  },
  {
    methodId: 'method-algo-tmm-layer',
    family: METHOD_TMM,
    run: () => runTmmLayerSample(),
    label: '传输矩阵单层',
  },
  {
    methodId: 'method-algo-tmm-stack',
    family: METHOD_TMM,
    run: () => runTmmStackSample(),
    label: '传输矩阵多层叠乘',
  },
  {
    methodId: METHOD_MULTIGRID,
    family: METHOD_MULTIGRID,
    run: () => runMgVcycleSample(),
    label: '多重网格 · 族',
  },
  {
    methodId: 'method-algo-mg-restrict',
    family: METHOD_MULTIGRID,
    run: () => runMgRestrictSample(),
    label: '多重网格全加权限制',
  },
  {
    methodId: 'method-algo-mg-vcycle',
    family: METHOD_MULTIGRID,
    run: () => runMgVcycleSample(),
    label: '多重网格 V 循环',
  },
  {
    methodId: METHOD_BPM,
    family: METHOD_BPM,
    run: () => runBpmSplitStepSample(),
    label: '光束传播 光束传播法 · 族',
  },
  {
    methodId: 'method-algo-bpm-split-step',
    family: METHOD_BPM,
    run: () => runBpmSplitStepSample(),
    label: '光束传播分步傅里叶',
  },
  {
    methodId: METHOD_GMRES,
    family: METHOD_GMRES,
    run: () => runGmresSample(),
    label: '广义最小残差求解器 · 族',
  },
  {
    methodId: 'method-algo-gmres',
    family: METHOD_GMRES,
    run: () => runGmresSample(),
    label: '重启广义最小残差',
  },
  {
    methodId: 'method-algo-bpm-kerr',
    family: METHOD_BPM,
    run: () => runBpmKerrSample(),
    label: '光束传播克尔非线性',
  },
  {
    methodId: METHOD_SCHRODINGER,
    family: METHOD_SCHRODINGER,
    run: () => runTdseSplitSample(),
    label: '含时薛定谔方程 · 族',
  },
  {
    methodId: 'method-algo-tdse-split',
    family: METHOD_SCHRODINGER,
    run: () => runTdseSplitSample(),
    label: '含时薛定谔分步算符',
  },
  {
    methodId: 'method-algo-tdse-prob',
    family: METHOD_SCHRODINGER,
    run: () => runTdseProbSample(),
    label: '含时薛定谔概率归一',
  },
  {
    methodId: METHOD_RBF,
    family: METHOD_RBF,
    run: () => runRbfGaussSample(),
    label: '径向基 · 族',
  },
  {
    methodId: 'method-algo-rbf-gauss',
    family: METHOD_RBF,
    run: () => runRbfGaussSample(),
    label: '径向基高斯核',
  },
  {
    methodId: 'method-algo-rbf-interp',
    family: METHOD_RBF,
    run: () => runRbfInterpSample(),
    label: '径向基配点插值',
  },
  {
    methodId: METHOD_SPLITTING,
    family: METHOD_SPLITTING,
    run: () => runStrangSample(),
    label: '算子分裂 · 族',
  },
  {
    methodId: 'method-algo-lie-trotter',
    family: METHOD_SPLITTING,
    run: () => runLieTrotterSample(),
    label: '李–特罗特分裂',
  },
  {
    methodId: 'method-algo-strang',
    family: METHOD_SPLITTING,
    run: () => runStrangSample(),
    label: '斯特朗分裂',
  },
  {
    methodId: METHOD_BICGSTAB,
    family: METHOD_BICGSTAB,
    run: () => runBicgstabSample(),
    label: '双共轭梯度稳定求解器 · 族',
  },
  {
    methodId: 'method-algo-bicgstab',
    family: METHOD_BICGSTAB,
    run: () => runBicgstabSample(),
    label: '双共轭梯度稳定迭代',
  },
  {
    methodId: METHOD_HELMHOLTZ,
    family: METHOD_HELMHOLTZ,
    run: () => runHelmholtzFdSample(),
    label: '亥姆霍兹方程 · 族',
  },
  {
    methodId: 'method-algo-helmholtz-fd',
    family: METHOD_HELMHOLTZ,
    run: () => runHelmholtzFdSample(),
    label: '亥姆霍兹一维有限差',
  },
  {
    methodId: METHOD_MCRT,
    family: METHOD_MCRT,
    run: () => runMcrtWalkSample(),
    label: '蒙特卡洛辐射传输 · 族',
  },
  {
    methodId: 'method-algo-mcrt-walk',
    family: METHOD_MCRT,
    run: () => runMcrtWalkSample(),
    label: '蒙特卡洛辐射传输光子游走',
  },
  {
    methodId: METHOD_RK,
    family: METHOD_RK,
    run: () => runRk4Sample(),
    label: '龙格–库塔积分 · 族',
  },
  {
    methodId: 'method-algo-rk4',
    family: METHOD_RK,
    run: () => runRk4Sample(),
    label: '经典四阶龙格–库塔',
  },
  {
    methodId: 'method-algo-tdse-imag',
    family: METHOD_SCHRODINGER,
    run: () => runTdseImagSample(),
    label: '含时薛定谔虚时演化',
  },
  {
    methodId: 'method-algo-mg-wcycle',
    family: METHOD_MULTIGRID,
    run: () => runMgWcycleSample(),
    label: '多重网格 W 循环',
  },
  {
    methodId: METHOD_KMC,
    family: METHOD_KMC,
    run: () => runKmcStepSample(),
    label: '动力学蒙特卡洛 · 族',
  },
  {
    methodId: 'method-algo-kmc-rates',
    family: METHOD_KMC,
    run: () => runKmcRatesSample(),
    label: '动力学蒙特卡洛速率/累计',
  },
  {
    methodId: 'method-algo-kmc-step',
    family: METHOD_KMC,
    run: () => runKmcStepSample(),
    label: '动力学蒙特卡洛一步推进',
  },
  {
    methodId: METHOD_MOM,
    family: METHOD_MOM,
    run: () => runMomImpedanceSample(),
    label: '矩量法 · 族',
  },
  {
    methodId: 'method-algo-mom-impedance',
    family: METHOD_MOM,
    run: () => runMomImpedanceSample(),
    label: '矩量法阻抗矩阵',
  },
  {
    methodId: 'method-algo-mom-solve',
    family: METHOD_MOM,
    run: () => runMomSolveSample(),
    label: '矩量法电流求解',
  },
  {
    methodId: METHOD_PINN,
    family: METHOD_PINN,
    run: () => runPinnResidualSample(),
    label: '物理信息神经网络 · 族',
  },
  {
    methodId: 'method-algo-pinn-residual',
    family: METHOD_PINN,
    run: () => runPinnResidualSample(),
    label: '物理信息神经网络配点残差',
  },
  {
    methodId: METHOD_PE,
    family: METHOD_PE,
    run: () => runPeSsfSample(),
    label: '抛物方程 · 族',
  },
  {
    methodId: 'method-algo-pe-ssf',
    family: METHOD_PE,
    run: () => runPeSsfSample(),
    label: '抛物方程分步傅里叶',
  },
  {
    methodId: METHOD_HOMOGENIZATION,
    family: METHOD_HOMOGENIZATION,
    run: () => runHomogSeriesSample(),
    label: '均匀化 / 有效介质 · 族',
  },
  {
    methodId: 'method-algo-homog-series',
    family: METHOD_HOMOGENIZATION,
    run: () => runHomogSeriesSample(),
    label: '串联有效传导',
  },
  {
    methodId: 'method-algo-homog-parallel',
    family: METHOD_HOMOGENIZATION,
    run: () => runHomogParallelSample(),
    label: '并联有效传导',
  },
  {
    methodId: METHOD_PID,
    family: METHOD_PID,
    run: () => runPidStepSample(),
    label: '比例积分微分控制 · 族',
  },
  {
    methodId: 'method-algo-pid-step',
    family: METHOD_PID,
    run: () => runPidStepSample(),
    label: '离散比例积分微分步进',
  },
  {
    methodId: METHOD_ADI,
    family: METHOD_ADI,
    run: () => runAdiHeatSample(),
    label: '交替方向隐式 · 族',
  },
  {
    methodId: 'method-algo-adi-heat',
    family: METHOD_ADI,
    run: () => runAdiHeatSample(),
    label: '交替方向隐式二维热传导',
  },
  {
    methodId: 'method-algo-adi-sweep',
    family: METHOD_ADI,
    run: () => runAdiSweepSample(),
    label: '交替方向隐式半步扫掠',
  },
  {
    methodId: METHOD_SHOOTING,
    family: METHOD_SHOOTING,
    run: () => runShootLinearSample(),
    label: '打靶法 · 族',
  },
  {
    methodId: 'method-algo-shoot-linear',
    family: METHOD_SHOOTING,
    run: () => runShootLinearSample(),
    label: '线性打靶',
  },
  {
    methodId: 'method-algo-shoot-secant',
    family: METHOD_SHOOTING,
    run: () => runShootSecantSample(),
    label: '打靶割线校正',
  },
  {
    methodId: METHOD_LQR,
    family: METHOD_LQR,
    run: () => runLqrRiccatiSample(),
    label: '线性二次最优控制 · 族',
  },
  {
    methodId: 'method-algo-lqr-riccati',
    family: METHOD_LQR,
    run: () => runLqrRiccatiSample(),
    label: '离散里卡提迭代',
  },
  {
    methodId: METHOD_SPARSE,
    family: METHOD_SPARSE,
    run: () => runCsrSpmvSample(),
    label: '稀疏线性代数 · 族',
  },
  {
    methodId: 'method-algo-csr-spmv',
    family: METHOD_SPARSE,
    run: () => runCsrSpmvSample(),
    label: '压缩稀疏行矩阵-向量积',
  },
  {
    methodId: 'method-algo-jacobi-iter',
    family: METHOD_SPARSE,
    run: () => runJacobiIterSample(),
    label: '雅可比迭代',
  },
  {
    methodId: METHOD_BFGS,
    family: METHOD_BFGS,
    run: () => runBfgsUpdateSample(),
    label: '拟牛顿优化 · 族',
  },
  {
    methodId: 'method-algo-bfgs-update',
    family: METHOD_BFGS,
    run: () => runBfgsUpdateSample(),
    label: '拟牛顿更新最小化',
  },
  {
    methodId: METHOD_LATTICE_GAS,
    family: METHOD_LATTICE_GAS,
    run: () => runHppCollideSample(),
    label: '格子气自动机 · 族',
  },
  {
    methodId: 'method-algo-hpp-collide',
    family: METHOD_LATTICE_GAS,
    run: () => runHppCollideSample(),
    label: '格点气体对头碰撞',
  },
  {
    methodId: 'method-algo-hpp-stream',
    family: METHOD_LATTICE_GAS,
    run: () => runHppStreamSample(),
    label: '格点气体迁移流送',
  },
  {
    methodId: METHOD_NYSTROM,
    family: METHOD_NYSTROM,
    run: () => runNystromQuadSample(),
    label: '尼斯特龙积分方程 · 族',
  },
  {
    methodId: 'method-algo-nystrom-quad',
    family: METHOD_NYSTROM,
    run: () => runNystromQuadSample(),
    label: '尼斯特龙求积离散',
  },
  {
    methodId: METHOD_CONVOLUTION,
    family: METHOD_CONVOLUTION,
    run: () => runConvDftSample(),
    label: '卷积 / 卷积定理 · 族',
  },
  {
    methodId: 'method-algo-conv-dft',
    family: METHOD_CONVOLUTION,
    run: () => runConvDftSample(),
    label: '离散傅里叶变换圆卷积',
  },
  {
    methodId: METHOD_POD,
    family: METHOD_POD,
    run: () => runPodSvdSample(),
    label: '本征正交分解 · 族',
  },
  {
    methodId: 'method-algo-pod-svd',
    family: METHOD_POD,
    run: () => runPodSvdSample(),
    label: '本征正交分解模态',
  },
  {
    methodId: 'method-algo-pod-project',
    family: METHOD_POD,
    run: () => runPodProjectSample(),
    label: '本征正交分解投影重构',
  },
  {
    methodId: METHOD_NELDER_MEAD,
    family: METHOD_NELDER_MEAD,
    run: () => runNmSimplexSample(),
    label: '内尔德–米德单纯形 · 族',
  },
  {
    methodId: 'method-algo-nm-simplex',
    family: METHOD_NELDER_MEAD,
    run: () => runNmSimplexSample(),
    label: '内尔德–米德单纯形迭代',
  },
  {
    methodId: METHOD_FFT,
    family: METHOD_FFT,
    run: () => runFftRadix2Sample(),
    label: '快速傅里叶变换 · 族',
  },
  {
    methodId: 'method-algo-fft-radix2',
    family: METHOD_FFT,
    run: () => runFftRadix2Sample(),
    label: '基-2 快速傅里叶变换',
  },
  {
    methodId: METHOD_BDF,
    family: METHOD_BDF,
    run: () => runBdf2Sample(),
    label: '后向差分多步法 · 族',
  },
  {
    methodId: 'method-algo-bdf2',
    family: METHOD_BDF,
    run: () => runBdf2Sample(),
    label: '二阶后向差分步进',
  },
  {
    methodId: METHOD_COLLOCATION,
    family: METHOD_COLLOCATION,
    run: () => runChebCollocSample(),
    label: '配置法 · 族',
  },
  {
    methodId: 'method-algo-cheb-colloc',
    family: METHOD_COLLOCATION,
    run: () => runChebCollocSample(),
    label: '切比雪夫配置边值问题',
  },
  {
    methodId: METHOD_SA,
    family: METHOD_SA,
    run: () => runSaStepSample(),
    label: '模拟退火 · 族',
  },
  {
    methodId: 'method-algo-sa-step',
    family: METHOD_SA,
    run: () => runSaStepSample(),
    label: '模拟退火步进',
  },
  {
    methodId: METHOD_GA,
    family: METHOD_GA,
    run: () => runGaGenerationSample(),
    label: '遗传算法 · 族',
  },
  {
    methodId: 'method-algo-ga-generation',
    family: METHOD_GA,
    run: () => runGaGenerationSample(),
    label: '遗传算法一代演化',
  },
  {
    methodId: METHOD_UQ,
    family: METHOD_UQ,
    run: () => runUqMcSample(),
    label: '不确定性量化 · 族',
  },
  {
    methodId: 'method-algo-uq-mc',
    family: METHOD_UQ,
    run: () => runUqMcSample(),
    label: '不确定度蒙特卡洛传播',
  },
  {
    methodId: METHOD_TRUST_REGION,
    family: METHOD_TRUST_REGION,
    run: () => runTrCauchySample(),
    label: '信赖域 · 族',
  },
  {
    methodId: 'method-algo-tr-cauchy',
    family: METHOD_TRUST_REGION,
    run: () => runTrCauchySample(),
    label: '柯西点信赖域步',
  },
  {
    methodId: 'method-algo-rts-smooth',
    family: 'method-kalman',
    run: () => runRtsSmoothSample(),
    label: '卡尔曼平滑',
  },
  {
    methodId: METHOD_PSO,
    family: METHOD_PSO,
    run: () => runPsoStepSample(),
    label: '粒子群优化 · 族',
  },
  {
    methodId: 'method-algo-pso-step',
    family: METHOD_PSO,
    run: () => runPsoStepSample(),
    label: '粒子群速度位置步进',
  },
  {
    methodId: METHOD_AD,
    family: METHOD_AD,
    run: () => runAdForwardSample(),
    label: '自动微分 · 族',
  },
  {
    methodId: 'method-algo-ad-forward',
    family: METHOD_AD,
    run: () => runAdForwardSample(),
    label: '前向模式自动微分',
  },
  {
    methodId: METHOD_LANCZOS,
    family: METHOD_LANCZOS,
    run: () => runLanczosEigSample(),
    label: '兰索斯特征值 · 族',
  },
  {
    methodId: 'method-algo-lanczos-eig',
    family: METHOD_LANCZOS,
    run: () => runLanczosEigSample(),
    label: '兰索斯特征逼近',
  },
  {
    methodId: METHOD_MCMC,
    family: METHOD_MCMC,
    run: () => runMhSample(),
    label: '马尔可夫链蒙特卡洛 · 族',
  },
  {
    methodId: 'method-algo-mh',
    family: METHOD_MCMC,
    run: () => runMhSample(),
    label: '梅特罗波利斯–黑斯廷斯',
  },
  {
    methodId: METHOD_EM,
    family: METHOD_EM,
    run: () => runEmGmmSample(),
    label: '期望最大化 · 族',
  },
  {
    methodId: 'method-algo-em-gmm',
    family: METHOD_EM,
    run: () => runEmGmmSample(),
    label: '期望最大化高斯混合',
  },
  {
    methodId: METHOD_CWT,
    family: METHOD_CWT,
    run: () => runCwtMexhatSample(),
    label: '连续小波变换 · 族',
  },
  {
    methodId: 'method-algo-cwt-mexhat',
    family: METHOD_CWT,
    run: () => runCwtMexhatSample(),
    label: '墨西哥帽小波',
  },
  {
    methodId: METHOD_ILP,
    family: METHOD_ILP,
    run: () => runBnbSample(),
    label: '整数线性规划 · 族',
  },
  {
    methodId: 'method-algo-bnb',
    family: METHOD_ILP,
    run: () => runBnbSample(),
    label: '分支定界 0-1',
  },
  {
    methodId: METHOD_LP,
    family: METHOD_LP,
    run: () => runSimplexSample(),
    label: '线性规划 · 族',
  },
  {
    methodId: 'method-algo-simplex',
    family: METHOD_LP,
    run: () => runSimplexSample(),
    label: '单纯形法',
  },
  {
    methodId: METHOD_SQ,
    family: METHOD_SQ,
    run: () => runSqLimitSample(),
    label: '肖克利–奎伊瑟极限 · 族',
  },
  {
    methodId: 'method-algo-sq-limit',
    family: METHOD_SQ,
    run: () => runSqLimitSample(),
    label: '肖克利–奎伊瑟极限扫带隙',
  },
  {
    methodId: METHOD_BATTERY,
    family: METHOD_BATTERY,
    run: () => runBatteryOcvSample(),
    label: '电池等效电路 · 族',
  },
  {
    methodId: 'method-algo-battery-ocv',
    family: METHOD_BATTERY,
    run: () => runBatteryOcvSample(),
    label: '电池开路电压–荷电状态',
  },
  {
    methodId: 'method-algo-battery-rint',
    family: METHOD_BATTERY,
    run: () => runBatteryRintSample(),
    label: '内阻放电',
  },
  {
    methodId: METHOD_BLOCH,
    family: METHOD_BLOCH,
    run: () => runBlochPrecessSample(),
    label: '布洛赫方程 · 族',
  },
  {
    methodId: 'method-algo-bloch-precess',
    family: METHOD_BLOCH,
    run: () => runBlochPrecessSample(),
    label: '布洛赫自由进动',
  },
  {
    methodId: METHOD_FIBER,
    family: METHOD_FIBER,
    run: () => runFiberAttenSample(),
    label: '光纤传播 · 族',
  },
  {
    methodId: 'method-algo-fiber-atten',
    family: METHOD_FIBER,
    run: () => runFiberAttenSample(),
    label: '光纤衰减',
  },
  {
    methodId: 'method-algo-fiber-dispersion-stub',
    family: METHOD_FIBER,
    run: () => runFiberDispersionSample(),
    label: '光纤色散占位',
  },
  {
    methodId: METHOD_PIEZO,
    family: METHOD_PIEZO,
    run: () => runPiezoDirectSample(),
    label: '压电耦合 · 族',
  },
  {
    methodId: 'method-algo-piezo-direct',
    family: METHOD_PIEZO,
    run: () => runPiezoDirectSample(),
    label: '正压电',
  },
  {
    methodId: 'method-algo-piezo-converse',
    family: METHOD_PIEZO,
    run: () => runPiezoConverseSample(),
    label: '逆压电',
  },
  {
    methodId: METHOD_RANKINE,
    family: METHOD_RANKINE,
    run: () => runRankineEtaSample(),
    label: '朗肯循环 · 族',
  },
  {
    methodId: 'method-algo-rankine-eta',
    family: METHOD_RANKINE,
    run: () => runRankineEtaSample(),
    label: '理想热机效率',
  },
  {
    methodId: METHOD_SEEBECK,
    family: METHOD_SEEBECK,
    run: () => runSeebeckVSample(),
    label: '塞贝克热电 · 族',
  },
  {
    methodId: 'method-algo-seebeck-v',
    family: METHOD_SEEBECK,
    run: () => runSeebeckVSample(),
    label: '塞贝克电压',
  },
  {
    methodId: 'method-algo-zt-figure',
    family: METHOD_SEEBECK,
    run: () => runZTSample(),
    label: '热电优值',
  },
  {
    methodId: METHOD_WIND,
    family: METHOD_WIND,
    run: () => runWindPowerSample(),
    label: '风力功率 · 族',
  },
  {
    methodId: 'method-algo-betz-limit',
    family: METHOD_WIND,
    run: () => runBetzSample(),
    label: '贝茨极限',
  },
  {
    methodId: 'method-algo-wind-power',
    family: METHOD_WIND,
    run: () => runWindPowerSample(),
    label: '风功率 ½ρAv³',
  },
  {
    methodId: METHOD_FUELCELL,
    family: METHOD_FUELCELL,
    run: () => runNernstSample(),
    label: '燃料电池 · 族',
  },
  {
    methodId: 'method-algo-nernst-voltage',
    family: METHOD_FUELCELL,
    run: () => runNernstSample(),
    label: '能斯特电压',
  },
  {
    methodId: 'method-algo-fc-polarization-stub',
    family: METHOD_FUELCELL,
    run: () => runFcPolarizationSample(),
    label: '燃料电池极化曲线',
  },
  {
    methodId: METHOD_DIODE,
    family: METHOD_DIODE,
    run: () => runShockleyDiodeSample(),
    label: '二极管方程 · 族',
  },
  {
    methodId: 'method-algo-shockley-diode',
    family: METHOD_DIODE,
    run: () => runShockleyDiodeSample(),
    label: '肖克利二极管',
  },
  {
    methodId: METHOD_STEFAN,
    family: METHOD_STEFAN,
    run: () => runStefanSample(),
    label: '斯特藩–玻尔兹曼 · 族',
  },
  {
    methodId: 'method-algo-stefan-law',
    family: METHOD_STEFAN,
    run: () => runStefanSample(),
    label: '斯特藩定律',
  },
  {
    methodId: METHOD_ZMATCH,
    family: METHOD_ZMATCH,
    run: () => runReflectionGammaSample(),
    label: '阻抗匹配 · 族',
  },
  {
    methodId: 'method-algo-reflection-gamma',
    family: METHOD_ZMATCH,
    run: () => runReflectionGammaSample(),
    label: '反射系数 Γ',
  },
  {
    methodId: METHOD_ALGO_SMITH_CHART,
    family: METHOD_ZMATCH,
    run: () => runSmithChartSample(),
    label: '史密斯圆图',
  },
  {
    methodId: METHOD_NODE_BUDGET,
    family: METHOD_NODE_BUDGET,
    run: () => runNodeDutyBudgetSample(),
    label: '节点功耗账本 · 族',
  },
  {
    methodId: METHOD_ALGO_NODE_DUTY,
    family: METHOD_NODE_BUDGET,
    run: () => runNodeDutyBudgetSample(),
    label: '占空比功耗与寿命',
  },
  {
    methodId: METHOD_ALGO_EDGE_SELF_POWER_CHAIN,
    family: METHOD_NODE_BUDGET,
    run: () => runEdgeSelfPowerChainSample(),
    label: '边缘自供电计算链',
  },
  {
    methodId: METHOD_ALGO_RESEARCH_2026,
    family: METHOD_NODE_BUDGET,
    run: () => runResearch2026ClaimsSample(),
    label: '2026 研究可计算断言',
  },
  {
    methodId: METHOD_CARNOT,
    family: METHOD_CARNOT,
    run: () => runCarnotEtaSample(),
    label: '卡诺循环 · 族',
  },
  {
    methodId: 'method-algo-carnot-eta',
    family: METHOD_CARNOT,
    run: () => runCarnotEtaSample(),
    label: '卡诺效率',
  },
  {
    methodId: METHOD_OTTO,
    family: METHOD_OTTO,
    run: () => runOttoEtaSample(),
    label: '奥托循环 · 族',
  },
  {
    methodId: 'method-algo-otto-eta',
    family: METHOD_OTTO,
    run: () => runOttoEtaSample(),
    label: '奥托效率',
  },
  {
    methodId: METHOD_HALL,
    family: METHOD_HALL,
    run: () => runHallVoltageSample(),
    label: '霍尔效应 · 族',
  },
  {
    methodId: 'method-algo-hall-voltage',
    family: METHOD_HALL,
    run: () => runHallVoltageSample(),
    label: '霍尔电压',
  },
  {
    methodId: METHOD_HYDRO,
    family: METHOD_HYDRO,
    run: () => runHydroPowerSample(),
    label: '水力发电 · 族',
  },
  {
    methodId: 'method-algo-hydro-power',
    family: METHOD_HYDRO,
    run: () => runHydroPowerSample(),
    label: '水力功率',
  },
  {
    methodId: 'method-algo-hydro-head',
    family: METHOD_HYDRO,
    run: () => runHydroHeadSample(),
    label: '比水头势能',
  },
  {
    methodId: METHOD_PA,
    family: METHOD_PA,
    run: () => runPaPressureSample(),
    label: '光声效应 · 族',
  },
  {
    methodId: 'method-algo-pa-pressure',
    family: METHOD_PA,
    run: () => runPaPressureSample(),
    label: '光声初始压',
  },
  {
    methodId: METHOD_MCE,
    family: METHOD_MCE,
    run: () => runMceDeltaTSample(),
    label: '磁热效应 · 族',
  },
  {
    methodId: 'method-algo-mce-delta-t',
    family: METHOD_MCE,
    run: () => runMceDeltaTSample(),
    label: '磁热绝热温变',
  },
  {
    methodId: METHOD_COMPTON,
    family: METHOD_COMPTON,
    run: () => runComptonShiftSample(),
    label: '康普顿散射 · 族',
  },
  {
    methodId: 'method-algo-compton-shift',
    family: METHOD_COMPTON,
    run: () => runComptonShiftSample(),
    label: '康普顿波长移动',
  },
  {
    methodId: METHOD_MHD,
    family: METHOD_MHD,
    run: () => runMhdEmfSample(),
    label: '磁流体发电 · 族',
  },
  {
    methodId: 'method-algo-mhd-emf',
    family: METHOD_MHD,
    run: () => runMhdEmfSample(),
    label: '磁流体电动势',
  },
  {
    methodId: METHOD_FRESNEL,
    family: METHOD_FRESNEL,
    run: () => runFresnelRSample(),
    label: '菲涅耳–斯涅尔 · 族',
  },
  {
    methodId: 'method-algo-fresnel-r',
    family: METHOD_FRESNEL,
    run: () => runFresnelRSample(),
    label: '正入射菲涅耳 R',
  },
  {
    methodId: METHOD_JT,
    family: METHOD_JT,
    run: () => runJtMuSample(),
    label: '焦耳–汤姆孙 · 族',
  },
  {
    methodId: 'method-algo-jt-mu',
    family: METHOD_JT,
    run: () => runJtMuSample(),
    label: '焦耳–汤姆孙温变',
  },
  {
    methodId: METHOD_THOMSON,
    family: METHOD_THOMSON,
    run: () => runThomsonHeatSample(),
    label: '汤姆孙热电 · 族',
  },
  {
    methodId: 'method-algo-thomson-heat',
    family: METHOD_THOMSON,
    run: () => runThomsonHeatSample(),
    label: '汤姆孙热',
  },
  {
    methodId: METHOD_DIESEL,
    family: METHOD_DIESEL,
    run: () => runDieselEtaSample(),
    label: '柴油循环 · 族',
  },
  {
    methodId: 'method-algo-diesel-eta',
    family: METHOD_DIESEL,
    run: () => runDieselEtaSample(),
    label: '柴油循环效率',
  },
  {
    methodId: METHOD_ELECTROSTRICT,
    family: METHOD_ELECTROSTRICT,
    run: () => runElectrostrictStrainSample(),
    label: '电致伸缩 · 族',
  },
  {
    methodId: 'method-algo-electrostrict-strain',
    family: METHOD_ELECTROSTRICT,
    run: () => runElectrostrictStrainSample(),
    label: '电致伸缩应变',
  },
  {
    methodId: METHOD_FARADAY_ROT,
    family: METHOD_FARADAY_ROT,
    run: () => runFaradayThetaSample(),
    label: '法拉第旋光 · 族',
  },
  {
    methodId: 'method-algo-faraday-theta',
    family: METHOD_FARADAY_ROT,
    run: () => runFaradayThetaSample(),
    label: '法拉第转角',
  },
  {
    methodId: METHOD_RAMAN,
    family: METHOD_RAMAN,
    run: () => runRamanShiftSample(),
    label: '拉曼散射 · 族',
  },
  {
    methodId: 'method-algo-raman-shift',
    family: METHOD_RAMAN,
    run: () => runRamanShiftSample(),
    label: '拉曼 斯托克斯 频移',
  },
  {
    methodId: METHOD_PRO,
    family: METHOD_PRO,
    run: () => runProPowerSample(),
    label: '渗透能 · 族',
  },
  {
    methodId: 'method-algo-pro-power',
    family: METHOD_PRO,
    run: () => runProPowerSample(),
    label: '压力延迟渗透功率',
  },
  {
    methodId: METHOD_THERMIONIC,
    family: METHOD_THERMIONIC,
    run: () => runRichardsonSample(),
    label: '热电子发射 · 族',
  },
  {
    methodId: 'method-algo-richardson-current',
    family: METHOD_THERMIONIC,
    run: () => runRichardsonSample(),
    label: '理查森电流密度',
  },
  {
    methodId: METHOD_POCKELS,
    family: METHOD_POCKELS,
    run: () => runPockelsDnSample(),
    label: '泡克耳斯效应 · 族',
  },
  {
    methodId: 'method-algo-pockels-dn',
    family: METHOD_POCKELS,
    run: () => runPockelsDnSample(),
    label: '泡克耳斯 Δn',
  },
  {
    methodId: METHOD_BRILLOUIN,
    family: METHOD_BRILLOUIN,
    run: () => runBrillouinShiftSample(),
    label: '布里渊散射 · 族',
  },
  {
    methodId: 'method-algo-brillouin-shift',
    family: METHOD_BRILLOUIN,
    run: () => runBrillouinShiftSample(),
    label: '布里渊频移',
  },
  {
    methodId: METHOD_BEER,
    family: METHOD_BEER,
    run: () => runBeerAbsorbanceSample(),
    label: '比尔–朗伯 · 族',
  },
  {
    methodId: 'method-algo-beer-absorbance',
    family: METHOD_BEER,
    run: () => runBeerAbsorbanceSample(),
    label: '比尔吸光度',
  },
  {
    methodId: METHOD_ARRHENIUS,
    family: METHOD_ARRHENIUS,
    run: () => runArrheniusKSample(),
    label: '阿伦尼乌斯 · 族',
  },
  {
    methodId: 'method-algo-arrhenius-k',
    family: METHOD_ARRHENIUS,
    run: () => runArrheniusKSample(),
    label: '阿伦尼乌斯速率',
  },
  {
    methodId: METHOD_FICK,
    family: METHOD_FICK,
    run: () => runFickFluxSample(),
    label: '菲克扩散 · 族',
  },
  {
    methodId: 'method-algo-fick-flux',
    family: METHOD_FICK,
    run: () => runFickFluxSample(),
    label: '菲克通量',
  },
  {
    methodId: METHOD_FOURIER,
    family: METHOD_FOURIER,
    run: () => runFourierFluxSample(),
    label: '傅里叶导热 · 族',
  },
  {
    methodId: 'method-algo-fourier-flux',
    family: METHOD_FOURIER,
    run: () => runFourierFluxSample(),
    label: '傅里叶热流',
  },
  {
    methodId: METHOD_RH,
    family: METHOD_RH,
    run: () => runRhPressureSample(),
    label: '兰金–雨贡纽 · 族',
  },
  {
    methodId: 'method-algo-rh-pressure-ratio',
    family: METHOD_RH,
    run: () => runRhPressureSample(),
    label: '激波压比',
  },
  {
    methodId: METHOD_WIEN,
    family: METHOD_WIEN,
    run: () => runWienPeakSample(),
    label: '维恩位移 · 族',
  },
  {
    methodId: 'method-algo-wien-peak',
    family: METHOD_WIEN,
    run: () => runWienPeakSample(),
    label: '维恩峰值波长',
  },
  {
    methodId: METHOD_PLANCK,
    family: METHOD_PLANCK,
    run: () => runPlanckBSample(),
    label: '普朗克定律 · 族',
  },
  {
    methodId: 'method-algo-planck-spectral',
    family: METHOD_PLANCK,
    run: () => runPlanckBSample(),
    label: '普朗克光谱因子',
  },
  {
    methodId: METHOD_JOHNSON,
    family: METHOD_JOHNSON,
    run: () => runJohnsonVrmsSample(),
    label: '约翰逊–奈奎斯特噪声 · 族',
  },
  {
    methodId: 'method-algo-johnson-vrms',
    family: METHOD_JOHNSON,
    run: () => runJohnsonVrmsSample(),
    label: '热噪声有效值电压',
  },
  {
    methodId: METHOD_ALPHAVOLTAIC,
    family: METHOD_ALPHAVOLTAIC,
    run: () => runAvPowerSample(),
    label: 'α 伏特效应 · 族',
  },
  {
    methodId: 'method-algo-av-power',
    family: METHOD_ALPHAVOLTAIC,
    run: () => runAvPowerSample(),
    label: 'α 伏特功率',
  },
  {
    methodId: METHOD_BERNOULLI,
    family: METHOD_BERNOULLI,
    run: () => runBernoulliSample(),
    label: '伯努利 · 族',
  },
  {
    methodId: 'method-algo-bernoulli-head',
    family: METHOD_BERNOULLI,
    run: () => runBernoulliSample(),
    label: '伯努利动压',
  },
  {
    methodId: METHOD_POISEUILLE,
    family: METHOD_POISEUILLE,
    run: () => runPoiseuilleQSample(),
    label: '泊肃叶流 · 族',
  },
  {
    methodId: 'method-algo-poiseuille-q',
    family: METHOD_POISEUILLE,
    run: () => runPoiseuilleQSample(),
    label: '泊肃叶流量',
  },
  {
    methodId: METHOD_STOKES,
    family: METHOD_STOKES,
    run: () => runStokesForceSample(),
    label: '斯托克斯阻力 · 族',
  },
  {
    methodId: 'method-algo-stokes-force',
    family: METHOD_STOKES,
    run: () => runStokesForceSample(),
    label: '斯托克斯力',
  },
  {
    methodId: METHOD_CC,
    family: METHOD_CC,
    run: () => runCcSlopeSample(),
    label: '克拉佩龙–克劳修斯 · 族',
  },
  {
    methodId: 'method-algo-cc-slope',
    family: METHOD_CC,
    run: () => runCcSlopeSample(),
    label: '相变斜率 dP/dT',
  },
  {
    methodId: METHOD_SAHA,
    family: METHOD_SAHA,
    run: () => runSahaKSample(),
    label: '萨哈电离 · 族',
  },
  {
    methodId: 'method-algo-saha-k',
    family: METHOD_SAHA,
    run: () => runSahaKSample(),
    label: '萨哈电离因子',
  },
  {
    methodId: METHOD_LANGMUIR,
    family: METHOD_LANGMUIR,
    run: () => runLangmuirThetaSample(),
    label: '朗缪尔等温 · 族',
  },
  {
    methodId: 'method-algo-langmuir-theta',
    family: METHOD_LANGMUIR,
    run: () => runLangmuirThetaSample(),
    label: '朗缪尔覆盖率',
  },
  {
    methodId: METHOD_SHOT,
    family: METHOD_SHOT,
    run: () => runShotIrmsSample(),
    label: '散粒噪声 · 族',
  },
  {
    methodId: 'method-algo-shot-irms',
    family: METHOD_SHOT,
    run: () => runShotIrmsSample(),
    label: '散粒噪声有效值电流',
  },
  {
    methodId: METHOD_LORENTZ,
    family: METHOD_LORENTZ,
    run: () => runLorentzForceSample(),
    label: '洛伦兹力 · 族',
  },
  {
    methodId: 'method-algo-lorentz-force',
    family: METHOD_LORENTZ,
    run: () => runLorentzForceSample(),
    label: '磁洛伦兹力',
  },
  {
    methodId: METHOD_CYCLOTRON,
    family: METHOD_CYCLOTRON,
    run: () => runCyclotronOmegaSample(),
    label: '回旋运动 · 族',
  },
  {
    methodId: 'method-algo-cyclotron-omega',
    family: METHOD_CYCLOTRON,
    run: () => runCyclotronOmegaSample(),
    label: '回旋角频率',
  },
  {
    methodId: METHOD_DEBYE,
    family: METHOD_DEBYE,
    run: () => runDebyeLengthSample(),
    label: '德拜长度 · 族',
  },
  {
    methodId: 'method-algo-debye-length',
    family: METHOD_DEBYE,
    run: () => runDebyeLengthSample(),
    label: '德拜长度',
  },
  {
    methodId: METHOD_PLASMA,
    family: METHOD_PLASMA,
    run: () => runPlasmaOmegaSample(),
    label: '等离子体频率 · 族',
  },
  {
    methodId: 'method-algo-plasma-omega',
    family: METHOD_PLASMA,
    run: () => runPlasmaOmegaSample(),
    label: '等离子体角频率',
  },
  {
    methodId: METHOD_BREWSTER,
    family: METHOD_BREWSTER,
    run: () => runBrewsterSample(),
    label: '布儒斯特角 · 族',
  },
  {
    methodId: 'method-algo-brewster-angle',
    family: METHOD_BREWSTER,
    run: () => runBrewsterSample(),
    label: '布儒斯特角',
  },
  {
    methodId: METHOD_MALUS,
    family: METHOD_MALUS,
    run: () => runMalusLawSample(),
    label: '马吕斯定律 · 族',
  },
  {
    methodId: 'method-algo-malus-i',
    family: METHOD_MALUS,
    run: () => runMalusLawSample(),
    label: '马吕斯强度',
  },
  {
    methodId: METHOD_COULOMB,
    family: METHOD_COULOMB,
    run: () => runCoulombForceSample(),
    label: '库仑定律 · 族',
  },
  {
    methodId: 'method-algo-coulomb-force',
    family: METHOD_COULOMB,
    run: () => runCoulombForceSample(),
    label: '库仑力',
  },
  {
    methodId: METHOD_BIOT,
    family: METHOD_BIOT,
    run: () => runBiotBSample(),
    label: '毕奥–萨伐尔 · 族',
  },
  {
    methodId: 'method-algo-biot-b',
    family: METHOD_BIOT,
    run: () => runBiotBSample(),
    label: '长直导线 B',
  },
  {
    methodId: METHOD_POYNTING,
    family: METHOD_POYNTING,
    run: () => runPoyntingSample(),
    label: '坡印廷矢量 · 族',
  },
  {
    methodId: 'method-algo-poynting-s',
    family: METHOD_POYNTING,
    run: () => runPoyntingSample(),
    label: '坡印廷能流',
  },
  {
    methodId: METHOD_YOUNG,
    family: METHOD_YOUNG,
    run: () => runYoungFringeSample(),
    label: '杨氏双缝 · 族',
  },
  {
    methodId: 'method-algo-young-fringe',
    family: METHOD_YOUNG,
    run: () => runYoungFringeSample(),
    label: '双缝条纹间距',
  },
  {
    methodId: METHOD_GRATING,
    family: METHOD_GRATING,
    run: () => runGratingOrderSample(),
    label: '衍射光栅 · 族',
  },
  {
    methodId: 'method-algo-grating-order',
    family: METHOD_GRATING,
    run: () => runGratingOrderSample(),
    label: '光栅级次角',
  },
  {
    methodId: METHOD_FERMI,
    family: METHOD_FERMI,
    run: () => runFermiOccupationSample(),
    label: '费米–狄拉克 · 族',
  },
  {
    methodId: 'method-algo-fermi-occupation',
    family: METHOD_FERMI,
    run: () => runFermiOccupationSample(),
    label: '费米占据因子',
  },
  {
    methodId: METHOD_VSWR,
    family: METHOD_VSWR,
    run: () => runVswrSample(),
    label: '电压驻波比 · 族',
  },
  {
    methodId: 'method-algo-vswr-from-gamma',
    family: METHOD_VSWR,
    run: () => runVswrSample(),
    label: '反射系数→驻波比',
  },
  {
    methodId: METHOD_BODE,
    family: METHOD_BODE,
    run: () => runBodeMagSample(),
    label: '波特图 · 族',
  },
  {
    methodId: 'method-algo-bode-mag-db',
    family: METHOD_BODE,
    run: () => runBodeMagSample(),
    label: '波特幅值',
  },
  {
    methodId: METHOD_JOSEPHSON,
    family: METHOD_JOSEPHSON,
    run: () => runJosephsonFreqSample(),
    label: '约瑟夫森效应 · 族',
  },
  {
    methodId: 'method-algo-josephson-freq',
    family: METHOD_JOSEPHSON,
    run: () => runJosephsonFreqSample(),
    label: '约瑟夫森频率',
  },
  {
    methodId: METHOD_AIRMASS,
    family: METHOD_AIRMASS,
    run: () => runAirMassSample(),
    label: '大气质量 · 族',
  },
  {
    methodId: 'method-algo-air-mass-am',
    family: METHOD_AIRMASS,
    run: () => runAirMassSample(),
    label: '大气质量数',
  },
  {
    methodId: METHOD_LAMBERT,
    family: METHOD_LAMBERT,
    run: () => runLambertIrradianceSample(),
    label: '朗伯余弦 · 族',
  },
  {
    methodId: 'method-algo-lambert-irradiance',
    family: METHOD_LAMBERT,
    run: () => runLambertIrradianceSample(),
    label: '朗伯辐照度',
  },
  {
    methodId: METHOD_SKIN,
    family: METHOD_SKIN,
    run: () => runSkinDepthSample(),
    label: '趋肤效应 · 族',
  },
  {
    methodId: 'method-algo-skin-depth',
    family: METHOD_SKIN,
    run: () => runSkinDepthSample(),
    label: '趋肤深度',
  },
  {
    methodId: METHOD_DRUDE,
    family: METHOD_DRUDE,
    run: () => runDrudeSigmaSample(),
    label: '德鲁德模型 · 族',
  },
  {
    methodId: 'method-algo-drude-sigma',
    family: METHOD_DRUDE,
    run: () => runDrudeSigmaSample(),
    label: '德鲁德电导',
  },
  {
    methodId: METHOD_SELLMEIER,
    family: METHOD_SELLMEIER,
    run: () => runSellmeierNSample(),
    label: '塞尔迈耶色散 · 族',
  },
  {
    methodId: 'method-algo-sellmeier-n',
    family: METHOD_SELLMEIER,
    run: () => runSellmeierNSample(),
    label: '塞尔迈耶 n',
  },
  {
    methodId: METHOD_FP,
    family: METHOD_FP,
    run: () => runFpFsrSample(),
    label: '法布里–珀罗 · 族',
  },
  {
    methodId: 'method-algo-fp-fsr',
    family: METHOD_FP,
    run: () => runFpFsrSample(),
    label: '法布里–珀罗自由光谱程',
  },
  {
    methodId: METHOD_MICHELSON,
    family: METHOD_MICHELSON,
    run: () => runMichelsonFringeSample(),
    label: '迈克尔逊干涉 · 族',
  },
  {
    methodId: 'method-algo-michelson-order',
    family: METHOD_MICHELSON,
    run: () => runMichelsonFringeSample(),
    label: '迈克尔逊级次',
  },
  {
    methodId: METHOD_WKB,
    family: METHOD_WKB,
    run: () => runWkbTSample(),
    label: '半经典隧穿 · 族',
  },
  {
    methodId: 'method-algo-wkb-transmission',
    family: METHOD_WKB,
    run: () => runWkbTSample(),
    label: '半经典隧穿透射率',
  },
  {
    methodId: METHOD_SHANNON,
    family: METHOD_SHANNON,
    run: () => runShannonCSample(),
    label: '香农容量 · 族',
  },
  {
    methodId: 'method-algo-shannon-c',
    family: METHOD_SHANNON,
    run: () => runShannonCSample(),
    label: '香农容量公式',
  },
  {
    methodId: METHOD_NF,
    family: METHOD_NF,
    run: () => runFriisNfSample(),
    label: '噪声系数 · 族',
  },
  {
    methodId: 'method-algo-friis-nf',
    family: METHOD_NF,
    run: () => runFriisNfSample(),
    label: '弗里斯级联噪声',
  },
  {
    methodId: METHOD_STEINMETZ,
    family: METHOD_STEINMETZ,
    run: () => runSteinmetzPSample(),
    label: '斯坦梅茨损耗 · 族',
  },
  {
    methodId: 'method-algo-steinmetz-p',
    family: METHOD_STEINMETZ,
    run: () => runSteinmetzPSample(),
    label: '斯坦梅茨功率',
  },
  {
    methodId: METHOD_NA,
    family: METHOD_NA,
    run: () => runNaSample(),
    label: '数值孔径 · 族',
  },
  {
    methodId: 'method-algo-na',
    family: METHOD_NA,
    run: () => runNaSample(),
    label: '数值孔径',
  },
  {
    methodId: METHOD_ABBE,
    family: METHOD_ABBE,
    run: () => runAbbeVSample(),
    label: '阿贝数 · 族',
  },
  {
    methodId: 'method-algo-abbe-v',
    family: METHOD_ABBE,
    run: () => runAbbeVSample(),
    label: '阿贝数',
  },
  {
    methodId: METHOD_MZ,
    family: METHOD_MZ,
    run: () => runMzISample(),
    label: '马赫–曾德尔 · 族',
  },
  {
    methodId: 'method-algo-mz-intensity',
    family: METHOD_MZ,
    run: () => runMzISample(),
    label: '马赫–曾德尔干涉强度',
  },
  {
    methodId: METHOD_SAGNAC,
    family: METHOD_SAGNAC,
    run: () => runSagnacPhaseSample(),
    label: '萨格纳克效应 · 族',
  },
  {
    methodId: 'method-algo-sagnac-phase',
    family: METHOD_SAGNAC,
    run: () => runSagnacPhaseSample(),
    label: '萨格纳克相位',
  },
  {
    methodId: METHOD_CURIE,
    family: METHOD_CURIE,
    run: () => runCurieChiSample(),
    label: '居里–外斯 · 族',
  },
  {
    methodId: 'method-algo-curie-chi',
    family: METHOD_CURIE,
    run: () => runCurieChiSample(),
    label: '居里–外斯磁化率',
  },
  {
    methodId: METHOD_VARSHNI,
    family: METHOD_VARSHNI,
    run: () => runVarshniEgSample(),
    label: '瓦什尼带隙 · 族',
  },
  {
    methodId: 'method-algo-varshni-eg',
    family: METHOD_VARSHNI,
    run: () => runVarshniEgSample(),
    label: '瓦什尼带隙',
  },
  {
    methodId: METHOD_EARLY,
    family: METHOD_EARLY,
    run: () => runEarlyVaSample(),
    label: '厄利效应 · 族',
  },
  {
    methodId: 'method-algo-early-va',
    family: METHOD_EARLY,
    run: () => runEarlyVaSample(),
    label: '厄利电压模型',
  },
  {
    methodId: METHOD_ZN,
    family: METHOD_ZN,
    run: () => runZnPidSample(),
    label: '齐格勒–尼科尔斯 · 族',
  },
  {
    methodId: 'method-algo-zn-pid',
    family: METHOD_ZN,
    run: () => runZnPidSample(),
    label: '齐格勒–尼科尔斯整定参数',
  },
  {
    methodId: METHOD_MB,
    family: METHOD_MB,
    run: () => runMbVrmsSample(),
    label: '麦克斯韦–玻尔兹曼 · 族',
  },
  {
    methodId: 'method-algo-mb-vrms',
    family: METHOD_MB,
    run: () => runMbVrmsSample(),
    label: '方均根速率',
  },
  {
    methodId: METHOD_EQUIP,
    family: METHOD_EQUIP,
    run: () => runEquipESample(),
    label: '能量均分 · 族',
  },
  {
    methodId: 'method-algo-equipartition-e',
    family: METHOD_EQUIP,
    run: () => runEquipESample(),
    label: '均分能量',
  },
  {
    methodId: METHOD_MORSE,
    family: METHOD_MORSE,
    run: () => runMorseVSample(),
    label: '莫尔斯势 · 族',
  },
  {
    methodId: 'method-algo-morse-v',
    family: METHOD_MORSE,
    run: () => runMorseVSample(),
    label: '莫尔斯势能',
  },
  {
    methodId: METHOD_ALFVEN,
    family: METHOD_ALFVEN,
    run: () => runAlfvenVSample(),
    label: '阿尔文波速 · 族',
  },
  {
    methodId: 'method-algo-alfven-v',
    family: METHOD_ALFVEN,
    run: () => runAlfvenVSample(),
    label: '阿尔文速度',
  },
  {
    methodId: METHOD_Q,
    family: METHOD_Q,
    run: () => runQFactorSample(),
    label: '品质因数 Q · 族',
  },
  {
    methodId: 'method-algo-q-factor',
    family: METHOD_Q,
    run: () => runQFactorSample(),
    label: '品质因数 Q',
  },
  {
    methodId: METHOD_FINESSE,
    family: METHOD_FINESSE,
    run: () => runFinesseSample(),
    label: '精细度 · 族',
  },
  {
    methodId: 'method-algo-finesse',
    family: METHOD_FINESSE,
    run: () => runFinesseSample(),
    label: '腔精细度',
  },
  {
    methodId: METHOD_LAWSON,
    family: METHOD_LAWSON,
    run: () => runLawsonNttSample(),
    label: '劳森判据 · 族',
  },
  {
    methodId: 'method-algo-lawson-ntt',
    family: METHOD_LAWSON,
    run: () => runLawsonNttSample(),
    label: '劳森三重积 nτT',
  },
  {
    methodId: METHOD_LONDON,
    family: METHOD_LONDON,
    run: () => runLondonLambdaSample(),
    label: '伦敦穿透深度 · 族',
  },
  {
    methodId: 'method-algo-london-lambda',
    family: METHOD_LONDON,
    run: () => runLondonLambdaSample(),
    label: '伦敦穿透深度 λL',
  },
  {
    methodId: METHOD_COLE,
    family: METHOD_COLE,
    run: () => runColeEpsSample(),
    label: '科尔–科尔介电 · 族',
  },
  {
    methodId: 'method-algo-cole-eps',
    family: METHOD_COLE,
    run: () => runColeEpsSample(),
    label: '德拜介电实部',
  },
  {
    methodId: METHOD_LANGEVIN,
    family: METHOD_LANGEVIN,
    run: () => runLangevinLSample(),
    label: '朗之万函数 · 族',
  },
  {
    methodId: 'method-algo-langevin-l',
    family: METHOD_LANGEVIN,
    run: () => runLangevinLSample(),
    label: '朗之万函数',
  },
  {
    methodId: METHOD_MILLER,
    family: METHOD_MILLER,
    run: () => runMillerCinSample(),
    label: '米勒电容 · 族',
  },
  {
    methodId: 'method-algo-miller-cin',
    family: METHOD_MILLER,
    run: () => runMillerCinSample(),
    label: '米勒输入电容',
  },
  {
    methodId: METHOD_ROUTH,
    family: METHOD_ROUTH,
    run: () => runRouthStable2Sample(),
    label: '劳斯–赫尔维茨 · 族',
  },
  {
    methodId: 'method-algo-routh-stable-2',
    family: METHOD_ROUTH,
    run: () => runRouthStable2Sample(),
    label: '二/三阶稳定判据',
  },
  {
    methodId: METHOD_SPARAM,
    family: METHOD_SPARAM,
    run: () => runS11DbSample(),
    label: '散射参数 · 族',
  },
  {
    methodId: 'method-algo-s11-db',
    family: METHOD_SPARAM,
    run: () => runS11DbSample(),
    label: '输入回波损耗',
  },
  {
    methodId: METHOD_YUKAWA,
    family: METHOD_YUKAWA,
    run: () => runYukawaVSample(),
    label: '汤川势 · 族',
  },
  {
    methodId: 'method-algo-yukawa-v',
    family: METHOD_YUKAWA,
    run: () => runYukawaVSample(),
    label: '汤川势能',
  },
  {
    methodId: METHOD_STREHL,
    family: METHOD_STREHL,
    run: () => runStrehlSample(),
    label: '斯特列尔比 · 族',
  },
  {
    methodId: 'method-algo-strehl',
    family: METHOD_STREHL,
    run: () => runStrehlSample(),
    label: '斯特列尔近似',
  },
  {
    methodId: METHOD_LARMOR,
    family: METHOD_LARMOR,
    run: () => runLarmorOmegaSample(),
    label: '拉莫尔进动 · 族',
  },
  {
    methodId: 'method-algo-larmor-omega',
    family: METHOD_LARMOR,
    run: () => runLarmorOmegaSample(),
    label: '拉莫尔角频率',
  },
  {
    methodId: METHOD_RABI,
    family: METHOD_RABI,
    run: () => runRabiFreqSample(),
    label: '拉比振荡 · 族',
  },
  {
    methodId: 'method-algo-rabi-freq',
    family: METHOD_RABI,
    run: () => runRabiFreqSample(),
    label: '拉比频率',
  },
  {
    methodId: METHOD_MEISSNER,
    family: METHOD_MEISSNER,
    run: () => runMeissnerBSample(),
    label: '迈斯纳效应 · 族',
  },
  {
    methodId: 'method-algo-meissner-expel',
    family: METHOD_MEISSNER,
    run: () => runMeissnerBSample(),
    label: '迈斯纳场衰减',
  },
  {
    methodId: METHOD_BCS,
    family: METHOD_BCS,
    run: () => runBcsGapSample(),
    label: '超导能隙 · 族',
  },
  {
    methodId: 'method-algo-bcs-gap',
    family: METHOD_BCS,
    run: () => runBcsGapSample(),
    label: '超导能隙近似',
  },
  {
    methodId: METHOD_VIRIAL,
    family: METHOD_VIRIAL,
    run: () => runVirialTSample(),
    label: '位力定理 · 族',
  },
  {
    methodId: 'method-algo-virial-t',
    family: METHOD_VIRIAL,
    run: () => runVirialTSample(),
    label: '位力温度',
  },
  {
    methodId: METHOD_SPITZER,
    family: METHOD_SPITZER,
    run: () => runSpitzerEtaSample(),
    label: '斯皮策电阻率 · 族',
  },
  {
    methodId: 'method-algo-spitzer-eta',
    family: METHOD_SPITZER,
    run: () => runSpitzerEtaSample(),
    label: '斯皮策电阻率',
  },
  {
    methodId: METHOD_BOHM,
    family: METHOD_BOHM,
    run: () => runBohmDSample(),
    label: '玻姆扩散 · 族',
  },
  {
    methodId: 'method-algo-bohm-d',
    family: METHOD_BOHM,
    run: () => runBohmDSample(),
    label: '玻姆扩散系数',
  },
  {
    methodId: METHOD_ROOT_LOCUS,
    family: METHOD_ROOT_LOCUS,
    run: () => runDampingZetaSample(),
    label: '根轨迹 · 族',
  },
  {
    methodId: 'method-algo-damping-zeta',
    family: METHOD_ROOT_LOCUS,
    run: () => runDampingZetaSample(),
    label: '阻尼比 ζ',
  },
  {
    methodId: METHOD_CAUCHY,
    family: METHOD_CAUCHY,
    run: () => runCauchyNSample(),
    label: '柯西色散 · 族',
  },
  {
    methodId: 'method-algo-cauchy-n',
    family: METHOD_CAUCHY,
    run: () => runCauchyNSample(),
    label: '柯西折射率',
  },
  {
    methodId: METHOD_PURCELL,
    family: METHOD_PURCELL,
    run: () => runPurcellFSample(),
    label: '珀塞尔因子 · 族',
  },
  {
    methodId: 'method-algo-purcell-f',
    family: METHOD_PURCELL,
    run: () => runPurcellFSample(),
    label: '珀塞尔因子',
  },
  {
    methodId: METHOD_IC,
    family: METHOD_IC,
    run: () => runIcJosephsonSample(),
    label: '临界电流 · 族',
  },
  {
    methodId: 'method-algo-ic-josephson',
    family: METHOD_IC,
    run: () => runIcJosephsonSample(),
    label: '约瑟夫森临界电流',
  },
  {
    methodId: METHOD_MADELUNG,
    family: METHOD_MADELUNG,
    run: () => runMadelungUSample(),
    label: '马德隆能 · 族',
  },
  {
    methodId: 'method-algo-madelung-u',
    family: METHOD_MADELUNG,
    run: () => runMadelungUSample(),
    label: '马德隆结合能',
  },
  {
    methodId: METHOD_FSPL,
    family: METHOD_FSPL,
    run: () => runFsplDbSample(),
    label: '自由空间路径损耗 · 族',
  },
  {
    methodId: 'method-algo-fspl-db',
    family: METHOD_FSPL,
    run: () => runFsplDbSample(),
    label: '自由空间路径损耗',
  },
  {
    methodId: METHOD_RADAR,
    family: METHOD_RADAR,
    run: () => runRadarPrSample(),
    label: '雷达方程 · 族',
  },
  {
    methodId: 'method-algo-radar-pr',
    family: METHOD_RADAR,
    run: () => runRadarPrSample(),
    label: '雷达回波功率',
  },
  {
    methodId: METHOD_LINK,
    family: METHOD_LINK,
    run: () => runLinkRxSample(),
    label: '链路预算 · 族',
  },
  {
    methodId: 'method-algo-link-rx-dbm',
    family: METHOD_LINK,
    run: () => runLinkRxSample(),
    label: '接收电平',
  },
  {
    methodId: METHOD_SNR,
    family: METHOD_SNR,
    run: () => runSnrDbSample(),
    label: '信噪比 · 族',
  },
  {
    methodId: 'method-algo-snr-db',
    family: METHOD_SNR,
    run: () => runSnrDbSample(),
    label: '信噪比',
  },
  {
    methodId: METHOD_ABCD,
    family: METHOD_ABCD,
    run: () => runAbcdSeriesZSample(),
    label: '传输矩阵二端口 · 族',
  },
  {
    methodId: 'method-algo-abcd-series-z',
    family: METHOD_ABCD,
    run: () => runAbcdSeriesZSample(),
    label: '串联阻抗的传输矩阵',
  },
  {
    methodId: METHOD_ROLLETT,
    family: METHOD_ROLLETT,
    run: () => runRollettKSample(),
    label: '罗莱特稳定因子 · 族',
  },
  {
    methodId: 'method-algo-rollett-k',
    family: METHOD_ROLLETT,
    run: () => runRollettKSample(),
    label: '罗莱特稳定因子',
  },
  {
    methodId: METHOD_RAMSEY,
    family: METHOD_RAMSEY,
    run: () => runRamseyPSample(),
    label: '拉姆齐干涉 · 族',
  },
  {
    methodId: 'method-algo-ramsey-p',
    family: METHOD_RAMSEY,
    run: () => runRamseyPSample(),
    label: '拉姆齐跃迁概率',
  },
  {
    methodId: METHOD_JC,
    family: METHOD_JC,
    run: () => runJcVacuumRabiSample(),
    label: '杰恩斯–卡明斯 · 族',
  },
  {
    methodId: 'method-algo-jc-vacuum-rabi',
    family: METHOD_JC,
    run: () => runJcVacuumRabiSample(),
    label: '真空拉比劈裂',
  },
  {
    methodId: METHOD_ZERNIKE,
    family: METHOD_ZERNIKE,
    run: () => runZernikeDefocusSample(),
    label: '泽尼克像差 · 族',
  },
  {
    methodId: 'method-algo-zernike-defocus',
    family: METHOD_ZERNIKE,
    run: () => runZernikeDefocusSample(),
    label: '泽尼克离焦',
  },
  {
    methodId: METHOD_BORN_LANDE,
    family: METHOD_BORN_LANDE,
    run: () => runBornLandeUSample(),
    label: '玻恩–朗德 · 族',
  },
  {
    methodId: 'method-algo-born-lande-u',
    family: METHOD_BORN_LANDE,
    run: () => runBornLandeUSample(),
    label: '玻恩–朗德晶格能',
  },
  {
    methodId: METHOD_GOOS_HANCHEN,
    family: METHOD_GOOS_HANCHEN,
    run: () => runGoosHanchenSample(),
    label: '古斯–亨兴位移 · 族',
  },
  {
    methodId: 'method-algo-goos-hanchen-d',
    family: METHOD_GOOS_HANCHEN,
    run: () => runGoosHanchenSample(),
    label: '古斯–亨兴位移量',
  },
  {
    methodId: METHOD_RE,
    family: METHOD_RE,
    run: () => runReynoldsSample(),
    label: '雷诺数 · 族',
  },
  {
    methodId: 'method-algo-reynolds',
    family: METHOD_RE,
    run: () => runReynoldsSample(),
    label: '雷诺数',
  },
  {
    methodId: METHOD_NU,
    family: METHOD_NU,
    run: () => runNusseltSample(),
    label: '努塞尔数 · 族',
  },
  {
    methodId: 'method-algo-nusselt',
    family: METHOD_NU,
    run: () => runNusseltSample(),
    label: '努塞尔数',
  },
  {
    methodId: METHOD_PR,
    family: METHOD_PR,
    run: () => runPrandtlSample(),
    label: '普朗特数 · 族',
  },
  {
    methodId: 'method-algo-prandtl',
    family: METHOD_PR,
    run: () => runPrandtlSample(),
    label: '普朗特数',
  },
  {
    methodId: METHOD_MACH,
    family: METHOD_MACH,
    run: () => runMachSample(),
    label: '马赫数 · 族',
  },
  {
    methodId: 'method-algo-mach',
    family: METHOD_MACH,
    run: () => runMachSample(),
    label: '马赫数',
  },
  {
    methodId: METHOD_KN,
    family: METHOD_KN,
    run: () => runKnudsenSample(),
    label: '克努森数 · 族',
  },
  {
    methodId: 'method-algo-knudsen',
    family: METHOD_KN,
    run: () => runKnudsenSample(),
    label: '克努森数',
  },
  {
    methodId: METHOD_VIEW,
    family: METHOD_VIEW,
    run: () => runViewParallelSample(),
    label: '角系数 · 族',
  },
  {
    methodId: 'method-algo-view-parallel',
    family: METHOD_VIEW,
    run: () => runViewParallelSample(),
    label: '平行圆盘角系数',
  },
  {
    methodId: METHOD_RJ,
    family: METHOD_RJ,
    run: () => runRayleighJeansBSample(),
    label: '瑞利–金斯 · 族',
  },
  {
    methodId: 'method-algo-rj-b',
    family: METHOD_RJ,
    run: () => runRayleighJeansBSample(),
    label: '瑞利–金斯谱',
  },
  {
    methodId: METHOD_MTF,
    family: METHOD_MTF,
    run: () => runMtfSample(),
    label: '调制传递函数 · 族',
  },
  {
    methodId: 'method-algo-mtf-contrast',
    family: METHOD_MTF,
    run: () => runMtfSample(),
    label: '对比度 / 调制传递函数',
  },
  {
    methodId: METHOD_HYBRID_PI,
    family: METHOD_HYBRID_PI,
    run: () => runGmSample(),
    label: '混合 π 模型 · 族',
  },
  {
    methodId: 'method-algo-gm',
    family: METHOD_HYBRID_PI,
    run: () => runGmSample(),
    label: '跨导',
  },
  {
    methodId: METHOD_BER,
    family: METHOD_BER,
    run: () => runBerBpskSample(),
    label: '误码率 · 族',
  },
  {
    methodId: 'method-algo-ber-bpsk',
    family: METHOD_BER,
    run: () => runBerBpskSample(),
    label: '二相相移键控误码率',
  },
  {
    methodId: METHOD_SQUID,
    family: METHOD_SQUID,
    run: () => runSquidFluxSample(),
    label: '超导量子干涉仪 · 族',
  },
  {
    methodId: 'method-algo-squid-flux',
    family: METHOD_SQUID,
    run: () => runSquidFluxSample(),
    label: '磁通量子数',
  },
  {
    methodId: METHOD_KITTEL,
    family: METHOD_KITTEL,
    run: () => runKittelFSample(),
    label: '基特尔公式 · 族',
  },
  {
    methodId: 'method-algo-kittel-f',
    family: METHOD_KITTEL,
    run: () => runKittelFSample(),
    label: '基特尔铁磁共振频率',
  },

  // ── Product depth bridges: teaching-only fallbacks ─────────
  // These roots intentionally point at existing teaching kernels. They do not
  // claim to implement the corresponding W-Sim engineering solver packages.
  {
    methodId: 'method-electro-thermal-igbt',
    family: 'method-electro-thermal-igbt',
    run: () => runRcTransientSample(),
    label: '教学类比 · RC 阶跃（非 IGBT 工程求解器）',
  },
  {
    methodId: 'method-acoustics-3d',
    family: 'method-acoustics-3d',
    run: () => runSpectrumBandSample('sound'),
    label: '教学样例 · 声波频谱（非三维声学工程求解器）',
  },
  {
    methodId: 'method-structural-mindlin',
    family: 'method-structural-mindlin',
    run: () => runSpectrumBandSample('vibration'),
    label: '教学样例 · 弦振动频谱（非 Mindlin 工程求解器）',
  },
]

/** Bindings whose methodId is registered in METHODS. */
export const MODULE_BINDINGS: ModuleBinding[] = BINDINGS_RAW.filter((b) => !!methodById(b.methodId))

export function runnerFor(methodId: string): ModuleBinding | undefined {
  return MODULE_BINDINGS.find((b) => b.methodId === methodId)
}

export function bindingsForFamily(familyMethodId: string): ModuleBinding[] {
  return MODULE_BINDINGS.filter((b) => b.family === familyMethodId)
}

export function allBoundMethodIds(): string[] {
  return MODULE_BINDINGS.map((b) => b.methodId)
}
