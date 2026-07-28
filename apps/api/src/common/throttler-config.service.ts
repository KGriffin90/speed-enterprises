import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import {
  ThrottlerOptionsFactory,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Wraps a throttler storage so a backing-store outage can NEVER take the API
 * down. Rate limiting is a protective layer, not a correctness requirement —
 * if Redis is unreachable we log and fail OPEN (allow the request) rather than
 * 500-ing every throttled route. Paired with a fast-fail ioredis config below,
 * this means a Redis blip degrades gracefully instead of cascading.
 */
class ResilientThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly inner: ThrottlerStorage, private readonly logger: Logger) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    try {
      return await this.inner.increment(key, ttl, limit, blockDuration, throttlerName);
    } catch (err) {
      this.logger.error(
        `Throttler store unavailable — allowing request (fail-open): ${(err as Error).message}`,
      );
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}

/**
 * Builds the ThrottlerModule options.
 *
 * Production (REDIS_URL set): counters live in Redis, so per-IP limits are
 * shared across every API instance — N replicas still enforce one global
 * budget. `rediss://` URLs get TLS automatically.
 *
 * Dev / single instance (no REDIS_URL): falls back to the in-memory store
 * (per-process counters), so nothing extra is needed to run locally.
 */
@Injectable()
export class ThrottlerConfigService implements ThrottlerOptionsFactory, OnApplicationShutdown {
  private readonly logger = new Logger('Throttler');
  private redis?: Redis;

  createThrottlerOptions(): ThrottlerModuleOptions {
    // Named 'default' so the per-route @Throttle({ default: { ... } })
    // overrides resolve to this throttler.
    const throttlers = [{ name: 'default', ttl: 60_000, limit: 120 }];

    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        'REDIS_URL not set — using in-memory throttler (counters are per-instance). ' +
        'Set REDIS_URL in production so limits are shared across replicas.',
      );
      return { throttlers };
    }

    this.redis = new Redis(url, {
      // Fail fast so a Redis outage degrades to fail-open throttling instead of
      // hanging auth requests: reject immediately when disconnected, cap retries
      // per command, and time commands out at 1s.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
      // Keep trying to reconnect (capped backoff) so it self-heals when Redis returns.
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    this.redis.on('error', (e) => this.logger.error(`Redis throttler store error: ${e.message}`));
    this.redis.on('ready', () => this.logger.log('Redis throttler store connected'));

    const storage = new ResilientThrottlerStorage(
      new ThrottlerStorageRedisService(this.redis),
      this.logger,
    );
    return { throttlers, storage };
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
