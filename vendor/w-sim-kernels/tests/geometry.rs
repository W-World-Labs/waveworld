use w_sim_kernels::{
    geometry::{voxelize_solids, voxelize_triangles},
    lbm::display_d3q19,
    KernelError,
};

#[test]
fn thermal_regions_classify_rotated_centers_and_reject_overlap_or_empty_regions() {
    use w_sim_kernels::geometry::assign_thermal_regions;
    let mut flags = [4u8; 125];
    flags[0] = 0;
    let matrix = [0., 0.2, 0., 0., -0.2, 0., 0., 1., 0., 0., 0.2, 0.];
    let regions = [[0., 0., 0., 0.5, 1., 1.], [0.5, 0., 0., 1., 1., 1.]];
    let mut counts = [0u32; 17];
    assign_thermal_regions(&mut flags, [5, 5, 5], &matrix, &regions, &mut counts).unwrap();
    for (i, &f) in flags.iter().enumerate() {
        assert_eq!(
            f,
            if i == 0 {
                0
            } else if (i / 5) % 5 < 2 {
                5
            } else {
                6
            }
        );
    }
    assert_eq!(&counts[..3], &[0, 49, 75]);
    flags.fill(4);
    assert_eq!(
        assign_thermal_regions(
            &mut flags,
            [5, 5, 5],
            &matrix,
            &[[0., 0., 0., 0.6, 1., 1.], [0.5, 0., 0., 1., 1., 1.]],
            &mut counts
        ),
        Err(KernelError::InvalidState)
    );
    assert!(flags.iter().all(|&f| f == 4));
    assert_eq!(
        assign_thermal_regions(
            &mut flags,
            [5, 5, 5],
            &matrix,
            &[[0., 0., 0., 0.01, 0.01, 0.01]],
            &mut counts
        ),
        Err(KernelError::InvalidState)
    );
}

const VERTICES: [f32; 24] = [
    1., 1., 1., 3., 1., 1., 3., 3., 1., 1., 3., 1., 1., 1., 3., 3., 1., 3., 3., 3., 3., 1., 3., 3.,
];
const INDICES: [u32; 36] = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7,
    4, 3, 4, 0,
];

fn box_vertices(lo: [f32; 3], hi: [f32; 3]) -> Vec<f32> {
    VERTICES
        .chunks_exact(3)
        .flat_map(|p| (0..3).map(move |axis| if p[axis] == 1. { lo[axis] } else { hi[axis] }))
        .collect()
}

#[test]
fn overlapping_closed_solids_are_a_union_only_when_explicitly_grouped() {
    let mut vertices = box_vertices([2., 2., 2.], [10., 10., 10.]);
    vertices.extend(box_vertices([6., 4., 3.], [14., 12., 11.]));
    let mut indices = INDICES.to_vec();
    indices.extend(INDICES.iter().map(|i| i + 8));
    let mut flags = vec![9; 18 * 16 * 14];
    let mut scratch = [0.; 120];
    let counts = voxelize_solids(
        &vertices,
        &indices,
        &[12, 12],
        18,
        16,
        14,
        &mut flags,
        &mut scratch,
    )
    .unwrap();
    // Independent axis-aligned expectation includes the original DDA surface
    // cells at upper x/y faces, but z uses the existing half-open slices.
    for z in 0..14 {
        for y in 0..16 {
            for x in 0..18 {
                let a = (2..=10).contains(&x) && (2..=10).contains(&y) && (2..10).contains(&z);
                let b = (6..=14).contains(&x) && (4..=12).contains(&y) && (3..11).contains(&z);
                assert_eq!(flags[x + 18 * (y + 16 * z)], u8::from(a || b));
            }
        }
    }
    assert_eq!(counts.solid_cells, 1051);
    assert_eq!(counts.frontal_area_cells, 95);
    let union = flags.clone();
    let legacy =
        voxelize_triangles(&vertices, &indices, 18, 16, 14, &mut flags, &mut scratch).unwrap();
    assert_eq!(legacy.solid_cells, 946);
    assert_eq!(flags[8 + 18 * (7 + 16 * 6)], 0); // center (8.5,7.5,6.5) lies in both boxes
    assert_eq!(union[8 + 18 * (7 + 16 * 6)], 1);
    // Explicit membership is independent of the orientation of a whole solid.
    for triangle in indices[36..].chunks_exact_mut(3) {
        triangle.swap(0, 2);
    }
    voxelize_solids(
        &vertices,
        &indices,
        &[12, 12],
        18,
        16,
        14,
        &mut flags,
        &mut scratch,
    )
    .unwrap();
    assert_eq!(flags, union);
}

