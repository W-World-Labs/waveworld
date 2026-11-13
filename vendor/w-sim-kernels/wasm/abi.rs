//! Stable WASM32 ABI. Algorithms live exclusively in the shared Rust library.
//! See README.md beside this file for byte layouts and ownership requirements.
#![no_std]

use core::{mem, ptr, slice};
use w_sim_kernels::antenna as ant;
use w_sim_kernels::faraday;
use w_sim_kernels::{fdtd, lbm, md, KernelError, Seed};
use w_sim_kernels::{laser, nljd, radar};
use w_sim_kernels::{sensing, transient};

const INVALID_DIMENSIONS: u32 = 1;
const INVALID_MEMORY: u32 = 2;
const UNSUPPORTED_ABI: u32 = 7;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

extern "C" {
    static __heap_base: u8;
}

#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    11
}

/// Lowest address callers may use. Below this are the module's data and stack.
#[no_mangle]
pub extern "C" fn heap_base() -> u32 {
    ptr::addr_of!(__heap_base) as u32
}

fn status(result: Result<(), KernelError>) -> u32 {
    match result {
        Ok(()) => 0,
        Err(KernelError::InvalidDimensions) => INVALID_DIMENSIONS,
        Err(KernelError::BufferLength) => INVALID_MEMORY,
        Err(KernelError::InvalidCoefficient) => 3,
        Err(KernelError::NonFiniteValue) => 4,
        Err(KernelError::InvalidState) => 5,
        Err(KernelError::UnsupportedFeature) => 6,
        Err(KernelError::RayLimitExceeded) => 8,
        Err(KernelError::InvalidSolidTopology) => 11,
    }
}

#[derive(Clone, Copy)]
struct Region {
    start: u64,
    end: u64,
}

impl Region {
    const EMPTY: Self = Self { start: 0, end: 0 };
}

fn region<T>(address: u32, len: usize) -> Result<Region, u32> {
    let bytes = len.checked_mul(mem::size_of::<T>()).ok_or(INVALID_MEMORY)?;
    if address == 0
        || bytes == 0
        || bytes > isize::MAX as usize
        || address < heap_base()
        || address as usize % mem::align_of::<T>() != 0
    {
        return Err(INVALID_MEMORY);
    }
    // Use u64: a maximum-sized WASM32 memory contains 2^32 bytes.
    let start = u64::from(address);
    let end = start + bytes as u64;
    if end > core::arch::wasm32::memory_size::<0>() as u64 * 65536 {
        return Err(INVALID_MEMORY);
    }
    Ok(Region { start, end })
}

fn distinct(regions: &[Region]) -> Result<(), u32> {
    for (i, first) in regions.iter().enumerate() {
        for second in &regions[i + 1..] {
            if first.start < second.end && second.start < first.end {
                return Err(INVALID_MEMORY);
            }
        }
    }
    Ok(())
}

fn cells(width: u32, height: u32) -> Result<usize, u32> {
    if width == 0 || height == 0 {
        return Err(INVALID_DIMENSIONS);
    }
    (width as usize)
        .checked_mul(height as usize)
        .ok_or(INVALID_DIMENSIONS)
}

