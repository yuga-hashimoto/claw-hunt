import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin = fp(async (app: FastifyInstance) => {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await redis.quit();
  });
});

export default redisPlugin;
