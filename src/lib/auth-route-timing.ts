type AuthRouteParams = {
  nextauth?: string[];
};

export type AuthRouteContext = {
  params: AuthRouteParams | Promise<AuthRouteParams>;
};

export type AuthRouteHandler = (
  request: Request,
  context: AuthRouteContext,
) => Promise<Response> | Response;

type TimingOptions = {
  logger?: (
    event: string,
    details: {
      durationMs: number;
      method: string;
      phase: string;
      status: number;
    },
  ) => void;
  now?: () => number;
};

const AUTH_PHASES = new Map([
  ["callback/google", "callback_google"],
  ["signin/google", "signin_google"],
  ["session", "session"],
  ["providers", "providers"],
  ["csrf", "csrf"],
  ["signout", "signout"],
]);

function roundDuration(durationMs: number): number {
  return Math.round(Math.max(0, durationMs) * 10) / 10;
}

function appendServerTiming(response: Response, value: string): Response {
  try {
    response.headers.append("Server-Timing", value);
    return response;
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    const headers = new Headers(response.headers);
    headers.append("Server-Timing", value);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

async function authPhase(context: AuthRouteContext): Promise<string> {
  const params = await context.params;
  const route = Array.isArray(params.nextauth)
    ? params.nextauth.slice(0, 2).join("/")
    : "";
  return AUTH_PHASES.get(route) ?? "other";
}

export function createTimedAuthHandler(
  handler: AuthRouteHandler,
  {
    logger = (event, details) => console.info(event, details),
    now = () => performance.now(),
  }: TimingOptions = {},
): AuthRouteHandler {
  return async (request, context) => {
    const startedAt = now();
    const phase = await authPhase(context);

    try {
      const response = await handler(request, context);
      const durationMs = roundDuration(now() - startedAt);
      const timedResponse = appendServerTiming(
        response,
        `vowbook_auth;dur=${durationMs};desc="${phase}"`,
      );
      logger("auth_timing", {
        durationMs,
        method: request.method,
        phase,
        status: timedResponse.status,
      });
      return timedResponse;
    } catch (error) {
      logger("auth_timing", {
        durationMs: roundDuration(now() - startedAt),
        method: request.method,
        phase,
        status: 500,
      });
      throw error;
    }
  };
}
