import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: Error, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'ValidationError',
        details: error.issues,
      });
    }

    if (error instanceof PrismaClientKnownRequestError) {
      return reply.status(400).send({
        error: 'DatabaseError',
        code: error.code,
        message: error.message,
      });
    }

    app.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: 'InternalServerError',
      message: 'Unexpected error',
    });
  });
});

export default errorHandlerPlugin;
