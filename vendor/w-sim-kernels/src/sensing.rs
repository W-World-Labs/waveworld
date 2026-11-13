//! Calibrated sensing with optional serial RC readout and pivoted-QR decoding.
//! The input is constant during a scan; no mechanical or EIT model is implied.
use crate::{
    hypot,
    ising::next_random,
    sqrt,
    transient::{first_order_weights, time_constant_rc, FirstOrderWeights},
    KernelError,
};

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SensingConfig {
    pub n: u32,
    pub sensors: u32,
    pub measurements: u32,
    pub encoding: u32,
    pub seed: u32,
    pub reserved: u32,
    pub noise_peak_v: f64,
    pub lambda: f64,
}

impl SensingConfig {
    /// (spatial inputs, sensors, measurements), before reserving any buffers.
    pub fn dimensions(&self) -> Result<(usize, usize, usize), KernelError> {
        if !(1..=64).contains(&self.n)
            || !(1..=64).contains(&self.sensors)
            || !(1..=128).contains(&self.measurements)
        {
            return Err(KernelError::InvalidDimensions);
        }
        if self.reserved != 0
            || self.encoding > 2
            || (self.encoding != 2 && self.measurements != self.sensors)
            || (self.encoding == 1 && !self.sensors.is_power_of_two())
            || !self.noise_peak_v.is_finite()
            || !(0.0..=1e6).contains(&self.noise_peak_v)
            || !self.lambda.is_finite()
            || !(0.0..=1e6).contains(&self.lambda)
        {
            return Err(KernelError::InvalidCoefficient);
        }
        Ok((
            self.n as usize,
            self.sensors as usize,
            self.measurements as usize,
        ))
    }
}

pub struct SensingBuffers<'a> {
    pub encoding: &'a mut [f64],
    pub sensor_voltages: &'a mut [f64],
    pub measurements: &'a mut [f64],
    pub reconstructed: &'a mut [f64],
    pub error: &'a mut [f64],
    pub qr: &'a mut [f64],
    pub rhs: &'a mut [f64],
    pub permutation: &'a mut [u32],
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SensingReadout {
    pub rmse: f64,
    pub residual_rms: f64,
    pub rank_tolerance: f64,
    pub rank: u32,
    /// 0 solved, 1 no unique reconstruction, 2 regularized.
    /// Status 1 makes reconstructed/error and both RMS slots undefined (zeroed).
    pub status: u32,
    pub rng_state: u32,
    pub reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct RcSamplingConfig {
    pub resistance: f64,
    pub capacitance: f64,
    pub dwell: f64,
    pub initial_voltage: f64,
}
impl RcSamplingConfig {
    fn checked(&self) -> Result<(FirstOrderWeights, f64), KernelError> {
        if !self.resistance.is_finite()
            || !(1e-3..=1e12).contains(&self.resistance)
            || !self.capacitance.is_finite()
            || !(1e-15..=1.).contains(&self.capacitance)
            || !self.dwell.is_finite()
            || !(1e-12..=1e3).contains(&self.dwell)
            || !self.initial_voltage.is_finite()
            || self.initial_voltage.abs() > 1e6
        {
            return Err(KernelError::InvalidCoefficient);
        }
        let tau = time_constant_rc(self.resistance, self.capacitance)?;
        Ok((first_order_weights(self.dwell, tau)?, tau))
    }
}
pub struct SensingSampling<'a> {
    pub rc: Option<&'a RcSamplingConfig>,
    pub ideal_voltages: &'a mut [f64],
    pub sampled_voltages: &'a mut [f64],
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SampledSensingReadout {
    pub sensing: SensingReadout,
    pub settling_fraction: f64,
    pub decay: f64,
    pub tau: f64,
}

fn finite(v: f64) -> Result<f64, KernelError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(KernelError::NonFiniteValue)
    }
}

fn bounded(values: &[f64]) -> Result<(), KernelError> {
    for &v in values {
        finite(v)?;
        if v.abs() > 1e6 {
            return Err(KernelError::InvalidCoefficient);
        }
    }
    Ok(())
}

