export default {
  fetch(_request: Request): Response {
    return Response.json({ ok: true });
  },
};
