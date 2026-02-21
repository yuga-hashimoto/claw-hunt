import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import jobsRoutes from './routes/jobs.js';

const app = Fastify({
  logger: true,
});

app.register(cors, { origin: true });
app.register(prismaPlugin);
app.register(redisPlugin);
app.register(errorHandlerPlugin);
app.register(jobsRoutes);

app.get('/health', async () => ({
  status: 'ok',
  environment: env.NODE_ENV,
}));

const start = async (): Promise<void> => {
  try {
    await app.listen({
      host: '0.0.0.0',
      port: env.PORT,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
