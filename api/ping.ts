export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

export function GET(): Response {
  return Response.json({ method: 'GET', ok: true });
}

export async function POST(request: Request): Promise<Response> {
  return Response.json({ method: 'POST', ok: true, body: await request.text() });
}
