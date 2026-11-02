import type {
  ErrorCode,
  ErrorDetail,
  RequestOf,
  ResolverFunction,
  ResponseOf,
} from '@secure-sections/shared';

/**
 * Typed bridge to the Forge resolver. The UI never sends identity, page or section identifiers
 * as authority: the server derives them from the signed Forge context.
 */
export interface Api {
  call<K extends ResolverFunction>(fn: K, payload?: RequestOf<K>): Promise<ResponseOf<K>>;
}

export const forgeApi: Api = {
  async call(fn, payload) {
    const { invoke } = await import('@forge/bridge');
    return (await invoke(fn, (payload ?? {}) as Record<string, unknown>)) as never;
  },
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail | undefined;
  constructor(code: ErrorCode, detail?: ErrorDetail) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

export type Wrapped<T> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; detail?: ErrorDetail };

export function unwrap<T>(res: Wrapped<T>): T {
  if (res.ok) return res.data;
  throw new ApiError(res.code, res.detail);
}

export async function safeCall<K extends ResolverFunction>(
  api: Api,
  fn: K,
  payload?: RequestOf<K>,
): Promise<ResponseOf<K> | { ok: false; code: 'UNAVAILABLE' }> {
  try {
    return await api.call(fn, payload);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
