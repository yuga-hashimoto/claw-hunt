import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

const PUBLIC_PATHS = new Set(['/health']);

const authPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (request, reply) => {
    if (!env.API_KEY) return;
    if (PUBLIC_PATHS.has(request.url.split('?')[0] ?? request.url)) return;

    const key = request.headers['x-api-key'];
    if (key !== env.API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
});

export default authPlugin;
