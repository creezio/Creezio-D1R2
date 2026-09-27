/** Only a received provider HTTP response can prove rejection before creation. */
export class ProviderTransportError extends Error {
  readonly outcome:'rejected'|'unknown';
  readonly code:'provider_rejected'|'provider_rate_limited'|'provider_unavailable';
  constructor(outcome:'rejected'|'unknown',
    code:'provider_rejected'|'provider_rate_limited'|'provider_unavailable'){
    super(code);
    this.name='ProviderTransportError';
    this.outcome=outcome;
    this.code=code;
  }
}