fn column_norm(
    a: &[f64],
    rows: usize,
    n: usize,
    start: usize,
    col: usize,
) -> Result<f64, KernelError> {
    let mut norm = 0.;
    for row in start..rows {
        norm = hypot(norm, a[row * n + col])?;
    }
    Ok(norm)
}

/// Householder QR with fresh trailing column norms and deterministic first-tie
/// pivot selection. Q^T is applied directly to rhs; no normal equations or Q
/// matrix are formed. The overwritten strict lower triangle is set to zero.
fn factor(
    a: &mut [f64],
    rhs: &mut [f64],
    permutation: &mut [u32],
    rows: usize,
    n: usize,
) -> Result<(u32, f64), KernelError> {
    for (j, p) in permutation.iter_mut().enumerate() {
        *p = j as u32;
    }
    let mut tolerance = 0.;
    let mut rank = 0;
    for k in 0..rows.min(n) {
        let mut pivot = k;
        let mut norm = column_norm(a, rows, n, k, k)?;
        for j in k + 1..n {
            let other = column_norm(a, rows, n, k, j)?;
            if other > norm {
                norm = other;
                pivot = j;
            }
        }
        if k == 0 {
            tolerance = (f64::EPSILON * rows.max(n) as f64) * norm;
        }
        if norm == 0. {
            break;
        }
        if pivot != k {
            for row in 0..rows {
                a.swap(row * n + k, row * n + pivot);
            }
            permutation.swap(k, pivot);
        }
        let alpha = a[k * n + k];
        let beta = if alpha.is_sign_negative() {
            norm
        } else {
            -norm
        };
        let tau = finite(1. - alpha / beta)?;
        let denominator = finite(alpha - beta)?;
        for row in k + 1..rows {
            a[row * n + k] = finite(a[row * n + k] / denominator)?;
        }
        a[k * n + k] = beta;
        for j in k + 1..n {
            let mut dot = a[k * n + j];
            for row in k + 1..rows {
                dot += a[row * n + k] * a[row * n + j];
            }
            let update = finite(tau * dot)?;
            a[k * n + j] = finite(a[k * n + j] - update)?;
            for row in k + 1..rows {
                a[row * n + j] = finite(a[row * n + j] - a[row * n + k] * update)?;
            }
        }
        let mut dot = rhs[k];
        for row in k + 1..rows {
            dot += a[row * n + k] * rhs[row];
        }
        let update = finite(tau * dot)?;
        rhs[k] = finite(rhs[k] - update)?;
        for row in k + 1..rows {
            rhs[row] = finite(rhs[row] - a[row * n + k] * update)?;
            a[row * n + k] = 0.;
        }
        if beta.abs() > tolerance {
            rank += 1;
        }
    }
    Ok((rank, tolerance))
}

fn coefficient(
    code: &[f64],
    sensing: &[f64],
    sensors: usize,
    n: usize,
    row: usize,
    col: usize,
) -> Result<f64, KernelError> {
    let mut sum = 0.;
    for k in 0..sensors {
        sum += code[row * sensors + k] * sensing[k * n + col];
    }
    finite(sum)
}

fn offset(code: &[f64], bias: &[f64], sensors: usize, row: usize) -> Result<f64, KernelError> {
    let mut sum = 0.;
    for k in 0..sensors {
        sum += code[row * sensors + k] * bias[k];
    }
    finite(sum)
}

fn system(
    b: &mut SensingBuffers<'_>,
    sensing: &[f64],
    bias: &[f64],
    n: usize,
    sensors: usize,
    m: usize,
    readout: Option<(FirstOrderWeights, f64)>,
) -> Result<(), KernelError> {
    b.qr.fill(0.);
    b.rhs.fill(0.);
    let mut baseline = readout.map_or(0., |r| r.1);
    for row in 0..m {
        for col in 0..n {
            let target = coefficient(b.encoding, sensing, sensors, n, row, col)?;
            b.qr[row * n + col] = if let Some((weights, _)) = readout {
                weights.sample(
                    if row == 0 {
                        0.
                    } else {
                        b.qr[(row - 1) * n + col]
                    },
                    target,
                )?
            } else {
                target
            };
        }
        let target = offset(b.encoding, bias, sensors, row)?;
        baseline = if let Some((weights, _)) = readout {
            weights.sample(baseline, target)?
        } else {
            target
        };
        b.rhs[row] = finite(b.measurements[row] - baseline)?;
    }
    Ok(())
}

