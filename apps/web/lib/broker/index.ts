import "server-only";
import { MemoryBroker } from "./memory";
import type { SignalBroker } from "./types";

export * from "./types";

/**
 * Broker selection.
 *
 * M0a runs on MemoryBroker, which is correct for `next dev` and for a single
 * long-lived process. It is NOT correct on Vercel, where two SSE streams from
 * the same device can land on different function instances and would never see
 * each other's messages.
 *
 * Before the first real deployment (M2), provision a Redis from the Vercel
 * Marketplace and add a RedisBroker here:
 *
 *     vercel integration add upstash/upstash-kv --yes
 *
 * Deliberately NOT stubbed out with a fake implementation — a broker that
 * silently drops messages in production is worse than a loud misconfiguration,
 * so this throws instead of degrading if you set BROKER=redis prematurely.
 */
function createBroker(): SignalBroker {
  const kind = process.env.BROKER ?? "memory";

  switch (kind) {
    case "memory":
      return new MemoryBroker();
    case "redis":
      throw new Error(
        "BROKER=redis is not implemented yet (planned for M2). " +
          "Provision Redis via `vercel integration add upstash/upstash-kv` " +
          "and implement lib/broker/redis.ts first.",
      );
    default:
      throw new Error(`Unknown BROKER=${kind}`);
  }
}

export const broker: SignalBroker = (globalThis as any).__aioBrokerInstance ??
  ((globalThis as any).__aioBrokerInstance = createBroker());
