/** Liveness endpoint used by the Docker healthcheck. */
export async function GET() {
  return Response.json({ status: 'ok' });
}
