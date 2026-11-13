/**
 * Applications catalog barrel (#86 / #96).
 * Edit one application in `parts/<id>.ts`.
 */
import type { ApplicationProfile } from './types'
import { app_solar_cell } from './parts/app-solar-cell'
import { app_tpv } from './parts/app-tpv'
import { app_thermoelectric_seebeck } from './parts/app-thermoelectric-seebeck'
import { app_peltier_cooler } from './parts/app-peltier-cooler'
import { app_led_display } from './parts/app-led-display'
import { app_ultrasound_imaging } from './parts/app-ultrasound-imaging'
import { app_nuclear_power } from './parts/app-nuclear-power'
import { app_li_ion_battery } from './parts/app-li-ion-battery'
import { app_mri } from './parts/app-mri'
import { app_fiber_optic } from './parts/app-fiber-optic'
import { app_piezo_harvest } from './parts/app-piezo-harvest'
import { app_steg } from './parts/app-steg'
import { app_rtg } from './parts/app-rtg'
import { app_fuel_cell } from './parts/app-fuel-cell'
import { app_wind_turbine } from './parts/app-wind-turbine'
import { app_hydro_plant } from './parts/app-hydro-plant'
import { app_mhd_generator } from './parts/app-mhd-generator'
import { app_photoacoustic_imaging } from './parts/app-photoacoustic-imaging'
import { app_diesel_genset } from './parts/app-diesel-genset'
import { app_pro_osmotic } from './parts/app-pro-osmotic'
import { app_thermionic_converter } from './parts/app-thermionic-converter'
import { app_orc_plant } from './parts/app-orc-plant'
import { app_alphavoltaic } from './parts/app-alphavoltaic'
import { app_kalina_cycle } from './parts/app-kalina-cycle'
import { app_hall_thruster } from './parts/app-hall-thruster'
import { app_spectrometer_grating } from './parts/app-spectrometer-grating'
import { app_rf_link_vswr } from './parts/app-rf-link-vswr'
import { app_fiber_link } from './parts/app-fiber-link'
import { app_fabry_perot_sensor } from './parts/app-fabry-perot-sensor'
import { app_sagnac_gyro } from './parts/app-sagnac-gyro'
import { app_pid_servo } from './parts/app-pid-servo'
import { app_tokamak_lawson } from './parts/app-tokamak-lawson'
import { app_sc_cavity } from './parts/app-sc-cavity'
import { app_nmr_rabi } from './parts/app-nmr-rabi'
import { app_sc_qubit_cavity } from './parts/app-sc-qubit-cavity'
import { app_radar_link } from './parts/app-radar-link'
import { app_atomic_clock_ramsey } from './parts/app-atomic-clock-ramsey'
import { app_convective_cooling } from './parts/app-convective-cooling'
import { app_squid_magnetometer } from './parts/app-squid-magnetometer'

export const APPLICATIONS: ApplicationProfile[] = [
  app_solar_cell,
  app_tpv,
  app_thermoelectric_seebeck,
  app_peltier_cooler,
  app_led_display,
  app_ultrasound_imaging,
  app_nuclear_power,
  app_li_ion_battery,
  app_mri,
  app_fiber_optic,
  app_piezo_harvest,
  app_steg,
  app_rtg,
  app_fuel_cell,
  app_wind_turbine,
  app_hydro_plant,
  app_mhd_generator,
  app_photoacoustic_imaging,
  app_diesel_genset,
  app_pro_osmotic,
  app_thermionic_converter,
  app_orc_plant,
  app_alphavoltaic,
  app_kalina_cycle,
  app_hall_thruster,
  app_spectrometer_grating,
  app_rf_link_vswr,
  app_fiber_link,
  app_fabry_perot_sensor,
  app_sagnac_gyro,
  app_pid_servo,
  app_tokamak_lawson,
  app_sc_cavity,
  app_nmr_rabi,
  app_sc_qubit_cavity,
  app_radar_link,
  app_atomic_clock_ramsey,
  app_convective_cooling,
  app_squid_magnetometer,
]
