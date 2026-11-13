"""Opt-in ASE, FiPy and ngspice examples; never installed or run by normal CI.

Use a separate venv with ase==3.29.0, fipy==4.0.3 and pytest==9.1.1.
Pass an ngspice executable with --ngspice and a new directory with --output-dir.
Upstream inputs are downloaded with checked hashes, or read from --source-dir.
Only generated numerical references are consumed by WaveWorld's small CI checks.
"""
import argparse
import hashlib
import html
import importlib.util
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

SOURCES = [
    ("ase-lj.py", "https://gitlab.com/ase/ase/-/raw/3.29.0/ase/test/calculator/test_lj.py",
     "fafbbe3bee70d0c29549b53a0d91f0f17486ffa9fd6c33f717377d9bad9cf38a"),
    ("fipy-mesh1D.py", "https://raw.githubusercontent.com/usnistgov/fipy/4.0.3/examples/diffusion/explicit/mesh1D.py",
     "6ec15b1255fc3f72b90e84f5287c09e6efc89fad71dadf852acfa60b1983ea5f"),
    ("ngspice-tutorial.html", "https://ngspice.sourceforge.io/ngspice-tutorial.html",
     "4c8abbaeda257a6efc212be5bdd71c851757e0605e4587c320e18cfbe036e335"),
]