#[test]
fn nested_shells_keep_explicit_cavity_semantics_and_single_body_bits() {
    let mut vertices = box_vertices([1., 1., 1.], [9., 9., 9.]);
    vertices.extend(box_vertices([3., 3., 3.], [7., 7., 7.]));
    let mut indices = INDICES.to_vec();
    indices.extend(INDICES.iter().map(|i| i + 8));
    let mut flags = vec![0; 1000];
    let mut scratch = [0.; 120];
    voxelize_triangles(&vertices, &indices, 10, 10, 10, &mut flags, &mut scratch).unwrap();
    let legacy = flags.clone();
    assert_eq!(flags[555], 0);
    voxelize_solids(
        &vertices,
        &indices,
        &[24],
        10,
        10,
        10,
        &mut flags,
        &mut scratch,
    )
    .unwrap();
    assert_eq!(flags, legacy);
    voxelize_solids(
        &vertices,
        &indices,
        &[12, 12],
        10,
        10,
        10,
        &mut flags,
        &mut scratch,
    )
    .unwrap();
    let union = flags.clone();
    assert_eq!(flags[555], 1);
    voxelize_solids(
        &vertices[..24],
        &INDICES,
        &[12],
        10,
        10,
        10,
        &mut flags,
        &mut scratch,
    )
    .unwrap();
    assert_eq!(flags, union); // contained solid adds no occupancy
    voxelize_triangles(
        &vertices[..24],
        &INDICES,
        10,
        10,
        10,
        &mut flags,
        &mut scratch,
    )
    .unwrap();
    assert_eq!(flags, union);
}

#[test]
fn solid_partitions_reject_zero_incomplete_and_overflow_counts_before_writes() {
    let mut flags = [9; 96];
    for counts in [&[0][..], &[11], &[13], &[6, 7], &[u32::MAX, 1]] {
        assert_eq!(
            voxelize_solids(
                &VERTICES,
                &INDICES,
                counts,
                6,
                4,
                4,
                &mut flags,
                &mut [0.; 60]
            ),
            Err(KernelError::InvalidState)
        );
        assert!(flags.iter().all(|&f| f == 9));
    }
    assert_eq!(
        voxelize_solids(
            &VERTICES,
            &INDICES,
            &[12],
            6,
            4,
            4,
            &mut flags,
            &mut [0.; 59]
        ),
        Err(KernelError::BufferLength)
    );
    assert!(flags.iter().all(|&f| f == 9));
}

#[test]
fn closed_box_preserves_scanline_surface_and_projection_convention() {
    let mut flags = [7; 6 * 4 * 4];
    let result =
        voxelize_triangles(&VERTICES, &INDICES, 6, 4, 4, &mut flags, &mut [0.; 60]).unwrap();
    assert_eq!(result.solid_cells, 18);
    assert_eq!(result.frontal_area_cells, 6);
    for z in 0..4 {
        for y in 0..4 {
            for x in 0..6 {
                assert_eq!(
                    flags[x + 6 * (y + 4 * z)],
                    u8::from((1..=3).contains(&x) && (1..=3).contains(&y) && (1..=2).contains(&z))
                );
            }
        }
    }
    let original = flags;
    assert_eq!(
        voxelize_triangles(&[], &[], 6, 4, 4, &mut flags, &mut []),
        Err(KernelError::InvalidSolidTopology)
    );
    assert_eq!(flags, original);
}

#[test]
fn clipped_closed_mesh_does_not_walk_billions_of_outside_samples() {
    let vertices = box_vertices([-1e9, 1., 1.], [1e9, 3., 3.]);
    let mut flags = [0; 6 * 4 * 4];
    let result =
        voxelize_triangles(&vertices, &INDICES, 6, 4, 4, &mut flags, &mut [0.; 60]).unwrap();
    assert_eq!(result.solid_cells, 36);
    assert_eq!(result.frontal_area_cells, 6);
}

#[test]
fn open_tube_cannot_be_silently_filled_like_its_closed_box() {
    let vertices = box_vertices([2., 2., 2.], [6., 6., 6.]);
    let mut flags = [9; 512];
    let mut scratch = [0.; 60];
    assert_eq!(
        voxelize_triangles(&vertices, &INDICES, 8, 8, 8, &mut flags, &mut scratch)
            .unwrap()
            .solid_cells,
        100
    );
    let original = flags;
    // Both z end caps used to be invisible to the z-slice fill: the open tube
    // produced exactly the same 100 solid cells as the closed cube.
    for groups in [&[][..], &[8]] {
        assert_eq!(
            voxelize_solids(
                &vertices,
                &INDICES[12..],
                groups,
                8,
                8,
                8,
                &mut flags,
                &mut scratch
            ),
            Err(KernelError::InvalidSolidTopology)
        );
        assert_eq!(flags, original);
    }
    assert_eq!(
        voxelize_triangles(&vertices, &INDICES[..3], 8, 8, 8, &mut flags, &mut scratch),
        Err(KernelError::InvalidSolidTopology)
    );
    assert_eq!(flags, original);
}

