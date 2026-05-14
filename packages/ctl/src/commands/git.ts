import { Command } from 'commander';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

interface GitRpcResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CommonOptions {
  remote?: string;
  cwd?: string;
}

async function rpc(method: 'git.pull' | 'git.push', opts: CommonOptions, extra: string[]): Promise<number> {
  const urlStr = process.env.AGENTBOX_RELAY_URL;
  const token = process.env.AGENTBOX_RELAY_TOKEN;
  if (!urlStr || !token) {
    process.stderr.write(
      'agentbox-ctl git: AGENTBOX_RELAY_URL / AGENTBOX_RELAY_TOKEN not set; no relay configured for this box.\n',
    );
    return 65;
  }
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    process.stderr.write(`agentbox-ctl git: invalid AGENTBOX_RELAY_URL: ${urlStr}\n`);
    return 65;
  }

  const params: Record<string, unknown> = {
    path: opts.cwd ?? process.cwd(),
  };
  if (opts.remote) params.remote = opts.remote;
  if (extra.length > 0) params.args = extra;

  const body = JSON.stringify({ method, params });
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? httpsRequest : httpRequest;
  const port = url.port.length > 0 ? Number.parseInt(url.port, 10) : isHttps ? 443 : 80;

  return new Promise<number>((resolve) => {
    const req = transport(
      {
        host: url.hostname,
        port,
        method: 'POST',
        path: `${url.pathname.replace(/\/$/, '')}/rpc`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: GitRpcResult | null = null;
          try {
            parsed = JSON.parse(text) as GitRpcResult;
          } catch {
            parsed = null;
          }
          if (parsed && typeof parsed.exitCode === 'number') {
            if (parsed.stdout) process.stdout.write(parsed.stdout);
            if (parsed.stderr) process.stderr.write(parsed.stderr);
            resolve(parsed.exitCode);
            return;
          }
          process.stderr.write(`agentbox-ctl git: relay returned ${String(status)}: ${text}\n`);
          resolve(status >= 200 && status < 300 ? 0 : 1);
        });
      },
    );
    req.on('error', (err) => {
      process.stderr.write(`agentbox-ctl git: ${String(err.message ?? err)}\n`);
      resolve(126);
    });
    req.write(body);
    req.end();
  });
}

export const gitCommand = new Command('git')
  .description('Git operations that need host credentials (routed through the agentbox relay)')
  .addCommand(
    new Command('pull')
      .description('Run `git pull` on the host worktree for this box')
      .option('--remote <name>', 'remote name (default: origin)')
      .option('--cwd <path>', 'path inside the container identifying which worktree to use')
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .argument('[args...]', 'additional args forwarded to git pull')
      .action(async (args: string[], opts: CommonOptions) => {
        const code = await rpc('git.pull', opts, args);
        process.exit(code);
      }),
  )
  .addCommand(
    new Command('push')
      .description('Run `git push` on the host worktree for this box')
      .option('--remote <name>', 'remote name (default: origin)')
      .option('--cwd <path>', 'path inside the container identifying which worktree to use')
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .argument('[args...]', 'additional args forwarded to git push')
      .action(async (args: string[], opts: CommonOptions) => {
        const code = await rpc('git.push', opts, args);
        process.exit(code);
      }),
  );
