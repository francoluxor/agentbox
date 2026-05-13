import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const DEFAULT_BOX_IMAGE = 'agentbox/box:dev';

const here = dirname(fileURLToPath(import.meta.url));
// src/ is one level under the package root at build/dev time; the Dockerfile
// sits at the package root next to package.json. The build *context* is the
// monorepo root because the image bakes in packages/ctl/dist/bin.js.
const PACKAGE_ROOT = resolve(here, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
export const DOCKERFILE_PATH = resolve(PACKAGE_ROOT, 'Dockerfile.box');
export const BUILD_CONTEXT_DIR = REPO_ROOT;

export async function imageExists(ref: string): Promise<boolean> {
  const result = await execa('docker', ['image', 'inspect', ref], { reject: false });
  return result.exitCode === 0;
}

export interface BuildImageOptions {
  ref?: string;
  dockerfile?: string;
  contextDir?: string;
  onProgress?: (line: string) => void;
}

export async function buildImage(opts: BuildImageOptions = {}): Promise<string> {
  const ref = opts.ref ?? DEFAULT_BOX_IMAGE;
  const dockerfile = opts.dockerfile ?? DOCKERFILE_PATH;
  const contextDir = opts.contextDir ?? BUILD_CONTEXT_DIR;

  const subprocess = execa('docker', ['build', '-t', ref, '-f', dockerfile, contextDir], {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (opts.onProgress) {
    const forward = (chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) opts.onProgress?.(line);
      }
    };
    subprocess.stdout?.on('data', forward);
    subprocess.stderr?.on('data', forward);
  }

  await subprocess;
  return ref;
}

export interface EnsureImageOptions {
  onProgress?: (line: string) => void;
  /** Dockerfile path. Defaults to `Dockerfile.box` next to this package. */
  dockerfile?: string;
  /** Build context directory. Defaults to the monorepo root. */
  contextDir?: string;
}

export async function ensureImage(
  ref: string = DEFAULT_BOX_IMAGE,
  opts: EnsureImageOptions = {},
): Promise<{ ref: string; built: boolean }> {
  if (await imageExists(ref)) {
    return { ref, built: false };
  }
  await buildImage({
    ref,
    dockerfile: opts.dockerfile,
    contextDir: opts.contextDir,
    onProgress: opts.onProgress,
  });
  return { ref, built: true };
}

/** Path to the relay Dockerfile (sits next to Dockerfile.box at the package root). */
export const RELAY_DOCKERFILE_PATH = resolve(PACKAGE_ROOT, 'Dockerfile.relay');
