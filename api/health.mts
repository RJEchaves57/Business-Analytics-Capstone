export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

export function GET(): Response {
  return Response.json({ ok: true, node: process.version });
}
