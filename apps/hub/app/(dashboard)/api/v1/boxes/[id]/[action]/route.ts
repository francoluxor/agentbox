// POST /api/v1/boxes/:id/:action — lifecycle: pause | resume | stop | destroy.
// Mutations need the in-process host backend; the Postgres/plane path 503s (hosted
// writes are a documented follow-up).
import { backendOrNull } from '../../../lib/backend';
import { fail, failFromAction, ok } from '../../../lib/envelope';
import { isLifecycleAction } from '../../../lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; action: string }> },
): Promise<Response> {
  const { id, action } = await ctx.params;
  if (!isLifecycleAction(action)) {
    return fail('invalid_request', `unknown action: ${action}`, { allowed: ['pause', 'resume', 'stop', 'destroy'] });
  }
  const backend = backendOrNull();
  if (!backend) return fail('backend_unavailable', 'hub backend unavailable (run the hub server)');

  const res = await backend[action](id);
  if (!res.ok) return failFromAction(res.error);
  return ok({ ok: true });
}
