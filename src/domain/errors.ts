import type { ErrorCode, ErrorDetail } from '@secure-sections/shared';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail | undefined;
  constructor(code: ErrorCode, detail?: ErrorDetail) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail;
  }
}