#[test]
fn touching_closed_solids_require_explicit_sets_and_all_sets_validate_before_writes() {
    let mut vertices = VERTICES.to_vec();
    vertices.extend(box_vertices([3., 1., 1.], [5., 3., 3.]));
    let mut indices = INDICES.to_vec();
    indices.extend(INDICES.iter().map(|i| i + 8));
    let mut flags = [9; 96];
    let mut scratch = [0.; 120];
    let result = voxelize_solids(
        &vertices,
        &indices,
        &[12, 12],
        6,
        4,
        4,
        &mut flags,
        &mut scratch,
    )
    .unwrap();
    assert_eq!(result.solid_cells, 30);
    for z in 0..4 {
        for y in 0..4 {
            for x in 0..6 {
                assert_eq!(
                    flags[x + 6 * (y + 4 * z)],
                    u8::from((1..=5).contains(&x) && (1..=3).contains(&y) && (1..3).contains(&z))
                );
            }
        }
    }
    let original = flags;
    assert_eq!(
        voxelize_triangles(&vertices, &indices, 6, 4, 4, &mut flags, &mut scratch),
        Err(KernelError::InvalidSolidTopology)
    );
    assert_eq!(
        voxelize_solids(
            &vertices,
            &indices[..69],
            &[12, 11],
            6,
            4,
            4,
            &mut flags,
            &mut scratch
        ),
        Err(KernelError::InvalidSolidTopology)
    );
    assert_eq!(flags, original);
}

#[test]
fn geometric_edges_ignore_vertex_numbering_but_do_not_weld_nearby_coordinates() {
    let vertices = box_vertices([0., 0., 0.], [3., 3., 3.]);
    let mut flags = [0; 96];
    let mut scratch = [0.; 60];
    voxelize_triangles(&vertices, &INDICES, 6, 4, 4, &mut flags, &mut scratch).unwrap();
    let original = flags;
    let mut duplicated: Vec<f32> = INDICES
        .iter()
        .flat_map(|&i| vertices[i as usize * 3..i as usize * 3 + 3].iter().copied())
        .collect();
    for (i, value) in duplicated.iter_mut().enumerate() {
        if *value == 0. && i % 2 == 0 {
            *value = -0.;
        }
    }
    let mut numbered: Vec<u32> = (0..36).collect();
    voxelize_triangles(&duplicated, &numbered, 6, 4, 4, &mut flags, &mut scratch).unwrap();
    assert_eq!(flags, original);
    // Permute vertices and reverse all triangle orientations together.
    let reversed: Vec<f32> = duplicated
        .chunks_exact(3)
        .rev()
        .flatten()
        .copied()
        .collect();
    for i in &mut numbered {
        *i = 35 - *i;
    }
    for triangle in numbered.chunks_exact_mut(3) {
        triangle.swap(0, 2);
    }
    voxelize_triangles(&reversed, &numbered, 6, 4, 4, &mut flags, &mut scratch).unwrap();
    assert_eq!(flags, original);
    duplicated[3] = f32::from_bits(3f32.to_bits() + 1);
    let identity: Vec<u32> = (0..36).collect();
    assert_eq!(
        voxelize_triangles(&duplicated, &identity, 6, 4, 4, &mut flags, &mut scratch),
        Err(KernelError::InvalidSolidTopology)
    );
    assert_eq!(flags, original);
}

#[test]
fn degenerate_triangles_do_not_change_occupancy_or_hide_bad_boundary_edges() {
    let mut vertices = VERTICES.to_vec();
    vertices.extend([0., 0., 0., 7., 7., 7., 14., 14., 14.]);
    let mut indices = INDICES.to_vec();
    indices.extend([8, 9, 10, 0, 0, 1]);
    let mut flags = [0; 96];
    let mut scratch = [0.; 70];
    voxelize_triangles(&VERTICES, &INDICES, 6, 4, 4, &mut flags, &mut scratch).unwrap();
    let original = flags;
    voxelize_triangles(&vertices, &indices, 6, 4, 4, &mut flags, &mut scratch).unwrap();
    assert_eq!(flags, original);
    for bad in [&indices[12..], &indices[36..]] {
        assert_eq!(
            voxelize_triangles(&vertices, bad, 6, 4, 4, &mut flags, &mut scratch),
            Err(KernelError::InvalidSolidTopology)
        );
        assert_eq!(flags, original);
    }
    let mut reversed_face = INDICES;
    reversed_face.swap(0, 2);
    assert_eq!(
        voxelize_triangles(&VERTICES, &reversed_face, 6, 4, 4, &mut flags, &mut scratch),
        Err(KernelError::InvalidSolidTopology)
    );
    let mut duplicate_face = INDICES.to_vec();
    duplicate_face.extend(&INDICES[..3]);
    assert_eq!(
        voxelize_triangles(
            &VERTICES,
            &duplicate_face,
            6,
            4,
            4,
            &mut flags,
            &mut scratch
        ),
        Err(KernelError::InvalidSolidTopology)
    );
    assert_eq!(flags, original);
}