def run(command, directory, log):
    result = subprocess.run(command, cwd=directory, capture_output=True, text=True, timeout=60)
    (directory / log).write_text(result.stdout + result.stderr)
    result.check_returncode()
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--ngspice", required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    provenance = []
    for name, url, expected in SOURCES:
        if args.source_dir:
            data = (args.source_dir / name).read_bytes()
        else:
            with urllib.request.urlopen(url, timeout=20) as response:
                data = response.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Upstream source changed or exceeded limit: {name}")
        (output / name).write_bytes(data)
        provenance.append({"name": name, "url": url, "sha256": expected})

    import numpy as np
    import ase
    import fipy
    from ase.calculators.lj import LennardJones
    from ase.io import read
    from ase.md.verlet import VelocityVerlet
    from fipy.tests.doctestPlus import testmod

    # Unmodified official examples, outside the product and outside normal CI.
    run([sys.executable, "-m", "pytest", "-q", "ase-lj.py"], output, "ase-official.log")
    spec = importlib.util.spec_from_file_location("fipy_official_example", output / "fipy-mesh1D.py")
    example = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(example)
    official_fipy = testmod(example)
    if official_fipy.failed or official_fipy.attempted == 0:
        raise AssertionError(f"FiPy official example failed: {official_fipy}")

    # ASE reads the same bundled atomic state. 'ASE' leaves the numeric reduced
    # coordinates/masses/velocities unchanged; this is not physical argon in SI.
    data_path = Path(__file__).resolve().parents[2] / "public/datasets/lammps-lj-2d.data"
    atoms = read(data_path, format="lammps-data", units="ASE", atom_style="atomic",
                 Z_of_type={1: 18}, read_image_flags=False)
    assert np.all(atoms.get_masses() == 1) and np.all(atoms.positions[:, 2] == 0)
    atoms.set_pbc([True, True, False])
    atoms.calc = LennardJones(epsilon=1, sigma=1, rc=2.5, smooth=False)
    VelocityVerlet(atoms, timestep=0.005).run(5)
    ase_reference = {
        "version": ase.__version__, "inputSha256": hashlib.sha256(data_path.read_bytes()).hexdigest(),
        "steps": 5, "positions": atoms.get_positions(wrap=True)[:, :2].ravel().tolist(),
        "speeds": np.linalg.norm(atoms.get_velocities()[:, :2], axis=1).tolist(),
        "potential": float(atoms.get_potential_energy()), "kinetic": float(atoms.get_kinetic_energy()),
        "total": float(atoms.get_total_energy()),
    }

    # Adapt the official explicit diffusion equation to our current 2D heat
    # scene: unit cells, zero flux on all faces, D=1, dt=r, three steps.
    scene = {"r": 0.2, "steps": 3, "seeds": [
        {"x": 96, "y": 60, "radius": 1, "amount": 7},
        {"x": 0, "y": 0, "radius": 1, "amount": 3},
    ]}
    width, height = 192, 120
    yy, xx = np.mgrid[:height, :width]
    initial = np.zeros((height, width))
    for seed in scene["seeds"]:
        initial[(xx - seed["x"]) ** 2 + (yy - seed["y"]) ** 2 <= seed["radius"] ** 2] += seed["amount"]
    # FiPy 4.0.3 must keep half-cell boundary distances in floating point.
    mesh = fipy.Grid2D(nx=width, ny=height, dx=1.0, dy=1.0)
    field = fipy.CellVariable(mesh=mesh, value=initial.ravel())
    equation = fipy.TransientTerm() == fipy.ExplicitDiffusionTerm(coeff=1)
    for _ in range(scene["steps"]):
        equation.solve(var=field, dt=scene["r"])
    values = np.asarray(field.value)
    assert np.isfinite(values).all()
    fipy_reference = {
        "version": fipy.__version__, "input": {"module": "sim", "scene": scene},
        "width": width, "height": height,
        "nonzero": [[int(i), float(values[i])] for i in np.flatnonzero(values)],
        "total": float(values.sum()), "peak": float(values.max()),
    }

    # Retain the exact tutorial circuit. Only append non-interactive run/output
    # commands; the dual RC topology is not implemented by our one-pole method.
    tutorial = (output / "ngspice-tutorial.html").read_text()
    original = next(html.unescape(block).strip() for block in re.findall(r"<code>(.*?)</code>", tutorial, re.S)
                    if block.strip().startswith(".title dual rc ladder")) + "\n"
    (output / "ngspice-dual-rc-source.cir").write_text(original)
    ng_version = run([args.ngspice, "-v"], output, "ngspice-version.log")
    ng_version = re.search(r"ngspice-\d+", ng_version).group()

    def circuit(name, netlist, analysis, vectors, linearize=False):
        control = (".control\nset noaskquit\nset wr_vecnames\nset wr_singlescale\nset numdgt=17\n"
                   + analysis + "\n" + (f"linearize {vectors}\n" if linearize else "")
                   + f"wrdata {name}.tsv {vectors}\nquit\n.endc\n.end\n")
        (output / f"{name}.cir").write_text(netlist.rsplit(".end", 1)[0] + control)
        run([args.ngspice, "-n", "-b", f"{name}.cir"], output, f"{name}.log")
        samples = np.loadtxt(output / f"{name}.tsv", skiprows=1)
        if samples.ndim != 2 or len(samples) < 2 or not np.isfinite(samples).all():
            raise ValueError(f"Invalid ngspice output: {name}")
        return samples

    dual = circuit("ngspice-dual-rc", original, "tran 50u 50m", "v(in) v(int) v(out)")
    assert abs(dual[-1, 0] - 0.05) < 1e-12 and np.all((dual[:, 1:] >= -1e-8) & (dual[:, 1:] <= 5.00001))
    ng_references = []
    for mode in ["rc-charge", "rc-discharge", "rl"]:
        scene = {"mode": mode, "v0": 5, "r": 1000, "c": 1e-4, "l": 0.5}
        tau = scene["l"] / scene["r"] if mode == "rl" else scene["r"] * scene["c"]
        components = {
            "rc-charge": "V1 in 0 DC 5\nR1 in out 1000\nC1 out 0 100u IC=0\n",
            "rc-discharge": "R1 out 0 1000\nC1 out 0 100u IC=5\n",
            "rl": "V1 in 0 DC 5\nR1 in out 1000\nL1 out 0 0.5 IC=0\n",
        }[mode]
        deck = (f"WaveWorld one-pole {mode} comparison\n" + components
                + ".options reltol=1e-9 abstol=1e-12 vntol=1e-10 method=trap\n.end\n")
        samples = circuit("ngspice-" + mode, deck,
                          f"tran {5 * tau / 240:.17g} {5 * tau:.17g} 0 {tau / 1000:.17g} uic",
                          "i(L1)" if mode == "rl" else "v(out)", linearize=True)
        assert samples.shape == (241, 2)
        np.testing.assert_allclose(samples[:, 0], np.linspace(0, 5 * tau, 241), rtol=0, atol=1e-14)
        ng_references.append({"input": {"module": "transient", "scene": scene}, "values": samples[:, 1].tolist()})
        if mode == "rc-charge":
            # Explicit uniform resampling in ngspice; do not mislabel adaptive
            # solver timestamps as uniformly sampled or as a measured ECG.
            csv = ("# name=ngspice RC charge (simulated)\n# sample_rate_hz=480\n# unit=V\n"
                   "# source=https://ngspice.sourceforge.io/ngspice-tutorial.html\nVc\n")
            csv += "\n".join(format(v, ".17g") for v in samples[:, 1]) + "\n"
            (output / "ngspice-rc-charge.csv").write_text(csv)

    reference = {"ase": ase_reference, "fipy": fipy_reference, "ngspice": {"version": ng_version, "cases": ng_references}}
    (output / "software-hello-reference.json").write_text(json.dumps(reference, indent=2, allow_nan=False) + "\n")
    report = {"sources": provenance, "fipyOfficial": {"attempted": official_fipy.attempted, "failed": official_fipy.failed},
              "ngspiceOfficial": {"rows": len(dual), "finalTime": float(dual[-1, 0]), "finalVoltages": dual[-1, 1:].tolist()},
              "artifacts": {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in [
                  "software-hello-reference.json", "ngspice-rc-charge.csv", "ngspice-dual-rc-source.cir"]}}
    (output / "provenance.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Official ASE/FiPy/ngspice examples and 5 comparison cases written to {output}")


if __name__ == "__main__":
    main()
