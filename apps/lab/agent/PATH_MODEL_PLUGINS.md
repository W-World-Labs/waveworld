# Runtime path-model plugins

The Agent can discover third-party path models at startup without rebuilding the
Agent binary. Set `WAVEWORLD_PATH_PLUGIN_DIR` to a directory whose immediate
subdirectories are plugin packages. The registry is loaded once, integrity
checked, and frozen before capabilities are advertised or jobs are claimed.
The same registry instance is used for both operations.

Each package contains `waveworld-path-plugin.json` and an ESM entrypoint:

```json
{
  "protocol": "waveworld.path-model-plugin/v1",
  "entry": "plugin.mjs",
  "files": ["plugin.mjs", "solver.mjs", "package-lock.json"],
  "implementationSha256": "<lowercase SHA-256 over the declared files>",
  "dependencyLockSha256": "<optional lowercase SHA-256>"
}
```

The entrypoint exports either `default` or `pathModelPlugin`, implementing the
`PathModelAdapter` contract: a validated `manifest` plus a `run(input)` method.
All executable modules and data that affect results must be listed in `files`.
Paths are package-relative; absolute paths, directory escapes, symlinks,
duplicate files, digest mismatches, duplicate `id@version`, and malformed
manifests fail Agent startup. This fail-closed behavior prevents an Agent from
advertising code different from the code it will execute.

The implementation digest is calculated by sorting declared paths and hashing,
for every file, `relativePath + NUL + bytes + NUL`. The helper
`calculatePluginImplementationSha256` in `src/path-plugin-loader.ts` implements
the canonical algorithm and can be called by packaging tooling.

Example entrypoint:

```js
export default {
  manifest: {
    id: 'my-model', version: '1.0.0', backends: ['cpu'],
    parameters: { alpha: { type: 'number', required: true, min: 0 } },
    outputs: { score: { type: 'number' } }
  },
  run({ parameters, maxSteps }) {
    return { steps: maxSteps, metrics: { score: Number(parameters.alpha) } };
  }
};
```

Restart the Agent after installing or removing a package. Hot reload is
intentionally unsupported: a running process keeps one immutable registry so a
capability update cannot race with job execution.
