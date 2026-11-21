export default function handler(_req: unknown, res: { status(code: number): unknown; setHeader(name: string, value: string): unknown; end(body?: unknown): unknown }): void {
  res.status(200);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
}