/// v=S*x+b; y=C*v+noise; reconstruct from A=C*S, z=y-C*b.
/// All matrices are row-major. Config seed is restarted on each call, with one
/// RNG draw per measurement even at zero noise. Buffers are fully reusable.
/// Any error invalidates the outputs; a rank-deficient result is not an error
/// and retains its valid forward/encoding outputs with no reconstruction.
pub fn sense_array(
    p: &SensingConfig,
    input: &[f64],
    sensing: &[f64],
    bias: &[f64],
    custom_code: Option<&[f64]>,
    b: &mut SensingBuffers<'_>,
) -> Result<SensingReadout, KernelError> {
    sense_array_impl(p, input, sensing, bias, custom_code, b, None).map(|r| r.sensing)
}

pub fn sense_array_sampled(
    p: &SensingConfig,
    input: &[f64],
    sensing: &[f64],
    bias: &[f64],
    custom_code: Option<&[f64]>,
    b: &mut SensingBuffers<'_>,
    sampling: &mut SensingSampling<'_>,
) -> Result<SampledSensingReadout, KernelError> {
    sense_array_impl(p, input, sensing, bias, custom_code, b, Some(sampling))
}

fn sense_array_impl(
    p: &SensingConfig,
    input: &[f64],
    sensing: &[f64],
    bias: &[f64],
    custom_code: Option<&[f64]>,
    b: &mut SensingBuffers<'_>,
    mut sampling: Option<&mut SensingSampling<'_>>,
) -> Result<SampledSensingReadout, KernelError> {
    let (n, sensors, m) = p.dimensions()?;
    let rc = sampling.as_ref().and_then(|s| s.rc.copied());
    let response = rc.as_ref().map(RcSamplingConfig::checked).transpose()?;
    let filter = response.zip(rc).map(|((w, _), r)| (w, r.initial_voltage));
    let with_response = |sensing| SampledSensingReadout {
        sensing,
        settling_fraction: response.map_or(1., |r| r.0.settling_fraction),
        decay: response.map_or(0., |r| r.0.decay),
        tau: response.map_or(0., |r| r.1),
    };
    if sampling
        .as_ref()
        .is_some_and(|s| s.ideal_voltages.len() != m || s.sampled_voltages.len() != m)
    {
        return Err(KernelError::BufferLength);
    }
    if input.len() != n
        || sensing.len() != sensors * n
        || bias.len() != sensors
        || b.encoding.len() != m * sensors
        || b.sensor_voltages.len() != sensors
        || b.measurements.len() != m
        || b.reconstructed.len() != n
        || b.error.len() != n
        || b.qr.len() != (m + n) * n
        || b.rhs.len() != m + n
        || b.permutation.len() != n
    {
        return Err(KernelError::BufferLength);
    }
    match (p.encoding, custom_code) {
        (2, Some(code)) if code.len() == m * sensors => bounded(code)?,
        (2, Some(_)) => return Err(KernelError::BufferLength),
        (2, None) | (0 | 1, Some(_)) => return Err(KernelError::InvalidCoefficient),
        _ => (),
    }
    bounded(input)?;
    bounded(sensing)?;
    bounded(bias)?;
    if let Some(code) = custom_code {
        b.encoding.copy_from_slice(code);
    } else if p.encoding == 0 {
        b.encoding.fill(0.);
        for i in 0..sensors {
            b.encoding[i * sensors + i] = 1.;
        }
    } else {
        let normalization = 1. / sqrt(sensors as f64)?;
        for row in 0..m {
            for col in 0..sensors {
                b.encoding[row * sensors + col] = if (row & col).count_ones().is_multiple_of(2) {
                    normalization
                } else {
                    -normalization
                };
            }
        }
    }
    b.reconstructed.fill(0.);
    b.error.fill(0.);
    for k in 0..sensors {
        let mut signal = 0.;
        for col in 0..n {
            signal += sensing[k * n + col] * input[col];
        }
        b.sensor_voltages[k] = finite(signal + bias[k])?;
    }
    let mut rng = p.seed;
    let mut sampled = rc.as_ref().map_or(0., |r| r.initial_voltage);
    for row in 0..m {
        let mut signal = 0.;
        for k in 0..sensors {
            signal += b.encoding[row * sensors + k] * b.sensor_voltages[k];
        }
        sampled = if let Some((weights, _)) = response {
            weights.sample(sampled, signal)?
        } else {
            signal
        };
        if let Some(ref mut s) = sampling {
            s.ideal_voltages[row] = finite(signal)?;
            s.sampled_voltages[row] = finite(sampled)?;
        }
        let noise = (2. * next_random(&mut rng) - 1.) * p.noise_peak_v;
        b.measurements[row] = finite(sampled + noise)?;
    }
    system(b, sensing, bias, n, sensors, m, filter)?;
    let (rank, rank_tolerance) = factor(&mut b.qr[..m * n], &mut b.rhs[..m], b.permutation, m, n)?;
    let mut readout = SensingReadout {
        rmse: 0.,
        residual_rms: 0.,
        rank_tolerance,
        rank,
        status: if p.lambda > 0. {
            2
        } else if rank < n as u32 {
            1
        } else {
            0
        },
        rng_state: rng,
        reserved: 0,
    };
    if readout.status == 1 {
        return Ok(with_response(readout));
    }
    if p.lambda > 0. {
        system(b, sensing, bias, n, sensors, m, filter)?;
        let diagonal = sqrt(p.lambda)?;
        for i in 0..n {
            b.qr[(m + i) * n + i] = diagonal;
        }
        let (augmented_rank, _) = factor(b.qr, b.rhs, b.permutation, m + n, n)?;
        // A positive lambda is algebraically full-rank, but can be too small
        // relative to A to resolve that rank in FP64. Do not publish a finite
        // yet indeterminate back substitution as a regularized reconstruction.
        if augmented_rank < n as u32 {
            return Err(KernelError::InvalidState);
        }
    }
    for i in (0..n).rev() {
        let diagonal = b.qr[i * n + i];
        if diagonal == 0. {
            return Err(KernelError::InvalidState);
        }
        let mut value = b.rhs[i];
        for j in i + 1..n {
            value -= b.qr[i * n + j] * b.reconstructed[b.permutation[j] as usize];
        }
        b.reconstructed[b.permutation[i] as usize] = finite(value / diagonal)?;
    }
    let mut error_norm = 0.;
    for (i, &x) in input.iter().enumerate() {
        b.error[i] = finite(b.reconstructed[i] - x)?;
        error_norm = hypot(error_norm, b.error[i])?;
    }
    readout.rmse = finite(error_norm / sqrt(n as f64)?)?;
    // Reuse the existing work buffers to recover the exact filtered operator
    // after QR. Static calls retain their original work/output bit patterns.
    if filter.is_some() {
        system(b, sensing, bias, n, sensors, m, filter)?;
    }
    let mut residual_norm = 0.;
    for row in 0..m {
        let mut predicted = 0.;
        for col in 0..n {
            predicted += if filter.is_some() {
                b.qr[row * n + col]
            } else {
                coefficient(b.encoding, sensing, sensors, n, row, col)?
            } * b.reconstructed[col];
        }
        let residual = finite(
            predicted
                - if filter.is_some() {
                    b.rhs[row]
                } else {
                    b.measurements[row] - offset(b.encoding, bias, sensors, row)?
                },
        )?;
        residual_norm = hypot(residual_norm, residual)?;
    }
    readout.residual_rms = finite(residual_norm / sqrt(m as f64)?)?;
    Ok(with_response(readout))
}
