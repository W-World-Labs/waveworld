use w_sim_kernels::{seed_heat, seed_wave, step_heat, step_wave, KernelError, Seed};

fn total(field: &[f32]) -> f64 {
    field.iter().map(|&value| value as f64).sum()
}

#[test]
fn heat_impulse_matches_two_exact_reference_steps() {
    let mut current = [0.0; 9];
    current[4] = 1.0;
    let mut next = [0.0; 9];
    step_heat(&current, &mut next, 3, 3, 0.25).unwrap();
    assert_eq!(next, [0.0, 0.25, 0.0, 0.25, 0.0, 0.25, 0.0, 0.25, 0.0]);
    step_heat(&next, &mut current, 3, 3, 0.25).unwrap();
    assert_eq!(
        current,
        [0.125, 0.0625, 0.125, 0.0625, 0.25, 0.0625, 0.125, 0.0625, 0.125]
    );
    assert_eq!(total(&current), 1.0);
}

#[test]
fn heat_insulated_edges_conserve_and_satisfy_maximum_principle() {
    let (width, height) = (17, 11);
    let mut current = vec![0.0; width * height];
    seed_heat(
        &mut current,
        width,
        height,
        Seed {
            x: 0,
            y: 0,
            radius: 3,
            amount: 80.0,
        },
    )
    .unwrap();
    let initial = total(&current);
    let mut next = current.clone();
    for _ in 0..128 {
        step_heat(&current, &mut next, width, height, 0.25).unwrap();
        assert!(next.iter().all(|&value| (0.0..=80.0).contains(&value)));
        core::mem::swap(&mut current, &mut next);
    }
    assert!((total(&current) - initial).abs() < initial * 2e-6);
    for (width, height) in [(1, 1), (1, 7), (7, 1)] {
        let current = vec![37.5; width * height];
        let mut next = vec![0.0; width * height];
        step_heat(&current, &mut next, width, height, 0.25).unwrap();
        assert_eq!(current, next);
    }
}

#[test]
fn wave_impulse_matches_two_exact_reference_steps() {
    let mut current = [0.0; 25];
    let mut previous = current;
    seed_wave(
        &mut current,
        &mut previous,
        5,
        Seed {
            x: 2,
            y: 2,
            radius: 0,
            amount: 1.0,
        },
    )
    .unwrap();
    step_wave(&current, &mut previous, 5, 0.25, 1.0, None).unwrap();
    assert_eq!(
        previous,
        [
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0, 0.0, 0.25, 0.0, 0.25, 0.0, 0.0, 0.0,
            0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ]
    );
    step_wave(&previous, &mut current, 5, 0.25, 1.0, None).unwrap();
    assert_eq!(
        current,
        [
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.125, 0.25, 0.125, 0.0, 0.0, 0.25, -0.75, 0.25, 0.0,
            0.0, 0.125, 0.25, 0.125, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ]
    );
}

// Exact discrete leapfrog invariant (kinetic + cross-time gradient potential),
// rather than the RMS displacement used by the preview's visual summary.
fn wave_energy(current: &[f32], previous: &[f32], n: usize, a: f64) -> f64 {
    let mut energy = 0.0;
    for y in 0..n {
        for x in 0..n {
            let k = y * n + x;
            let velocity = current[k] as f64 - previous[k] as f64;
            energy += velocity * velocity * 0.5;
            for neighbor in [
                if x + 1 < n { Some(k + 1) } else { None },
                if y + 1 < n { Some(k + n) } else { None },
            ]
            .into_iter()
            .flatten()
            {
                let gradient = current[neighbor] as f64 - current[k] as f64;
                let old_gradient = previous[neighbor] as f64 - previous[k] as f64;
                energy += a * 0.5 * gradient * old_gradient;
            }
        }
    }
    energy
}

#[test]
fn wave_undamped_discrete_energy_stays_bounded() {
    let n = 19;
    let mut current = vec![0.0; n * n];
    let mut previous = current.clone();
    seed_wave(
        &mut current,
        &mut previous,
        n,
        Seed {
            x: 9,
            y: 9,
            radius: 2,
            amount: 3.0,
        },
    )
    .unwrap();
    let initial = wave_energy(&current, &previous, n, 0.25);
    for _ in 0..128 {
        step_wave(&current, &mut previous, n, 0.25, 1.0, None).unwrap();
        core::mem::swap(&mut current, &mut previous);
        assert!((wave_energy(&current, &previous, n, 0.25) - initial).abs() < initial * 2e-6);
    }
}

#[test]
fn wave_walls_and_obstacles_are_zero() {
    let n = 7;
    let mut current = vec![0.0; n * n];
    let mut previous = current.clone();
    seed_wave(
        &mut current,
        &mut previous,
        n,
        Seed {
            x: 0,
            y: 0,
            radius: usize::MAX,
            amount: 1.0,
        },
    )
    .unwrap();
    let mut obstacles = vec![0; n * n];
    obstacles[3 * n + 3] = 1;
    for _ in 0..12 {
        step_wave(&current, &mut previous, n, 0.5, 0.99, Some(&obstacles)).unwrap();
        for y in 0..n {
            for x in 0..n {
                if x == 0 || y == 0 || x == n - 1 || y == n - 1 || obstacles[y * n + x] != 0 {
                    assert_eq!(previous[y * n + x], 0.0);
                }
            }
        }
        core::mem::swap(&mut current, &mut previous);
    }
}

#[test]
fn invalid_inputs_return_errors_instead_of_panicking_or_spreading_nan() {
    assert_eq!(
        step_heat(&[], &mut [], 0, 1, 0.1),
        Err(KernelError::InvalidDimensions)
    );
    assert_eq!(
        step_heat(&[], &mut [], usize::MAX, 2, 0.1),
        Err(KernelError::InvalidDimensions)
    );
    assert_eq!(
        step_heat(&[0.0], &mut [], 1, 1, 0.1),
        Err(KernelError::BufferLength)
    );
    assert_eq!(
        step_heat(&[0.0], &mut [0.0], 1, 1, 0.251),
        Err(KernelError::InvalidCoefficient)
    );
    assert_eq!(
        step_heat(&[f32::NAN], &mut [0.0], 1, 1, 0.1),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(
        step_wave(&[], &mut [], 1, 0.25, 1.0, None),
        Err(KernelError::InvalidDimensions)
    );
    for (a, damping) in [(0.51, 1.0), (f64::NAN, 1.0), (0.25, -0.1), (0.25, 1.1)] {
        assert_eq!(
            step_wave(&[0.0; 9], &mut [0.0; 9], 3, a, damping, None),
            Err(KernelError::InvalidCoefficient)
        );
    }
    assert_eq!(
        step_wave(&[0.0; 9], &mut [0.0; 9], 3, 0.25, 1.0, Some(&[0])),
        Err(KernelError::BufferLength)
    );
    assert_eq!(
        step_wave(&[f32::MAX; 9], &mut [-f32::MAX; 9], 3, 0.25, 1.0, None),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(
        seed_heat(
            &mut [0.0],
            1,
            1,
            Seed {
                x: 0,
                y: 0,
                radius: 0,
                amount: f64::INFINITY
            }
        ),
        Err(KernelError::NonFiniteValue)
    );
}
