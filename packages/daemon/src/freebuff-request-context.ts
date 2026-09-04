import { AsyncLocalStorage } from "node:async_hooks";

export type FreebuffRequestContext = {
  instanceId: string;
  traceSessionId?: string;
  reasoningEffort?: string;
};

const requestContext = new AsyncLocalStorage<FreebuffRequestContext>();
let installed = false;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function withSessionMetadata(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): RequestInit | undefined {
  const context = requestContext.getStore();
  if (!context || !init || typeof init.body !== "string") return init;
  let url: URL;
  try {
    url = new URL(requestUrl(input));
  } catch {
    return init;
  }
  if (!url.pathname.endsWith("/api/v1/chat/completions")) return init;
  try {
    const body: unknown = JSON.parse(init.body);
    if (!body || typeof body !== "object" || Array.isArray(body)) return init;
    const record = body as Record<string, unknown>;
    const metadata = record.codebuff_metadata;
    record.codebuff_metadata = {
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
      ...(context.traceSessionId ? { trace_session_id: context.traceSessionId } : {}),
      ...(context.reasoningEffort ? { freebuff_reasoning_effort: context.reasoningEffort } : {}),
      freebuff_instance_id: context.instanceId,
    };
    return { ...init, body: JSON.stringify(record) };
  } catch {
    return init;
  }
}

/** Published SDK predates extraCodebuffMetadata; stamp session id onto chat completions. */
export function installFreebuffFetchMetadataBridge(): void {
  if (installed) return;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    return originalFetch(input, withSessionMetadata(input, init));
  }) as typeof fetch;
  installed = true;
}

export function withFreebuffRequestContext<T>(
  context: FreebuffRequestContext,
  operation: () => Promise<T> | T,
): Promise<T> | T {
  installFreebuffFetchMetadataBridge();
  return requestContext.run(context, operation);
}