#[test]
fn bad_mesh_and_scratch_return_errors() {
    let mut flags = [9; 6 * 4 * 4];
    assert_eq!(
        voxelize_triangles(&VERTICES, &INDICES, 6, 4, 4, &mut flags, &mut [0.; 59]).unwrap_err(),
        KernelError::BufferLength
    );
    assert_eq!(
        voxelize_triangles(&VERTICES, &[0, 1, 100], 6, 4, 4, &mut flags, &mut [0.; 5]).unwrap_err(),
        KernelError::InvalidState
    );
    assert_eq!(
        voxelize_triangles(&[f32::NAN, 0., 0.], &[], 6, 4, 4, &mut flags, &mut []).unwrap_err(),
        KernelError::NonFiniteValue
    );
    assert_eq!(
        voxelize_triangles(&[f32::MAX, 0., 0.], &[], 6, 4, 4, &mut flags, &mut []).unwrap_err(),
        KernelError::InvalidState
    );
    assert!(flags.iter().all(|&flag| flag == 9));
}

#[test]
fn display_matches_analytic_solid_rotation_and_clamped_boundaries() {
    let mut velocity = [0.; 3 * 3 * 3 * 3];
    for z in 0..3 {
        for y in 0..3 {
            for x in 0..3 {
                let k = (x + 3 * (y + 3 * z)) * 3;
                velocity[k] = -(y as f32) * 0.02;
                velocity[k + 1] = x as f32 * 0.02;
            }
        }
    }
    let mut config = w_sim_kernels::lbm::D3q19Config {
        nx: 3,
        ny: 3,
        nz: 3,
        tau: 0.8,
        u_inlet: 0.,
        smagorinsky_cs: 0.,
        turbulence_intensity: 0.,
        ground_velocity: None,
        free_slip_walls: false,
        boundary: w_sim_kernels::lbm::D3q19Boundary::Closed,
        fan: None,
        thermal: None,
    };
    let mut display = [0.; 3 * 3 * 3 * 2];
    display_d3q19(&config, &velocity, &[0; 27], None, None, &mut display).unwrap();
    let center = 1 + 3 * (1 + 3);
    assert!((display[center * 2] as f64 - 0.02f64 * 2.0f64.sqrt()).abs() < 2e-9);
    assert!((display[center * 2 + 1] as f64 - 0.04).abs() < 2e-9);
    assert!((display[1] as f64 - 0.02).abs() < 2e-9);
    let mut single = [0.; 2];
    config.nx = 1;
    config.ny = 1;
    config.nz = 1;
    display_d3q19(&config, &[3., 4., 0.], &[0], None, None, &mut single).unwrap();
    assert_eq!(single, [5., 0.]);
    display_d3q19(&config, &[3., 4., 0.], &[1], None, None, &mut single).unwrap();
    assert_eq!(single, [0., 0.]);
    assert_eq!(
        display_d3q19(&config, &[f32::NAN, 0., 0.], &[0], None, None, &mut single),
        Err(KernelError::NonFiniteValue)
    );
    assert_eq!(
        display_d3q19(&config, &[0.; 3], &[2], None, None, &mut single),
        Err(KernelError::UnsupportedFeature)
    );
}
#[test]
fn contact_faces_use_six_faces_and_optional_periodic_wrap() {
    use w_sim_kernels::geometry::thermal_contact_faces;
    let mut flags = vec![0; 27];
    flags[12] = 4;
    flags[14] = 5;
    flags[25] = 19;
    flags[26] = 20;
    let mut mask = [0; 5];
    thermal_contact_faces(&flags, [3, 3, 3], false, &mut mask).unwrap();
    assert_eq!(mask, [0, 0, 0, 0, 128]);
    thermal_contact_faces(&flags, [3, 3, 3], true, &mut mask).unwrap();
    assert_eq!(mask[0] & 1, 1);
    assert_eq!(mask[4] & 128, 128);
    flags[13] = 5;
    thermal_contact_faces(&flags, [3, 3, 3], false, &mut mask).unwrap();
    assert_eq!(mask[0] & 1, 1);
    flags[13] = 21;
    assert!(thermal_contact_faces(&flags, [3, 3, 3], false, &mut mask).is_err());
    assert!(thermal_contact_faces(&flags[..26], [3, 3, 3], false, &mut mask).is_err());
}
