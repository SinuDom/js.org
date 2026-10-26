// Checks a 3-digit code against the private authenticator before a room can be started.
// Env: AUTHENTICATOR_URL, AUTHENTICATOR_SERVICE, AUTHENTICATOR_API_KEY
export default async (req, context) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let code;
  try {
    ({ code } = await req.json());
  } catch {
    return Response.json({ valid: false, reason: 'bad_json' }, { status: 400 });
  }

  const { AUTHENTICATOR_URL, AUTHENTICATOR_SERVICE, AUTHENTICATOR_API_KEY } = process.env;
  if (!AUTHENTICATOR_URL || !AUTHENTICATOR_SERVICE || !AUTHENTICATOR_API_KEY) {
    return Response.json({ valid: false, reason: 'not_configured' }, { status: 503 });
  }

  let res;
  try {
    res = await fetch(AUTHENTICATOR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${AUTHENTICATOR_API_KEY}`,
      },
      body: JSON.stringify({
        service: AUTHENTICATOR_SERVICE,
        code: String(code ?? ''),
        subject: context.ip,
      }),
    });
  } catch {
    return Response.json({ valid: false, reason: 'unreachable' }, { status: 502 });
  }

  const { valid = false, reason, retryAfterMs } = await res.json().catch(() => ({}));
  return Response.json(
    { valid, reason, retryAfterMs },
    { status: valid ? 200 : res.status === 429 ? 429 : 401 },
  );
};

export const config = { path: '/api/check-code' };
