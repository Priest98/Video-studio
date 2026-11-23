// Oyinca integration boundary.
//
// IMPORTANT: Oyinca today authenticates users with JWTs and its media `register` endpoint only accepts
// files already inside its own Vercel Blob storage. It has no partner OAuth or API-key surface yet.
// `HttpOyincaClient` therefore targets the PROPOSED contract in docs/oyinca-integration.md. Do not point
// it at production until Oyinca implements that contract; the paths below are configuration, not facts.
//
// By design there is no publish method here. The Studio can only submit into Oyinca's approval queue.

export interface OyincaAccount {
  brandId: string;
  accountId: string;
  platform: string;
  handle?: string;
  canSubmit: boolean;
}

export interface SubmitClipRequest {
  idempotencyKey: string;
  brandId: string;
  accountId: string;
  videoUrl: string; // short-lived signed URL
  filename: string;
  mimeType: "video/mp4";
  sizeBytes: number;
  title?: string;
  caption?: string;
  thumbnailUrl?: string;
  suggestedPublishAt?: string; // a suggestion only; Oyinca's scheduling and approval decide
}

export interface SubmitClipResult {
  assetId: string;
  state: "awaiting_approval";
}

export interface OyincaClient {
  listAccounts(): Promise<OyincaAccount[]>;
  submitClip(req: SubmitClipRequest): Promise<SubmitClipResult>;
}

/** Credentials rejected or expired: stop retrying and ask the user to reconnect. */
export class OyincaAuthError extends Error {}
/** Network, 5xx or rate-limit: safe to retry with the same idempotency key. */
export class OyincaTransientError extends Error {}
/** Oyinca refused the request (validation, permission, quota). Retrying will not help. */
export class OyincaRejectedError extends Error {}

export const PROPOSED_PATHS = {
  accounts: "/partner/v1/accounts",
  submit: "/partner/v1/approval-queue/submissions",
};

export class HttpOyincaClient implements OyincaClient {
  private baseUrl: string;
  private getToken: () => Promise<string>;
  private paths: typeof PROPOSED_PATHS;
  private fetchImpl: typeof fetch;

  constructor(
    baseUrl: string,
    getToken: () => Promise<string>,
    paths: typeof PROPOSED_PATHS = PROPOSED_PATHS,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl;
    this.getToken = getToken;
    this.paths = paths;
    this.fetchImpl = fetchImpl;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${await this.getToken()}`, ...(init.headers ?? {}) },
      });
    } catch (e) {
      throw new OyincaTransientError(`network error: ${(e as Error).message}`);
    }
    if (res.status === 401) throw new OyincaAuthError("Oyinca rejected the credentials");
    if (res.status === 403) throw new OyincaRejectedError("Not permitted for this account");
    if (res.status === 429 || res.status >= 500) throw new OyincaTransientError(`Oyinca returned ${res.status}`);
    if (!res.ok) throw new OyincaRejectedError(`Oyinca returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  listAccounts() {
    return this.call<OyincaAccount[]>(this.paths.accounts);
  }

  submitClip(req: SubmitClipRequest) {
    const { idempotencyKey, ...body } = req;
    return this.call<SubmitClipResult>(this.paths.submit, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
  }
}
