import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JobStatus } from '@prisma/client';

const createJobSchema = z.object({
  title: z.string().min(3).max(200),
  prompt: z.string().min(1).max(10000),
  rewardTokens: z.number().int().positive(),
  deadlineAt: z.coerce.date(),
});

const createSubmissionSchema = z.object({
  workerId: z.string().min(1).max(64),
  content: z.string().min(1).max(20000),
  latencyMs: z.number().int().nonnegative(),
});

const scoreSubmissionSchema = z.object({
  submissionId: z.string().min(1),
  quality: z.number().min(0).max(1),
});

const SYSTEM_REQUESTER_HANDLE = 'system-requester';

function calculateSpeed(latencyMs: number): number {
  const normalized = 1 - latencyMs / 10000;
  return Math.max(0, Math.min(1, normalized));
}

export default async function jobsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/jobs', async (request, reply) => {
    const payload = createJobSchema.parse(request.body);

    const job = await app.prisma.job.create({
      data: {
        title: payload.title,
        prompt: payload.prompt,
        rewardTokens: payload.rewardTokens,
        deadlineAt: payload.deadlineAt,
        status: JobStatus.OPEN,
        requester: {
          connectOrCreate: {
            where: { handle: SYSTEM_REQUESTER_HANDLE },
            create: { handle: SYSTEM_REQUESTER_HANDLE },
          },
        },
        escrow: {
          create: {
            amountTokens: payload.rewardTokens,
            status: 'LOCKED',
          },
        },
        auditLogs: {
          create: {
            action: 'JOB_CREATED',
            metadata: {
              rewardTokens: payload.rewardTokens,
            },
          },
        },
      },
      include: {
        escrow: true,
      },
    });

    return reply.status(201).send(job);
  });

  app.get('/jobs/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    const job = await app.prisma.job.findUnique({
      where: { id: params.id },
      include: {
        submissions: true,
        escrow: true,
      },
    });

    if (!job) {
      return reply.status(404).send({ error: 'JobNotFound' });
    }

    return reply.send(job);
  });

  app.post('/jobs/:id/submissions', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = createSubmissionSchema.parse(request.body);

    const job = await app.prisma.job.findUnique({ where: { id: params.id } });
    if (!job) {
      return reply.status(404).send({ error: 'JobNotFound' });
    }

    const worker = await app.prisma.user.upsert({
      where: { handle: payload.workerId },
      update: {},
      create: { handle: payload.workerId },
    });

    const submission = await app.prisma.submission.create({
      data: {
        jobId: params.id,
        workerId: worker.id,
        content: payload.content,
        latencyMs: payload.latencyMs,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        jobId: params.id,
        actorId: submission.workerId,
        action: 'SUBMISSION_CREATED',
        metadata: {
          submissionId: submission.id,
          latencyMs: payload.latencyMs,
        },
      },
    });

    return reply.status(201).send(submission);
  });

  app.post('/jobs/:id/score', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = scoreSubmissionSchema.parse(request.body);

    const submission = await app.prisma.submission.findFirst({
      where: {
        id: payload.submissionId,
        jobId: params.id,
      },
    });

    if (!submission) {
      return reply.status(404).send({ error: 'SubmissionNotFound' });
    }

    const speed = calculateSpeed(submission.latencyMs);
    const score = payload.quality * 0.7 + speed * 0.3;

    const updated = await app.prisma.submission.update({
      where: { id: submission.id },
      data: {
        qualityScore: payload.quality,
        speedScore: speed,
        finalScore: score,
        status: 'SCORED',
      },
    });

    await app.prisma.auditLog.create({
      data: {
        jobId: params.id,
        actorId: submission.workerId,
        action: 'SUBMISSION_SCORED',
        metadata: {
          submissionId: submission.id,
          quality: payload.quality,
          speed,
          score,
        },
      },
    });

    return reply.send({
      submission: updated,
      score,
      quality: payload.quality,
      speed,
      formula: 'quality*0.7 + speed*0.3',
    });
  });
}
