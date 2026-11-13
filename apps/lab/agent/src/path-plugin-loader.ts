import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentBuildProvenance } from './build-provenance.ts';
import {
  PathModelRegistry,
  createDefaultPathModelRegistry,
  type PathModelAdapter,
  type PathModelManifest,
} from './path-experiment-runner.ts';

export const PATH_MODEL_PLUGIN_PROTOCOL = 'waveworld.path-model-plugin/v1' as const;
export const PATH_MODEL_PLUGIN_MANIFEST = 'waveworld-path-plugin.json' as const;

export interface PathModelPluginDescriptorV1 {
  protocol: typeof PATH_MODEL_PLUGIN_PROTOCOL;
  entry: string;
  files: string[];
  implementationSha256: string;
  dependencyLockSha256?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

/** Digest an explicitly declared, sorted file set so undeclared directory noise is irrelevant. */
export function calculatePluginImplementationSha256(pluginDir: string, files: string[]): string {
  if (!Array.isArray(files) || files.length === 0) throw new Error('plugin files must be a non-empty array');
  const unique = [...new Set(files)].sort();
  if (unique.length !== files.length) throw new Error('plugin files contain duplicates');
  const hash = createHash('sha256');
  for (const relative of unique) {
    const absolute = resolvePluginFile(pluginDir, relative);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`plugin file must be a regular file: ${relative}`);
    hash.update(`${relative}\0`, 'utf8');
    hash.update(fs.readFileSync(absolute));
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex');
}

export async function createAgentPathModelRegistry(
  build: AgentBuildProvenance,
  pluginRoot = process.env.WAVEWORLD_PATH_PLUGIN_DIR,
): Promise<PathModelRegistry> {
  const registry = createDefaultPathModelRegistry();
  const withIdentity = new PathModelRegistry();
  for (const manifest of registry.manifests()) {
    const adapter = registry.resolve(manifest.id, manifest.version);
    withIdentity.register(adapter, {
      source: 'builtin',
      implementationSha256: build.modelImplementationSha256,
      dependencyLockSha256: build.dependencyLockSha256,
    });
  }
  if (pluginRoot?.trim()) await loadExternalPlugins(withIdentity, path.resolve(pluginRoot));
  return withIdentity.freeze();
}

export function pathModelCapabilities(registry: PathModelRegistry): Array<PathModelManifest & { implementationSha256: string }> {
  return registry.manifests().map((manifest) => {
    const identity = registry.identity(manifest.id, manifest.version);
    if (!identity) throw new Error(`path model lacks implementation identity: ${manifest.id}@${manifest.version}`);
    return { ...manifest, backends: [...manifest.backends], implementationSha256: identity.implementationSha256 };
  });
}

async function loadExternalPlugins(registry: PathModelRegistry, root: string): Promise<void> {
  const rootStat = fs.statSync(root);
  if (!rootStat.isDirectory()) throw new Error(`WAVEWORLD_PATH_PLUGIN_DIR is not a directory: ${root}`);
  const directories = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(root, entry.name)).sort();
  for (const pluginDir of directories) {
    const descriptorPath = path.join(pluginDir, PATH_MODEL_PLUGIN_MANIFEST);
    if (!fs.existsSync(descriptorPath)) continue;
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) as Partial<PathModelPluginDescriptorV1>;
    validateDescriptor(descriptor, pluginDir);
    const digest = calculatePluginImplementationSha256(pluginDir, descriptor.files);
    if (digest !== descriptor.implementationSha256) throw new Error(`path plugin integrity mismatch: ${path.basename(pluginDir)}`);
    const entry = resolvePluginFile(pluginDir, descriptor.entry);
    if (!descriptor.files.includes(descriptor.entry)) throw new Error('plugin entry must be included in files');
    const imported = await import(pathToFileURL(entry).href);
    const adapter = (imported.pathModelPlugin ?? imported.default) as PathModelAdapter | undefined;
    if (!adapter || typeof adapter.run !== 'function' || !adapter.manifest) {
      throw new Error(`path plugin does not export a PathModelAdapter: ${path.basename(pluginDir)}`);
    }
    registry.register(adapter, {
      source: 'external',
      implementationSha256: digest,
      ...(descriptor.dependencyLockSha256 ? { dependencyLockSha256: descriptor.dependencyLockSha256 } : {}),
    });
  }
}

function validateDescriptor(
  value: Partial<PathModelPluginDescriptorV1>,
  pluginDir: string,
): asserts value is PathModelPluginDescriptorV1 {
  if (value.protocol !== PATH_MODEL_PLUGIN_PROTOCOL) throw new Error(`unsupported path plugin protocol in ${pluginDir}`);
  if (typeof value.entry !== 'string' || !value.entry.trim()) throw new Error('plugin entry is required');
  if (!Array.isArray(value.files) || value.files.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('plugin files are invalid');
  if (typeof value.implementationSha256 !== 'string' || !SHA256.test(value.implementationSha256)) throw new Error('plugin implementationSha256 must be lowercase SHA-256');
  if (value.dependencyLockSha256 !== undefined && !SHA256.test(value.dependencyLockSha256)) throw new Error('plugin dependencyLockSha256 must be lowercase SHA-256');
}

function resolvePluginFile(pluginDir: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error(`invalid plugin file path: ${relative}`);
  const absolute = path.resolve(pluginDir, relative);
  const prefix = `${path.resolve(pluginDir)}${path.sep}`;
  if (!absolute.startsWith(prefix)) throw new Error(`plugin file escapes its directory: ${relative}`);
  return absolute;
}
