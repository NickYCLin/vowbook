import dns from "node:dns";
import http from "node:http";
import https from "node:https";

/** 位址在這段時間內直接用快取，不再打擾解析器。 */
export const DNS_FRESH_TTL_MS = 60_000;
/** 解析失敗時，最久可以沿用多久以前查到的位址。 */
export const DNS_STALE_TTL_MS = 30 * 60_000;
/** 單次查詢最多試幾輪。 */
export const DNS_ATTEMPTS = 3;

const TRANSIENT_CODES = new Set(["EAI_AGAIN", "ETIMEDOUT", "ECONNREFUSED"]);

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | unknown,
  family?: number,
) => void;

type LookupOptions = {
  family?: number;
  all?: boolean;
  [option: string]: unknown;
};

export type DnsLookup = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void;

type CacheEntry = {
  address: string | unknown;
  family: number | undefined;
  storedAt: number;
};

export type ResilientLookupOptions = {
  lookup?: DnsLookup;
  now?: () => number;
  attempts?: number;
  freshTtlMs?: number;
  staleTtlMs?: number;
};

function isTransient(error: NodeJS.ErrnoException): boolean {
  return TRANSIENT_CODES.has(error.code ?? "");
}

/**
 * 這台主機對外查 DNS 會掉封包，偶發的失敗就足以中斷一次 Google 登入。
 * 查到就記著、失敗時先重試、真的查不到再沿用上次的位址，讓登入不被一次抖動打斷。
 * Node 建立連線時會用 all 形式查詢，兩種查法都要照顧到。
 */
export function createResilientLookup(
  options: ResilientLookupOptions = {},
): DnsLookup {
  const underlying = options.lookup ?? (dns.lookup as unknown as DnsLookup);
  const now = options.now ?? (() => Date.now());
  const attempts = options.attempts ?? DNS_ATTEMPTS;
  const freshTtlMs = options.freshTtlMs ?? DNS_FRESH_TTL_MS;
  const staleTtlMs = options.staleTtlMs ?? DNS_STALE_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  return function resilientLookup(hostname, lookupOptions, callback) {
    const wantsAll = lookupOptions?.all === true;
    const key = `${hostname}|${lookupOptions?.family ?? 0}|${wantsAll ? "all" : "one"}`;
    const cached = cache.get(key);
    if (cached && now() - cached.storedAt < freshTtlMs) {
      callback(null, cached.address, cached.family);
      return;
    }

    let attempt = 0;
    const tryOnce = () => {
      attempt += 1;
      underlying(hostname, lookupOptions, (error, address, family) => {
        if (!error) {
          cache.set(key, { address, family, storedAt: now() });
          callback(null, address, family);
          return;
        }
        if (isTransient(error) && attempt < attempts) {
          tryOnce();
          return;
        }
        const fallback = cache.get(key);
        if (
          isTransient(error) &&
          fallback &&
          now() - fallback.storedAt < staleTtlMs
        ) {
          callback(null, fallback.address, fallback.family);
          return;
        }
        callback(error);
      });
    };
    tryOnce();
  };
}

let installed = false;

/** 掛到預設 agent 上，NextAuth 對 Google 的請求就會走這套解析。 */
export function installResilientDns(options: ResilientLookupOptions = {}): void {
  if (installed) return;
  installed = true;
  const lookup = createResilientLookup(options);
  // globalAgent 在型別上沒有公開 options，但這是 Node 實際用來建立連線的設定來源。
  const agents = [http.globalAgent, https.globalAgent] as unknown as Array<{
    options: { lookup?: DnsLookup };
  }>;
  for (const agent of agents) {
    agent.options.lookup = lookup;
  }
}