/// P-Q interpolation at a supplied flow and RPM ratio, not an operating-point solve.
#[no_mangle]
pub extern "C" fn fan_curve_pressure(
    points: u32,
    count: u32,
    flow_m3_s: f64,
    rpm_ratio: f64,
    output: u32,
) -> u32 {
    use w_sim_kernels::fan_curve::{pressure_rise, FanCurvePoint};
    let operation = || -> Result<u32, u32> {
        if !(2..=256).contains(&count) {
            return Err(INVALID_MEMORY);
        }
        distinct(&[
            region::<FanCurvePoint>(points, count as usize)?,
            region::<f64>(output, 1)?,
        ])?;
        let result = unsafe {
            pressure_rise(
                slice::from_raw_parts(points as *const FanCurvePoint, count as usize),
                flow_m3_s,
                rpm_ratio,
            )
        };
        Ok(status(result.map(|value| unsafe {
            ptr::write(output as *mut f64, value)
        })))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn thermal_contact_faces(
    flags: u32,
    nx: u32,
    ny: u32,
    nz: u32,
    periodic: u32,
    mask: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let n = cells(nx, ny)?
            .checked_mul(nz as usize)
            .ok_or(INVALID_DIMENSIONS)?;
        if nz == 0 || periodic > 1 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[region::<u8>(flags, n)?, region::<u32>(mask, 5)?])?;
        let result = unsafe {
            w_sim_kernels::geometry::thermal_contact_faces(
                slice::from_raw_parts(flags as *const u8, n),
                [nx as usize, ny as usize, nz as usize],
                periodic == 1,
                &mut *(mask as *mut [u32; 5]),
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn thermal_regions(
    flags: u32,
    nx: u32,
    ny: u32,
    nz: u32,
    matrix: u32,
    bounds: u32,
    count: u32,
    counts: u32,
) -> u32 {
    let work = || -> Result<u32, u32> {
        if count > 16 {
            return Err(6);
        }
        let n = cells(nx, ny)?
            .checked_mul(nz as usize)
            .ok_or(INVALID_DIMENSIONS)?;
        distinct(&[
            region::<u8>(flags, n)?,
            region::<f64>(matrix, 12)?,
            if count == 0 {
                Region::EMPTY
            } else {
                region::<[f64; 6]>(bounds, count as usize)?
            },
            region::<u32>(counts, 17)?,
        ])?;
        let result = unsafe {
            w_sim_kernels::geometry::assign_thermal_regions(
                slice::from_raw_parts_mut(flags as *mut u8, n),
                [nx as usize, ny as usize, nz as usize],
                &ptr::read(matrix as *const [f64; 12]),
                if count == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(bounds as *const [f64; 6], count as usize)
                },
                &mut *(counts as *mut [u32; 17]),
            )
        };
        Ok(status(result))
    };
    work().unwrap_or_else(|e| e)
}

fn wave_cells(n: u32) -> Result<usize, u32> {
    if n < 3 {
        return Err(INVALID_DIMENSIONS);
    }
    cells(n, n)
}

/// Existing wave step ABI; mask=0 means no obstacle buffer.
#[no_mangle]
pub extern "C" fn step(u: u32, previous: u32, n: u32, a: f64, damping: f64, mask: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let len = wave_cells(n)?;
        let mask_region = if mask == 0 {
            Region::EMPTY
        } else {
            region::<u8>(mask, len)?
        };
        distinct(&[
            region::<f32>(u, len)?,
            region::<f32>(previous, len)?,
            mask_region,
        ])?;
        // All slices are aligned, in caller-owned linear memory, and disjoint.
        let result = unsafe {
            let obstacles = if mask == 0 {
                None
            } else {
                Some(slice::from_raw_parts(mask as *const u8, len))
            };
            w_sim_kernels::step_wave(
                slice::from_raw_parts(u as *const f32, len),
                slice::from_raw_parts_mut(previous as *mut f32, len),
                n as usize,
                a,
                damping,
                obstacles,
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

/// Existing heat step ABI.
#[no_mangle]
pub extern "C" fn heat(u: u32, next: u32, width: u32, height: u32, r: f64) -> u32 {
    let operation = || -> Result<u32, u32> {
        let len = cells(width, height)?;
        distinct(&[region::<f32>(u, len)?, region::<f32>(next, len)?])?;
        let result = unsafe {
            w_sim_kernels::step_heat(
                slice::from_raw_parts(u as *const f32, len),
                slice::from_raw_parts_mut(next as *mut f32, len),
                width as usize,
                height as usize,
                r,
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn seed_wave(
    u: u32,
    previous: u32,
    n: u32,
    x: i32,
    y: i32,
    radius: u32,
    amount: f64,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let len = wave_cells(n)?;
        distinct(&[region::<f32>(u, len)?, region::<f32>(previous, len)?])?;
        let seed = Seed {
            x: x as isize,
            y: y as isize,
            radius: radius as usize,
            amount,
        };
        let result = unsafe {
            w_sim_kernels::seed_wave(
                slice::from_raw_parts_mut(u as *mut f32, len),
                slice::from_raw_parts_mut(previous as *mut f32, len),
                n as usize,
                seed,
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn seed_heat(
    field: u32,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    radius: u32,
    amount: f64,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let len = cells(width, height)?;
        region::<f32>(field, len)?;
        let seed = Seed {
            x: x as isize,
            y: y as isize,
            radius: radius as usize,
            amount,
        };
        let result = unsafe {
            w_sim_kernels::seed_heat(
                slice::from_raw_parts_mut(field as *mut f32, len),
                width as usize,
                height as usize,
                seed,
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MdParameters {
    n: u32,
    dim: u32,
    reserved0: u32,
    reserved1: u32,
    dt: f64,
    rc: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct MdBathParameters {
    flags: u32,
    reserved: u32,
    target_temperature: f64,
    target_pressure: f64,
    tau_p: f64,
    kappa_t: f64,
    max_scale: f64,
}
fn md_parameters(address: u32) -> Result<(md::MdConfig, Region, usize), u32> {
    let memory = region::<MdParameters>(address, 1)?;
    let p = unsafe { ptr::read(address as *const MdParameters) };
    if p.reserved0 != 0 || p.reserved1 != 0 {
        return Err(UNSUPPORTED_ABI);
    }
    let c = md::MdConfig {
        n: p.n as usize,
        dim: p.dim as usize,
        dt: p.dt,
        rc: p.rc,
    };
    let len = c.value_count().map_err(|e| status(Err(e)))?;
    Ok((c, memory, len))
}
fn md_bath(address: u32) -> Result<(md::MdBath, Region), u32> {
    let memory = region::<MdBathParameters>(address, 1)?;
    let p = unsafe { ptr::read(address as *const MdBathParameters) };
    if p.flags > 3
        || p.reserved != 0
        || (p.flags & 1 == 0 && p.target_temperature.to_bits() != 0)
        || (p.flags & 2 == 0 && p.target_pressure.to_bits() != 0)
    {
        return Err(UNSUPPORTED_ABI);
    }
    Ok((
        md::MdBath {
            target_temperature: if p.flags & 1 == 1 {
                Some(p.target_temperature)
            } else {
                None
            },
            target_pressure: if p.flags & 2 == 2 {
                Some(p.target_pressure)
            } else {
                None
            },
            tau_p: p.tau_p,
            kappa_t: p.kappa_t,
            max_scale: p.max_scale,
        },
        memory,
    ))
}
enum MdOperation {
    Init,
    Step,
    Batch(u32),
    Barostat,
    ParticleBatch(Option<f64>, u32),
}
#[repr(C)]
#[derive(Clone, Copy)]
struct ScreeningParameters {
    eps_r: f64,
    lambda_d: f64,
    k_coulomb: f64,
}
fn particle_parameters(
    addresses: [u32; 4],
    n: usize,
) -> Result<(md::ScreeningParams, [Region; 4]), u32> {
    let regions = [
        region::<ScreeningParameters>(addresses[0], 1)?,
        region::<f32>(addresses[1], n)?,
        region::<f32>(addresses[2], n)?,
        region::<f32>(addresses[3], n)?,
    ];
    let s = unsafe { ptr::read(addresses[0] as *const ScreeningParameters) };
    Ok((
        md::ScreeningParams {
            eps_r: s.eps_r,
            lambda_d: s.lambda_d,
            k_coulomb: s.k_coulomb,
        },
        regions,
    ))
}
fn md_mutate(
    params: u32,
    state: u32,
    bath: u32,
    arrays: [u32; 4],
    operation: MdOperation,
    output: u32,
    particles: Option<[u32; 4]>,
) -> u32 {
    let work = || -> Result<u32, u32> {
        let (c, config_region, len) = md_parameters(params)?;
        let state_region = region::<md::MdScalars>(state, 1)?;
        let mut scalar = unsafe { ptr::read(state as *const md::MdScalars) };
        let bath = if matches!(operation, MdOperation::Batch(_) | MdOperation::Barostat) {
            Some(md_bath(bath)?)
        } else {
            None
        };
        let output_region = if matches!(operation, MdOperation::Barostat) {
            region::<f64>(output, 1)?
        } else {
            Region::EMPTY
        };
        let particle = particles.map(|p| particle_parameters(p, c.n)).transpose()?;
        let mut regions = [
            config_region,
            state_region,
            bath.as_ref().map_or(Region::EMPTY, |b| b.1),
            output_region,
            region::<f32>(arrays[0], len)?,
            region::<f32>(arrays[1], len)?,
            region::<f32>(arrays[2], len)?,
            region::<f32>(arrays[3], len)?,
            Region::EMPTY,
            Region::EMPTY,
            Region::EMPTY,
            Region::EMPTY,
        ];
        if let Some((_, p)) = &particle {
            regions[8..].copy_from_slice(p);
        }
        distinct(&regions)?;
        let result = unsafe {
            let mut buffers = md::MdBuffers {
                pos: slice::from_raw_parts_mut(arrays[0] as *mut f32, len),
                vel: slice::from_raw_parts_mut(arrays[1] as *mut f32, len),
                force: slice::from_raw_parts_mut(arrays[2] as *mut f32, len),
                unwrapped: slice::from_raw_parts_mut(arrays[3] as *mut f32, len),
            };
            if let Some(addresses) = particles {
                let p = md::ParticleProperties {
                    charge: slice::from_raw_parts(addresses[1] as *const f32, c.n),
                    sigma: slice::from_raw_parts(addresses[2] as *const f32, c.n),
                    epsilon: slice::from_raw_parts(addresses[3] as *const f32, c.n),
                };
                let screening = &particle.as_ref().unwrap().0;
                match operation {
                    MdOperation::Init => {
                        md::init_particles(&c, &mut scalar, &mut buffers, &p, screening)
                    }
                    MdOperation::Step => {
                        md::step_particles(&c, &mut scalar, &mut buffers, &p, screening)
                    }
                    MdOperation::ParticleBatch(t, steps) => {
                        md::batch_particles(&c, &mut scalar, &mut buffers, &p, screening, t, steps)
                    }
                    _ => Err(KernelError::UnsupportedFeature),
                }
                .map(|_| 1.)
            } else {
                match operation {
                    MdOperation::Init => md::init_md(&c, &mut scalar, &mut buffers).map(|_| 1.),
                    MdOperation::Step => md::step_md(&c, &mut scalar, &mut buffers).map(|_| 1.),
                    MdOperation::Batch(steps) => md::batch_md(
                        &c,
                        &mut scalar,
                        &mut buffers,
                        &bath.as_ref().unwrap().0,
                        steps,
                    )
                    .map(|_| 1.),
                    MdOperation::Barostat => {
                        md::barostat_md(&c, &mut scalar, &mut buffers, &bath.as_ref().unwrap().0)
                    }
                    MdOperation::ParticleBatch(_, _) => Err(KernelError::UnsupportedFeature),
                }
            }
        };
        Ok(status(result.map(|scale| unsafe {
            ptr::write(state as *mut md::MdScalars, scalar);
            if output != 0 {
                ptr::write(output as *mut f64, scale)
            }
        })))
    };
    work().unwrap_or_else(|error| error)
}
#[no_mangle]
pub extern "C" fn md_init(
    config: u32,
    state: u32,
    pos: u32,
    vel: u32,
    force: u32,
    unwrapped: u32,
) -> u32 {
    md_mutate(
        config,
        state,
        0,
        [pos, vel, force, unwrapped],
        MdOperation::Init,
        0,
        None,
    )
}
#[no_mangle]
pub extern "C" fn md_step(
    config: u32,
    state: u32,
    pos: u32,
    vel: u32,
    force: u32,
    unwrapped: u32,
) -> u32 {
    md_mutate(
        config,
        state,
        0,
        [pos, vel, force, unwrapped],
        MdOperation::Step,
        0,
        None,
    )
}
#[no_mangle]
pub extern "C" fn md_batch(
    config: u32,
    state: u32,
    bath: u32,
    pos: u32,
    vel: u32,
    force: u32,
    unwrapped: u32,
    steps: u32,
) -> u32 {
    md_mutate(
        config,
        state,
        bath,
        [pos, vel, force, unwrapped],
        MdOperation::Batch(steps),
        0,
        None,
    )
}
#[no_mangle]
pub extern "C" fn md_barostat(
    config: u32,
    state: u32,
    bath: u32,
    pos: u32,
    vel: u32,
    force: u32,
    unwrapped: u32,
    output: u32,
) -> u32 {
    md_mutate(
        config,
        state,
        bath,
        [pos, vel, force, unwrapped],
        MdOperation::Barostat,
        output,
        None,
    )
}
#[no_mangle]
pub extern "C" fn md_force(params: u32, state: u32, pos: u32, force: u32) -> u32 {
    let work = || -> Result<u32, u32> {
        let (c, config_region, len) = md_parameters(params)?;
        let state_region = region::<md::MdScalars>(state, 1)?;
        distinct(&[
            config_region,
            state_region,
            region::<f32>(pos, len)?,
            region::<f32>(force, len)?,
        ])?;
        let mut scalar = unsafe { ptr::read(state as *const md::MdScalars) };
        let result = unsafe {
            md::compute_lj_forces(
                &c,
                scalar.box_l,
                slice::from_raw_parts(pos as *const f32, len),
                slice::from_raw_parts_mut(force as *mut f32, len),
            )
        };
        Ok(status(result.map(|f| unsafe {
            scalar.potential = f.potential;
            scalar.virial = f.virial;
            ptr::write(state as *mut md::MdScalars, scalar)
        })))
    };
    work().unwrap_or_else(|error| error)
}
#[no_mangle]
pub extern "C" fn md_read(
    params: u32,
    state: u32,
    pos0: u32,
    vel: u32,
    unwrapped: u32,
    speed: u32,
    stats: u32,
) -> u32 {
    md_observe(params, state, pos0, vel, unwrapped, speed, stats, None)
}
fn md_observe(
    params: u32,
    state: u32,
    pos0: u32,
    vel: u32,
    unwrapped: u32,
    speed: u32,
    stats: u32,
    charge: Option<u32>,
) -> u32 {
    let work = || -> Result<u32, u32> {
        let (c, config_region, len) = md_parameters(params)?;
        distinct(&[
            config_region,
            region::<md::MdScalars>(state, 1)?,
            region::<f32>(pos0, len)?,
            region::<f32>(vel, len)?,
            region::<f32>(unwrapped, len)?,
            region::<f32>(speed, c.n)?,
            region::<f64>(stats, if charge.is_some() { 10 } else { 9 })?,
            if let Some(q) = charge {
                region::<f32>(q, c.n)?
            } else {
                Region::EMPTY
            },
        ])?;
        let scalar = unsafe { ptr::read(state as *const md::MdScalars) };
        let result = unsafe {
            if let Some(q) = charge {
                md::read_particles(
                    &c,
                    &scalar,
                    slice::from_raw_parts(pos0 as *const f32, len),
                    slice::from_raw_parts(vel as *const f32, len),
                    slice::from_raw_parts(unwrapped as *const f32, len),
                    slice::from_raw_parts(q as *const f32, c.n),
                    slice::from_raw_parts_mut(speed as *mut f32, c.n),
                )
                .map(|s| (s.md, s.total_charge))
            } else {
                md::read_md(
                    &c,
                    &scalar,
                    slice::from_raw_parts(pos0 as *const f32, len),
                    slice::from_raw_parts(vel as *const f32, len),
                    slice::from_raw_parts(unwrapped as *const f32, len),
                    slice::from_raw_parts_mut(speed as *mut f32, c.n),
                )
                .map(|s| (s, 0.))
            }
        };
        Ok(status(result.map(|(s, total_charge)| unsafe {
            slice::from_raw_parts_mut(stats as *mut f64, 9).copy_from_slice(&[
                s.temperature,
                s.kinetic,
                s.potential,
                s.total,
                s.pressure,
                s.msd,
                s.box_l,
                s.volume,
                s.density,
            ]);
            if charge.is_some() {
                ptr::write((stats as *mut f64).add(9), total_charge);
            }
        })))
    };
    work().unwrap_or_else(|error| error)
}
#[no_mangle]
pub extern "C" fn particles_init(
    config: u32,
    state: u32,
    screening: u32,
    pos: u32,
    vel: u32,
    force: u32,
    unwrapped: u32,
    charge: u32,
    sigma: u32,
    epsilon: u32,
) -> u32 {
    md_mutate(
        config,
        state,
        0,
        [pos, vel, force, unwrapped],
        MdOperation::Init,
        0,
        Some([screening, charge, sigma, epsilon]),
    )
}
#[no_mangle]
pub extern "C" fn particles_step(
    config: u32,
    state: u32,
    screening: u32,
    pos: u32,
    vel: u32,
    force: u32,
    unwrapped: u32,
    charge: u32,
    sigma: u32,
    epsilon: u32,
) -> u32 {
    md_mutate(
        config,
        state,
        0,
        [pos, vel, force, unwrapped],
        MdOperation::Step,
        0,
        Some([screening, charge, sigma, epsilon]),
    )
}
#[no_mangle]
pub extern "C" fn particles_batch(
    config: u32,
    state: u32,
    screening: u32,
    pos: u32,
    vel: u32,
    force: u32,
    unwrapped: u32,
    charge: u32,
    sigma: u32,
    epsilon: u32,
    target: f64,
    thermostat: u32,
    steps: u32,
) -> u32 {
    if thermostat > 1 || (thermostat == 0 && target.to_bits() != 0) {
        return UNSUPPORTED_ABI;
    }
    md_mutate(
        config,
        state,
        0,
        [pos, vel, force, unwrapped],
        MdOperation::ParticleBatch(if thermostat == 1 { Some(target) } else { None }, steps),
        0,
        Some([screening, charge, sigma, epsilon]),
    )
}
#[no_mangle]
pub extern "C" fn particles_read(
    config: u32,
    state: u32,
    pos0: u32,
    vel: u32,
    unwrapped: u32,
    charge: u32,
    speed: u32,
    stats: u32,
) -> u32 {
    md_observe(
        config,
        state,
        pos0,
        vel,
        unwrapped,
        speed,
        stats,
        Some(charge),
    )
}
#[no_mangle]
pub extern "C" fn particles_force(
    config: u32,
    state: u32,
    screening: u32,
    pos: u32,
    force: u32,
    charge: u32,
    sigma: u32,
    epsilon: u32,
) -> u32 {
    let work = || -> Result<u32, u32> {
        let (c, config_region, len) = md_parameters(config)?;
        let (s, p) = particle_parameters([screening, charge, sigma, epsilon], c.n)?;
        distinct(&[
            config_region,
            region::<md::MdScalars>(state, 1)?,
            region::<f32>(pos, len)?,
            region::<f32>(force, len)?,
            p[0],
            p[1],
            p[2],
            p[3],
        ])?;
        let mut scalar = unsafe { ptr::read(state as *const md::MdScalars) };
        let result = unsafe {
            md::compute_particle_forces(
                &c,
                scalar.box_l,
                slice::from_raw_parts(pos as *const f32, len),
                slice::from_raw_parts_mut(force as *mut f32, len),
                &md::ParticleProperties {
                    charge: slice::from_raw_parts(charge as *const f32, c.n),
                    sigma: slice::from_raw_parts(sigma as *const f32, c.n),
                    epsilon: slice::from_raw_parts(epsilon as *const f32, c.n),
                },
                &s,
            )
        };
        Ok(status(result.map(|f| unsafe {
            scalar.potential = f.potential;
            scalar.virial = f.virial;
            ptr::write(state as *mut md::MdScalars, scalar)
        })))
    };
    work().unwrap_or_else(|error| error)
}
#[no_mangle]
pub extern "C" fn md_rdf(
    params: u32,
    state: u32,
    pos: u32,
    bins: u32,
    r_max: f64,
    hist: u32,
    r: u32,
    g: u32,
    stats: u32,
) -> u32 {
    let work = || -> Result<u32, u32> {
        let (c, config_region, len) = md_parameters(params)?;
        let bins = bins as usize;
        distinct(&[
            config_region,
            region::<md::MdScalars>(state, 1)?,
            region::<f32>(pos, len)?,
            region::<f64>(hist, bins)?,
            region::<f32>(r, bins)?,
            region::<f32>(g, bins)?,
            region::<f64>(stats, 2)?,
        ])?;
        let scalar = unsafe { ptr::read(state as *const md::MdScalars) };
        let result = unsafe {
            md::radial_distribution(
                &c,
                scalar.box_l,
                slice::from_raw_parts(pos as *const f32, len),
                r_max,
                slice::from_raw_parts_mut(hist as *mut f64, bins),
                slice::from_raw_parts_mut(r as *mut f32, bins),
                slice::from_raw_parts_mut(g as *mut f32, bins),
            )
        };
        Ok(status(result.map(|s| unsafe {
            slice::from_raw_parts_mut(stats as *mut f64, 2)
                .copy_from_slice(&[s.r_max, s.pair_count as f64])
        })))
    };
    work().unwrap_or_else(|error| error)
}
#[no_mangle]
pub extern "C" fn md_diffusion(
    times: u32,
    msd: u32,
    len: u32,
    dim: u32,
    skip: f64,
    output: u32,
) -> u32 {
    let work = || -> Result<u32, u32> {
        let len = len as usize;
        distinct(&[
            if len == 0 {
                Region::EMPTY
            } else {
                region::<f64>(times, len)?
            },
            if len == 0 {
                Region::EMPTY
            } else {
                region::<f64>(msd, len)?
            },
            region::<f64>(output, 5)?,
        ])?;
        let result = unsafe {
            md::diffusion_einstein(
                if len == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(times as *const f64, len)
                },
                if len == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(msd as *const f64, len)
                },
                dim as usize,
                skip,
            )
        };
        Ok(status(result.map(|s| unsafe {
            slice::from_raw_parts_mut(output as *mut f64, 5).copy_from_slice(&[
                s.diffusion,
                s.slope,
                s.intercept,
                s.r2,
                s.n_fit as f64,
            ])
        })))
    };
    work().unwrap_or_else(|error| error)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct FdtdParameters {
    nx: u32,
    ny: u32,
    boundary: u32,
    reserved: u32,
    dt: f64,
    mu: f64,
}

fn fdtd_parameters(address: u32) -> Result<(fdtd::FdtdConfig, Region, usize), u32> {
    let memory = region::<FdtdParameters>(address, 1)?;
    let p = unsafe { ptr::read(address as *const FdtdParameters) };
    if p.reserved != 0 {
        return Err(UNSUPPORTED_ABI);
    }
    let boundary = match p.boundary {
        0 => fdtd::FdtdBoundary::Mur,
        1 => fdtd::FdtdBoundary::Pec,
        _ => return Err(6),
    };
    let config = fdtd::FdtdConfig {
        nx: p.nx as usize,
        ny: p.ny as usize,
        dt: p.dt,
        mu: p.mu,
        boundary,
    };
    let n = config.cell_count().map_err(|_| INVALID_DIMENSIONS)?;
    Ok((config, memory, n))
}

/// Additive ABI4 TMz Yee step. All buffers, including histories, are disjoint.
#[no_mangle]
pub extern "C" fn fdtd_step(
    params: u32,
    eps: u32,
    mask: u32,
    ez: u32,
    hx: u32,
    hy: u32,
    left: u32,
    right: u32,
    bottom: u32,
    top: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (config, config_region, n) = fdtd_parameters(params)?;
        let mask_region = if mask == 0 {
            Region::EMPTY
        } else {
            region::<u8>(mask, n)?
        };
        distinct(&[
            config_region,
            region::<f32>(eps, n)?,
            mask_region,
            region::<f32>(ez, n)?,
            region::<f32>(hx, n)?,
            region::<f32>(hy, n)?,
            region::<f32>(left, config.ny)?,
            region::<f32>(right, config.ny)?,
            region::<f32>(bottom, config.nx)?,
            region::<f32>(top, config.nx)?,
        ])?;
        let result = unsafe {
            let eps = slice::from_raw_parts(eps as *const f32, n);
            let mask = if mask == 0 {
                None
            } else {
                Some(slice::from_raw_parts(mask as *const u8, n))
            };
            let mut state = fdtd::FdtdBuffers {
                ez: slice::from_raw_parts_mut(ez as *mut f32, n),
                hx: slice::from_raw_parts_mut(hx as *mut f32, n),
                hy: slice::from_raw_parts_mut(hy as *mut f32, n),
                prev_left: slice::from_raw_parts_mut(left as *mut f32, config.ny),
                prev_right: slice::from_raw_parts_mut(right as *mut f32, config.ny),
                prev_bottom: slice::from_raw_parts_mut(bottom as *mut f32, config.nx),
                prev_top: slice::from_raw_parts_mut(top as *mut f32, config.nx),
            };
            fdtd::step_fdtd(&config, eps, mask, &mut state)
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn fdtd_source(ez: u32, nx: u32, ny: u32, x: u32, y: u32, amplitude: f64) -> u32 {
    let operation = || -> Result<u32, u32> {
        let n = cells(nx, ny)?;
        region::<f32>(ez, n)?;
        let result = unsafe {
            fdtd::add_soft_source(
                slice::from_raw_parts_mut(ez as *mut f32, n),
                nx as usize,
                ny as usize,
                x as usize,
                y as usize,
                amplitude,
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn fdtd_energy(
    params: u32,
    eps: u32,
    ez: u32,
    hx: u32,
    hy: u32,
    output: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (config, config_region, n) = fdtd_parameters(params)?;
        distinct(&[
            config_region,
            region::<f32>(eps, n)?,
            region::<f32>(ez, n)?,
            region::<f32>(hx, n)?,
            region::<f32>(hy, n)?,
            region::<f64>(output, 1)?,
        ])?;
        let result = unsafe {
            fdtd::energy_fdtd(
                &config,
                slice::from_raw_parts(eps as *const f32, n),
                slice::from_raw_parts(ez as *const f32, n),
                slice::from_raw_parts(hx as *const f32, n),
                slice::from_raw_parts(hy as *const f32, n),
            )
        };
        Ok(status(result.map(|value| unsafe {
            ptr::write(output as *mut f64, value)
        })))
    };
    operation().unwrap_or_else(|error| error)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ThermalScalars {
    gravity_per_kelvin: f64,
    dt_seconds: f64,
    ambient_c: f64,
    fixed_surface_c: f64,
    dx_meters: f64,
    fluid_density: f64,
    fluid_specific_heat: f64,
    fluid_conductivity: f64,
    solid_density: f64,
    solid_specific_heat: f64,
    solid_conductivity: f64,
    total_power_w: f64,
    mode: u32,
    max_substeps: u32,
    temperature_scale_c: f64,
}

impl ThermalScalars {
    fn config(
        self,
        material_count: u32,
        materials: [lbm::ThermalMaterial; 16],
        contact_mask: [u32; 5],
        contact_resistance: [f64; 136],
    ) -> Result<lbm::ThermalConfig, u32> {
        Ok(lbm::ThermalConfig {
            gravity_per_kelvin: self.gravity_per_kelvin,
            dt_seconds: self.dt_seconds,
            ambient_c: self.ambient_c,
            fixed_surface_c: self.fixed_surface_c,
            dx_meters: self.dx_meters,
            fluid_density: self.fluid_density,
            fluid_specific_heat: self.fluid_specific_heat,
            fluid_conductivity: self.fluid_conductivity,
            solid_density: self.solid_density,
            solid_specific_heat: self.solid_specific_heat,
            solid_conductivity: self.solid_conductivity,
            total_power_w: self.total_power_w,
            mode: match self.mode {
                0 => lbm::ThermalMode::FixedTemperature,
                1 => lbm::ThermalMode::SolidPower,
                _ => return Err(6),
            },
            max_substeps: self.max_substeps,
            temperature_scale_c: self.temperature_scale_c,
            material_count: material_count as usize,
            materials,
            contact_mask,
            contact_resistance,
        })
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct D3q19Parameters {
    nx: u32,
    ny: u32,
    nz: u32,
    boundary: u32,
    free_slip: u32,
    fan_enabled: u32,
    tau: f64,
    u_inlet: f64,
    smagorinsky_cs: f64,
    turbulence_intensity: f64,
    version: u32,
    thermal_enabled: u32,
    fan_center: [f64; 3],
    fan_radius: f64,
    fan_normal: [f64; 3],
    fan_acceleration: f64,
    thermal: ThermalScalars,
    material_count: u32,
    ground_enabled: u32,
    ground_velocity: f64,
    materials: [lbm::ThermalMaterial; 16],
    contact_mask: [u32; 5],
    contact_reserved: [u32; 3],
    contact_resistance: [f64; 136],
}

const _: () = {
    assert!(mem::size_of::<ThermalScalars>() == 112);
    assert!(mem::offset_of!(ThermalScalars, temperature_scale_c) == 104);
    assert!(mem::size_of::<D3q19Parameters>() == 1888);
    assert!(mem::align_of::<D3q19Parameters>() == 8);
    assert!(mem::offset_of!(D3q19Parameters, tau) == 24);
    assert!(mem::offset_of!(D3q19Parameters, version) == 56);
    assert!(mem::offset_of!(D3q19Parameters, fan_center) == 64);
    assert!(mem::offset_of!(D3q19Parameters, fan_acceleration) == 120);
    assert!(mem::offset_of!(D3q19Parameters, thermal) == 128);
    assert!(mem::offset_of!(D3q19Parameters, material_count) == 240);
    assert!(mem::offset_of!(D3q19Parameters, ground_enabled) == 244);
    assert!(mem::offset_of!(D3q19Parameters, ground_velocity) == 248);
    assert!(mem::offset_of!(D3q19Parameters, materials) == 256);
    assert!(mem::offset_of!(D3q19Parameters, contact_mask) == 768);
    assert!(mem::offset_of!(D3q19Parameters, contact_resistance) == 800);
};

fn parameters(address: u32) -> Result<(lbm::D3q19Config, Region), u32> {
    let memory = region::<D3q19Parameters>(address, 1)?;
    // Copy all primitive fields before constructing any mutable data slices.
    let p = unsafe { ptr::read(address as *const D3q19Parameters) };
    if p.version != abi_version() || p.material_count > 16 {
        return Err(UNSUPPORTED_ABI);
    }
    let ground_velocity = match p.ground_enabled {
        0 if p.ground_velocity.to_bits() == 0 => None,
        1 => Some(p.ground_velocity),
        _ => return Err(UNSUPPORTED_ABI),
    };
    if (p.thermal.mode == 0 || p.thermal_enabled == 0) && p.material_count != 0 {
        return Err(UNSUPPORTED_ABI);
    }
    let unused = unsafe {
        slice::from_raw_parts(
            (address + 256 + p.material_count * 32) as *const u8,
            (16 - p.material_count) as usize * 32,
        )
    };
    if unused.iter().any(|&b| b != 0) {
        return Err(UNSUPPORTED_ABI);
    }
    if p.contact_reserved != [0; 3]
        || p.contact_mask[4] & !255 != 0
        || ((p.thermal.mode == 0 || p.thermal_enabled == 0) && p.contact_mask != [0; 5])
        || p.contact_resistance
            .iter()
            .enumerate()
            .any(|(i, r)| p.contact_mask[i / 32] & (1 << (i % 32)) == 0 && r.to_bits() != 0)
    {
        return Err(UNSUPPORTED_ABI);
    }
    let thermal = match p.thermal_enabled {
        0 => {
            let unused = unsafe { slice::from_raw_parts((address + 128) as *const u8, 112) };
            if unused.iter().any(|&byte| byte != 0) {
                return Err(UNSUPPORTED_ABI);
            }
            None
        }
        1 => Some(p.thermal.config(
            p.material_count,
            p.materials,
            p.contact_mask,
            p.contact_resistance,
        )?),
        _ => return Err(6),
    };
    let fan = match p.fan_enabled {
        0 => {
            if p.fan_center
                .into_iter()
                .chain([p.fan_radius])
                .chain(p.fan_normal)
                .chain([p.fan_acceleration])
                .any(|value| value.to_bits() != 0)
            {
                return Err(UNSUPPORTED_ABI);
            }
            None
        }
        1 => Some(lbm::D3q19Fan {
            center: p.fan_center,
            normal: p.fan_normal,
            radius_cells: p.fan_radius,
            acceleration_lattice: p.fan_acceleration,
        }),
        _ => return Err(6),
    };
    let boundary = match p.boundary {
        0 => lbm::D3q19Boundary::WindTunnel,
        1 => lbm::D3q19Boundary::Periodic,
        2 => lbm::D3q19Boundary::Closed,
        _ => return Err(6),
    };
    if p.free_slip > 1 {
        return Err(6);
    }
    Ok((
        lbm::D3q19Config {
            nx: p.nx as usize,
            ny: p.ny as usize,
            nz: p.nz as usize,
            tau: p.tau,
            u_inlet: p.u_inlet,
            smagorinsky_cs: p.smagorinsky_cs,
            turbulence_intensity: p.turbulence_intensity,
            ground_velocity,
            free_slip_walls: p.free_slip == 1,
            boundary,
            fan,
            thermal,
        },
        memory,
    ))
}

struct D3q19Regions {
    count: usize,
    populations: usize,
}

#[allow(clippy::too_many_arguments)]
fn d3q19_regions(
    config: &lbm::D3q19Config,
    config_region: Region,
    flags: u32,
    f: u32,
    post: u32,
    velocity: u32,
    density: u32,
    energy: u32,
    next_energy: u32,
    temperature: u32,
    mass: u32,
    stats: Option<u32>,
) -> Result<D3q19Regions, u32> {
    let count = config.cell_count().map_err(|error| status(Err(error)))?;
    let populations = count.checked_mul(lbm::D3Q19_Q).ok_or(INVALID_DIMENSIONS)?;
    let velocity_len = count.checked_mul(3).ok_or(INVALID_DIMENSIONS)?;
    if config.thermal.is_none()
        && (energy != 0 || next_energy != 0 || temperature != 0 || mass != 0)
    {
        return Err(INVALID_MEMORY);
    }
    distinct(&[
        config_region,
        region::<u8>(flags, count)?,
        region::<f32>(f, populations)?,
        region::<f32>(post, populations)?,
        region::<f32>(velocity, velocity_len)?,
        region::<f32>(density, count)?,
        if config.thermal.is_some() {
            region::<f64>(energy, count)?
        } else {
            Region::EMPTY
        },
        if config.thermal.is_some() {
            region::<f64>(next_energy, count)?
        } else {
            Region::EMPTY
        },
        if config.thermal.is_some() {
            region::<f64>(temperature, count)?
        } else {
            Region::EMPTY
        },
        if config.thermal.is_some() {
            region::<f64>(mass, count)?
        } else {
            Region::EMPTY
        },
        if let Some(address) = stats {
            region::<f64>(address, 19)?
        } else {
            Region::EMPTY
        },
    ])?;
    Ok(D3q19Regions { count, populations })
}

#[no_mangle]
pub extern "C" fn d3q19_init(
    config_ptr: u32,
    flags: u32,
    f: u32,
    post: u32,
    velocity: u32,
    density: u32,
    energy: u32,
    next_energy: u32,
    temperature: u32,
    mass: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (config, config_region) = parameters(config_ptr)?;
        let sizes = d3q19_regions(
            &config,
            config_region,
            flags,
            f,
            post,
            velocity,
            density,
            energy,
            next_energy,
            temperature,
            mass,
            None,
        )?;
        let result = unsafe {
            lbm::init_d3q19(
                &config,
                slice::from_raw_parts(flags as *const u8, sizes.count),
                slice::from_raw_parts_mut(f as *mut f32, sizes.populations),
                slice::from_raw_parts_mut(post as *mut f32, sizes.populations),
                slice::from_raw_parts_mut(velocity as *mut f32, sizes.count * 3),
                slice::from_raw_parts_mut(density as *mut f32, sizes.count),
                if config.thermal.is_some() {
                    Some(lbm::ThermalBuffers {
                        energy: slice::from_raw_parts_mut(energy as *mut f64, sizes.count),
                        next_energy: slice::from_raw_parts_mut(
                            next_energy as *mut f64,
                            sizes.count,
                        ),
                        temperature_delta_k: slice::from_raw_parts_mut(
                            temperature as *mut f64,
                            sizes.count,
                        ),
                        mass: slice::from_raw_parts_mut(mass as *mut f64, sizes.count),
                    })
                } else {
                    None
                },
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn d3q19_step(
    config_ptr: u32,
    flags: u32,
    f: u32,
    post: u32,
    velocity: u32,
    density: u32,
    energy: u32,
    next_energy: u32,
    temperature: u32,
    mass: u32,
    step: u32,
    stats: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (config, config_region) = parameters(config_ptr)?;
        let sizes = d3q19_regions(
            &config,
            config_region,
            flags,
            f,
            post,
            velocity,
            density,
            energy,
            next_energy,
            temperature,
            mass,
            Some(stats),
        )?;
        let result = unsafe {
            lbm::step_d3q19(
                &config,
                slice::from_raw_parts(flags as *const u8, sizes.count),
                slice::from_raw_parts_mut(f as *mut f32, sizes.populations),
                slice::from_raw_parts_mut(post as *mut f32, sizes.populations),
                slice::from_raw_parts_mut(velocity as *mut f32, sizes.count * 3),
                slice::from_raw_parts_mut(density as *mut f32, sizes.count),
                if config.thermal.is_some() {
                    Some(lbm::ThermalBuffers {
                        energy: slice::from_raw_parts_mut(energy as *mut f64, sizes.count),
                        next_energy: slice::from_raw_parts_mut(
                            next_energy as *mut f64,
                            sizes.count,
                        ),
                        temperature_delta_k: slice::from_raw_parts_mut(
                            temperature as *mut f64,
                            sizes.count,
                        ),
                        mass: slice::from_raw_parts_mut(mass as *mut f64, sizes.count),
                    })
                } else {
                    None
                },
                step,
            )
        };
        match result {
            Ok(value) => {
                let [fx, fy, fz] = value.obstacle_force;
                let mut output = [0.; 19];
                output[..5].copy_from_slice(&[fx, fy, fz, value.mass, value.max_speed]);
                if let Some(t) = value.thermal {
                    output[5..12].copy_from_slice(&thermal_readout(t));
                }
                let m = value.mass_balance;
                output[12..].copy_from_slice(&[
                    m.bulk_mass_before,
                    m.bulk_mass_after,
                    m.inlet_net_mass,
                    m.outlet_net_mass,
                    m.collision_mass_change,
                    m.inlet_replacement_mass,
                    m.outlet_replacement_mass,
                ]);
                unsafe {
                    ptr::write(stats as *mut [f64; 19], output);
                }
                Ok(0)
            }
            Err(error) => Ok(status(Err(error))),
        }
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn d3q19_display(
    config_ptr: u32,
    velocity: u32,
    flags: u32,
    temperature: u32,
    populations: u32,
    display: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (config, config_region) = parameters(config_ptr)?;
        let count = config.cell_count().map_err(|error| status(Err(error)))?;
        let velocity_len = count.checked_mul(3).ok_or(INVALID_DIMENSIONS)?;
        let stride = 2 + usize::from(config.thermal.is_some()) + usize::from(populations != 0);
        let population_len = count.checked_mul(lbm::D3Q19_Q).ok_or(INVALID_DIMENSIONS)?;
        let display_len = count.checked_mul(stride).ok_or(INVALID_DIMENSIONS)?;
        if config.thermal.is_none() && temperature != 0 {
            return Err(INVALID_MEMORY);
        }
        distinct(&[
            config_region,
            region::<f32>(velocity, velocity_len)?,
            region::<u8>(flags, count)?,
            if config.thermal.is_some() {
                region::<f64>(temperature, count)?
            } else {
                Region::EMPTY
            },
            if populations == 0 {
                Region::EMPTY
            } else {
                region::<f32>(populations, population_len)?
            },
            region::<f32>(display, display_len)?,
        ])?;
        let result = unsafe {
            lbm::display_d3q19(
                &config,
                slice::from_raw_parts(velocity as *const f32, velocity_len),
                slice::from_raw_parts(flags as *const u8, count),
                if config.thermal.is_some() {
                    Some(slice::from_raw_parts(temperature as *const f64, count))
                } else {
                    None
                },
                if populations == 0 {
                    None
                } else {
                    Some(slice::from_raw_parts(
                        populations as *const f32,
                        population_len,
                    ))
                },
                slice::from_raw_parts_mut(display as *mut f32, display_len),
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

#[no_mangle]
pub extern "C" fn voxelize(
    vertices: u32,
    vertex_count: u32,
    indices: u32,
    triangle_count: u32,
    nx: u32,
    ny: u32,
    nz: u32,
    flags: u32,
    scratch: u32,
    counts: u32,
) -> u32 {
    voxelize_solids(
        vertices,
        vertex_count,
        indices,
        triangle_count,
        0,
        0,
        nx,
        ny,
        nz,
        flags,
        scratch,
        counts,
    )
}

#[no_mangle]
pub extern "C" fn voxelize_solids(
    vertices: u32,
    vertex_count: u32,
    indices: u32,
    triangle_count: u32,
    solid_counts: u32,
    solid_count: u32,
    nx: u32,
    ny: u32,
    nz: u32,
    flags: u32,
    scratch: u32,
    counts: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let count = cells(nx, ny)?
            .checked_mul(nz as usize)
            .filter(|&n| n > 0)
            .ok_or(INVALID_DIMENSIONS)?;
        let vertex_len = (vertex_count as usize)
            .checked_mul(3)
            .ok_or(INVALID_DIMENSIONS)?;
        let index_len = (triangle_count as usize)
            .checked_mul(3)
            .ok_or(INVALID_DIMENSIONS)?;
        let scratch_len = (triangle_count as usize)
            .checked_mul(5)
            .ok_or(INVALID_DIMENSIONS)?;
        distinct(&[
            if vertex_len == 0 {
                Region::EMPTY
            } else {
                region::<f32>(vertices, vertex_len)?
            },
            if index_len == 0 {
                Region::EMPTY
            } else {
                region::<u32>(indices, index_len)?
            },
            if solid_count == 0 {
                Region::EMPTY
            } else {
                region::<u32>(solid_counts, solid_count as usize)?
            },
            region::<u8>(flags, count)?,
            if scratch_len == 0 {
                Region::EMPTY
            } else {
                region::<f64>(scratch, scratch_len)?
            },
            region::<u32>(counts, 2)?,
        ])?;
        let result = unsafe {
            w_sim_kernels::geometry::voxelize_solids(
                if vertex_len == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(vertices as *const f32, vertex_len)
                },
                if index_len == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(indices as *const u32, index_len)
                },
                if solid_count == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(solid_counts as *const u32, solid_count as usize)
                },
                nx as usize,
                ny as usize,
                nz as usize,
                slice::from_raw_parts_mut(flags as *mut u8, count),
                if scratch_len == 0 {
                    &mut []
                } else {
                    slice::from_raw_parts_mut(scratch as *mut f64, scratch_len)
                },
            )
        };
        match result {
            Ok(value) => {
                unsafe {
                    ptr::write(
                        counts as *mut [u32; 2],
                        [value.solid_cells as u32, value.frontal_area_cells as u32],
                    );
                }
                Ok(0)
            }
            Err(error) => Ok(status(Err(error))),
        }
    };
    operation().unwrap_or_else(|error| error)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MacProjectionParameters {
    nx: u32,
    ny: u32,
    nz: u32,
    open_faces: u32,
    max_iterations: u32,
    reserved: u32,
    dx_m: f64,
    dt_s: f64,
    density_kg_m3: f64,
    absolute_divergence_tol: f64,
    relative_residual_tol: f64,
}

const _: () = assert!(mem::size_of::<MacProjectionParameters>() == 64);

impl MacProjectionParameters {
    fn config(
        self,
    ) -> Result<
        (
            w_sim_kernels::mac_projection::MacProjectionConfig,
            [usize; 6],
        ),
        u32,
    > {
        if self.reserved != 0 || self.open_faces > 63 {
            return Err(UNSUPPORTED_ABI);
        }
        let (nx, ny, nz) = (self.nx as usize, self.ny as usize, self.nz as usize);
        let n = cells(self.nx, self.ny)?
            .checked_mul(nz)
            .filter(|&n| n > 0)
            .ok_or(INVALID_DIMENSIONS)?;
        let face_count = |a: usize, b: usize, c: usize| {
            a.checked_add(1)
                .and_then(|a| a.checked_mul(b))
                .and_then(|ab| ab.checked_mul(c))
                .ok_or(INVALID_DIMENSIONS)
        };
        Ok((
            w_sim_kernels::mac_projection::MacProjectionConfig {
                nx,
                ny,
                nz,
                open_faces: self.open_faces as u8,
                max_iterations: self.max_iterations,
                dx_m: self.dx_m,
                dt_s: self.dt_s,
                density_kg_m3: self.density_kg_m3,
                absolute_divergence_tol: self.absolute_divergence_tol,
                relative_residual_tol: self.relative_residual_tol,
            },
            [
                n,
                face_count(nx, ny, nz)?,
                face_count(ny, nx, nz)?,
                face_count(nz, nx, ny)?,
                n.checked_mul(6).ok_or(INVALID_DIMENSIONS)?,
                n.checked_mul(2).ok_or(INVALID_DIMENSIONS)?,
            ],
        ))
    }
}

#[repr(C)]
struct MacProjectionReadout {
    iterations: u32,
    fluid_cells: u32,
    closed_components: u32,
    reserved: u32,
    initial_divergence_linf: f64,
    final_divergence_linf: f64,
    allowed_divergence_linf: f64,
    residual_linf_pa_per_m2: f64,
}

#[repr(C)]
struct MacProjectionFailure {
    iterations: u32,
    reserved_words: [u32; 3],
    residual_linf_pa_per_m2: f64,
    allowed_residual_linf_pa_per_m2: f64,
    reserved_doubles: [f64; 2],
}

const _: () = {
    assert!(mem::size_of::<MacProjectionReadout>() == 48);
    assert!(mem::size_of::<MacProjectionFailure>() == 48);
};

fn mac_readout(s: w_sim_kernels::mac_projection::MacProjectionStats) -> MacProjectionReadout {
    MacProjectionReadout {
        iterations: s.iterations,
        fluid_cells: s.fluid_cells,
        closed_components: s.closed_components,
        reserved: 0,
        initial_divergence_linf: s.initial_divergence_linf,
        final_divergence_linf: s.final_divergence_linf,
        allowed_divergence_linf: s.allowed_divergence_linf,
        residual_linf_pa_per_m2: s.residual_linf_pa_per_m2,
    }
}

// Call only after validating the output region and all pointer aliases.
fn mac_projection_result(
    output: u32,
    result: Result<
        w_sim_kernels::mac_projection::MacProjectionStats,
        w_sim_kernels::mac_projection::MacProjectionError,
    >,
) -> u32 {
    use w_sim_kernels::mac_projection::MacProjectionError;
    match result {
        Ok(s) => {
            unsafe {
                ptr::write(output as *mut MacProjectionReadout, mac_readout(s));
            }
            0
        }
        Err(MacProjectionError::NotConverged {
            iterations,
            residual_linf_pa_per_m2,
            allowed_residual_linf_pa_per_m2,
        }) => {
            unsafe {
                ptr::write(
                    output as *mut MacProjectionFailure,
                    MacProjectionFailure {
                        iterations,
                        reserved_words: [0; 3],
                        residual_linf_pa_per_m2,
                        allowed_residual_linf_pa_per_m2,
                        reserved_doubles: [0.; 2],
                    },
                );
            }
            9
        }
        Err(MacProjectionError::Invalid(error)) => status(Err(error)),
    }
}

/// Pressure projection only; this does not advance a fluid or thermal simulation.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn mac_project(
    config: u32,
    flags: u32,
    u: u32,
    v: u32,
    w: u32,
    pressure: u32,
    work: u32,
    topology_work: u32,
    output: u32,
) -> u32 {
    use w_sim_kernels::mac_projection::{project_mac3d, MacProjectionBuffers};
    let operation = || -> Result<u32, u32> {
        let cm = region::<MacProjectionParameters>(config, 1)?;
        let p = unsafe { ptr::read(config as *const MacProjectionParameters) };
        let (c, [n, nu, nv, nw, ns, nt]) = p.config()?;
        distinct(&[
            cm,
            region::<u8>(flags, n)?,
            region::<f64>(u, nu)?,
            region::<f64>(v, nv)?,
            region::<f64>(w, nw)?,
            region::<f64>(pressure, n)?,
            region::<f64>(work, ns)?,
            region::<u32>(topology_work, nt)?,
            region::<MacProjectionReadout>(output, 1)?,
        ])?;
        let result = unsafe {
            project_mac3d(
                &c,
                slice::from_raw_parts(flags as *const u8, n),
                &mut MacProjectionBuffers {
                    u: slice::from_raw_parts_mut(u as *mut f64, nu),
                    v: slice::from_raw_parts_mut(v as *mut f64, nv),
                    w: slice::from_raw_parts_mut(w as *mut f64, nw),
                    pressure: slice::from_raw_parts_mut(pressure as *mut f64, n),
                    work: slice::from_raw_parts_mut(work as *mut f64, ns),
                    topology_work: slice::from_raw_parts_mut(topology_work as *mut u32, nt),
                },
            )
        };
        Ok(mac_projection_result(output, result))
    };
    operation().unwrap_or_else(|error| error)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MacStepParameters {
    projection: MacProjectionParameters,
    kinematic_viscosity_m2_s: f64,
    open_velocity_m_s: [f64; 3],
}

#[repr(C)]
struct MacStepReadout {
    projection: MacProjectionReadout,
    advection_cfl: f64,
    diffusion_cfl: f64,
    combined_cfl: f64,
    wall_impulse_kg_m_s: [f64; 3],
    open_impulse_kg_m_s: [f64; 3],
    body_impulse_kg_m_s: [f64; 3],
    pressure_impulse_kg_m_s: [f64; 3],
}

const _: () = {
    assert!(mem::size_of::<MacStepParameters>() == 96);
    assert!(mem::size_of::<MacStepReadout>() == 168);
};

/// One explicit laminar momentum step and shared pressure projection.
#[no_mangle]
pub extern "C" fn mac_step(config: u32, table: u32, output: u32) -> u32 {
    use w_sim_kernels::mac_step::{step_mac3d, MacStepBuffers, MacStepConfig, MacStepError};
    let operation = || -> Result<u32, u32> {
        let cm = region::<MacStepParameters>(config, 1)?;
        let tm = region::<u32>(table, 13)?;
        let p = unsafe { ptr::read(config as *const MacStepParameters) };
        let (projection, [n, nu, nv, nw, ns, nt]) = p.projection.config()?;
        let addresses = unsafe { ptr::read(table as *const [u32; 13]) };
        let mut regions = [Region::EMPTY; 16];
        regions[0] = cm;
        regions[1] = tm;
        regions[2] = region::<MacStepReadout>(output, 1)?;
        regions[3] = region::<u8>(addresses[0], n)?;
        for group in 0..3 {
            for (axis, count) in [nu, nv, nw].into_iter().enumerate() {
                regions[4 + group * 3 + axis] =
                    region::<f64>(addresses[1 + group * 3 + axis], count)?;
            }
        }
        regions[13] = region::<f64>(addresses[10], n)?;
        regions[14] = region::<f64>(addresses[11], ns)?;
        regions[15] = region::<u32>(addresses[12], nt)?;
        distinct(&regions)?;
        let c = MacStepConfig {
            projection,
            kinematic_viscosity_m2_s: p.kinematic_viscosity_m2_s,
            open_velocity_m_s: p.open_velocity_m_s,
        };
        let result = unsafe {
            step_mac3d(
                &c,
                slice::from_raw_parts(addresses[0] as *const u8, n),
                &mut MacStepBuffers {
                    u: slice::from_raw_parts(addresses[1] as *const f64, nu),
                    v: slice::from_raw_parts(addresses[2] as *const f64, nv),
                    w: slice::from_raw_parts(addresses[3] as *const f64, nw),
                    acceleration_u: slice::from_raw_parts(addresses[4] as *const f64, nu),
                    acceleration_v: slice::from_raw_parts(addresses[5] as *const f64, nv),
                    acceleration_w: slice::from_raw_parts(addresses[6] as *const f64, nw),
                    next_u: slice::from_raw_parts_mut(addresses[7] as *mut f64, nu),
                    next_v: slice::from_raw_parts_mut(addresses[8] as *mut f64, nv),
                    next_w: slice::from_raw_parts_mut(addresses[9] as *mut f64, nw),
                    pressure: slice::from_raw_parts_mut(addresses[10] as *mut f64, n),
                    work: slice::from_raw_parts_mut(addresses[11] as *mut f64, ns),
                    topology_work: slice::from_raw_parts_mut(addresses[12] as *mut u32, nt),
                },
            )
        };
        match result {
            Ok(s) => {
                unsafe {
                    ptr::write(
                        output as *mut MacStepReadout,
                        MacStepReadout {
                            projection: mac_readout(s.projection),
                            advection_cfl: s.advection_cfl,
                            diffusion_cfl: s.diffusion_cfl,
                            combined_cfl: s.combined_cfl,
                            wall_impulse_kg_m_s: s.wall_impulse_kg_m_s,
                            open_impulse_kg_m_s: s.open_impulse_kg_m_s,
                            body_impulse_kg_m_s: s.body_impulse_kg_m_s,
                            pressure_impulse_kg_m_s: s.pressure_impulse_kg_m_s,
                        },
                    );
                }
                Ok(0)
            }
            Err(MacStepError::Projection(error)) => {
                unsafe {
                    ptr::write_bytes(output as *mut u8, 0, 168);
                }
                Ok(mac_projection_result(output, Err(error)))
            }
            Err(MacStepError::TimeStepExceeded {
                advection_cfl,
                diffusion_cfl,
                combined_cfl,
            }) => {
                unsafe {
                    ptr::write_bytes(output as *mut u8, 0, 168);
                    ptr::write(
                        (output + 48) as *mut [f64; 3],
                        [advection_cfl, diffusion_cfl, combined_cfl],
                    );
                }
                Ok(10)
            }
            Err(MacStepError::Invalid(error)) => Ok(status(Err(error))),
        }
    };
    operation().unwrap_or_else(|error| error)
}

fn thermal_readout(t: lbm::ThermalStep) -> [f64; 7] {
    [
        t.thermal_energy_j,
        t.source_energy_j,
        t.boundary_energy_j,
        t.energy_residual_j,
        t.solid_max_c,
        t.fluid_max_c,
        t.substeps as f64,
    ]
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MacThermalParameters {
    projection: MacProjectionParameters,
    thermal: ThermalScalars,
    material_count: u32,
    reserved: u32,
    materials: [lbm::ThermalMaterial; 16],
    contact_mask: [u32; 5],
    contact_reserved: [u32; 3],
    contact_resistance: [f64; 136],
}

const _: () = {
    assert!(mem::size_of::<MacThermalParameters>() == 1816);
    assert!(mem::offset_of!(MacThermalParameters, thermal) == 64);
    assert!(mem::offset_of!(MacThermalParameters, material_count) == 176);
    assert!(mem::offset_of!(MacThermalParameters, materials) == 184);
    assert!(mem::offset_of!(MacThermalParameters, contact_mask) == 696);
    assert!(mem::offset_of!(MacThermalParameters, contact_resistance) == 728);
};

/// Conservative sensible heat using supplied, already-projected MAC face velocities.
#[no_mangle]
pub extern "C" fn mac_thermal_step(config: u32, table: u32, output: u32) -> u32 {
    use w_sim_kernels::mac_thermal::{step_mac_thermal3d, MacThermalBuffers};
    let operation = || -> Result<u32, u32> {
        let cm = region::<MacThermalParameters>(config, 1)?;
        let tm = region::<u32>(table, 8)?;
        let p = unsafe { ptr::read(config as *const MacThermalParameters) };
        if p.reserved != 0 || p.contact_reserved != [0; 3] {
            return Err(UNSUPPORTED_ABI);
        }
        let (c, [n, nu, nv, nw, _, _]) = p.projection.config()?;
        let thermal = p.thermal.config(
            p.material_count,
            p.materials,
            p.contact_mask,
            p.contact_resistance,
        )?;
        let addresses = unsafe { ptr::read(table as *const [u32; 8]) };
        let mut regions = [Region::EMPTY; 11];
        regions[0] = cm;
        regions[1] = tm;
        regions[2] = region::<f64>(output, 7)?;
        regions[3] = region::<u8>(addresses[0], n)?;
        for (i, count) in [nu, nv, nw, n, n, n, n].into_iter().enumerate() {
            regions[4 + i] = region::<f64>(addresses[1 + i], count)?;
        }
        distinct(&regions)?;
        let result = unsafe {
            step_mac_thermal3d(
                &c,
                &thermal,
                slice::from_raw_parts(addresses[0] as *const u8, n),
                &mut MacThermalBuffers {
                    u: slice::from_raw_parts(addresses[1] as *const f64, nu),
                    v: slice::from_raw_parts(addresses[2] as *const f64, nv),
                    w: slice::from_raw_parts(addresses[3] as *const f64, nw),
                    energy: slice::from_raw_parts(addresses[4] as *const f64, n),
                    next_energy: slice::from_raw_parts_mut(addresses[5] as *mut f64, n),
                    temperature_delta_k: slice::from_raw_parts_mut(addresses[6] as *mut f64, n),
                    work: slice::from_raw_parts_mut(addresses[7] as *mut f64, n),
                },
            )
        };
        Ok(status(result.map(|t| unsafe {
            ptr::write(output as *mut [f64; 7], thermal_readout(t));
        })))
    };
    operation().unwrap_or_else(|error| error)
}

/// Clear and calculate fan-only face accelerations with supplied P-Q curves.
#[no_mangle]
pub extern "C" fn mac_fans(
    config: u32,
    disks: u32,
    count: u32,
    points: u32,
    point_count: u32,
    table: u32,
    output: u32,
) -> u32 {
    use w_sim_kernels::{
        fan_curve::FanCurvePoint,
        mac_fan::{mac_fan_accelerations, MacFanBuffers, MacFanDisk, MacFanReadout},
    };
    let operation = || -> Result<u32, u32> {
        if count > 16 || point_count > 4096 {
            return Err(INVALID_MEMORY);
        }
        let cm = region::<MacProjectionParameters>(config, 1)?;
        let tm = region::<u32>(table, 7)?;
        let p = unsafe { ptr::read(config as *const MacProjectionParameters) };
        let (c, [n, nu, nv, nw, _, _]) = p.config()?;
        let addresses = unsafe { ptr::read(table as *const [u32; 7]) };
        let mut regions = [Region::EMPTY; 12];
        regions[0] = cm;
        regions[1] = tm;
        if count == 0 {
            if disks != 0 || output != 0 || point_count != 0 {
                return Err(INVALID_MEMORY);
            }
        } else {
            regions[2] = region::<MacFanDisk>(disks, count as usize)?;
            regions[3] = region::<MacFanReadout>(output, count as usize)?;
        }
        if point_count == 0 {
            if points != 0 {
                return Err(INVALID_MEMORY);
            }
        } else {
            regions[4] = region::<FanCurvePoint>(points, point_count as usize)?;
        }
        regions[5] = region::<u8>(addresses[0], n)?;
        for (i, len) in [nu, nv, nw, nu, nv, nw].into_iter().enumerate() {
            regions[6 + i] = region::<f64>(addresses[1 + i], len)?;
        }
        distinct(&regions)?;
        let result = unsafe {
            mac_fan_accelerations(
                &c,
                slice::from_raw_parts(addresses[0] as *const u8, n),
                if count == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(disks as *const MacFanDisk, count as usize)
                },
                if point_count == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(points as *const FanCurvePoint, point_count as usize)
                },
                &mut MacFanBuffers {
                    u: slice::from_raw_parts(addresses[1] as *const f64, nu),
                    v: slice::from_raw_parts(addresses[2] as *const f64, nv),
                    w: slice::from_raw_parts(addresses[3] as *const f64, nw),
                    acceleration_u: slice::from_raw_parts_mut(addresses[4] as *mut f64, nu),
                    acceleration_v: slice::from_raw_parts_mut(addresses[5] as *mut f64, nv),
                    acceleration_w: slice::from_raw_parts_mut(addresses[6] as *mut f64, nw),
                    readouts: if count == 0 {
                        &mut []
                    } else {
                        slice::from_raw_parts_mut(output as *mut MacFanReadout, count as usize)
                    },
                },
            )
        };
        Ok(status(result))
    };
    operation().unwrap_or_else(|error| error)
}

/// SI cell fields for recording; f64 maximum cell speed is a separate readout.
#[no_mangle]
pub extern "C" fn mac_sample(
    config: u32,
    table: u32,
    thermal: u32,
    ambient_c: f64,
    max_speed: u32,
) -> u32 {
    use w_sim_kernels::mac_fields::{sample_mac_cells, MacCellFieldBuffers};
    let operation = || -> Result<u32, u32> {
        if thermal > 1 {
            return Err(6);
        }
        let cm = region::<MacProjectionParameters>(config, 1)?;
        let tm = region::<u32>(table, 7)?;
        let p = unsafe { ptr::read(config as *const MacProjectionParameters) };
        let (c, [n, nu, nv, nw, _, _]) = p.config()?;
        let addresses = unsafe { ptr::read(table as *const [u32; 7]) };
        if thermal == 0 && addresses[5] != 0 {
            return Err(INVALID_MEMORY);
        }
        let len = n
            .checked_mul(4 + thermal as usize)
            .ok_or(INVALID_DIMENSIONS)?;
        distinct(&[
            cm,
            tm,
            region::<f64>(max_speed, 1)?,
            region::<u8>(addresses[0], n)?,
            region::<f64>(addresses[1], nu)?,
            region::<f64>(addresses[2], nv)?,
            region::<f64>(addresses[3], nw)?,
            region::<f64>(addresses[4], n)?,
            if thermal == 0 {
                Region::EMPTY
            } else {
                region::<f64>(addresses[5], n)?
            },
            region::<f32>(addresses[6], len)?,
        ])?;
        let result = unsafe {
            sample_mac_cells(
                &c,
                slice::from_raw_parts(addresses[0] as *const u8, n),
                ambient_c,
                &mut MacCellFieldBuffers {
                    u: slice::from_raw_parts(addresses[1] as *const f64, nu),
                    v: slice::from_raw_parts(addresses[2] as *const f64, nv),
                    w: slice::from_raw_parts(addresses[3] as *const f64, nw),
                    pressure_pa: slice::from_raw_parts(addresses[4] as *const f64, n),
                    temperature_delta_k: if thermal == 0 {
                        None
                    } else {
                        Some(slice::from_raw_parts(addresses[5] as *const f64, n))
                    },
                    output: slice::from_raw_parts_mut(addresses[6] as *mut f32, len),
                },
            )
        };
        Ok(status(result.map(|value| unsafe {
            ptr::write(max_speed as *mut f64, value)
        })))
    };
    operation().unwrap_or_else(|error| error)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct FluidParameters {
    n: u32,
    iterations: u32,
    thermal: u32,
    inlet_enabled: u32,
    dt: f64,
    viscosity: f64,
    diffusion: f64,
    buoyancy: f64,
    ambient: f64,
    inlet_speed: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct FluidSourceParameters {
    dye_enabled: u32,
    reserved: u32,
    density: f64,
    spacing: f64,
    width: f64,
    decay: f64,
    cooling: f64,
}
const _: () = {
    assert!(mem::size_of::<FluidParameters>() == 64);
    assert!(mem::size_of::<FluidSourceParameters>() == 48);
};
fn fluid_parameters(
    address: u32,
) -> Result<(w_sim_kernels::fluid::FluidConfig, Region, usize), u32> {
    let memory = region::<FluidParameters>(address, 1)?;
    let p = unsafe { ptr::read(address as *const FluidParameters) };
    if p.thermal > 1
        || p.inlet_enabled > 1
        || (p.inlet_enabled == 0 && p.inlet_speed.to_bits() != 0)
    {
        return Err(UNSUPPORTED_ABI);
    }
    let c = w_sim_kernels::fluid::FluidConfig {
        n: p.n as usize,
        iterations: p.iterations,
        dt: p.dt,
        viscosity: p.viscosity,
        diffusion: p.diffusion,
        thermal: p.thermal == 1,
        buoyancy: p.buoyancy,
        ambient: p.ambient,
        inlet_speed: if p.inlet_enabled == 1 {
            Some(p.inlet_speed)
        } else {
            None
        },
    };
    let n = c.cell_count().map_err(|_| INVALID_DIMENSIONS)?;
    Ok((c, memory, n))
}
fn with_fluid_state(
    config: u32,
    table: u32,
    extra: Region,
    work: impl FnOnce(
        &w_sim_kernels::fluid::FluidConfig,
        &mut w_sim_kernels::fluid::FluidBuffers<'_>,
        Option<&[u8]>,
    ) -> Result<(), KernelError>,
) -> Result<u32, u32> {
    let (c, config_memory, n) = fluid_parameters(config)?;
    let table_memory = region::<u32>(table, 11)?;
    let addresses = unsafe { ptr::read(table as *const [u32; 11]) };
    let mut regions = [Region::EMPTY; 14];
    regions[0] = config_memory;
    regions[1] = table_memory;
    regions[2] = extra;
    for i in 0..10 {
        regions[3 + i] = region::<f32>(addresses[i], n)?;
    }
    regions[13] = if addresses[10] == 0 {
        Region::EMPTY
    } else {
        region::<u8>(addresses[10], n)?
    };
    distinct(&regions)?;
    let result = unsafe {
        let mut state = w_sim_kernels::fluid::FluidBuffers {
            vx: slice::from_raw_parts_mut(addresses[0] as *mut f32, n),
            vy: slice::from_raw_parts_mut(addresses[1] as *mut f32, n),
            vx0: slice::from_raw_parts_mut(addresses[2] as *mut f32, n),
            vy0: slice::from_raw_parts_mut(addresses[3] as *mut f32, n),
            dens: slice::from_raw_parts_mut(addresses[4] as *mut f32, n),
            dens0: slice::from_raw_parts_mut(addresses[5] as *mut f32, n),
            p: slice::from_raw_parts_mut(addresses[6] as *mut f32, n),
            div: slice::from_raw_parts_mut(addresses[7] as *mut f32, n),
            scalar0: slice::from_raw_parts_mut(addresses[8] as *mut f32, n),
            temp: slice::from_raw_parts_mut(addresses[9] as *mut f32, n),
        };
        work(
            &c,
            &mut state,
            if addresses[10] == 0 {
                None
            } else {
                Some(slice::from_raw_parts(addresses[10] as *const u8, n))
            },
        )
    };
    Ok(status(result))
}
#[no_mangle]
pub extern "C" fn fluid_step(config: u32, table: u32, source: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (memory, source) = if source == 0 {
            (Region::EMPTY, None)
        } else {
            let memory = region::<FluidSourceParameters>(source, 1)?;
            let p = unsafe { ptr::read(source as *const FluidSourceParameters) };
            if p.dye_enabled > 1
                || p.reserved != 0
                || (p.dye_enabled == 0
                    && [p.density, p.spacing, p.width]
                        .iter()
                        .any(|v| v.to_bits() != 0))
            {
                return Err(UNSUPPORTED_ABI);
            }
            (
                memory,
                Some(w_sim_kernels::fluid::FluidSource {
                    dye: if p.dye_enabled == 1 {
                        Some(w_sim_kernels::fluid::DyeInlet {
                            density: p.density,
                            spacing: p.spacing,
                            width: p.width,
                        })
                    } else {
                        None
                    },
                    density_decay: p.decay,
                    temperature_cooling: p.cooling,
                }),
            )
        };
        with_fluid_state(config, table, memory, |c, s, mask| {
            if let Some(source) = source {
                w_sim_kernels::fluid::advance_fluid(c, s, mask, &source)
            } else {
                w_sim_kernels::fluid::step_fluid(c, s, mask)
            }
        })
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_apply(config: u32, table: u32, operation: u32) -> u32 {
    with_fluid_state(config, table, Region::EMPTY, |c, s, mask| match operation {
        0 => w_sim_kernels::fluid::apply_buoyancy(c, s.vy, s.temp),
        1 => w_sim_kernels::fluid::apply_obstacle(c, s.vx, s.vy, s.dens, mask),
        _ => Err(KernelError::UnsupportedFeature),
    })
    .unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_set_boundary(config: u32, b: u32, x: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = fluid_parameters(config)?;
        distinct(&[cm, region::<f32>(x, n)?])?;
        Ok(status(unsafe {
            w_sim_kernels::fluid::set_boundary(&c, b, slice::from_raw_parts_mut(x as *mut f32, n))
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_linear_solve(
    config: u32,
    b: u32,
    x: u32,
    x0: u32,
    a: f64,
    denominator: f64,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = fluid_parameters(config)?;
        distinct(&[cm, region::<f32>(x, n)?, region::<f32>(x0, n)?])?;
        Ok(status(unsafe {
            w_sim_kernels::fluid::linear_solve(
                &c,
                b,
                slice::from_raw_parts_mut(x as *mut f32, n),
                slice::from_raw_parts(x0 as *const f32, n),
                a,
                denominator,
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_diffuse(config: u32, b: u32, x: u32, x0: u32, diff: f64) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = fluid_parameters(config)?;
        distinct(&[cm, region::<f32>(x, n)?, region::<f32>(x0, n)?])?;
        Ok(status(unsafe {
            w_sim_kernels::fluid::diffuse(
                &c,
                b,
                slice::from_raw_parts_mut(x as *mut f32, n),
                slice::from_raw_parts(x0 as *const f32, n),
                diff,
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_project(config: u32, vx: u32, vy: u32, p: u32, div: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = fluid_parameters(config)?;
        distinct(&[
            cm,
            region::<f32>(vx, n)?,
            region::<f32>(vy, n)?,
            region::<f32>(p, n)?,
            region::<f32>(div, n)?,
        ])?;
        Ok(status(unsafe {
            w_sim_kernels::fluid::project(
                &c,
                slice::from_raw_parts_mut(vx as *mut f32, n),
                slice::from_raw_parts_mut(vy as *mut f32, n),
                slice::from_raw_parts_mut(p as *mut f32, n),
                slice::from_raw_parts_mut(div as *mut f32, n),
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_advect(config: u32, b: u32, d: u32, d0: u32, vx: u32, vy: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = fluid_parameters(config)?;
        let output = region::<f32>(d, n)?;
        distinct(&[cm, output])?;
        // Read-only inputs may coincide (velocity advects itself); none may alias output/config.
        for address in [d0, vx, vy] {
            let input = region::<f32>(address, n)?;
            distinct(&[cm, output, input])?;
        }
        Ok(status(unsafe {
            w_sim_kernels::fluid::advect(
                &c,
                b,
                slice::from_raw_parts_mut(d as *mut f32, n),
                slice::from_raw_parts(d0 as *const f32, n),
                slice::from_raw_parts(vx as *const f32, n),
                slice::from_raw_parts(vy as *const f32, n),
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_read(
    config: u32,
    vx: u32,
    vy: u32,
    dens: u32,
    temp: u32,
    margin: u32,
    output: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = fluid_parameters(config)?;
        let out = region::<f64>(output, 6)?;
        for address in [vx, vy, dens, temp] {
            distinct(&[cm, out, region::<f32>(address, n)?])?;
        }
        let result = unsafe {
            w_sim_kernels::fluid::read_fluid(
                &c,
                slice::from_raw_parts(vx as *const f32, n),
                slice::from_raw_parts(vy as *const f32, n),
                slice::from_raw_parts(dens as *const f32, n),
                slice::from_raw_parts(temp as *const f32, n),
                margin as usize,
            )
        };
        Ok(status(result.map(|s| unsafe {
            ptr::write(
                output as *mut [f64; 6],
                [
                    s.peak_density,
                    s.mean_density,
                    s.max_speed,
                    s.min_temperature,
                    s.max_temperature,
                    s.max_divergence,
                ],
            )
        })))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn fluid_max_divergence(vx: u32, vy: u32, n: u32, margin: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let count = cells(n, n)?;
        let out = region::<f64>(output, 1)?;
        for address in [vx, vy] {
            distinct(&[out, region::<f32>(address, count)?])?;
        }
        let result = unsafe {
            w_sim_kernels::fluid::max_divergence(
                slice::from_raw_parts(vx as *const f32, count),
                slice::from_raw_parts(vy as *const f32, count),
                n as usize,
                margin as usize,
            )
        };
        Ok(status(result.map(|value| unsafe {
            ptr::write(output as *mut f64, value)
        })))
    };
    operation().unwrap_or_else(|e| e)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct IsingParameters {
    size: u32,
    reserved: u32,
    temperature: f64,
}
fn ising_parameters(
    address: u32,
) -> Result<(w_sim_kernels::ising::IsingConfig, Region, usize), u32> {
    let memory = region::<IsingParameters>(address, 1)?;
    let p = unsafe { ptr::read(address as *const IsingParameters) };
    if p.reserved != 0 {
        return Err(UNSUPPORTED_ABI);
    }
    let c = w_sim_kernels::ising::IsingConfig {
        size: p.size as usize,
        temperature: p.temperature,
    };
    let n = c.cells().map_err(|e| status(Err(e)))?;
    Ok((c, memory, n))
}
#[no_mangle]
pub extern "C" fn ising_init(config: u32, spins: u32, rng: u32, seed: u32, hot: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = ising_parameters(config)?;
        if hot > 1 {
            return Err(UNSUPPORTED_ABI);
        }
        distinct(&[cm, region::<i8>(spins, n)?, region::<u32>(rng, 1)?])?;
        Ok(status(unsafe {
            w_sim_kernels::ising::init_ising(
                &c,
                slice::from_raw_parts_mut(spins as *mut i8, n),
                &mut *(rng as *mut u32),
                seed,
                hot == 1,
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn ising_next(rng: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        distinct(&[region::<u32>(rng, 1)?, region::<f64>(output, 1)?])?;
        unsafe {
            ptr::write(
                output as *mut f64,
                w_sim_kernels::ising::next_random(&mut *(rng as *mut u32)),
            );
        }
        Ok(0)
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn ising_sweep(
    config: u32,
    spins: u32,
    rng: u32,
    moments: u32,
    algorithm: u32,
    sample: u32,
    reset: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ising::{sweep_ising, IsingAlgorithm, IsingMoments};
        let (c, cm, n) = ising_parameters(config)?;
        if sample > 1 || reset > 1 || algorithm > 1 {
            return Err(UNSUPPORTED_ABI);
        }
        if moments == 0 && (sample != 0 || reset != 0) {
            return Err(INVALID_MEMORY);
        }
        distinct(&[
            cm,
            region::<i8>(spins, n)?,
            region::<u32>(rng, 1)?,
            if moments == 0 {
                Region::EMPTY
            } else {
                region::<IsingMoments>(moments, 1)?
            },
        ])?;
        Ok(status(unsafe {
            sweep_ising(
                &c,
                slice::from_raw_parts_mut(spins as *mut i8, n),
                &mut *(rng as *mut u32),
                if moments == 0 {
                    None
                } else {
                    Some(&mut *(moments as *mut IsingMoments))
                },
                if algorithm == 0 {
                    IsingAlgorithm::Metropolis
                } else {
                    IsingAlgorithm::Heatbath
                },
                sample == 1,
                reset == 1,
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn ising_read(config: u32, spins: u32, moments: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ising::{onsager_tc, read_ising, IsingMoments};
        let (c, cm, n) = ising_parameters(config)?;
        distinct(&[
            cm,
            region::<i8>(spins, n)?,
            region::<IsingMoments>(moments, 1)?,
            region::<f64>(output, 10)?,
        ])?;
        let result = unsafe {
            read_ising(
                &c,
                slice::from_raw_parts(spins as *const i8, n),
                &*(moments as *const IsingMoments),
            )
        };
        Ok(status(result.map(|r| unsafe {
            let p = r.point;
            ptr::write(
                output as *mut [f64; 10],
                [
                    r.magnetization,
                    r.energy,
                    p.samples as f64,
                    p.mean_m.unwrap_or(0.),
                    p.mean_abs_m.unwrap_or(0.),
                    p.mean_energy.unwrap_or(0.),
                    p.specific_heat.unwrap_or(0.),
                    p.susceptibility.unwrap_or(0.),
                    p.reference,
                    onsager_tc(),
                ],
            );
        })))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn ising_delta(config: u32, spins: u32, index: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm, n) = ising_parameters(config)?;
        distinct(&[cm, region::<i8>(spins, n)?, region::<f64>(output, 1)?])?;
        let result = unsafe {
            w_sim_kernels::ising::delta_energy(
                &c,
                slice::from_raw_parts(spins as *const i8, n),
                index as usize,
            )
        };
        Ok(status(
            result.map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn ising_reference(temperature: f64, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        region::<f64>(output, 2)?;
        Ok(status(
            w_sim_kernels::ising::onsager_magnetization(temperature).map(|m| unsafe {
                ptr::write(
                    output as *mut [f64; 2],
                    [w_sim_kernels::ising::onsager_tc(), m],
                )
            }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn ising_fluctuation(
    mean: f64,
    mean2: f64,
    n: u32,
    temperature: f64,
    kind: u32,
    output: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        region::<f64>(output, 1)?;
        let result = match kind {
            0 => w_sim_kernels::ising::specific_heat(mean, mean2, n as usize, temperature),
            1 => w_sim_kernels::ising::susceptibility(mean, mean2, n as usize, temperature),
            _ => return Err(UNSUPPORTED_ABI),
        };
        Ok(status(
            result.map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}

// The ODE families share memory checks, not a second numerical implementation.
fn ode_config<C: Copy>(address: u32) -> Result<(C, Region), u32> {
    let region = region::<C>(address, 1)?;
    Ok((unsafe { ptr::read(address as *const C) }, region))
}

// Plane waves share only memory marshalling; physical formulas stay in plane.rs.
fn plane_sample<C: Copy>(
    config: u32,
    time: f64,
    xs: u32,
    count: u32,
    first: u32,
    second: u32,
    sample: fn(&C, f64, &[f64], &mut [f64], &mut [f64]) -> Result<(), KernelError>,
) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<C>(config)?;
        let n = count as usize;
        distinct(&[
            cm,
            if n == 0 {
                Region::EMPTY
            } else {
                region::<f64>(xs, n)?
            },
            if n == 0 {
                Region::EMPTY
            } else {
                region::<f64>(first, n)?
            },
            if n == 0 {
                Region::EMPTY
            } else {
                region::<f64>(second, n)?
            },
        ])?;
        Ok(status(if n == 0 {
            sample(&p, time, &[], &mut [], &mut [])
        } else {
            unsafe {
                sample(
                    &p,
                    time,
                    slice::from_raw_parts(xs as *const f64, n),
                    slice::from_raw_parts_mut(first as *mut f64, n),
                    slice::from_raw_parts_mut(second as *mut f64, n),
                )
            }
        }))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn plane_em_read(config: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        use w_sim_kernels::plane::*;
        let (p, cm) = ode_config::<EmConfig>(config)?;
        distinct(&[cm, region::<EmObservables>(output, 1)?])?;
        Ok(status(em_observables(&p).map(|r| unsafe {
            ptr::write(output as *mut EmObservables, r)
        })))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn plane_em_sample(
    config: u32,
    time: f64,
    xs: u32,
    count: u32,
    e: u32,
    b: u32,
) -> u32 {
    plane_sample(
        config,
        time,
        xs,
        count,
        e,
        b,
        w_sim_kernels::plane::sample_em,
    )
}
#[no_mangle]
pub extern "C" fn plane_acoustic_read(config: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        use w_sim_kernels::plane::*;
        let (p, cm) = ode_config::<AcousticConfig>(config)?;
        distinct(&[cm, region::<AcousticObservables>(output, 1)?])?;
        Ok(status(acoustic_observables(&p).map(|r| unsafe {
            ptr::write(output as *mut AcousticObservables, r)
        })))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn plane_acoustic_sample(
    config: u32,
    time: f64,
    xs: u32,
    count: u32,
    pressure: u32,
    velocity: u32,
) -> u32 {
    plane_sample(
        config,
        time,
        xs,
        count,
        pressure,
        velocity,
        w_sim_kernels::plane::sample_acoustic,
    )
}
#[no_mangle]
pub extern "C" fn plane_em3d(config: u32, z: u32, ey: u32, cbx: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        use w_sim_kernels::plane::*;
        let (p, cm) = ode_config::<Em3dConfig>(config)?;
        distinct(&[
            cm,
            region::<f64>(z, EM3D_SAMPLES)?,
            region::<f64>(ey, EM3D_SAMPLES)?,
            region::<f64>(cbx, EM3D_SAMPLES)?,
            region::<f64>(output, 1)?,
        ])?;
        Ok(status(
            unsafe {
                em3d_fields(
                    &p,
                    slice::from_raw_parts_mut(z as *mut f64, EM3D_SAMPLES),
                    slice::from_raw_parts_mut(ey as *mut f64, EM3D_SAMPLES),
                    slice::from_raw_parts_mut(cbx as *mut f64, EM3D_SAMPLES),
                )
            }
            .map(|r| unsafe { ptr::write(output as *mut f64, r) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn plane_sincos(angle: f64, output: u32) -> u32 {
    if let Err(e) = region::<f64>(output, 2) {
        return e;
    }
    status(
        w_sim_kernels::plane::phase_sin_cos(angle).map(|(s, c)| unsafe {
            ptr::write(output as *mut [f64; 2], [s, c]);
        }),
    )
}
fn ode_update<C: Copy, S: Copy>(
    config: u32,
    state: u32,
    step: impl FnOnce(S, &C) -> Result<S, KernelError>,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm) = ode_config::<C>(config)?;
        distinct(&[cm, region::<S>(state, 1)?])?;
        let s = unsafe { ptr::read(state as *const S) };
        Ok(status(
            step(s, &c).map(|s| unsafe { ptr::write(state as *mut S, s) }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn rlc_step(config: u32, state: u32) -> u32 {
    ode_update(config, state, w_sim_kernels::ode::rlc_step)
}
#[no_mangle]
pub extern "C" fn mutual_step(config: u32, state: u32) -> u32 {
    ode_update(config, state, w_sim_kernels::ode::mutual_step)
}
#[no_mangle]
pub extern "C" fn oscillator_step(config: u32, state: u32, time: f64) -> u32 {
    ode_update(config, state, |s, p| {
        w_sim_kernels::ode::oscillator_step(s, p, time)
    })
}
#[no_mangle]
pub extern "C" fn neuron_step(config: u32, state: u32) -> u32 {
    ode_update(config, state, w_sim_kernels::ode::neuron_step)
}
#[no_mangle]
pub extern "C" fn rlc_advance(config: u32, state: u32, count: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<RlcConfig>(config)?;
        if count == 0 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[
            cm,
            region::<RlcState>(state, 1)?,
            region::<RlcState>(output, count as usize)?,
        ])?;
        Ok(status(unsafe {
            advance_rlc(
                &c,
                &mut *(state as *mut RlcState),
                slice::from_raw_parts_mut(output as *mut RlcState, count as usize),
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn rlc_read(config: u32, state: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<RlcConfig>(config)?;
        distinct(&[cm, region::<RlcState>(state, 1)?, region::<f64>(output, 6)?])?;
        Ok(status(
            read_rlc(&c, unsafe { ptr::read(state as *const RlcState) }).map(|s| unsafe {
                ptr::write(
                    output as *mut [f64; 6],
                    [
                        s.omega0,
                        s.damping_ratio,
                        s.quality_factor.unwrap_or(0.),
                        s.damped_frequency,
                        s.energy,
                        f64::from(u8::from(s.quality_factor.is_some())),
                    ],
                )
            }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn mutual_advance(
    config: u32,
    state: u32,
    start: u32,
    count: u32,
    mode: u32,
    omega: f64,
    output: u32,
    shares: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<MutualConfig>(config)?;
        if count == 0 {
            return Err(INVALID_DIMENSIONS);
        }
        if mode > 1 {
            return Err(UNSUPPORTED_ABI);
        }
        distinct(&[
            cm,
            region::<MutualRunState>(state, 1)?,
            region::<MutualState>(output, count as usize)?,
            region::<f64>(shares, count as usize)?,
        ])?;
        Ok(status(unsafe {
            advance_mutual(
                &c,
                &mut *(state as *mut MutualRunState),
                start as usize,
                mode == 1,
                omega,
                slice::from_raw_parts_mut(output as *mut MutualState, count as usize),
                slice::from_raw_parts_mut(shares as *mut f64, count as usize),
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn mutual_read(config: u32, state: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<MutualConfig>(config)?;
        distinct(&[
            cm,
            region::<MutualRunState>(state, 1)?,
            region::<f64>(output, 5)?,
        ])?;
        Ok(status(
            read_mutual(&c, unsafe { ptr::read(state as *const MutualRunState) }).map(|s| unsafe {
                ptr::write(
                    output as *mut [f64; 5],
                    [
                        s.coupling,
                        s.turns_ratio,
                        s.secondary_voltage,
                        s.substeps as f64,
                        s.secondary_share,
                    ],
                )
            }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn oscillator_advance(
    config: u32,
    state: u32,
    start: u32,
    count: u32,
    output: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<OscillatorConfig>(config)?;
        if count == 0 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[
            cm,
            region::<OscillatorState>(state, 1)?,
            region::<OscillatorState>(output, count as usize)?,
        ])?;
        Ok(status(unsafe {
            advance_oscillator(
                &c,
                &mut *(state as *mut OscillatorState),
                start as usize,
                slice::from_raw_parts_mut(output as *mut OscillatorState, count as usize),
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn oscillator_read(config: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<OscillatorConfig>(config)?;
        distinct(&[cm, region::<f64>(output, 2)?])?;
        let result = || -> Result<[f64; 2], KernelError> {
            Ok([
                oscillator_omega0(c.mass, c.stiffness)?,
                oscillator_amplitude(&c, c.drive_omega)?,
            ])
        };
        Ok(status(result().map(|s| unsafe {
            ptr::write(output as *mut [f64; 2], s)
        })))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn oscillator_omega0(mass: f64, stiffness: f64, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        region::<f64>(output, 1)?;
        Ok(status(
            w_sim_kernels::ode::oscillator_omega0(mass, stiffness)
                .map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn oscillator_amplitude(config: u32, omega: f64, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        let (c, cm) = ode_config::<w_sim_kernels::ode::OscillatorConfig>(config)?;
        distinct(&[cm, region::<f64>(output, 1)?])?;
        Ok(status(
            w_sim_kernels::ode::oscillator_amplitude(&c, omega)
                .map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn oscillator_curve(
    config: u32,
    min: f64,
    max: f64,
    count: u32,
    omega: u32,
    amplitude: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<OscillatorConfig>(config)?;
        if count < 2 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[
            cm,
            region::<f64>(omega, count as usize)?,
            region::<f64>(amplitude, count as usize)?,
        ])?;
        Ok(status(unsafe {
            oscillator_curve(
                &c,
                min,
                max,
                slice::from_raw_parts_mut(omega as *mut f64, count as usize),
                slice::from_raw_parts_mut(amplitude as *mut f64, count as usize),
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn neuron_advance(
    config: u32,
    state: u32,
    pulses: u32,
    pulse_count: u32,
    start: u32,
    count: u32,
    output: u32,
    upward: u32,
) -> u32 {
    let operation = || -> Result<u32, u32> {
        use w_sim_kernels::ode::*;
        let (c, cm) = ode_config::<NeuronConfig>(config)?;
        if count == 0 {
            return Err(INVALID_DIMENSIONS);
        }
        if pulse_count == 0 && pulses != 0 {
            return Err(INVALID_MEMORY);
        }
        distinct(&[
            cm,
            region::<NeuronState>(state, 1)?,
            if pulse_count == 0 {
                Region::EMPTY
            } else {
                region::<u32>(pulses, pulse_count as usize)?
            },
            region::<f64>(output, count as usize)?,
            region::<u8>(upward, count as usize)?,
        ])?;
        Ok(status(unsafe {
            advance_neuron(
                &c,
                &mut *(state as *mut NeuronState),
                if pulse_count == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(pulses as *const u32, pulse_count as usize)
                },
                start as usize,
                slice::from_raw_parts_mut(output as *mut f64, count as usize),
                slice::from_raw_parts_mut(upward as *mut u8, count as usize),
            )
        }))
    };
    operation().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn ode_peak(values: u32, count: u32, output: u32) -> u32 {
    let operation = || -> Result<u32, u32> {
        if count == 0 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[
            region::<f64>(values, count as usize)?,
            region::<f64>(output, 1)?,
        ])?;
        Ok(status(
            w_sim_kernels::ode::peak(unsafe {
                slice::from_raw_parts(values as *const f64, count as usize)
            })
            .map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    operation().unwrap_or_else(|e| e)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct OpticsPointers {
    geoms: u32,
    stack: u32,
    segments: u32,
    hits: u32,
    events: u32,
    profiles: u32,
    bins: u32,
    reserved: u32,
}
fn optics_trace(
    config: u32,
    components: u32,
    state: u32,
    table: u32,
    operation: u32,
    budget: u32,
) -> u32 {
    let run = || -> Result<u32, u32> {
        use w_sim_kernels::optics::*;
        let (c, cm) = ode_config::<OpticsConfig>(config)?;
        let (p, pm) = ode_config::<OpticsPointers>(table)?;
        if c.reserved != 0 || p.reserved != 0 {
            return Err(UNSUPPORTED_ABI);
        }
        let n = c.component_count as usize;
        if n > MAX_COMPONENTS
            || c.screen_bins == 0
            || c.screen_bins > 4096
            || c.max_bounces > MAX_RAYS as u32
        {
            return Err(INVALID_DIMENSIONS);
        }
        let optional =
            |address: u32, len: usize, size: usize, align: usize| -> Result<Region, u32> {
                if len == 0 {
                    return Ok(Region::EMPTY);
                }
                if address as usize % align != 0 {
                    return Err(INVALID_MEMORY);
                }
                region::<u8>(address, len.checked_mul(size).ok_or(INVALID_MEMORY)?)
            };
        distinct(&[
            cm,
            pm,
            region::<OpticsState>(state, 1)?,
            if operation == 2 {
                Region::EMPTY
            } else {
                optional(components, n, mem::size_of::<OpticsComponent>(), 8)?
            },
            optional(p.geoms, n, 48, 8)?,
            region::<OpticsRay>(p.stack, STACK_CAPACITY)?,
            region::<RaySegment>(p.segments, MAX_RAYS)?,
            region::<RayHit>(p.hits, MAX_RAYS)?,
            region::<OpticsEvent>(p.events, MAX_RAYS)?,
            optional(p.profiles, n, 32, 8)?,
            optional(p.bins, n * c.screen_bins as usize, 8, 8)?,
        ])?;
        let result = unsafe {
            let mut buffers = OpticsBuffers {
                geoms: if n == 0 {
                    &mut []
                } else {
                    slice::from_raw_parts_mut(p.geoms as *mut SegmentGeom, n)
                },
                stack: slice::from_raw_parts_mut(p.stack as *mut OpticsRay, STACK_CAPACITY),
                segments: slice::from_raw_parts_mut(p.segments as *mut RaySegment, MAX_RAYS),
                hits: slice::from_raw_parts_mut(p.hits as *mut RayHit, MAX_RAYS),
                events: slice::from_raw_parts_mut(p.events as *mut OpticsEvent, MAX_RAYS),
                profiles: if n == 0 {
                    &mut []
                } else {
                    slice::from_raw_parts_mut(p.profiles as *mut ScreenProfile, n)
                },
                bins: if n == 0 {
                    &mut []
                } else {
                    slice::from_raw_parts_mut(p.bins as *mut f64, n * c.screen_bins as usize)
                },
            };
            if operation == 2 {
                read_trace(&c, &*(state as *const OpticsState), &mut buffers)
            } else {
                let components = if n == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(components as *const OpticsComponent, n)
                };
                let state = &mut *(state as *mut OpticsState);
                if operation == 0 {
                    init_trace(&c, components, state, &mut buffers)
                } else {
                    advance_trace(&c, components, state, &mut buffers, budget).map(|_| ())
                }
            }
        };
        Ok(status(result))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn optics_init(config: u32, components: u32, state: u32, table: u32) -> u32 {
    optics_trace(config, components, state, table, 0, 0)
}
#[no_mangle]
pub extern "C" fn optics_advance(
    config: u32,
    components: u32,
    state: u32,
    table: u32,
    budget: u32,
) -> u32 {
    optics_trace(config, components, state, table, 1, budget)
}
#[no_mangle]
pub extern "C" fn optics_read(config: u32, state: u32, table: u32) -> u32 {
    optics_trace(config, 0, state, table, 2, 0)
}
fn optics_direction(
    output: u32,
    f: impl FnOnce() -> Result<w_sim_kernels::optics::Direction, KernelError>,
) -> u32 {
    let run = || -> Result<u32, u32> {
        region::<f64>(output, 2)?;
        Ok(status(f().map(|d| unsafe {
            ptr::write(output as *mut [f64; 2], [d.dx, d.dy])
        })))
    };
    run().unwrap_or_else(|e| e)
}
fn optics_number(output: u32, f: impl FnOnce() -> Result<f64, KernelError>) -> u32 {
    let run = || -> Result<u32, u32> {
        region::<f64>(output, 1)?;
        Ok(status(
            f().map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}

fn radar_run(
    config: u32,
    state: u32,
    field0: u32,
    field1: u32,
    mask: u32,
    traces: u32,
    count: u32,
    initialize: bool,
) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<radar::RadarConfig>(config)?;
        if p.reserved != [0; 2] {
            return Err(UNSUPPORTED_ABI);
        }
        distinct(&[
            cm,
            region::<radar::RadarState>(state, 1)?,
            region::<f32>(field0, radar::CELLS)?,
            region::<f32>(field1, radar::CELLS)?,
            region::<u8>(mask, radar::CELLS)?,
            region::<f64>(traces, 4 * radar::BUFFER)?,
        ])?;
        let result = unsafe {
            let mut b = radar::RadarBuffers {
                field0: slice::from_raw_parts_mut(field0 as *mut f32, radar::CELLS),
                field1: slice::from_raw_parts_mut(field1 as *mut f32, radar::CELLS),
                mask: slice::from_raw_parts_mut(mask as *mut u8, radar::CELLS),
                traces: slice::from_raw_parts_mut(traces as *mut f64, 4 * radar::BUFFER),
            };
            let s = &mut *(state as *mut radar::RadarState);
            if initialize {
                radar::init_radar(&p, s, &mut b)
            } else {
                radar::advance_radar(&p, s, &mut b, count)
            }
        };
        Ok(status(result))
    };
    run().unwrap_or_else(|e| e)
}

#[no_mangle]
pub extern "C" fn array_sense(
    config: u32,
    input: u32,
    sensor_matrix: u32,
    bias: u32,
    custom_code: u32,
    table: u32,
    output: u32,
) -> u32 {
    array_sense_run(
        config,
        input,
        sensor_matrix,
        bias,
        custom_code,
        0,
        table,
        output,
        false,
    )
}
#[no_mangle]
pub extern "C" fn array_sense_sampled(
    config: u32,
    input: u32,
    sensor_matrix: u32,
    bias: u32,
    custom_code: u32,
    rc: u32,
    table: u32,
    output: u32,
) -> u32 {
    array_sense_run(
        config,
        input,
        sensor_matrix,
        bias,
        custom_code,
        rc,
        table,
        output,
        true,
    )
}
fn array_sense_run(
    config: u32,
    input: u32,
    sensor_matrix: u32,
    bias: u32,
    custom_code: u32,
    rc: u32,
    table: u32,
    output: u32,
    sampled: bool,
) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<sensing::SensingConfig>(config)?;
        if p.reserved != 0 {
            return Err(UNSUPPORTED_ABI);
        }
        let (n, sensors, m) = p.dimensions().map_err(|e| status(Err(e)))?;
        let count = if sampled { 10 } else { 8 };
        let tm = region::<u32>(table, count)?;
        let mut t = [0u32; 10];
        unsafe {
            t[..count].copy_from_slice(slice::from_raw_parts(table as *const u32, count));
        }
        let (rc_config, rcm) = if rc == 0 {
            (None, Region::EMPTY)
        } else {
            let (c, r) = ode_config::<sensing::RcSamplingConfig>(rc)?;
            (Some(c), r)
        };
        let code_region = if p.encoding == 2 {
            region::<f64>(custom_code, m * sensors)?
        } else if custom_code == 0 {
            Region::EMPTY
        } else {
            return Err(INVALID_MEMORY);
        };
        distinct(&[
            cm,
            tm,
            rcm,
            region::<f64>(output, if sampled { 8 } else { 5 })?,
            region::<f64>(input, n)?,
            region::<f64>(sensor_matrix, sensors * n)?,
            region::<f64>(bias, sensors)?,
            code_region,
            region::<f64>(t[0], m * sensors)?,
            region::<f64>(t[1], sensors)?,
            region::<f64>(t[2], m)?,
            region::<f64>(t[3], n)?,
            region::<f64>(t[4], n)?,
            region::<f64>(t[5], (m + n) * n)?,
            region::<f64>(t[6], m + n)?,
            region::<u32>(t[7], n)?,
            if sampled {
                region::<f64>(t[8], m)?
            } else {
                Region::EMPTY
            },
            if sampled {
                region::<f64>(t[9], m)?
            } else {
                Region::EMPTY
            },
        ])?;
        Ok(status(unsafe {
            let input = slice::from_raw_parts(input as *const f64, n);
            let sensing = slice::from_raw_parts(sensor_matrix as *const f64, sensors * n);
            let bias = slice::from_raw_parts(bias as *const f64, sensors);
            let custom = if p.encoding == 2 {
                Some(slice::from_raw_parts(
                    custom_code as *const f64,
                    m * sensors,
                ))
            } else {
                None
            };
            let mut b = sensing::SensingBuffers {
                encoding: slice::from_raw_parts_mut(t[0] as *mut f64, m * sensors),
                sensor_voltages: slice::from_raw_parts_mut(t[1] as *mut f64, sensors),
                measurements: slice::from_raw_parts_mut(t[2] as *mut f64, m),
                reconstructed: slice::from_raw_parts_mut(t[3] as *mut f64, n),
                error: slice::from_raw_parts_mut(t[4] as *mut f64, n),
                qr: slice::from_raw_parts_mut(t[5] as *mut f64, (m + n) * n),
                rhs: slice::from_raw_parts_mut(t[6] as *mut f64, m + n),
                permutation: slice::from_raw_parts_mut(t[7] as *mut u32, n),
            };
            if sampled {
                sensing::sense_array_sampled(
                    &p,
                    input,
                    sensing,
                    bias,
                    custom,
                    &mut b,
                    &mut sensing::SensingSampling {
                        rc: rc_config.as_ref(),
                        ideal_voltages: slice::from_raw_parts_mut(t[8] as *mut f64, m),
                        sampled_voltages: slice::from_raw_parts_mut(t[9] as *mut f64, m),
                    },
                )
                .map(|r| ptr::write(output as *mut sensing::SampledSensingReadout, r))
            } else {
                sensing::sense_array(&p, input, sensing, bias, custom, &mut b)
                    .map(|r| ptr::write(output as *mut sensing::SensingReadout, r))
            }
        }))
    };
    run().unwrap_or_else(|e| e)
}

#[no_mangle]
pub extern "C" fn transient_result(config: u32, values: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<transient::TransientConfig>(config)?;
        if p.reserved != 0 {
            return Err(UNSUPPORTED_ABI);
        }
        distinct(&[
            cm,
            region::<f64>(values, 241)?,
            region::<transient::TransientReadout>(output, 1)?,
        ])?;
        Ok(status(
            unsafe {
                transient::transient_result(&p, slice::from_raw_parts_mut(values as *mut f64, 241))
            }
            .map(|r| unsafe { ptr::write(output as *mut transient::TransientReadout, r) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}

#[no_mangle]
pub extern "C" fn faraday_result(config: u32, flux: u32, emf: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<faraday::FaradayConfig>(config)?;
        distinct(&[
            cm,
            region::<f64>(flux, 361)?,
            region::<f64>(emf, 361)?,
            region::<faraday::FaradayReadout>(output, 1)?,
        ])?;
        Ok(status(
            unsafe {
                faraday::faraday_result(
                    &p,
                    slice::from_raw_parts_mut(flux as *mut f64, 361),
                    slice::from_raw_parts_mut(emf as *mut f64, 361),
                )
            }
            .map(|r| unsafe { ptr::write(output as *mut faraday::FaradayReadout, r) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn faraday_induced(d_phi_dt: f64, n: f64, output: u32) -> u32 {
    optics_number(output, || faraday::induced_emf(d_phi_dt, n))
}
#[no_mangle]
pub extern "C" fn faraday_motional(b: f64, length: f64, v: f64, output: u32) -> u32 {
    optics_number(output, || faraday::motional_emf(b, length, v))
}
#[no_mangle]
pub extern "C" fn faraday_peak(n: f64, b: f64, area: f64, omega: f64, output: u32) -> u32 {
    optics_number(output, || faraday::peak_emf(n, b, area, omega))
}
#[no_mangle]
pub extern "C" fn faraday_flux(t: f64, n: f64, b: f64, area: f64, omega: f64, output: u32) -> u32 {
    optics_number(output, || faraday::rotating_coil_flux(t, n, b, area, omega))
}
#[no_mangle]
pub extern "C" fn faraday_emf(t: f64, n: f64, b: f64, area: f64, omega: f64, output: u32) -> u32 {
    optics_number(output, || faraday::rotating_coil_emf(t, n, b, area, omega))
}
#[no_mangle]
pub extern "C" fn faraday_series(flux: u32, count: u32, dt: f64, n: f64, output: u32) -> u32 {
    if count == 0 {
        return if flux == 0 && output == 0 {
            status(faraday::emf_from_flux_series(&[], dt, n, &mut []))
        } else {
            INVALID_MEMORY
        };
    }
    let run = || -> Result<u32, u32> {
        let count = count as usize;
        distinct(&[region::<f64>(flux, count)?, region::<f64>(output, count)?])?;
        Ok(status(unsafe {
            faraday::emf_from_flux_series(
                slice::from_raw_parts(flux as *const f64, count),
                dt,
                n,
                slice::from_raw_parts_mut(output as *mut f64, count),
            )
        }))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn transient_step(config: u32, state: u32) -> u32 {
    ode_update(
        config,
        state,
        |mut s: f64, p: &transient::FirstOrderConfig| {
            transient::first_order_step(p, &mut s)?;
            Ok(s)
        },
    )
}
#[no_mangle]
pub extern "C" fn transient_advance(config: u32, state: u32, count: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<transient::FirstOrderConfig>(config)?;
        distinct(&[cm, region::<f64>(state, 1)?])?;
        Ok(status(unsafe {
            transient::first_order_advance(&p, &mut *(state as *mut f64), count)
        }))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn transient_tau_rc(r: f64, c: f64, output: u32) -> u32 {
    optics_number(output, || transient::time_constant_rc(r, c))
}
#[no_mangle]
pub extern "C" fn transient_tau_rl(l: f64, r: f64, output: u32) -> u32 {
    optics_number(output, || transient::time_constant_rl(l, r))
}
#[no_mangle]
pub extern "C" fn transient_charge(t: f64, v0: f64, r: f64, c: f64, output: u32) -> u32 {
    optics_number(output, || transient::rc_charge(t, v0, r, c))
}
#[no_mangle]
pub extern "C" fn transient_discharge(t: f64, v0: f64, r: f64, c: f64, output: u32) -> u32 {
    optics_number(output, || transient::rc_discharge(t, v0, r, c))
}
#[no_mangle]
pub extern "C" fn transient_current(t: f64, v0: f64, r: f64, l: f64, output: u32) -> u32 {
    optics_number(output, || transient::rl_current(t, v0, r, l))
}
#[no_mangle]
pub extern "C" fn transient_weights(time: f64, tau: f64, output: u32) -> u32 {
    if let Err(e) = region::<transient::FirstOrderWeights>(output, 1) {
        return e;
    }
    status(
        transient::first_order_weights(time, tau)
            .map(|r| unsafe { ptr::write(output as *mut transient::FirstOrderWeights, r) }),
    )
}
#[no_mangle]
pub extern "C" fn radar_init(
    config: u32,
    state: u32,
    field0: u32,
    field1: u32,
    mask: u32,
    traces: u32,
) -> u32 {
    radar_run(config, state, field0, field1, mask, traces, 0, true)
}
#[no_mangle]
pub extern "C" fn radar_advance(
    config: u32,
    state: u32,
    field0: u32,
    field1: u32,
    mask: u32,
    traces: u32,
    count: u32,
) -> u32 {
    radar_run(config, state, field0, field1, mask, traces, count, false)
}
#[no_mangle]
pub extern "C" fn radar_mask(mask: u32) -> u32 {
    if let Err(e) = region::<u8>(mask, radar::CELLS) {
        return e;
    }
    status(unsafe { radar::radar_mask(slice::from_raw_parts_mut(mask as *mut u8, radar::CELLS)) })
}
#[no_mangle]
pub extern "C" fn radar_read(state: u32, traces: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (s, sm) = ode_config::<radar::RadarState>(state)?;
        distinct(&[
            sm,
            region::<f64>(traces, 4 * radar::BUFFER)?,
            region::<f64>(output, 12)?,
        ])?;
        Ok(status(
            unsafe {
                radar::read_radar(
                    &s,
                    slice::from_raw_parts(traces as *const f64, 4 * radar::BUFFER),
                )
            }
            .map(|channels| {
                let mut values = [0.; 12];
                for (i, ch) in channels.into_iter().enumerate() {
                    if let Some(ch) = ch {
                        values[i * 3] = ch.v;
                        values[i * 3 + 1] = ch.pp;
                        values[i * 3 + 2] = 1.;
                    }
                }
                unsafe { ptr::write(output as *mut [f64; 12], values) }
            }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
fn radar_range(config: u32, range: Option<f64>, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<radar::RadarRangeParams>(config)?;
        distinct(&[cm, region::<f64>(output, 1)?])?;
        Ok(status(
            (if let Some(r) = range {
                radar::radar_received_power(&p, r)
            } else {
                radar::radar_max_range(&p)
            })
            .map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn radar_max_range(config: u32, output: u32) -> u32 {
    radar_range(config, None, output)
}
#[no_mangle]
pub extern "C" fn radar_received_power(config: u32, range: f64, output: u32) -> u32 {
    radar_range(config, Some(range), output)
}
#[no_mangle]
pub extern "C" fn radar_wavelength(frequency: f64, output: u32) -> u32 {
    optics_number(output, || radar::radar_wavelength(frequency))
}
#[no_mangle]
pub extern "C" fn radar_power_ratio(output: u32) -> u32 {
    optics_number(output, || Ok(radar::radar_power_ratio_double_range()))
}

#[no_mangle]
pub extern "C" fn laser_step(config: u32, state: u32) -> u32 {
    ode_update(
        config,
        state,
        |mut s: laser::LaserState, p: &laser::LaserConfig| {
            laser::laser_step(&p.params, &mut s, p.pump, p.dt)?;
            Ok(s)
        },
    )
}
#[no_mangle]
pub extern "C" fn laser_advance(config: u32, state: u32, count: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<laser::LaserConfig>(config)?;
        distinct(&[cm, region::<laser::LaserState>(state, 1)?])?;
        Ok(status(unsafe {
            laser::laser_advance(&p, &mut *(state as *mut laser::LaserState), count)
        }))
    };
    run().unwrap_or_else(|e| e)
}
fn laser_scalar(config: u32, pump: Option<f64>, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<laser::LaserParams>(config)?;
        distinct(&[cm, region::<f64>(output, 1)?])?;
        Ok(status(
            (if let Some(v) = pump {
                laser::steady_photons(&p, v)
            } else {
                laser::threshold_pump(&p)
            })
            .map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn laser_threshold(params: u32, output: u32) -> u32 {
    laser_scalar(params, None, output)
}
#[no_mangle]
pub extern "C" fn laser_steady(params: u32, pump: f64, output: u32) -> u32 {
    laser_scalar(params, Some(pump), output)
}
#[no_mangle]
pub extern "C" fn laser_characteristics(params: u32, pump: f64, curve: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<laser::LaserParams>(params)?;
        distinct(&[
            cm,
            region::<laser::LaserPoint>(curve, 51)?,
            region::<laser::LaserReadout>(output, 1)?,
        ])?;
        Ok(status(
            unsafe {
                laser::laser_characteristics(
                    &p,
                    pump,
                    slice::from_raw_parts_mut(curve as *mut laser::LaserPoint, 51),
                )
            }
            .map(|r| unsafe { ptr::write(output as *mut laser::LaserReadout, r) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}

#[no_mangle]
pub extern "C" fn nljd_response(v: f64, a2: f64, a3: f64, output: u32) -> u32 {
    optics_number(output, || nljd::diode_response(v, a2, a3))
}
#[no_mangle]
pub extern "C" fn nljd_coefficients(kind: u32, output: u32) -> u32 {
    if let Err(e) = region::<nljd::Coefficients>(output, 1) {
        return e;
    }
    status(
        nljd::junction_coefficients(kind)
            .map(|v| unsafe { ptr::write(output as *mut nljd::Coefficients, v) }),
    )
}
#[no_mangle]
pub extern "C" fn nljd_harmonic_amplitudes(a2: f64, a3: f64, output: u32) -> u32 {
    if let Err(e) = region::<nljd::Harmonics>(output, 1) {
        return e;
    }
    status(
        nljd::harmonic_amplitudes(a2, a3)
            .map(|v| unsafe { ptr::write(output as *mut nljd::Harmonics, v) }),
    )
}
#[no_mangle]
pub extern "C" fn nljd_harmonics(kind: u32, output: u32) -> u32 {
    if let Err(e) = region::<nljd::Harmonics>(output, 1) {
        return e;
    }
    status(nljd::harmonics(kind).map(|v| unsafe { ptr::write(output as *mut nljd::Harmonics, v) }))
}
#[no_mangle]
pub extern "C" fn nljd_classify(harmonics: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (h, hm) = ode_config::<nljd::Harmonics>(harmonics)?;
        distinct(&[hm, region::<u32>(output, 1)?])?;
        Ok(status(
            nljd::classify(&h).map(|v| unsafe { ptr::write(output as *mut u32, v) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn nljd_result(kind: u32, transfer: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        distinct(&[region::<f64>(transfer, 81)?, region::<f64>(output, 9)?])?;
        Ok(status(
            unsafe { nljd::nljd_result(kind, slice::from_raw_parts_mut(transfer as *mut f64, 81)) }
                .map(|r| unsafe {
                    ptr::write(
                        output as *mut [f64; 9],
                        [
                            r.coefficients.a2,
                            r.coefficients.a3,
                            r.harmonics.f1,
                            r.harmonics.f2,
                            r.harmonics.f3,
                            r.relative.f1,
                            r.relative.f2,
                            r.relative.f3,
                            r.verdict as f64,
                        ],
                    )
                }),
        ))
    };
    run().unwrap_or_else(|e| e)
}

fn antenna_config(address: u32) -> Result<(ant::AntennaLinkConfig, Region), u32> {
    let (p, m) = ode_config::<ant::AntennaLinkConfig>(address)?;
    if p.reserved != 0 {
        return Err(UNSUPPORTED_ABI);
    }
    Ok((p, m))
}
fn array_config(address: u32) -> Result<(ant::ArrayConfig, Region), u32> {
    let (p, m) = ode_config::<ant::ArrayConfig>(address)?;
    if p.reserved != 0 {
        return Err(UNSUPPORTED_ABI);
    }
    Ok((p, m))
}
#[no_mangle]
pub extern "C" fn antenna_pattern(kind: u32, theta: f64, output: u32) -> u32 {
    optics_number(output, || ant::pattern_2d(kind, theta))
}
#[no_mangle]
pub extern "C" fn antenna_directivity(kind: u32, output: u32) -> u32 {
    optics_number(output, || ant::directivity_db(kind))
}
#[no_mangle]
pub extern "C" fn antenna_beamwidth(kind: u32, output: u32) -> u32 {
    optics_number(output, || ant::antenna_beamwidth(kind))
}
#[no_mangle]
pub extern "C" fn antenna_dipole_power(theta: f64, output: u32) -> u32 {
    optics_number(output, || ant::dipole_power(theta))
}
#[no_mangle]
pub extern "C" fn antenna_polarization(theta: f64, output: u32) -> u32 {
    optics_number(output, || ant::polarization_loss(theta))
}
#[no_mangle]
pub extern "C" fn antenna_math(operation: u32, input: f64, output: u32) -> u32 {
    optics_number(output, || ant::math_value(operation, input))
}
#[no_mangle]
pub extern "C" fn antenna_friis(config: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = antenna_config(config)?;
        distinct(&[cm, region::<ant::LinkReadout>(output, 1)?])?;
        Ok(status(ant::friis_link(&p).map(|r| unsafe {
            ptr::write(output as *mut ant::LinkReadout, r)
        })))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn antenna_link(config: u32, pattern: u32, powers: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = antenna_config(config)?;
        distinct(&[
            cm,
            region::<f64>(pattern, ant::LINK_PATTERN_SAMPLES)?,
            region::<f64>(powers, ant::LINK_POWER_SAMPLES)?,
            region::<ant::AntennaLinkReadout>(output, 1)?,
        ])?;
        Ok(status(
            unsafe {
                ant::antenna_link(
                    &p,
                    slice::from_raw_parts_mut(pattern as *mut f64, ant::LINK_PATTERN_SAMPLES),
                    slice::from_raw_parts_mut(powers as *mut f64, ant::LINK_POWER_SAMPLES),
                )
            }
            .map(|r| unsafe { ptr::write(output as *mut ant::AntennaLinkReadout, r) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn antenna_3d(config: u32, pattern: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = ode_config::<ant::Antenna3dConfig>(config)?;
        distinct(&[
            cm,
            region::<f64>(pattern, ant::POLAR_SAMPLES)?,
            region::<f64>(output, 4)?,
        ])?;
        Ok(status(
            unsafe {
                ant::antenna_3d(
                    &p,
                    slice::from_raw_parts_mut(pattern as *mut f64, ant::POLAR_SAMPLES),
                )
            }
            .map(|r| unsafe {
                ptr::write(
                    output as *mut [f64; 4],
                    [
                        r.pr_dbm.unwrap_or(0.),
                        r.fspl_db,
                        r.plf,
                        if r.pr_dbm.is_some() { 1. } else { 0. },
                    ],
                )
            }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn array_factor(config: u32, theta: f64, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = array_config(config)?;
        distinct(&[cm, region::<f64>(output, 1)?])?;
        Ok(status(
            ant::array_factor(&p, theta).map(|v| unsafe { ptr::write(output as *mut f64, v) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn array_pattern(config: u32, count: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = array_config(config)?;
        if count < 2 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[cm, region::<ant::ArraySample>(output, count as usize)?])?;
        Ok(status(unsafe {
            ant::array_pattern(
                &p,
                slice::from_raw_parts_mut(output as *mut ant::ArraySample, count as usize),
            )
        }))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn array_beamwidth(config: u32, scan: u32, count: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = array_config(config)?;
        if count < 2 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[
            cm,
            region::<ant::ArraySample>(scan, count as usize)?,
            region::<f64>(output, 2)?,
        ])?;
        Ok(status(
            unsafe {
                ant::array_beamwidth(
                    &p,
                    slice::from_raw_parts_mut(scan as *mut ant::ArraySample, count as usize),
                )
            }
            .map(|r| unsafe {
                ptr::write(
                    output as *mut [f64; 2],
                    [r.width_deg, if r.clipped { 1. } else { 0. }],
                )
            }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn array_grating(d: f64, steer: f64, output: u32, count: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        distinct(&[
            region::<f64>(output, ant::MAX_GRATING_LOBES)?,
            region::<u32>(count, 1)?,
        ])?;
        Ok(status(
            unsafe {
                ant::grating_lobes(
                    d,
                    steer,
                    slice::from_raw_parts_mut(output as *mut f64, ant::MAX_GRATING_LOBES),
                )
            }
            .map(|n| unsafe { ptr::write(count as *mut u32, n as u32) }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn array_result(
    config: u32,
    pattern: u32,
    scan: u32,
    phases: u32,
    grating: u32,
    output: u32,
) -> u32 {
    let run = || -> Result<u32, u32> {
        let (p, cm) = array_config(config)?;
        if !(2..=48).contains(&p.n) {
            return Ok(3);
        }
        distinct(&[
            cm,
            region::<ant::ArraySample>(pattern, ant::ARRAY_PATTERN_SAMPLES)?,
            region::<ant::ArraySample>(scan, ant::ARRAY_SCAN_SAMPLES)?,
            region::<f64>(phases, p.n as usize)?,
            region::<f64>(grating, ant::MAX_GRATING_LOBES)?,
            region::<f64>(output, 3)?,
        ])?;
        Ok(status(
            unsafe {
                ant::array_result(
                    &p,
                    slice::from_raw_parts_mut(
                        pattern as *mut ant::ArraySample,
                        ant::ARRAY_PATTERN_SAMPLES,
                    ),
                    slice::from_raw_parts_mut(
                        scan as *mut ant::ArraySample,
                        ant::ARRAY_SCAN_SAMPLES,
                    ),
                    slice::from_raw_parts_mut(phases as *mut f64, p.n as usize),
                    slice::from_raw_parts_mut(grating as *mut f64, ant::MAX_GRATING_LOBES),
                )
            }
            .map(|r| unsafe {
                ptr::write(
                    output as *mut [f64; 3],
                    [
                        r.beamwidth_deg,
                        if r.beamwidth_clipped { 1. } else { 0. },
                        r.grating_count as f64,
                    ],
                )
            }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn optics_unit(rot: f64, output: u32) -> u32 {
    optics_direction(output, || w_sim_kernels::optics::unit_from_rot(rot))
}
#[no_mangle]
pub extern "C" fn optics_normalize(dx: f64, dy: f64, output: u32) -> u32 {
    optics_direction(output, || w_sim_kernels::optics::normalize(dx, dy))
}
#[no_mangle]
pub extern "C" fn optics_reflect(dx: f64, dy: f64, nx: f64, ny: f64, output: u32) -> u32 {
    optics_direction(output, || w_sim_kernels::optics::reflect(dx, dy, nx, ny))
}
#[no_mangle]
pub extern "C" fn optics_refract(
    dx: f64,
    dy: f64,
    nx: f64,
    ny: f64,
    n1: f64,
    n2: f64,
    output: u32,
) -> u32 {
    let run = || -> Result<u32, u32> {
        region::<f64>(output, 3)?;
        Ok(status(
            w_sim_kernels::optics::refract(dx, dy, nx, ny, n1, n2).map(|d| unsafe {
                ptr::write(
                    output as *mut [f64; 3],
                    if let Some(d) = d {
                        [d.dx, d.dy, 1.]
                    } else {
                        [0., 0., 0.]
                    },
                )
            }),
        ))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn optics_incidence(dx: f64, dy: f64, nx: f64, ny: f64, output: u32) -> u32 {
    optics_number(output, || {
        w_sim_kernels::optics::incidence_angle_deg(dx, dy, nx, ny)
    })
}
#[no_mangle]
pub extern "C" fn optics_malus(pol: f64, polarized: u32, axis: f64, output: u32) -> u32 {
    if polarized > 1 || polarized == 0 && pol.to_bits() != 0 {
        return UNSUPPORTED_ABI;
    }
    optics_number(output, || {
        w_sim_kernels::optics::malus_factor(if polarized == 1 { Some(pol) } else { None }, axis)
    })
}
#[no_mangle]
pub extern "C" fn optics_segment(component: u32, output: u32) -> u32 {
    let run = || -> Result<u32, u32> {
        use w_sim_kernels::optics::*;
        let (c, cm) = ode_config::<OpticsComponent>(component)?;
        distinct(&[cm, region::<SegmentGeom>(output, 1)?])?;
        Ok(status(component_segment(&c).map(|g| unsafe {
            ptr::write(output as *mut SegmentGeom, g)
        })))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn optics_intersection(
    ox: f64,
    oy: f64,
    dx: f64,
    dy: f64,
    geometry: u32,
    eps: f64,
    output: u32,
) -> u32 {
    let run = || -> Result<u32, u32> {
        use w_sim_kernels::optics::*;
        let (g, gm) = ode_config::<SegmentGeom>(geometry)?;
        distinct(&[gm, region::<f64>(output, 5)?])?;
        Ok(status(ray_segment_hit(ox, oy, dx, dy, &g, eps).map(
            |h| unsafe {
                ptr::write(
                    output as *mut [f64; 5],
                    if let Some(h) = h {
                        [h.t, h.s, h.x, h.y, 1.]
                    } else {
                        [0.; 5]
                    },
                )
            },
        )))
    };
    run().unwrap_or_else(|e| e)
}
#[no_mangle]
pub extern "C" fn optics_seed(
    components: u32,
    count: u32,
    output: u32,
    capacity: u32,
    out_count: u32,
) -> u32 {
    let run = || -> Result<u32, u32> {
        use w_sim_kernels::optics::*;
        if count > MAX_COMPONENTS as u32 || capacity > STACK_CAPACITY as u32 {
            return Err(INVALID_DIMENSIONS);
        }
        distinct(&[
            if count == 0 {
                Region::EMPTY
            } else {
                region::<OpticsComponent>(components, count as usize)?
            },
            if capacity == 0 {
                Region::EMPTY
            } else {
                region::<OpticsRay>(output, capacity as usize)?
            },
            region::<u32>(out_count, 1)?,
        ])?;
        let result = unsafe {
            seed_rays(
                if count == 0 {
                    &[]
                } else {
                    slice::from_raw_parts(components as *const OpticsComponent, count as usize)
                },
                if capacity == 0 {
                    &mut []
                } else {
                    slice::from_raw_parts_mut(output as *mut OpticsRay, capacity as usize)
                },
            )
        };
        Ok(status(result.map(|n| unsafe {
            ptr::write(out_count as *mut u32, n as u32)
        })))
    };
    run().unwrap_or_else(|e| e)
}
