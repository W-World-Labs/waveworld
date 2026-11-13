//! Analytic far-field antenna/link and uniform linear-array helpers, FP64.
//! No geometry/PDE solve or measured antenna calibration is implied.
use crate::{exp_negative, hypot, md::round_js, optics::atan_unit, sin_cos, sqrt, KernelError};
use core::f64::consts::{FRAC_PI_2, LOG10_2, LOG10_E, PI, SQRT_2};

pub const LINK_PATTERN_SAMPLES: usize = 361;
pub const LINK_POWER_SAMPLES: usize = 121;
pub const POLAR_SAMPLES: usize = 49;
pub const ARRAY_PATTERN_SAMPLES: usize = 361;
pub const ARRAY_SCAN_SAMPLES: usize = 2001;
pub const MAX_GRATING_LOBES: usize = 20;
const DEG: f64 = PI / 180.;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct AntennaLinkConfig {
    pub pt_dbm: f64,
    pub gt_dbi: f64,
    pub gr_dbi: f64,
    pub frequency_hz: f64,
    pub distance_m: f64,
    /// 0 isotropic, 1 half-wave dipole, 2 directional cos^20 field.
    pub kind: u32,
    pub reserved: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct LinkReadout {
    pub pr_dbm: f64,
    pub fspl_db: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct AntennaLinkReadout {
    pub directivity_db: f64,
    pub beamwidth_deg: f64,
    pub pr_dbm: f64,
    pub fspl_db: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Antenna3dConfig {
    pub frequency_hz: f64,
    pub pt_dbm: f64,
    pub distance_m: f64,
    pub elevation_deg: f64,
    pub polarization_deg: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Antenna3dReadout {
    pub pr_dbm: Option<f64>,
    pub fspl_db: f64,
    pub plf: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ArrayConfig {
    pub d_over_lambda: f64,
    pub steer_deg: f64,
    pub n: u32,
    pub reserved: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct ArraySample {
    pub theta: f64,
    pub gain: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct ArrayBeamwidth {
    pub width_deg: f64,
    pub clipped: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct ArrayReadout {
    pub beamwidth_deg: f64,
    pub beamwidth_clipped: bool,
    pub grating_count: usize,
}

fn finite(values: &[f64]) -> Result<(), KernelError> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
fn value(v: f64) -> Result<f64, KernelError> {
    finite(&[v])?;
    Ok(v)
}
fn kind(k: u32) -> Result<(), KernelError> {
    if k <= 2 {
        Ok(())
    } else {
        Err(KernelError::InvalidCoefficient)
    }
}

// Exact binary exponent reduction and log(m)=2*atanh((m-1)/(m+1)).
// Same identity/range as Sun fdlibm e_log.c, using a direct 24-term series
// rather than fdlibm's rational/polynomial coefficients. No libm dependency.
fn log10_positive(x: f64) -> Result<f64, KernelError> {
    finite(&[x])?;
    if x <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let (x, adjustment) = if x < f64::MIN_POSITIVE {
        (x * 18_014_398_509_481_984., -54)
    } else {
        (x, 0)
    };
    let bits = x.to_bits();
    let mut exponent = ((bits >> 52) as i32) - 1023 + adjustment;
    let mut m = f64::from_bits((bits & ((1_u64 << 52) - 1)) | (1023_u64 << 52));
    if m > SQRT_2 {
        m *= 0.5;
        exponent += 1;
    }
    let y = (m - 1.) / (m + 1.);
    let y2 = y * y;
    let mut term = y;
    let mut sum = y;
    for k in 1..24 {
        term *= y2;
        sum += term / (2 * k + 1) as f64;
    }
    value(exponent as f64 * LOG10_2 + (2. * sum) * LOG10_E)
}
fn power_ten_curve(x: f64) -> Result<f64, KernelError> {
    if !(0. ..=5.).contains(&x) {
        return Err(KernelError::InvalidCoefficient);
    }
    value(1. / exp_negative(x * core::f64::consts::LN_10)?)
}
fn asin_unit(x: f64) -> Result<f64, KernelError> {
    finite(&[x])?;
    if x.abs() > 1. {
        return Err(KernelError::InvalidCoefficient);
    }
    let a = x.abs();
    let b = sqrt((1. - a) * (1. + a))?;
    let r = if a <= b {
        atan_unit(a / b)
    } else {
        FRAC_PI_2 - atan_unit(b / a)
    };
    Ok(if x.is_sign_negative() { -r } else { r })
}
/// Direct audits of the exact math used below: 0 log10(x>0), 1 10^x on [0,5],
/// 2 asin(x) on [-1,1]. This is not a general-purpose arbitrary-power API.
pub fn math_value(operation: u32, x: f64) -> Result<f64, KernelError> {
    finite(&[x])?;
    match operation {
        0 => log10_positive(x),
        1 => power_ten_curve(x),
        2 => asin_unit(x),
        _ => Err(KernelError::InvalidCoefficient),
    }
}

pub fn pattern_2d(antenna_kind: u32, theta: f64) -> Result<f64, KernelError> {
    kind(antenna_kind)?;
    finite(&[theta])?;
    Ok(match antenna_kind {
        0 => 1.,
        1 => {
            let (s, c) = sin_cos(theta)?;
            if s.abs() < 1e-9 {
                0.
            } else {
                (sin_cos((PI / 2.) * c)?.1 / s).abs().min(1.)
            }
        }
        _ => {
            let c = sin_cos(theta)?.1;
            if c <= 0. {
                0.
            } else {
                let c2 = c * c;
                let c4 = c2 * c2;
                let c8 = c4 * c4;
                (c8 * c8) * c4
            }
        }
    })
}
pub fn dipole_power(theta: f64) -> Result<f64, KernelError> {
    let f = pattern_2d(1, theta)?;
    Ok(f * f)
}
pub fn polarization_loss(theta: f64) -> Result<f64, KernelError> {
    let c = sin_cos(theta)?.1;
    Ok(c * c)
}
pub fn directivity_db(antenna_kind: u32) -> Result<f64, KernelError> {
    kind(antenna_kind)?;
    Ok(match antenna_kind {
        0 => 0.,
        1 => 2.15,
        _ => 10. * log10_positive(2. * (2. * 20. + 1.))?,
    })
}
pub fn antenna_beamwidth(antenna_kind: u32) -> Result<f64, KernelError> {
    kind(antenna_kind)?;
    if antenna_kind == 0 {
        return Ok(360.);
    }
    let peak_theta = if antenna_kind == 1 { PI / 2. } else { 0. };
    let half = pattern_2d(antenna_kind, peak_theta)? / SQRT_2;
    let mut theta = peak_theta;
    let mut edge = peak_theta;
    while theta <= peak_theta + PI {
        if pattern_2d(antenna_kind, theta)? < half {
            edge = theta;
            break;
        }
        theta += 0.0005;
    }
    Ok((2. * (edge - peak_theta) * 180.) / PI)
}
pub fn friis_link(p: &AntennaLinkConfig) -> Result<LinkReadout, KernelError> {
    kind(p.kind)?;
    finite(&[p.pt_dbm, p.gt_dbi, p.gr_dbi, p.frequency_hz, p.distance_m])?;
    if p.reserved != 0 || p.frequency_hz <= 0. || p.distance_m <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let argument = (4. * PI * p.distance_m * p.frequency_hz) / crate::plane::C0;
    let fspl_db = 20. * log10_positive(argument)?;
    let pr_dbm = value(p.pt_dbm + p.gt_dbi + p.gr_dbi - fspl_db)?;
    Ok(LinkReadout { pr_dbm, fspl_db })
}
pub fn antenna_link(
    p: &AntennaLinkConfig,
    pattern: &mut [f64],
    powers: &mut [f64],
) -> Result<AntennaLinkReadout, KernelError> {
    if pattern.len() != LINK_PATTERN_SAMPLES || powers.len() != LINK_POWER_SAMPLES {
        return Err(KernelError::BufferLength);
    }
    let link = friis_link(p)?;
    for (i, v) in pattern.iter_mut().enumerate() {
        let phi = 2. * PI * i as f64 / 360.;
        *v = pattern_2d(p.kind, (((phi + PI) % (2. * PI)) - PI).abs())?;
    }
    for (i, v) in powers.iter_mut().enumerate() {
        let distance_m = power_ten_curve(5. * i as f64 / 120.)?;
        *v = friis_link(&AntennaLinkConfig { distance_m, ..*p })?.pr_dbm;
    }
    Ok(AntennaLinkReadout {
        directivity_db: directivity_db(p.kind)?,
        beamwidth_deg: antenna_beamwidth(p.kind)?,
        pr_dbm: link.pr_dbm,
        fspl_db: link.fspl_db,
    })
}
pub fn antenna_3d(
    p: &Antenna3dConfig,
    pattern: &mut [f64],
) -> Result<Antenna3dReadout, KernelError> {
    if pattern.len() != POLAR_SAMPLES {
        return Err(KernelError::BufferLength);
    }
    finite(&[p.elevation_deg, p.polarization_deg])?;
    let field = pattern_2d(1, p.elevation_deg * PI / 180.)?;
    let plf = if p.polarization_deg == 90. {
        0.
    } else {
        polarization_loss(p.polarization_deg * PI / 180.)?
    };
    let config = AntennaLinkConfig {
        frequency_hz: p.frequency_hz,
        distance_m: p.distance_m,
        pt_dbm: 0.,
        gt_dbi: 0.,
        gr_dbi: 0.,
        kind: 1,
        reserved: 0,
    };
    let fspl_db = friis_link(&config)?.fspl_db;
    finite(&[p.pt_dbm])?;
    let pr_dbm = if field == 0. || plf == 0. {
        None
    } else {
        let r = friis_link(&AntennaLinkConfig {
            pt_dbm: p.pt_dbm,
            gt_dbi: 2.15 + 20. * log10_positive(field)?,
            gr_dbi: 2.15,
            ..config
        })?;
        Some(value(r.pr_dbm + 10. * log10_positive(plf)?)?)
    };
    for (i, v) in pattern.iter_mut().enumerate() {
        *v = pattern_2d(1, i as f64 * PI / 48.)?;
    }
    Ok(Antenna3dReadout {
        pr_dbm,
        fspl_db,
        plf,
    })
}

fn array_config(p: &ArrayConfig) -> Result<(), KernelError> {
    finite(&[p.d_over_lambda, p.steer_deg])?;
    if p.reserved != 0 || p.n > 4096 {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
fn factor(p: &ArrayConfig, theta: f64) -> Result<f64, KernelError> {
    if p.n == 0 {
        return Ok(0.);
    }
    let psi = value(
        2. * PI * p.d_over_lambda * (sin_cos(theta * DEG)?.0 - sin_cos(p.steer_deg * DEG)?.0),
    )?;
    let mut re = 0.;
    let mut im = 0.;
    for n in 0..p.n {
        let (s, c) = sin_cos(n as f64 * psi)?;
        re += c;
        im += s;
    }
    value(hypot(re, im)? / p.n as f64)
}
pub fn array_factor(p: &ArrayConfig, theta: f64) -> Result<f64, KernelError> {
    array_config(p)?;
    finite(&[theta])?;
    factor(p, theta)
}
pub fn array_pattern(p: &ArrayConfig, output: &mut [ArraySample]) -> Result<(), KernelError> {
    array_config(p)?;
    if output.len() < 2 {
        return Err(KernelError::InvalidDimensions);
    }
    let last = output.len() - 1;
    for (i, v) in output.iter_mut().enumerate() {
        let theta = -90. + (180. * i as f64) / last as f64;
        *v = ArraySample {
            theta,
            gain: factor(p, theta)?,
        };
    }
    Ok(())
}
pub fn array_beamwidth(
    p: &ArrayConfig,
    scan: &mut [ArraySample],
) -> Result<ArrayBeamwidth, KernelError> {
    array_pattern(p, scan)?;
    let index = value((p.steer_deg + 90.) / 180. * (scan.len() - 1) as f64)?;
    let pk = round_js(index).clamp(0., (scan.len() - 1) as f64) as usize;
    let half = 1. / SQRT_2;
    let (mut lo, mut hi) = (-90., 90.);
    let (mut lower, mut upper) = (false, false);
    for i in (0..=pk).rev() {
        if scan[i].gain < half {
            lo = scan[i].theta;
            lower = true;
            break;
        }
    }
    for v in &scan[pk..] {
        if v.gain < half {
            hi = v.theta;
            upper = true;
            break;
        }
    }
    Ok(ArrayBeamwidth {
        width_deg: hi - lo,
        clipped: !lower || !upper,
    })
}
pub fn grating_lobes(d: f64, steer: f64, output: &mut [f64]) -> Result<usize, KernelError> {
    if output.len() != MAX_GRATING_LOBES {
        return Err(KernelError::BufferLength);
    }
    finite(&[d, steer])?;
    let s0 = sin_cos(steer * DEG)?.0;
    output.fill(0.);
    if d == 0. {
        return Ok(0);
    }
    let mut count = 0;
    for m in -10..=10 {
        if m == 0 {
            continue;
        }
        let s = s0 + m as f64 / d;
        // Infinite m/d for subnormal d is outside the visible interval, as in JS.
        if (-1. ..=1.).contains(&s) {
            output[count] = (asin_unit(s)? * 180.) / PI;
            count += 1;
        }
    }
    // Preserve the original ascending order, including helpers with signed d.
    for i in 1..count {
        let mut j = i;
        while j > 0 && output[j] < output[j - 1] {
            output.swap(j, j - 1);
            j -= 1;
        }
    }
    Ok(count)
}
pub fn array_result(
    p: &ArrayConfig,
    pattern: &mut [ArraySample],
    scan: &mut [ArraySample],
    phases: &mut [f64],
    grating: &mut [f64],
) -> Result<ArrayReadout, KernelError> {
    array_config(p)?;
    if !(2..=48).contains(&p.n) {
        return Err(KernelError::InvalidCoefficient);
    }
    if pattern.len() != ARRAY_PATTERN_SAMPLES
        || scan.len() != ARRAY_SCAN_SAMPLES
        || phases.len() != p.n as usize
        || grating.len() != MAX_GRATING_LOBES
    {
        return Err(KernelError::BufferLength);
    }
    let width = array_beamwidth(p, scan)?;
    array_pattern(p, pattern)?;
    let s0 = sin_cos(p.steer_deg * DEG)?.0;
    for (i, v) in phases.iter_mut().enumerate() {
        *v = if i == 0 || p.steer_deg == 0. {
            0.
        } else {
            value(-2. * PI * p.d_over_lambda * i as f64 * s0)?
        };
    }
    let grating_count = grating_lobes(p.d_over_lambda, p.steer_deg, grating)?;
    Ok(ArrayReadout {
        beamwidth_deg: width.width_deg,
        beamwidth_clipped: width.clipped,
        grating_count,
    })
}
