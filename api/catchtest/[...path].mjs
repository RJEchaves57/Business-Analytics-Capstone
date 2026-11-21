export function GET(request) {
  return Response.json({ method: 'GET', path: new URL(request.url).pathname });
}

export async function POST(request) {
  return Response.json({ method: 'POST', path: new URL(request.url).pathname, body: await request.text() });
}
