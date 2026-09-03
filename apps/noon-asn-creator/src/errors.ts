export type AsnErrorKind =
  | "input"
  | "configuration"
  | "authentication"
  | "http"
  | "network"
  | "timeout"
  | "contract"
  | "verification"
  | "workbook"
  | "browser"
  | "journal";

export interface AsnErrorOptions {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class AsnCreatorError extends Error {
  readonly name = "AsnCreatorError";
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly kind: AsnErrorKind,
    readonly retryable: boolean,
    readonly stage: string,
    message: string,
    options: AsnErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}
