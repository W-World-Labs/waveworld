"""Optional external reference check; never installed or run by the normal CI suite.

Use a separate environment with the LAMMPS Python package and its MPI libraries.
Example: python scripts/research/lammps-hello.py --output /tmp/lammps-reference.json
"""
import argparse
import json
import math
from pathlib import Path

from lammps import lammps

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[2] / "public/datasets/lammps-lj-2d.data")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
data_path = str(args.data.resolve())
if any(char in data_path for char in ['"', "\n", "\r"]):
    parser.error("data path cannot contain quotes or line breaks")

with lammps(cmdargs=["-screen", "none", "-log", "none"]) as solver:
    solver.commands_list([
        "units lj", "dimension 2", "atom_style atomic", "boundary p p p",
        "pair_style lj/cut 2.5", f'read_data "{data_path}"',
        "pair_modify shift yes mix arithmetic", "timestep 0.005",
        "fix integrate all nve", "fix planar all enforce2d",
        "compute_modify thermo_temp extra/dof 0",
        "thermo_style custom step atoms temp pe ke etotal press",
        "thermo_modify norm no", "thermo 1", "run 5",
    ])
    count = solver.get_natoms()
    pos = solver.gather_atoms("x", 1, 3)
    vel = solver.gather_atoms("v", 1, 3)
    result = {
        "steps": 5, "atoms": count, "version": solver.version(),
        "positions": [pos[3 * i + d] for i in range(count) for d in range(2)],
        "speeds": [math.hypot(vel[3 * i], vel[3 * i + 1]) for i in range(count)],
        **{key: solver.get_thermo(name) for key, name in [
            ("potential", "pe"), ("kinetic", "ke"), ("total", "etotal"),
            ("temperature", "temp"), ("pressure", "press"),
        ]},
    }
with args.output.open("x") as output:
    json.dump(result, output, indent=2)
    output.write("\n")
print(f"Wrote {count} atoms / 5 steps to {args.output}")
