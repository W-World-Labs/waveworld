//! Bounded 2D ray optics with the product's sequential event and LIFO split order.
use crate::{hypot, sin_cos, sqrt, KernelError};
pub const MAX_COMPONENTS: usize = 64;
pub const MAX_RAYS: usize = 20_000;
pub const STACK_CAPACITY: usize = MAX_RAYS + MAX_COMPONENTS * 9;
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct OpticsConfig {
    pub component_count: u32,
    pub max_bounces: u32,
    pub screen_bins: u32,
    pub reserved: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct OpticsComponent {
    pub kind: u32,
    pub reserved: u32,
    pub x: f64,
    pub y: f64,
    pub rot: f64,
    pub length: f64,
    pub power: f64,
    pub wavelength_nm: f64,
    pub focal_length: f64,
    pub n: f64,
    pub pol_angle_deg: f64,
    pub split_t: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct OpticsRay {
    pub x: f64,
    pub y: f64,
    pub dx: f64,
    pub dy: f64,
    pub intensity: f64,
    pub wavelength_nm: f64,
    pub pol_deg: f64,
    pub bounces: u32,
    pub polarized: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct SegmentGeom {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    pub nx: f64,
    pub ny: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct RaySegment {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    pub intensity: f64,
    pub wavelength_nm: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct RayHit {
    pub component_index: u32,
    pub kind: u32,
    pub x: f64,
    pub y: f64,
    pub intensity: f64,
    pub wavelength_nm: f64,
    pub s: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct OpticsEvent {
    pub event_type: u32,
    pub component_index: u32,
    pub kind: u32,
    pub fields_mask: u32,
    pub x: f64,
    pub y: f64,
    pub intensity_in: f64,
    pub intensity_out: f64,
    pub theta_i: f64,
    pub theta_t: f64,
    pub note0: f64,
    pub note1: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct ScreenProfile {
    pub component_index: u32,
    pub peak_bin: u32,
    pub screen_power: f64,
    pub total: f64,
    pub peak_s: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct OpticsState {
    pub processed: u32,
    pub stack_len: u32,
    pub segment_count: u32,
    pub hit_count: u32,
    pub event_count: u32,
    pub profile_count: u32,
    pub initialized: u32,
    pub reserved: u32,
}
pub struct OpticsBuffers<'a> {
    pub geoms: &'a mut [SegmentGeom],
    pub stack: &'a mut [OpticsRay],
    pub segments: &'a mut [RaySegment],
    pub hits: &'a mut [RayHit],
    pub events: &'a mut [OpticsEvent],
    pub profiles: &'a mut [ScreenProfile],
    pub bins: &'a mut [f64],
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Direction {
    pub dx: f64,
    pub dy: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct RayIntersection {
    pub t: f64,
    pub s: f64,
    pub x: f64,
    pub y: f64,
}
fn finite(v: &[f64]) -> Result<(), KernelError> {
    if v.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(KernelError::NonFiniteValue)
    }
}
fn value(v: f64) -> Result<f64, KernelError> {
    finite(&[v])?;
    Ok(v)
}
pub fn unit_from_rot(rot: f64) -> Result<Direction, KernelError> {
    let (s, c) = sin_cos((rot * core::f64::consts::PI) / 180.)?;
    Ok(Direction { dx: c, dy: s })
}
pub fn normalize(dx: f64, dy: f64) -> Result<Direction, KernelError> {
    let length = hypot(dx, dy)?;
    Ok(if length > 1e-12 {
        Direction {
            dx: dx / length,
            dy: dy / length,
        }
    } else {
        Direction { dx: 1., dy: 0. }
    })
}
pub fn reflect(dx: f64, dy: f64, nx: f64, ny: f64) -> Result<Direction, KernelError> {
    finite(&[dx, dy])?;
    let n = normalize(nx, ny)?;
    let dot = dx * n.dx + dy * n.dy;
    normalize(dx - 2. * dot * n.dx, dy - 2. * dot * n.dy)
}
pub fn refract(
    dx: f64,
    dy: f64,
    nx: f64,
    ny: f64,
    n1: f64,
    n2: f64,
) -> Result<Option<Direction>, KernelError> {
    finite(&[dx, dy, n1, n2])?;
    if n1 <= 0. || n2 <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let mut n = normalize(nx, ny)?;
    let mut cosi = -(dx * n.dx + dy * n.dy);
    if cosi < 0. {
        n.dx = -n.dx;
        n.dy = -n.dy;
        cosi = -cosi;
    }
    let eta = n1 / n2;
    let k = value(1. - eta * eta * (1. - cosi * cosi))?;
    if k < 0. {
        return Ok(None);
    }
    let b = eta * cosi - sqrt(k)?;
    Ok(Some(normalize(eta * dx + b * n.dx, eta * dy + b * n.dy)?))
}
fn atan_small(x: f64) -> f64 {
    let xx = x * x;
    let mut term = x;
    let mut sum = x;
    for k in 1..=30 {
        term *= -xx;
        sum += term / (2 * k + 1) as f64;
    }
    sum
}
pub(crate) fn atan_unit(x: f64) -> f64 {
    if x > core::f64::consts::SQRT_2 - 1. {
        core::f64::consts::FRAC_PI_4 + atan_small((x - 1.) / (x + 1.))
    } else {
        atan_small(x)
    }
}
fn acos_unit(c: f64) -> Result<f64, KernelError> {
    if c == 0. {
        return Ok(core::f64::consts::FRAC_PI_2);
    }
    let y = sqrt((1. - c) * (1. + c))?;
    Ok(if y > c {
        core::f64::consts::FRAC_PI_2 - atan_unit(c / y)
    } else {
        atan_unit(y / c)
    })
}
pub fn incidence_angle_deg(dx: f64, dy: f64, nx: f64, ny: f64) -> Result<f64, KernelError> {
    finite(&[dx, dy])?;
    let n = normalize(nx, ny)?;
    let c = value((-(dx * n.dx + dy * n.dy)).abs())?.clamp(0., 1.);
    Ok((acos_unit(c)? * 180.) / core::f64::consts::PI)
}
pub fn malus_factor(pol: Option<f64>, axis: f64) -> Result<f64, KernelError> {
    finite(&[axis])?;
    if let Some(pol) = pol {
        let c = sin_cos(((pol - axis) * core::f64::consts::PI) / 180.)?.1;
        Ok(c * c)
    } else {
        Ok(0.5)
    }
}
/// Protected-silver mirror coating: catalog visible-band power reflectance
/// (~0.94–0.97 over 450–700 nm); 0.94 folds in scatter loss. Metallic
/// reflectance is only weakly angle- and polarization-dependent in the
/// visible band, so a named coating constant is honest here while the
/// dielectric components use the angle-resolved Fresnel equations.
const MIRROR_R_PROTECTED_SILVER: f64 = 0.94;
/// Plate beam-splitter coating loss: the component's `split_t` ratio is
/// exact, so the legs carry t·(1−A) and (1−t)·(1−A) of the incident power;
/// R + T = 1 − A conserves energy minus the coated substrate's
/// absorption/scatter share.
const SPLITTER_COATING_ABSORPTION: f64 = 0.03;
/// Fresnel power reflectances (R_s, R_p) for a ray crossing n1 → n2.
/// `cos_i`/`cos_t` are the ray-to-normal cosines on each side (both >= 0).
/// Total internal reflection is resolved by the caller (R = 1) before any
/// transmitted direction exists, so this is only reached with real cosines.
fn fresnel_rs_rp(n1: f64, n2: f64, cos_i: f64, cos_t: f64) -> Result<(f64, f64), KernelError> {
    finite(&[n1, n2, cos_i, cos_t])?;
    if n1 <= 0. || n2 <= 0. || cos_i < 0. || cos_t < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let si = n1 * cos_i;
    let st = n2 * cos_t;
    let rs = (si - st) / (si + st);
    let pi = n1 * cos_t;
    let pt = n2 * cos_i;
    let rp = (pi - pt) / (pi + pt);
    Ok((value(rs * rs)?, value(rp * rp)?))
}
/// Reflectance for the ray's polarization state. `pol_deg` is the E-field
/// angle about the propagation axis: 0 lies in the drawing (incidence)
/// plane — pure p — and 90 is normal to it — pure s. Unpolarized teaching
/// rays carry the equal mix (R_s + R_p)/2.
fn reflectance(r: OpticsRay, n1: f64, n2: f64, cos_i: f64, cos_t: f64) -> Result<f64, KernelError> {
    let (rs, rp) = fresnel_rs_rp(n1, n2, cos_i, cos_t)?;
    Ok(if r.polarized == 1 {
        let c = sin_cos((r.pol_deg * core::f64::consts::PI) / 180.)?.1;
        value(rs * (1. - c * c) + rp * c * c)?
    } else {
        (rs + rp) / 2.
    })
}
/// Transmitted normal cosine for n1 → n2 at incident normal cosine `cos_i`
/// (Snell). None on total internal reflection.
fn snell_cos_t(n1: f64, n2: f64, cos_i: f64) -> Result<Option<f64>, KernelError> {
    finite(&[n1, n2, cos_i])?;
    let eta = n1 / n2;
    let sin_t2 = value(eta * eta * (1. - cos_i * cos_i).max(0.))?;
    if sin_t2 > 1. {
        return Ok(None);
    }
    Ok(Some(sqrt(1. - sin_t2)?))
}
/// T = 1 − R across one dielectric surface. Only the refracted leg is
/// traced; the reflected share R is reported through the event's
/// intensity_in − intensity_out gap.
fn surface_transmittance(
    r: OpticsRay,
    n1: f64,
    n2: f64,
    cos_i: f64,
    cos_t: f64,
) -> Result<f64, KernelError> {
    value(1. - reflectance(r, n1, n2, cos_i, cos_t)?)
}
/// Fresnel power transmittance of a plane-parallel plate of index `n` in
/// air: air→glass at `cos_i`, then glass→air at the same internal angle
/// because the exit face is parallel (outgoing ray parallel to incoming).
/// A parallel plate can never TIR on exit for n > 1; n < 1 returns 0.
fn plate_transmittance(r: OpticsRay, n: f64, cos_i: f64) -> Result<f64, KernelError> {
    let Some(cos_t) = snell_cos_t(1., n, cos_i)? else {
        return Ok(0.);
    };
    let t1 = surface_transmittance(r, 1., n, cos_i, cos_t)?;
    let t2 = surface_transmittance(r, n, 1., cos_t, cos_i)?;
    value(t1 * t2)
}
/// Fresnel power transmittance of a thin lens of index `n`: air→glass at
/// the incoming ray's angle to the element normal, then glass→air at the
/// internal angle that produces the outgoing slope (Snell-reversible, so
/// the internal cosine follows from the outgoing air-side cosine).
fn lens_transmittance(
    r: OpticsRay,
    n: f64,
    nx: f64,
    ny: f64,
    out: Direction,
) -> Result<f64, KernelError> {
    let cos_i1 = value((r.dx * nx + r.dy * ny).abs())?;
    let Some(cos_t1) = snell_cos_t(1., n, cos_i1)? else {
        return Ok(0.);
    };
    let t1 = surface_transmittance(r, 1., n, cos_i1, cos_t1)?;
    let cos_t2 = value((out.dx * nx + out.dy * ny).abs())?;
    let Some(cos_i2) = snell_cos_t(1., n, cos_t2)? else {
        return Ok(0.);
    };
    let t2 = surface_transmittance(r, n, 1., cos_i2, cos_t2)?;
    value(t1 * t2)
}
fn component(c: &OpticsComponent) -> Result<(), KernelError> {
    finite(&[
        c.x,
        c.y,
        c.rot,
        c.length,
        c.power,
        c.wavelength_nm,
        c.focal_length,
        c.n,
        c.pol_angle_deg,
        c.split_t,
    ])?;
    if c.kind > 7 || c.reserved != 0 {
        return Err(KernelError::UnsupportedFeature);
    }
    if c.length < 0. || c.power < 0. || c.wavelength_nm <= 0. || c.n <= 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    Ok(())
}
pub fn component_segment(c: &OpticsComponent) -> Result<SegmentGeom, KernelError> {
    component(c)?;
    let n = unit_from_rot(c.rot)?;
    let half = c.length / 2.;
    let s = SegmentGeom {
        x0: c.x - (-n.dy) * half,
        y0: c.y - n.dx * half,
        x1: c.x + (-n.dy) * half,
        y1: c.y + n.dx * half,
        nx: n.dx,
        ny: n.dy,
    };
    finite(&[s.x0, s.y0, s.x1, s.y1])?;
    Ok(s)
}
pub fn ray_segment_hit(
    ox: f64,
    oy: f64,
    dx: f64,
    dy: f64,
    seg: &SegmentGeom,
    eps: f64,
) -> Result<Option<RayIntersection>, KernelError> {
    finite(&[
        ox, oy, dx, dy, seg.x0, seg.y0, seg.x1, seg.y1, seg.nx, seg.ny, eps,
    ])?;
    if eps < 0. {
        return Err(KernelError::InvalidCoefficient);
    }
    let sx = seg.x1 - seg.x0;
    let sy = seg.y1 - seg.y0;
    let det = value(dx * sy - dy * sx)?;
    if det.abs() < 1e-12 {
        return Ok(None);
    }
    let rx = seg.x0 - ox;
    let ry = seg.y0 - oy;
    let t = value((rx * sy - ry * sx) / det)?;
    let s = value((rx * dy - ry * dx) / det)?;
    if t <= eps || !(-1e-6..=1. + 1e-6).contains(&s) {
        return Ok(None);
    }
    Ok(Some(RayIntersection {
        t,
        s: s.clamp(0., 1.),
        x: value(ox + t * dx)?,
        y: value(oy + t * dy)?,
    }))
}
pub fn seed_rays(
    components: &[OpticsComponent],
    out: &mut [OpticsRay],
) -> Result<usize, KernelError> {
    if components.len() > MAX_COMPONENTS {
        return Err(KernelError::InvalidDimensions);
    }
    for c in components {
        component(c)?;
    }
    let count = components.iter().filter(|c| c.kind == 0).count() * 9;
    if out.len() < count {
        return Err(KernelError::BufferLength);
    }
    let mut at = 0;
    for c in components {
        if c.kind != 0 {
            continue;
        }
        let base = unit_from_rot(c.rot)?;
        for i in 0..9 {
            let t = (i as f64 / 8.) * 2. - 1.;
            let direction = unit_from_rot(c.rot + t * 2.5)?;
            let off = t * 5.;
            out[at] = OpticsRay {
                x: value(c.x + base.dx * 10. + (-base.dy) * off)?,
                y: value(c.y + base.dy * 10. + base.dx * off)?,
                dx: direction.dx,
                dy: direction.dy,
                intensity: c.power / 9.,
                wavelength_nm: c.wavelength_nm,
                ..Default::default()
            };
            at += 1;
        }
    }
    Ok(count)
}
fn config(c: &OpticsConfig, b: &OpticsBuffers) -> Result<(), KernelError> {
    let n = c.component_count as usize;
    if n > MAX_COMPONENTS
        || c.max_bounces > MAX_RAYS as u32
        || c.screen_bins == 0
        || c.screen_bins > 4096
    {
        return Err(KernelError::InvalidDimensions);
    }
    if c.reserved != 0 {
        return Err(KernelError::UnsupportedFeature);
    }
    if b.geoms.len() < n
        || b.stack.len() < STACK_CAPACITY
        || b.segments.len() < MAX_RAYS
        || b.hits.len() < MAX_RAYS
        || b.events.len() < MAX_RAYS
        || b.profiles.len() < n
        || b.bins.len() < n * c.screen_bins as usize
    {
        return Err(KernelError::BufferLength);
    }
    Ok(())
}
fn state(c: &OpticsConfig, s: &OpticsState) -> Result<(), KernelError> {
    if s.initialized != 1
        || s.reserved != 0
        || s.processed > MAX_RAYS as u32
        || s.stack_len > STACK_CAPACITY as u32
        || s.segment_count > s.processed
        || s.hit_count > s.segment_count
        || s.event_count > s.segment_count
        || s.profile_count > c.component_count
        || s.profile_count > s.hit_count
    {
        return Err(KernelError::InvalidState);
    }
    Ok(())
}
pub fn init_trace(
    c: &OpticsConfig,
    components: &[OpticsComponent],
    s: &mut OpticsState,
    b: &mut OpticsBuffers,
) -> Result<(), KernelError> {
    config(c, b)?;
    if components.len() != c.component_count as usize {
        return Err(KernelError::BufferLength);
    }
    for component in components {
        self::component(component)?;
    }
    for (i, component) in components.iter().enumerate() {
        b.geoms[i] = component_segment(component)?;
    }
    let rays = seed_rays(components, b.stack)?;
    b.bins[..components.len() * c.screen_bins as usize].fill(0.);
    b.profiles[..components.len()].fill(ScreenProfile::default());
    *s = OpticsState {
        stack_len: rays as u32,
        initialized: 1,
        ..Default::default()
    };
    Ok(())
}
fn ray_valid(r: OpticsRay) -> Result<(), KernelError> {
    finite(&[
        r.x,
        r.y,
        r.dx,
        r.dy,
        r.intensity,
        r.wavelength_nm,
        r.pol_deg,
    ])?;
    if r.intensity < 0.
        || r.wavelength_nm <= 0.
        || r.polarized > 1
        || r.polarized == 0 && r.pol_deg != 0.
    {
        return Err(KernelError::InvalidState);
    }
    Ok(())
}
fn push(s: &mut OpticsState, b: &mut OpticsBuffers, r: OpticsRay) -> Result<(), KernelError> {
    ray_valid(r)?;
    if s.stack_len as usize >= b.stack.len() {
        return Err(KernelError::BufferLength);
    }
    b.stack[s.stack_len as usize] = r;
    s.stack_len += 1;
    Ok(())
}
fn outgoing(
    r: OpticsRay,
    x: f64,
    y: f64,
    d: Direction,
    distance: f64,
    intensity: f64,
) -> Result<OpticsRay, KernelError> {
    let ray = OpticsRay {
        x: x + d.dx * distance,
        y: y + d.dy * distance,
        dx: d.dx,
        dy: d.dy,
        bounces: r.bounces.checked_add(1).ok_or(KernelError::InvalidState)?,
        intensity,
        ..r
    };
    ray_valid(ray)?;
    Ok(ray)
}
fn exit_bound(r: OpticsRay) -> Result<Option<f64>, KernelError> {
    let mut best = f64::INFINITY;
    for (position, direction, size) in [(r.x, r.dx, 960.), (r.y, r.dy, 560.)] {
        if direction.abs() > 1e-12 {
            for t in [
                (-40. - position) / direction,
                (size + 40. - position) / direction,
            ] {
                finite(&[t])?;
                if t > 1e-4 {
                    best = best.min(t);
                }
            }
        }
    }
    Ok(if best.is_finite() { Some(best) } else { None })
}
fn segment(
    s: &mut OpticsState,
    b: &mut OpticsBuffers,
    r: OpticsRay,
    x: f64,
    y: f64,
) -> Result<(), KernelError> {
    finite(&[x, y])?;
    if s.segment_count as usize >= b.segments.len() {
        return Err(KernelError::BufferLength);
    }
    b.segments[s.segment_count as usize] = RaySegment {
        x0: r.x,
        y0: r.y,
        x1: x,
        y1: y,
        intensity: r.intensity,
        wavelength_nm: r.wavelength_nm,
    };
    s.segment_count += 1;
    Ok(())
}
fn handle(
    r: OpticsRay,
    c: &OpticsComponent,
    g: SegmentGeom,
    h: RayIntersection,
    index: usize,
    s: &mut OpticsState,
    b: &mut OpticsBuffers,
) -> Result<u32, KernelError> {
    let theta = incidence_angle_deg(r.dx, r.dy, g.nx, g.ny)?;
    let mut e = OpticsEvent {
        component_index: index as u32,
        kind: c.kind,
        x: h.x,
        y: h.y,
        intensity_in: r.intensity,
        ..Default::default()
    };
    let direction = Direction { dx: r.dx, dy: r.dy };
    let mut absorbed = false;
    match c.kind {
        5 => {
            e.event_type = 7;
            absorbed = true;
        }
        4 => {
            e.event_type = 6;
            e.fields_mask = 1;
        }
        1 => {
            let d = reflect(r.dx, r.dy, g.nx, g.ny)?;
            e.event_type = 0;
            e.fields_mask = 3;
            e.intensity_out = r.intensity * MIRROR_R_PROTECTED_SILVER;
            e.theta_i = theta;
            push(s, b, outgoing(r, h.x, h.y, d, 0.4, e.intensity_out)?)?;
        }
        3 => {
            let cosi = -(r.dx * g.nx + r.dy * g.ny);
            let (n1, n2) = if cosi > 0. { (1., c.n) } else { (c.n, 1.) };
            let d = refract(r.dx, r.dy, g.nx, g.ny, n1, n2)?;
            e.fields_mask = 3;
            e.theta_i = theta;
            if let Some(d) = d {
                e.event_type = 1;
                e.fields_mask = 7;
                e.theta_t = incidence_angle_deg(d.dx, d.dy, g.nx, g.ny)?;
                e.note0 = n1;
                e.note1 = n2;
                // Fresnel T at this surface; the specular leg carries R and
                // is reported through the in − out gap rather than traced.
                let cos_i = value(cosi.abs())?;
                let cos_t = snell_cos_t(n1, n2, cos_i)?.unwrap_or(0.);
                e.intensity_out = r.intensity * surface_transmittance(r, n1, n2, cos_i, cos_t)?;
                if e.intensity_out > 1e-5 {
                    push(s, b, outgoing(r, h.x, h.y, d, 0.4, e.intensity_out)?)?;
                } else {
                    absorbed = true;
                }
            } else {
                e.event_type = 2;
                // TIR: R = 1 exactly; the evanescent wave carries no power.
                e.intensity_out = r.intensity;
                push(
                    s,
                    b,
                    outgoing(
                        r,
                        h.x,
                        h.y,
                        reflect(r.dx, r.dy, g.nx, g.ny)?,
                        0.4,
                        e.intensity_out,
                    )?,
                )?;
            }
        }
        2 => {
            let f = c.focal_length;
            if f.abs() <= 1e-6 {
                // Infinite focal length: a plane-parallel plate — direction
                // unchanged, but both faces still take their Fresnel share.
                let cos_i = value((r.dx * g.nx + r.dy * g.ny).abs())?;
                let t = plate_transmittance(r, c.n, cos_i)?;
                push(
                    s,
                    b,
                    outgoing(r, h.x, h.y, direction, 0.4, r.intensity * t)?,
                )?;
                return Ok(0);
            }
            let axis = unit_from_rot(c.rot)?;
            let tx = -axis.dy;
            let ty = axis.dx;
            let height = (h.x - c.x) * tx + (h.y - c.y) * ty;
            let ax_in = r.dx * axis.dx + r.dy * axis.dy;
            let sign = if ax_in >= 0. { 1. } else { -1. };
            let ax = Direction {
                dx: axis.dx * sign,
                dy: axis.dy * sign,
            };
            let along = r.dx * ax.dx + r.dy * ax.dy;
            let tangent = r.dx * tx + r.dy * ty;
            let slope = (tangent / along.abs().max(1e-9)) * if along < 0. { -1. } else { 1. };
            let slope_out = slope - height / f;
            let d = normalize(ax.dx + tx * slope_out, ax.dy + ty * slope_out)?;
            e.event_type = 3;
            e.fields_mask = 1;
            // Fresnel loss on both lens faces (entry air→glass, exit
            // glass→air at the internal angle of the outgoing slope).
            e.intensity_out = r.intensity * lens_transmittance(r, c.n, g.nx, g.ny, d)?;
            e.note0 = f;
            e.note1 = height;
            if e.intensity_out > 1e-5 {
                push(s, b, outgoing(r, h.x, h.y, d, 0.5, e.intensity_out)?)?;
            } else {
                absorbed = true;
            }
        }
        6 => {
            let factor = malus_factor(
                if r.polarized == 1 {
                    Some(r.pol_deg)
                } else {
                    None
                },
                c.pol_angle_deg,
            )?;
            e.event_type = 4;
            e.fields_mask = 1 | if r.polarized == 0 { 8 } else { 0 };
            e.note0 = factor;
            e.note1 = c.pol_angle_deg;
            // Sheet polarizer: Malus on the analyzed component times the two
            // Fresnel faces of the plate (index c.n, air on both sides).
            let cos_i = value((r.dx * g.nx + r.dy * g.ny).abs())?;
            e.intensity_out = r.intensity * factor * plate_transmittance(r, c.n, cos_i)?;
            if e.intensity_out < 1e-5 {
                absorbed = true;
            } else {
                let mut next = outgoing(r, h.x, h.y, direction, 0.5, e.intensity_out)?;
                next.pol_deg = c.pol_angle_deg;
                next.polarized = 1;
                push(s, b, next)?;
            }
        }
        7 => {
            let t = c.split_t.clamp(0., 1.);
            let reflectance = 1. - t;
            let throughput = 1. - SPLITTER_COATING_ABSORPTION;
            let d = reflect(r.dx, r.dy, g.nx, g.ny)?;
            if t * r.intensity > 1e-5 {
                push(
                    s,
                    b,
                    outgoing(r, h.x, h.y, direction, 0.5, r.intensity * t * throughput)?,
                )?;
            }
            if reflectance * r.intensity > 1e-5 {
                push(
                    s,
                    b,
                    outgoing(r, h.x, h.y, d, 0.5, r.intensity * reflectance * throughput)?,
                )?;
            }
            e.event_type = 5;
            e.fields_mask = 1;
            e.intensity_out = r.intensity * throughput;
            e.note0 = t;
            e.note1 = reflectance;
        }
        _ => return Err(KernelError::UnsupportedFeature),
    }
    finite(&[
        e.x,
        e.y,
        e.intensity_in,
        e.intensity_out,
        e.theta_i,
        e.theta_t,
        e.note0,
        e.note1,
    ])?;
    if s.event_count as usize >= b.events.len() {
        return Err(KernelError::BufferLength);
    }
    b.events[s.event_count as usize] = e;
    s.event_count += 1;
    Ok(if c.kind == 4 { 2 } else { u32::from(absorbed) })
}
pub fn advance_trace(
    c: &OpticsConfig,
    components: &[OpticsComponent],
    s: &mut OpticsState,
    b: &mut OpticsBuffers,
    budget: u32,
) -> Result<bool, KernelError> {
    config(c, b)?;
    state(c, s)?;
    if components.len() != c.component_count as usize {
        return Err(KernelError::BufferLength);
    }
    if budget == 0 || budget > MAX_RAYS as u32 {
        return Err(KernelError::InvalidDimensions);
    }
    for component in components {
        self::component(component)?;
    }
    for _ in 0..budget {
        if s.stack_len == 0 {
            return Ok(true);
        }
        if s.processed >= MAX_RAYS as u32 {
            return Err(KernelError::RayLimitExceeded);
        }
        s.processed += 1;
        s.stack_len -= 1;
        let r = b.stack[s.stack_len as usize];
        ray_valid(r)?;
        if r.bounces > c.max_bounces || r.intensity < 1e-4 {
            continue;
        }
        let mut best: Option<(usize, RayIntersection)> = None;
        for (index, component) in components.iter().enumerate() {
            if component.kind == 0 {
                continue;
            }
            if let Some(hit) = ray_segment_hit(r.x, r.y, r.dx, r.dy, &b.geoms[index], 1e-4)? {
                if best.as_ref().is_none_or(|(_, old)| hit.t < old.t) {
                    best = Some((index, hit));
                }
            }
        }
        let bound = exit_bound(r)?;
        if best
            .as_ref()
            .is_none_or(|(_, h)| bound.is_some_and(|t| t < h.t))
        {
            if let Some(t) = bound {
                segment(s, b, r, r.x + r.dx * t, r.y + r.dy * t)?;
            }
            continue;
        }
        let (index, hit) = best.ok_or(KernelError::InvalidState)?;
        segment(s, b, r, hit.x, hit.y)?;
        let outcome = handle(r, &components[index], b.geoms[index], hit, index, s, b)?;
        if outcome == 0 {
            continue;
        }
        if s.hit_count as usize >= b.hits.len() {
            return Err(KernelError::BufferLength);
        }
        b.hits[s.hit_count as usize] = RayHit {
            component_index: index as u32,
            kind: components[index].kind,
            x: hit.x,
            y: hit.y,
            intensity: r.intensity,
            wavelength_nm: r.wavelength_nm,
            s: hit.s,
        };
        s.hit_count += 1;
        if outcome == 2 {
            let existing = b.profiles[..s.profile_count as usize]
                .iter()
                .position(|p| p.component_index == index as u32);
            let profile_index = if let Some(at) = existing {
                at
            } else {
                let at = s.profile_count as usize;
                if at >= components.len() {
                    return Err(KernelError::InvalidState);
                }
                b.profiles[at] = ScreenProfile {
                    component_index: index as u32,
                    ..Default::default()
                };
                s.profile_count += 1;
                at
            };
            b.profiles[profile_index].screen_power =
                value(b.profiles[profile_index].screen_power + r.intensity)?;
            let bins = c.screen_bins as usize;
            let bin = ((hit.s * bins as f64) as usize).min(bins - 1);
            let at = index * bins + bin;
            b.bins[at] = value(b.bins[at] + r.intensity)?;
        }
    }
    Ok(s.stack_len == 0)
}
pub fn read_trace(
    c: &OpticsConfig,
    s: &OpticsState,
    b: &mut OpticsBuffers,
) -> Result<(), KernelError> {
    config(c, b)?;
    state(c, s)?;
    if s.stack_len != 0 {
        return Err(KernelError::InvalidState);
    }
    let n = c.screen_bins as usize;
    let mut seen = 0_u64;
    for profile in &mut b.profiles[..s.profile_count as usize] {
        if profile.component_index >= c.component_count {
            return Err(KernelError::InvalidState);
        }
        finite(&[profile.screen_power])?;
        let bit = 1_u64 << profile.component_index;
        if profile.screen_power < 0. || seen & bit != 0 {
            return Err(KernelError::InvalidState);
        }
        seen |= bit;
        let mut total = 0.;
        let mut peak = -1.;
        let mut peak_bin = 0;
        for (i, &v) in b.bins
            [profile.component_index as usize * n..(profile.component_index as usize + 1) * n]
            .iter()
            .enumerate()
        {
            if !v.is_finite() {
                return Err(KernelError::NonFiniteValue);
            }
            if v < 0. {
                return Err(KernelError::InvalidState);
            }
            total += v;
            if v > peak {
                peak = v;
                peak_bin = i;
            }
        }
        profile.total = value(total)?;
        profile.peak_bin = peak_bin as u32;
        profile.peak_s = (peak_bin as f64 + 0.5) / n as f64;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use std::vec::Vec;
    #[test]
    fn angle_reference_matches_std() {
        for i in 0..=1000 {
            let c = i as f64 / 1000.;
            assert!((acos_unit(c).unwrap() - c.acos()).abs() < 7e-16);
        }
        for c in [f64::from_bits(1_f64.to_bits() - 1), 1e-300] {
            assert!((acos_unit(c).unwrap() - c.acos()).abs() < 7e-16);
        }
    }
    #[test]
    fn fresnel_normal_incidence_matches_index_ratio() {
        let (rs, rp) = fresnel_rs_rp(1., 1.5, 1., 1.).unwrap();
        let r = ((1.5_f64 - 1.) / (1.5 + 1.)).powi(2);
        assert!((rs - r).abs() < 1e-15);
        assert!((rp - r).abs() < 1e-15);
        let (rs, rp) = fresnel_rs_rp(1.5, 1., 1., 1.).unwrap();
        assert!((rs - r).abs() < 1e-15);
        assert!((rp - r).abs() < 1e-15);
    }
    #[test]
    fn fresnel_p_vanishes_at_brewster() {
        // theta_B = atan(n2/n1); there theta_i + theta_t = 90°.
        let brewster = (1.5_f64).atan();
        let cos_i = brewster.cos();
        let cos_t = snell_cos_t(1., 1.5, cos_i).unwrap().unwrap();
        let (rs, rp) = fresnel_rs_rp(1., 1.5, cos_i, cos_t).unwrap();
        assert!(rp < 1e-12);
        assert!(rs > 0.1);
        // p-polarized ray (pol 0 lies in the incidence plane) transmits fully.
        let p_ray = OpticsRay {
            polarized: 1,
            pol_deg: 0.,
            intensity: 1.,
            wavelength_nm: 532.,
            ..Default::default()
        };
        let t_p = surface_transmittance(p_ray, 1., 1.5, cos_i, cos_t).unwrap();
        assert!((t_p - 1.).abs() < 1e-12);
        // s-polarized ray (pol 90 out of plane) keeps only 1 − R_s.
        let s_ray = OpticsRay {
            pol_deg: 90.,
            ..p_ray
        };
        let t_s = surface_transmittance(s_ray, 1., 1.5, cos_i, cos_t).unwrap();
        assert!((t_s - (1. - rs)).abs() < 1e-12);
        // Unpolarized sits between the two.
        let t_u = surface_transmittance(
            OpticsRay {
                polarized: 0,
                pol_deg: 0.,
                ..p_ray
            },
            1.,
            1.5,
            cos_i,
            cos_t,
        )
        .unwrap();
        assert!(t_s < t_u && t_u < t_p);
    }
    #[test]
    fn snell_cos_t_reports_tir_above_critical_angle() {
        // Critical angle for glass→air is asin(1/1.5) ≈ 41.8°.
        assert!(snell_cos_t(1.5, 1., (45_f64).to_radians().cos())
            .unwrap()
            .is_none());
        assert!(snell_cos_t(1.5, 1., (30_f64).to_radians().cos())
            .unwrap()
            .is_some());
    }
    struct Traced {
        segments: Vec<RaySegment>,
        events: Vec<OpticsEvent>,
    }
    fn component(kind: u32, x: f64, y: f64, rot: f64) -> OpticsComponent {
        // Mirrors the wasm-fields writer defaults.
        OpticsComponent {
            kind,
            x,
            y,
            rot,
            length: 80.,
            power: 1.,
            wavelength_nm: 635.,
            focal_length: 140.,
            n: 1.5,
            pol_angle_deg: rot,
            split_t: 0.5,
            ..Default::default()
        }
    }
    fn trace(components: &[OpticsComponent]) -> Traced {
        let config = OpticsConfig {
            component_count: components.len() as u32,
            max_bounces: 28,
            screen_bins: 48,
            reserved: 0,
        };
        let mut state = OpticsState::default();
        let mut geoms = std::vec![SegmentGeom::default(); components.len()];
        let mut stack = std::vec![OpticsRay::default(); STACK_CAPACITY];
        let mut segments = std::vec![RaySegment::default(); MAX_RAYS];
        let mut hits = std::vec![RayHit::default(); MAX_RAYS];
        let mut events = std::vec![OpticsEvent::default(); MAX_RAYS];
        let mut profiles = std::vec![ScreenProfile::default(); components.len()];
        let mut bins = std::vec![0.; components.len() * 48];
        {
            let mut b = OpticsBuffers {
                geoms: &mut geoms,
                stack: &mut stack,
                segments: &mut segments,
                hits: &mut hits,
                events: &mut events,
                profiles: &mut profiles,
                bins: &mut bins,
            };
            init_trace(&config, components, &mut state, &mut b).unwrap();
            while !advance_trace(&config, components, &mut state, &mut b, 4096).unwrap() {}
        }
        Traced {
            segments: segments[..state.segment_count as usize].to_vec(),
            events: events[..state.event_count as usize].to_vec(),
        }
    }
    #[test]
    fn tir_reflects_full_power_above_critical_angle() {
        // Laser inside the dense side of an n=1.5 interface at 50° > 41.8°.
        let mut laser = component(0, 380., 250., 50.);
        laser.wavelength_nm = 532.;
        let mut face = component(3, 520., 300., 0.);
        face.length = 280.;
        let traced = trace(&[laser, face]);
        let tirs: Vec<OpticsEvent> = traced
            .events
            .iter()
            .copied()
            .filter(|e| e.event_type == 2)
            .collect();
        assert!(!tirs.is_empty());
        for e in tirs {
            assert!(e.theta_i > 41.8);
            assert!((e.intensity_out - e.intensity_in).abs() < 1e-12);
        }
        // No transmitted leg exists above the critical angle.
        assert!(traced.events.iter().all(|e| e.event_type != 1));
    }
    #[test]
    fn interface_refract_event_carries_fresnel_transmittance() {
        // Air → glass at near-normal incidence: T ≈ 1 − ((n−1)/(n+1))² = 0.96.
        let laser = component(0, 80., 280., 0.);
        let mut face = component(3, 420., 280., 0.);
        face.length = 220.;
        let traced = trace(&[laser, face]);
        let refracts: Vec<OpticsEvent> = traced
            .events
            .iter()
            .copied()
            .filter(|e| e.event_type == 1)
            .collect();
        assert_eq!(refracts.len(), 9);
        for e in refracts {
            let ci = (e.theta_i * core::f64::consts::PI / 180.).cos();
            let ct = (e.theta_t * core::f64::consts::PI / 180.).cos();
            let rs = ((ci - 1.5 * ct) / (ci + 1.5 * ct)).powi(2);
            let rp = ((ct - 1.5 * ci) / (ct + 1.5 * ci)).powi(2);
            let expected = e.intensity_in * (1. - (rs + rp) / 2.);
            assert!((e.intensity_out - expected).abs() < 1e-12);
            assert!((e.intensity_out / e.intensity_in - 0.96).abs() < 0.002);
        }
    }
    #[test]
    fn beam_splitter_legs_conserve_power_minus_coating_loss() {
        let mut laser = component(0, 100., 300., 0.);
        laser.wavelength_nm = 532.;
        let mut splitter = component(7, 420., 300., 45.);
        splitter.length = 90.;
        let traced = trace(&[laser, splitter]);
        let splits: Vec<OpticsEvent> = traced
            .events
            .iter()
            .copied()
            .filter(|e| e.event_type == 5)
            .collect();
        assert_eq!(splits.len(), 9);
        for e in splits {
            // Outgoing segments start one step past the split point.
            let legs: f64 = traced
                .segments
                .iter()
                .filter(|s| (s.x0 - e.x).abs() < 1. && (s.y0 - e.y).abs() < 1.)
                .map(|s| s.intensity)
                .sum();
            assert!((legs - e.intensity_in * 0.97).abs() < 1e-9);
            assert!((e.intensity_out - e.intensity_in * 0.97).abs() < 1e-12);
        }
    }
    #[test]
    fn mirror_reflects_at_coating_reflectance() {
        let laser = component(0, 80., 280., 0.);
        let mut mirror = component(1, 420., 280., 135.);
        mirror.length = 110.;
        let traced = trace(&[laser, mirror]);
        let reflects: Vec<OpticsEvent> = traced
            .events
            .iter()
            .copied()
            .filter(|e| e.event_type == 0)
            .collect();
        assert_eq!(reflects.len(), 9);
        for e in reflects {
            assert!((e.intensity_out - e.intensity_in * 0.94).abs() < 1e-12);
        }
    }
    #[test]
    fn p_polarized_ray_transmits_fully_at_brewster_surface() {
        // Polarizer fixes pol 0 (in-plane); interface tilted to the air→glass
        // Brewster angle 56.31° must pass the whole surviving power. The
        // normal faces the beam (ray opposes it) so the crossing is air→glass.
        let laser = component(0, 60., 280., 0.);
        let mut pol = component(6, 200., 280., 0.);
        pol.pol_angle_deg = 0.;
        pol.length = 100.;
        let mut face = component(3, 420., 280., 180. + 1.5_f64.atan().to_degrees());
        face.length = 220.;
        let traced = trace(&[laser, pol, face]);
        let refracts: Vec<OpticsEvent> = traced
            .events
            .iter()
            .copied()
            .filter(|e| e.event_type == 1)
            .collect();
        assert!(!refracts.is_empty());
        for e in refracts {
            assert!(e.theta_i > 50.);
            assert!(e.intensity_out / e.intensity_in > 0.99);
        }
    }
}
