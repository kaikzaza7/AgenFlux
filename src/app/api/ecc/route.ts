import type { IncomingMessage } from 'node:http';
import { publicEccCatalog, eccContents } from '../../../../server/ecc.ts';
import { localRequest } from '../../../../server/security.ts';
import { redact, redactValue } from '../../../../server/redact.ts';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { host: request.headers.get('host') ?? '', origin: request.headers.get('origin') ?? undefined };
  if (!localRequest({ headers } as IncomingMessage, Number(process.env.PORT ?? 3000))) return Response.json({ error: 'Acesso permitido somente pela origem local.' }, { status: 403 });
  try {
    const id = new URL(request.url).searchParams.get('id');
    return Response.json(id ? { id, content: redact(eccContents(id)) } : redactValue(publicEccCatalog()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
