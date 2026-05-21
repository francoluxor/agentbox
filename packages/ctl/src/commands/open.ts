import { Command } from 'commander';
import { postRpcAndExit } from '../relay-rpc.js';

interface OpenParams {
  url: string;
}

/**
 * Opens a URL in the *host's* default browser by routing through the relay
 * (`browser.open` RPC). The box has no real browser of its own; this is what
 * `xdg-open` and `$BROWSER` are wired to inside the image.
 */
export const openCommand = new Command('open')
  .description("Open a URL in the host's default browser (via the agentbox relay)")
  .argument('<url>', 'http(s) URL to open on the host')
  .action(async (url: string) => {
    const params: OpenParams = { url };
    const code = await postRpcAndExit('browser.open', params, {
      errorPrefix: 'agentbox-ctl open',
    });
    process.exit(code);
  });
