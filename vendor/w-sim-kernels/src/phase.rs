//! Large finite binary64 phase reduction. The fixed-point 2/pi product retains
//! only the quadrant and fractional remainder (Payne-Hanek/fdlibm method).
//! Constants are independently generated, not a copied library implementation:
//! `wasm/generate-phase-oracle.py` cross-checks Chudnovsky and AGM pi at 700 digits.
//! See https://www.netlib.org/fdlibm/k_rem_pio2.c for the method rationale.
use crate::{map_quadrant, sin_cos_reduced};

// floor(2/pi * 2^1664), little-endian u32 limbs. At MAX finite binary64 the
// omitted product tail is <2^-640; the reconstructed remainder uses 106 bits.
const TWO_OVER_PI: [u32; 52] = [
    0xdce8092a, 0x19c367cd, 0x8c6b47c4, 0x60e27bc0, 0xca73a8c9, 0x06061556, 0x4d732731, 0x8dffd880,
    0x14a06840, 0x6599855f, 0x5ee61b08, 0xa9e39161, 0x9af4361d, 0xf0cfbc20, 0xfc7b6bab, 0x56033046,
    0x1f8d5d08, 0x6bfb5fb1, 0x8a5292ea, 0x3d0739f7, 0xebe5f17b, 0x7527bac7, 0x9e5fea2d, 0x4f463f66,
    0x27cb09b7, 0x6d367ecf, 0x5a0a6d1f, 0xef2f118b, 0xde05980f, 0x1ff897ff, 0xbdf9283b, 0x9c845f8b,
    0x835339f4, 0x3991d639, 0xb45f7e41, 0xe99c7026, 0x2ebb4484, 0xe88235f5, 0xb129a73e, 0xfe1deb1c,
    0x09d1921c, 0x06492eea, 0x424dd2e0, 0xb7246e3a, 0xdebbc561, 0xfe5163ab, 0x3c439041, 0xdb629599,
    0xf534ddc0, 0xfc2757d1, 0x4e441529, 0xa2f9836e,
];

fn bit(words: &[u32; 54], index: i32) -> u64 {
    if index < 0 {
        0
    } else {
        ((words[index as usize / 32] >> (index % 32)) & 1) as u64
    }
}
fn extract(words: &[u32; 54], top: i32) -> u64 {
    let mut value = 0;
    for i in 0..53 {
        value = value * 2 + bit(words, top - i);
    }
    value
}
fn scale(mantissa: u64, exponent: i32) -> f64 {
    if exponent >= -1022 {
        mantissa as f64 * f64::from_bits(((exponent + 1023) as u64) << 52)
    } else {
        (mantissa as f64 * f64::MIN_POSITIVE) * f64::from_bits(((exponent + 2045) as u64) << 52)
    }
}

/// Called only for finite |angle| > 2^18. No platform libm or fused arithmetic.
pub(crate) fn large_sin_cos(angle: f64) -> (f64, f64) {
    let bits = angle.abs().to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32 - 1023;
    let mantissa = (bits & ((1_u64 << 52) - 1)) | (1_u64 << 52);
    let mut product = [0_u32; 54];
    for j in 0..2 {
        let word = ((mantissa >> (32 * j)) as u32) as u64;
        let mut carry = 0;
        for (i, &constant) in TWO_OVER_PI.iter().enumerate() {
            let next = constant as u64 * word + product[i + j] as u64 + carry;
            product[i + j] = next as u32;
            carry = next >> 32;
        }
        product[52 + j] = carry as u32;
    }
    let shift = 1664 + 52 - exponent;
    let mut quadrant = bit(&product, shift) + 2 * bit(&product, shift + 1);
    let negative = bit(&product, shift - 1) != 0;
    if negative {
        quadrant += 1;
        // Magnitude of the negative remainder: 2^shift - fractional numerator.
        let mut carry = 1_u64;
        for word in &mut product {
            let next = (!*word) as u64 + carry;
            *word = next as u32;
            carry = next >> 32;
        }
    }
    let mut top = shift - 1;
    while top >= 0 && bit(&product, top) == 0 {
        top -= 1;
    }
    let hi = scale(extract(&product, top), top - shift - 52);
    let lo = scale(extract(&product, top - 53), top - shift - 105);
    let pi2 = core::f64::consts::FRAC_PI_2;
    let p = hi * pi2;
    // Dekker error-free product, plus the low part of pi/2 and fractional tail.
    let a = 134_217_729. * hi;
    let ah = a - (a - hi);
    let al = hi - ah;
    let b = 134_217_729. * pi2;
    let bh = b - (b - pi2);
    let bl = pi2 - bh;
    let error = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
    let tail = (error + hi * 6.123_233_995_736_766e-17) + lo * pi2;
    let high = p + tail;
    let low = (p - high) + tail;
    let (r, rr) = if negative { (-high, -low) } else { (high, low) };
    let (s, c) = sin_cos_reduced(r);
    let (s, c) = map_quadrant((s + c * rr, c - s * rr), (quadrant & 3) as i64);
    (if angle.is_sign_negative() { -s } else { s }, c)
}
