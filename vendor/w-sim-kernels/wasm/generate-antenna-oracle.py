"""Opt-in independent math fixtures, Python standard library only.

Decimal.log10/power plus the asin Taylor series (different from Rust atan).
For |x|>0.5 use asin(x)=pi/2-2*asin(sqrt((1-x)/2)); see Sun's original
https://www.netlib.org/fdlibm/e_asin.c method discussion, not its coefficients.
Pi comes from the existing independently cross-checked 1664-bit 2/pi fixture;
its >500 decimal digits exceed this oracle's 190-digit calculation precision.
"""
from decimal import Decimal as D, localcontext
from pathlib import Path
import gzip
import json
import math
import random
import struct


def bits(x):
    return struct.pack('>d', x).hex()


def small_asin(x):
    term, total = x, x
    for n in range(1, 400):
        term *= x * x * D((2 * n - 1) ** 2) / D(2 * n * (2 * n + 1))
        total += term
        if abs(term) < D('1e-185'):
            break
    return total


with localcontext() as context:
    context.prec = 190
    folder = Path(__file__).with_name('fixtures')
    phases = json.loads(gzip.decompress((folder / 'phase-high-precision.json.gz').read_bytes()))
    pi = D(2) ** (phases['fixedBits'] + 1) / D(int(phases['twoOverPiHex'], 16))
    rng = random.Random(67244)
    logs = [math.ulp(0.), float.fromhex('0x0.fffffffffffffp-1022'),
            float.fromhex('0x1p-1022'), .5, 1., 2., 10., 82.,
            math.nextafter(1., 0.), math.nextafter(1., math.inf),
            math.nextafter(math.sqrt(2), 0.), math.sqrt(2), math.nextafter(math.sqrt(2), math.inf),
            1e-300, 1e300, float.fromhex('0x1.fffffffffffffp1023')]
    for _ in range(96):
        word = (rng.randrange(1, 2047) << 52) | rng.getrandbits(52)
        logs.append(struct.unpack('>d', word.to_bytes(8, 'big'))[0])
    powers = [5 * i / 120 for i in range(121)] + [rng.random() * 5 for _ in range(32)]
    arcs = [i / 100 for i in range(-100, 101)] + [math.nextafter(-1., 0.), math.nextafter(1., 0.), math.ulp(0.), -math.ulp(0.), 0., -0., 1e-300, -1e-300]
    cases = []
    for op, values in enumerate([logs, powers, arcs]):
        for x in values:
            a = D.from_float(x)
            if op == 0:
                result = a.log10()
            elif op == 1:
                result = D(10) ** a
            else:
                m = abs(a)
                result = small_asin(m) if m <= D('.5') else pi / 2 - 2 * small_asin(((1 - m) / 2).sqrt())
                if x < 0:
                    result = -result
            rounded = math.copysign(0., x) if op == 2 and x == 0 else float(result)
            cases.append([op, bits(x), bits(rounded)])
    output = dict(precisionDecimal=190, piSource='independent 1664-bit phase oracle',
                  method='Decimal.log10/power; asin Taylor with half-angle reduction', cases=cases)
    (folder / 'antenna-math-oracle.json.gz').write_bytes(gzip.compress(json.dumps(output, separators=(',', ':')).encode(), mtime=0))
    print(f'{len(cases)} independent antenna math references')
