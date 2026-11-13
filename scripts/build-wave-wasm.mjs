// Verify that the consumed W-Sim WASM artifact matches the locally vendored
// source crate. WaveWorld consumes the built module from @w-sim/solvers-lbm;
// it does not rebuild W-Sim-owned solver packages.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'package.json'));
const packageEntry = require.resolve('@w-sim/solvers-lbm/d3q19');
const target = resolve(dirname(packageEntry), 'wasm-kernel.js');
const checker = resolve(root, 'vendor/w-sim-kernels/wasm/build-kernels.mjs');
execFileSync(process.execPath, [checker, '--target', target, '--check'], { cwd: root, stdio: 'inherit', timeout: 120000 });
