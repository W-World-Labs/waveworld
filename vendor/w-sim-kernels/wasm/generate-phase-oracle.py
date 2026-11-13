"""Opt-in test data/constants generator; Python standard library only.

Two independent pi algorithms cross-check the 1664-bit 2/pi integer.
The oracle uses Decimal remainder/Taylor, not the Rust fixed-point reducer.
Run from any directory; stdout is the little-endian u32 Rust constant table.
Method background: https://www.netlib.org/fdlibm/k_rem_pio2.c
No source implementation or constant table is copied from fdlibm.
"""
from decimal import Decimal as D, localcontext
from pathlib import Path
import gzip
import json
import math
import random
import struct


def pi_chudnovsky():
    m, ell, x, k = 1, 13591409, 1, 6
    total = D(ell)
    for i in range(1, 53):
        m = m * (k * k * k - 16 * k) // (i * i * i)
        ell += 545140134
        x *= -262537412640768000
        total += D(m * ell) / D(x)
        k += 12
    return 426880 * D(10005).sqrt() / total


def pi_agm():
    a, b, t, p = D(1), 1 / D(2).sqrt(), D(1) / 4, D(1)
    for _ in range(13):
        an = (a + b) / 2
        b = (a * b).sqrt()
        t -= p * (a - an) ** 2
        a, p = an, p * 2
    return (a + b) ** 2 / (4 * t)


def bits(x):
    return struct.pack('>d', x).hex()


with localcontext() as ctx:
    ctx.prec = 720
    pi = pi_chudnovsky()
    other = pi_agm()
    assert abs(pi - other) < D('1e-700')
    fixed = int((2 / pi) * D(2) ** 1664)
    assert fixed == int((2 / other) * D(2) ** 1664)
    assert hex(fixed)[2:].startswith('a2f9836e4e441529fc2757d1f534dd')
    limbs = [(fixed >> (32 * i)) & 0xffffffff for i in range(52)]
    print('\n'.join('    ' + ', '.join(f'0x{w:08x}' for w in limbs[i:i + 4]) + ',' for i in range(0, 52, 4)))
    values = [0., -0., math.ulp(0.), math.pi / 4, math.pi / 2, math.pi,
              1e-100, 1e20, 1e46, 6e46, float.fromhex('0x1.fffffffffffffp1023')]
    for x in [2. ** 18, *[2. ** e for e in [19, 20, 40, 100, 200, 500, 800, 1023]]]:
        values.extend([math.nextafter(x, 0), x, math.nextafter(x, math.inf)])
    for n in [10**10, 10**20, 2**52, 2**100, 2**500, 2**1000]:
        for q in range(4):
            x = float(D(n + q) * pi / 2)
            values.extend([math.nextafter(x, 0), x, math.nextafter(x, math.inf)])
    rng = random.Random(439782)
    for _ in range(180):
        word = (rng.randrange(1041, 2047) << 52) | rng.getrandbits(52)
        values.append(struct.unpack('>d', word.to_bytes(8, 'big'))[0])
    values = list({bits(x): x for v in values for x in [v, -v]}.values())
    cases = []
    for x in values:
        angle = D.from_float(x)
        r = angle % (2 * pi)
        if r > pi:
            r -= 2 * pi
        if r < -pi:
            r += 2 * pi
        s, c, st, ct = r, D(1), r, D(1)
        for k in range(1, 500):
            st *= -r * r / ((2 * k) * (2 * k + 1))
            ct *= -r * r / ((2 * k - 1) * (2 * k))
            s, c = s + st, c + ct
            if abs(st) + abs(ct) < D('1e-710'):
                break
        sf = math.copysign(0., x) if x == 0 else float(s)
        cases.append([bits(x), bits(sf), bits(float(c))])
    result = dict(precisionDecimal=720, piAgreementDecimal=700, fixedBits=1664,
                  method='Chudnovsky + Gauss-Legendre pi; Decimal remainder and Taylor oracle',
                  twoOverPiHex=f'{fixed:x}', cases=cases)
    path = Path(__file__).with_name('fixtures') / 'phase-high-precision.json.gz'
    path.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':')).encode(), mtime=0))
    print(f'// {len(cases)} independently reduced oracle values, {path.name}')
