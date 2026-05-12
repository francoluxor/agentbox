import { execa, type Result } from 'execa';

export interface DockerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function dockerInfo(): Promise<void> {
  const result: Result = await execa('docker', ['info'], { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(
      `docker info failed (exit ${String(result.exitCode)}). Is the Docker daemon running?\n${String(result.stderr)}`,
    );
  }
}

export interface RunBoxSpec {
  name: string;
  image: string;
  lowerPath: string;
  upperVolume: string;
  nodeModulesVolume: string;
  extraVolumes?: string[];
  env?: Record<string, string>;
}

export async function runBox(spec: RunBoxSpec): Promise<string> {
  const args: string[] = [
    'run',
    '-d',
    '--name',
    spec.name,
    '--hostname',
    spec.name,
    '--cap-add=SYS_ADMIN',
    '--device=/dev/fuse',
    '--security-opt=apparmor:unconfined',
    '-v',
    `${spec.lowerPath}:/host-src:ro`,
    '-v',
    `${spec.upperVolume}:/upper`,
    '-v',
    `${spec.nodeModulesVolume}:/workspace/node_modules`,
  ];
  for (const v of spec.extraVolumes ?? []) {
    args.push('-v', v);
  }
  for (const [k, val] of Object.entries(spec.env ?? {})) {
    args.push('-e', `${k}=${val}`);
  }
  args.push(spec.image, 'sleep', 'infinity');

  const { stdout } = await execa('docker', args);
  return stdout.trim();
}

export async function execInBox(
  container: string,
  cmd: string[],
  opts: { user?: string } = {},
): Promise<DockerExecResult> {
  const args: string[] = ['exec'];
  if (opts.user) args.push('--user', opts.user);
  args.push(container, ...cmd);
  const result = await execa('docker', args, { reject: false });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export async function removeBox(container: string): Promise<void> {
  await execa('docker', ['rm', '-f', container], { reject: false });
}

export async function containerExists(name: string): Promise<boolean> {
  const result = await execa(
    'docker',
    ['container', 'inspect', '--format', '{{.Id}}', name],
    { reject: false },
  );
  return result.exitCode === 0;
}

export async function volumeExists(name: string): Promise<boolean> {
  const result = await execa('docker', ['volume', 'inspect', name], { reject: false });
  return result.exitCode === 0;
}

export async function ensureVolume(name: string): Promise<void> {
  if (await volumeExists(name)) return;
  await execa('docker', ['volume', 'create', name]);
}

