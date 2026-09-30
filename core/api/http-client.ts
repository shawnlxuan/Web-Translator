import { ProviderError } from './provider-interface';
import type { ProviderProtocol } from '../../shared/types';
import {
  buildProviderEndpointUrl,
  describeProviderEndpoint,
} from '../../shared/provider-presets';

export interface ProviderFetchOptions {
  providerName: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
}

export class ProviderNetworkError extends Error {
  readonly statusCode = 0;
  readonly isNetworkError = true;

  constructor(
    providerName: string,
    endpoint: string,
    readonly reason: 'network' | 'timeout',
    cause?: unknown,
  ) {
    const target = describeProviderEndpoint(endpoint);
    const message = reason === 'timeout'
      ? `${providerName} 请求 ${target} 超时，请检查接口地址、代理或网络后重试。`
      : `${providerName} 无法连接 ${target}，请检查接口地址、代理、DNS、证书、跨域配置或网络。`;
    super(message, { cause });
    this.name = 'ProviderNetworkError';
  }
}

export async function fetchProviderResponse(
  endpoint: string,
  path: string,
  protocol: ProviderProtocol,
  init: RequestInit,
  options: ProviderFetchOptions,
): Promise<Response> {
  const url = buildProviderEndpointUrl(endpoint, path, protocol);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let timedOut = false;
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const cleanup = () => {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  };
  const normalizeError = (error: unknown): Error => {
    if (externalSignal?.aborted) return new DOMException('Translation cancelled', 'AbortError');
    timedOut = controller.signal.aborted;
    return new ProviderNetworkError(options.providerName, endpoint, timedOut ? 'timeout' : 'network', error);
  };

  try {
    if (externalSignal?.aborted) throw externalSignal.reason;
    const response = await (options.fetcher ?? fetch)(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.body) { cleanup(); return response; }
    const reader = response.body.getReader();
    let finished = false;
    let wrappedController: ReadableStreamDefaultController<Uint8Array>;
    const stop = () => {
      if (finished) return;
      finished = true;
      cleanup();
      controller.signal.removeEventListener('abort', abortBody);
    };
    const abortBody = () => {
      if (finished) return;
      wrappedController.error(normalizeError(controller.signal.reason));
      stop();
      void reader.cancel().catch(() => {});
    };
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        wrappedController = streamController;
        controller.signal.addEventListener('abort', abortBody, { once: true });
        if (controller.signal.aborted) abortBody();
      },
      async pull(streamController) {
        try {
          const result = await reader.read();
          if (finished) return;
          if (result.done) { stop(); streamController.close(); }
          else streamController.enqueue(result.value);
        } catch (error) {
          if (!finished) { streamController.error(normalizeError(error)); stop(); }
        }
      },
      async cancel() { stop(); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    cleanup();
    throw normalizeError(error);
  }
}

export async function createProviderErrorFromResponse(
  providerName: string,
  response: Response,
): Promise<ProviderError> {
  const body = await response.text().catch(() => '');
  return new ProviderError(
    providerName,
    response.status,
    sanitizeProviderErrorDetails(body || response.statusText),
  );
}

export function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof ProviderNetworkError
    || (
      typeof error === 'object'
      && error !== null
      && (error as { isNetworkError?: unknown }).isNetworkError === true
    );
}

function sanitizeProviderErrorDetails(details: string): string {
  return details
    .replace(/https?:\/\/[^\s"',}]+/gi, (value) => {
      try {
        const url = new URL(value);
        url.search = '';
        url.hash = '';
        return url.toString();
      } catch {
        return value;
      }
    })
    .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
    .replace(
      /("(?:api[_-]?key|authorization|token)"\s*:\s*")[^"]*(")/gi,
      '$1[redacted]$2',
    )
    .replace(/((?:api[_-]?key|authorization|token)=)[^&\s"',}]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}
