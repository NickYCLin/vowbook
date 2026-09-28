import http from "node:http";
import https from "node:https";
import { describe, expect, it } from "vitest";
import {
  DNS_FRESH_TTL_MS,
  DNS_STALE_TTL_MS,
  createResilientLookup,
  installResilientDns,
} from "@/lib/resilient-dns";

type LookupResult = { address: string; family: number };

function transientError(): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    "getaddrinfo EAI_AGAIN accounts.google.com",
  );
  error.code = "EAI_AGAIN";
  return error;
}

function fakeLookup(outcomes: Array<LookupResult | NodeJS.ErrnoException>) {
  const calls: string[] = [];
  let index = 0;
  const lookup = (
    hostname: string,
    _options: unknown,
    callback: (
      error: NodeJS.ErrnoException | null,
      address?: string,
      family?: number,
    ) => void,
  ) => {
    calls.push(hostname);
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    if (outcome instanceof Error) {
      callback(outcome);
      return;
    }
    callback(null, outcome.address, outcome.family);
  };
  return { lookup, calls };
}

function resolve(
  lookup: ReturnType<typeof createResilientLookup>,
  hostname = "accounts.google.com",
): Promise<LookupResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    lookup(hostname, { family: 4 }, (error, address, family) => {
      if (error) rejectPromise(error);
      else resolvePromise({ address: address as string, family: family as number });
    });
  });
}

describe("resilient dns lookup", () => {
  it("retries a transient failure before giving up", async () => {
    const { lookup, calls } = fakeLookup([
      transientError(),
      transientError(),
      { address: "142.250.0.1", family: 4 },
    ]);
    const resilient = createResilientLookup({ lookup, attempts: 3 });
    await expect(resolve(resilient)).resolves.toEqual({
      address: "142.250.0.1",
      family: 4,
    });
    expect(calls).toHaveLength(3);
  });

  it("answers from cache while the entry is still fresh", async () => {
    let now = 1_000;
    const { lookup, calls } = fakeLookup([{ address: "142.250.0.1", family: 4 }]);
    const resilient = createResilientLookup({ lookup, now: () => now });
    await resolve(resilient);
    now += DNS_FRESH_TTL_MS - 1;
    await expect(resolve(resilient)).resolves.toEqual({
      address: "142.250.0.1",
      family: 4,
    });
    expect(calls).toHaveLength(1);
  });

  it("falls back to the last known address when the network goes quiet", async () => {
    let now = 1_000;
    const outcomes: Array<LookupResult | NodeJS.ErrnoException> = [
      { address: "142.250.0.1", family: 4 },
    ];
    const { lookup } = fakeLookup(outcomes);
    const resilient = createResilientLookup({ lookup, now: () => now, attempts: 2 });
    await resolve(resilient);
    outcomes.push(transientError());
    now += DNS_FRESH_TTL_MS + 1;
    await expect(resolve(resilient)).resolves.toEqual({
      address: "142.250.0.1",
      family: 4,
    });
  });

  it("stops serving a stale address once it is too old", async () => {
    let now = 1_000;
    const outcomes: Array<LookupResult | NodeJS.ErrnoException> = [
      { address: "142.250.0.1", family: 4 },
    ];
    const { lookup } = fakeLookup(outcomes);
    const resilient = createResilientLookup({ lookup, now: () => now, attempts: 1 });
    await resolve(resilient);
    outcomes.push(transientError());
    now += DNS_STALE_TTL_MS + 1;
    await expect(resolve(resilient)).rejects.toMatchObject({ code: "EAI_AGAIN" });
  });

  it("keeps a permanent failure permanent instead of retrying it", async () => {
    const missing: NodeJS.ErrnoException = new Error("getaddrinfo ENOTFOUND nope");
    missing.code = "ENOTFOUND";
    const { lookup, calls } = fakeLookup([missing]);
    const resilient = createResilientLookup({ lookup, attempts: 3 });
    await expect(resolve(resilient, "nope.invalid")).rejects.toMatchObject({
      code: "ENOTFOUND",
    });
    expect(calls).toHaveLength(1);
  });

  it("does not cache across different address families", async () => {
    const { lookup, calls } = fakeLookup([
      { address: "142.250.0.1", family: 4 },
      { address: "2404::1", family: 6 },
    ]);
    const resilient = createResilientLookup({ lookup });
    await resolve(resilient);
    await new Promise<void>((done) => {
      resilient("accounts.google.com", { family: 6 }, () => done());
    });
    expect(calls).toHaveLength(2);
  });

  it("retries and caches the multi-address lookups Node uses to connect", async () => {
    let now = 1_000;
    const addresses = [{ address: "142.250.0.1", family: 4 }];
    let calls = 0;
    let failNext = false;
    const resilient = createResilientLookup({
      now: () => now,
      attempts: 2,
      lookup: (_hostname, _options, callback) => {
        calls += 1;
        if (failNext) {
          (callback as (error: NodeJS.ErrnoException) => void)(transientError());
          return;
        }
        (callback as (error: null, result: unknown) => void)(null, addresses);
      },
    });
    const all = () =>
      new Promise<unknown>((done, rejectPromise) => {
        resilient("accounts.google.com", { all: true }, (error, result) => {
          if (error) rejectPromise(error);
          else done(result);
        });
      });

    await expect(all()).resolves.toEqual(addresses);
    await expect(all()).resolves.toEqual(addresses);
    expect(calls).toBe(1);

    now += DNS_FRESH_TTL_MS + 1;
    failNext = true;
    await expect(all()).resolves.toEqual(addresses);
    expect(calls).toBe(3);
  });

});

describe("installing the resilient lookup", () => {
  it("puts the lookup on the agents that NextAuth ends up using", () => {
    installResilientDns();
    const agents = [http.globalAgent, https.globalAgent] as unknown as Array<{
      options: { lookup?: unknown };
    }>;
    for (const agent of agents) {
      expect(typeof agent.options.lookup).toBe("function");
    }
  });
});
