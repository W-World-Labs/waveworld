use w_sim_kernels::{optics::*, KernelError};
struct Fields {
    geoms: Vec<SegmentGeom>,
    stack: Vec<OpticsRay>,
    segments: Vec<RaySegment>,
    hits: Vec<RayHit>,
    events: Vec<OpticsEvent>,
    profiles: Vec<ScreenProfile>,
    bins: Vec<f64>,
}
impl Fields {
    fn new(n: usize, bins: usize) -> Self {
        Self {
            geoms: vec![SegmentGeom::default(); n],
            stack: vec![OpticsRay::default(); STACK_CAPACITY],
            segments: vec![RaySegment::default(); MAX_RAYS],
            hits: vec![RayHit::default(); MAX_RAYS],
            events: vec![OpticsEvent::default(); MAX_RAYS],
            profiles: vec![ScreenProfile::default(); n],
            bins: vec![0.; n * bins],
        }
    }
    fn borrow(&mut self) -> OpticsBuffers<'_> {
        OpticsBuffers {
            geoms: &mut self.geoms,
            stack: &mut self.stack,
            segments: &mut self.segments,
            hits: &mut self.hits,
            events: &mut self.events,
            profiles: &mut self.profiles,
            bins: &mut self.bins,
        }
    }
}
fn component(kind: u32, x: f64, y: f64, rot: f64) -> OpticsComponent {
    OpticsComponent {
        kind,
        x,
        y,
        rot,
        length: 140.,
        power: 1.,
        wavelength_nm: 532.,
        focal_length: 140.,
        n: 1.5,
        pol_angle_deg: rot,
        split_t: 0.5,
        reserved: 0,
    }
}
#[test]
fn reflection_refraction_geometry_and_malus_follow_their_laws() {
    let d = unit_from_rot(45.).unwrap();
    let r = reflect(d.dx, d.dy, 1., 0.).unwrap();
    assert!((r.dx + d.dx).abs() < 1e-15);
    assert!((r.dy - d.dy).abs() < 1e-15);
    let t = refract(d.dx, d.dy, 1., 0., 1., 1.5).unwrap().unwrap();
    assert!((t.dy * 1.5 - d.dy).abs() < 1e-15);
    let d = unit_from_rot(50.).unwrap();
    assert!(refract(d.dx, d.dy, 1., 0., 1.5, 1.).unwrap().is_none());
    assert_eq!(malus_factor(None, 45.).unwrap(), 0.5);
    assert!(malus_factor(Some(0.), 90.).unwrap() < 1e-30);
    let g = component_segment(&component(1, 200., 100., 0.)).unwrap();
    let hit = ray_segment_hit(0., 100., 1., 0., &g, 1e-4)
        .unwrap()
        .unwrap();
    assert_eq!((hit.x, hit.y, hit.s), (200., 100., 0.5));
    assert!(ray_segment_hit(200., 100., 1., 0., &g, 1e-4)
        .unwrap()
        .is_none());
    assert_eq!(normalize(0., 0.).unwrap().dx, 1.);
}
#[test]
fn splitter_stack_is_lifo_and_screen_energy_is_reduced_in_first_hit_order() {
    let components = [
        component(0, 100., 300., 0.),
        component(7, 420., 300., 45.),
        component(4, 740., 300., 180.),
        component(4, 420., 80., 90.),
    ];
    let c = OpticsConfig {
        component_count: 4,
        max_bounces: 28,
        screen_bins: 48,
        reserved: 0,
    };
    let mut state = OpticsState::default();
    let mut fields = Fields::new(4, 48);
    init_trace(&c, &components, &mut state, &mut fields.borrow()).unwrap();
    assert_eq!(state.stack_len, 9);
    assert_eq!(fields.stack[8].bounces, 0);
    while !advance_trace(&c, &components, &mut state, &mut fields.borrow(), 1).unwrap() {}
    read_trace(&c, &state, &mut fields.borrow()).unwrap();
    assert_eq!(state.profile_count, 2);
    assert_eq!(fields.profiles[0].component_index, 3);
    assert_eq!(fields.profiles[1].component_index, 2);
    assert!(
        (fields.profiles[0].screen_power + fields.profiles[1].screen_power - 0.97).abs() < 3e-16
    );
    assert_eq!(fields.events[0].event_type, 5);
    assert_eq!(fields.events[1].component_index, 3);
    assert_eq!(fields.events[2].component_index, 2);
    let old = (
        state.processed,
        state.segment_count,
        state.event_count,
        fields.profiles[0].screen_power,
        fields.profiles[1].total,
    );
    fields.bins.fill(f64::NAN);
    fields.profiles[0].screen_power = f64::NAN;
    init_trace(&c, &components, &mut state, &mut fields.borrow()).unwrap();
    assert!(fields.bins.iter().all(|v| *v == 0.));
    assert!(advance_trace(&c, &components, &mut state, &mut fields.borrow(), 20000).unwrap());
    read_trace(&c, &state, &mut fields.borrow()).unwrap();
    assert_eq!(
        old,
        (
            state.processed,
            state.segment_count,
            state.event_count,
            fields.profiles[0].screen_power,
            fields.profiles[1].total
        )
    );
}
#[test]
fn zero_power_bounce_limit_and_explicit_ray_limit_do_not_publish_truncation() {
    let mut components = [component(0, 50., 100., 0.), component(1, 200., 100., 180.)];
    let mut c = OpticsConfig {
        component_count: 2,
        max_bounces: 0,
        screen_bins: 1,
        reserved: 0,
    };
    let mut state = OpticsState::default();
    let mut fields = Fields::new(2, 1);
    init_trace(&c, &components, &mut state, &mut fields.borrow()).unwrap();
    assert!(advance_trace(&c, &components, &mut state, &mut fields.borrow(), 20000).unwrap());
    assert_eq!(state.processed, 18);
    assert_eq!(state.segment_count, 9);
    components[0].power = 0.;
    init_trace(&c, &components, &mut state, &mut fields.borrow()).unwrap();
    assert!(advance_trace(&c, &components, &mut state, &mut fields.borrow(), 20000).unwrap());
    assert_eq!(state.processed, 9);
    assert_eq!(state.segment_count, 0);
    components[0].power = 1.;
    init_trace(&c, &components, &mut state, &mut fields.borrow()).unwrap();
    state.processed = 20000;
    assert_eq!(
        advance_trace(&c, &components, &mut state, &mut fields.borrow(), 1),
        Err(KernelError::RayLimitExceeded)
    );
    assert!(read_trace(&c, &state, &mut fields.borrow()).is_err());
    c.screen_bins = 0;
    assert!(init_trace(&c, &components, &mut state, &mut fields.borrow()).is_err());
}
#[test]
fn layouts_invalid_fields_and_lengths_fail_before_unsafe_values_escape() {
    assert_eq!(std::mem::size_of::<OpticsComponent>(), 88);
    assert_eq!(std::mem::size_of::<OpticsRay>(), 64);
    assert_eq!(std::mem::size_of::<OpticsEvent>(), 80);
    assert_eq!(std::mem::size_of::<RayHit>(), 48);
    assert_eq!(std::mem::size_of::<ScreenProfile>(), 32);
    assert_eq!(std::mem::size_of::<OpticsState>(), 32);
    let mut components = [component(0, 50., 100., 0.)];
    let c = OpticsConfig {
        component_count: 1,
        max_bounces: 28,
        screen_bins: 2,
        reserved: 0,
    };
    let mut state = OpticsState::default();
    let mut fields = Fields::new(1, 2);
    assert!(seed_rays(&components, &mut []).is_err());
    assert!(advance_trace(&c, &components, &mut state, &mut fields.borrow(), 1).is_err());
    components[0].rot = f64::NAN;
    assert_eq!(
        init_trace(&c, &components, &mut state, &mut fields.borrow()),
        Err(KernelError::NonFiniteValue)
    );
    components[0].rot = 0.;
    init_trace(&c, &components, &mut state, &mut fields.borrow()).unwrap();
    fields.stack[8].dx = f64::NAN;
    assert_eq!(
        advance_trace(&c, &components, &mut state, &mut fields.borrow(), 1),
        Err(KernelError::NonFiniteValue)
    );
    assert!(component_segment(&OpticsComponent {
        length: -1.,
        ..components[0]
    })
    .is_err());
    assert!(refract(1., 0., 1., 0., 0., 1.).is_err());
    assert!(malus_factor(Some(f64::INFINITY), 0.).is_err());
    assert!(unit_from_rot(f64::MAX).is_err());
}
