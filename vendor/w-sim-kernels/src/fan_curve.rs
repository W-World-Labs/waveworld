//! Static fan pressure rise from a user-supplied pressure/flow curve in SI units.
//!
//! RPM scaling uses `dp_s(Q) = s² dp_ref(Q / s)` at fixed fluid density and fan
//! geometry. This affinity-law approximation is not a rotor, motor, PWM, stall
//! dynamics or system operating-point solver. No manufacturer curve is built in.

use crate::KernelError;

pub const MAX_FAN_CURVE_POINTS: usize = 256;

/// A point at the curve's reference RPM and fluid density.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FanCurvePoint {
    pub flow_m3_s: f64,
    pub pressure_pa: f64,
}

/// Interpolate static pressure rise in Pa at `flow_m3_s` and an RPM ratio.
///
/// Accepts 2..=256 points with strictly increasing, non-negative flow and
/// non-negative pressure. Pressure may increase locally, including a measured
/// stall-region shoulder. Every point is validated, even for an endpoint query.
///
/// `rpm_ratio` is actual RPM / reference RPM, in `(0, 1]`; it is not PWM duty.
/// The admitted flow interval is `[s * Q_first, s * Q_last]`, including its
/// endpoints. The first point need not have zero flow, and the last need not
/// have zero pressure. No extrapolation, clamping, sorting or mutation occurs.
///
/// Errors: `BufferLength` for the point count; `NonFiniteValue` for non-finite
/// inputs or arithmetic; `InvalidCoefficient` for negative curve coordinates,
/// unordered flows or an RPM ratio outside `[0, 1]`; `UnsupportedFeature` for
/// zero RPM or reverse flow (no stopped-fan resistance or reverse-flow model);
/// `InvalidState` for flow outside the scaled interval or arithmetic underflow
/// that loses a positive value or collapses distinct flow coordinates.
pub fn pressure_rise(
    curve: &[FanCurvePoint],
    flow_m3_s: f64,
    rpm_ratio: f64,
) -> Result<f64, KernelError> {
    if !(2..=MAX_FAN_CURVE_POINTS).contains(&curve.len()) {
        return Err(KernelError::BufferLength);
    }
    if !flow_m3_s.is_finite() || !rpm_ratio.is_finite() {
        return Err(KernelError::NonFiniteValue);
    }
    if !(0.0..=1.0).contains(&rpm_ratio) {
        return Err(KernelError::InvalidCoefficient);
    }
    if rpm_ratio == 0.0 || flow_m3_s < 0.0 {
        return Err(KernelError::UnsupportedFeature);
    }
    let pressure_scale = rpm_ratio * rpm_ratio;
    if pressure_scale == 0.0 {
        return Err(KernelError::InvalidState);
    }
    for (i, point) in curve.iter().enumerate() {
        if !point.flow_m3_s.is_finite() || !point.pressure_pa.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        if point.flow_m3_s < 0.0
            || point.pressure_pa < 0.0
            || (i > 0 && point.flow_m3_s <= curve[i - 1].flow_m3_s)
        {
            return Err(KernelError::InvalidCoefficient);
        }
        let scaled_flow = rpm_ratio * point.flow_m3_s;
        let scaled_pressure = pressure_scale * point.pressure_pa;
        if (point.flow_m3_s > 0.0 && scaled_flow == 0.0)
            || (point.pressure_pa > 0.0 && scaled_pressure == 0.0)
            || (i > 0 && scaled_flow <= rpm_ratio * curve[i - 1].flow_m3_s)
        {
            return Err(KernelError::InvalidState);
        }
    }
    if flow_m3_s < rpm_ratio * curve[0].flow_m3_s
        || flow_m3_s > rpm_ratio * curve[curve.len() - 1].flow_m3_s
    {
        return Err(KernelError::InvalidState);
    }
    // Interpolate the scaled knots. This is the same affinity law, but avoids
    // Q/s rounding outside the domain when Q is an exact scaled endpoint.
    for pair in curve.windows(2) {
        let lower_flow = rpm_ratio * pair[0].flow_m3_s;
        let upper_flow = rpm_ratio * pair[1].flow_m3_s;
        if flow_m3_s > upper_flow {
            continue;
        }
        let lower_pressure = pressure_scale * pair[0].pressure_pa;
        let upper_pressure = pressure_scale * pair[1].pressure_pa;
        if flow_m3_s == lower_flow {
            return Ok(lower_pressure);
        }
        if flow_m3_s == upper_flow {
            return Ok(upper_pressure);
        }
        let width = upper_flow - lower_flow;
        // Compute both distances: 1-t can round to zero near a zero-pressure
        // endpoint even though a representable positive pressure remains.
        let lower_weight = (upper_flow - flow_m3_s) / width;
        let upper_weight = (flow_m3_s - lower_flow) / width;
        let lower_term = lower_weight * lower_pressure;
        let upper_term = upper_weight * upper_pressure;
        if lower_weight == 0.0
            || upper_weight == 0.0
            || (lower_pressure > 0.0 && lower_term == 0.0)
            || (upper_pressure > 0.0 && upper_term == 0.0)
        {
            return Err(KernelError::InvalidState);
        }
        let pressure = lower_term + upper_term;
        if !pressure.is_finite() {
            return Err(KernelError::NonFiniteValue);
        }
        return Ok(pressure);
    }
    Err(KernelError::InvalidState)
}
