import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentBuildProvenance {
  agentBuildId: string;
  dependencyLockSha256: string;
  modelImplementationSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

function digestFiles(files: Array<{ name: string; path: string }>): string {
  const hash = createHash('sha256');
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(`${file.name}\0`, 'utf8');
    hash.update(fs.readFileSync(file.path));
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex');
}

/**
 * Resolve digests from the bytes this process executes and its exact dependency
 * lock. An explicit deployment build id is mandatory in production; development
 * gets a visibly local id derived from the same source digest.
 */
export function resolveAgentBuildProvenance(): AgentBuildProvenance {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const agentRoot = path.resolve(here, '..');
  const sourceFiles = [
    { name: 'agent/src/path-experiment-runner.ts', path: path.join(here, 'path-experiment-runner.ts') },
    { name: 'src/lib/sim/photosensitization.ts', path: path.resolve(here, '../../../../src/lib/sim/photosensitization.ts') },
  ];
  const lockFiles = [{ name: 'agent/package-lock.json', path: path.join(agentRoot, 'package-lock.json') }];
  let implementation: string;
  let lock: string;
  let stampedBuildId: string | undefined;
  if (sourceFiles.every((file) => fs.existsSync(file.path)) && lockFiles.every((file) => fs.existsSync(file.path))) {
    implementation = digestFiles(sourceFiles);
    lock = digestFiles(lockFiles);
  } else {
    const candidates = [
      path.join(path.dirname(process.execPath), 'agent-build-provenance.json'),
      path.resolve(process.cwd(), 'agent-build-provenance.json'),
    ];
    const metadataPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!metadataPath) throw new Error('packaged Agent is missing agent-build-provenance.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Partial<AgentBuildProvenance>;
    implementation = metadata.modelImplementationSha256 ?? '';
    lock = metadata.dependencyLockSha256 ?? '';
    stampedBuildId = typeof metadata.agentBuildId === 'string' ? metadata.agentBuildId.trim() : undefined;
  }
  const explicitBuildId = process.env.WAVEWORLD_BUILD_ID ?? process.env.BUILD_ID ?? process.env.GIT_SHA;
  // A packaged bundle carries the build's stamped id in agent-build-provenance.json —
  // prefer it over a synthetic dev-* id when no runtime env override is set. A dev-*
  // stamped id still does not satisfy production: it marks a bundle built without a
  // deployment identity.
  const deployedBuildId = explicitBuildId?.trim() || (stampedBuildId && !stampedBuildId.startsWith('dev-') ? stampedBuildId : undefined);
  if (process.env.NODE_ENV === 'production' && !deployedBuildId) {
    throw new Error('production Agent requires WAVEWORLD_BUILD_ID, BUILD_ID, GIT_SHA, or a stamped agentBuildId in agent-build-provenance.json');
  }
  const agentBuildId = deployedBuildId || stampedBuildId || `dev-${implementation.slice(0, 16)}`;
  if (!SHA256.test(implementation) || !SHA256.test(lock)) throw new Error('failed to derive Agent SHA-256 provenance');
  return { agentBuildId, dependencyLockSha256: lock, modelImplementationSha256: implementation };
}
