import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JobStatus } from '@prisma/client';
import { calculateSpeed, computeFinalScore, estimateQualityFromContent } from '../lib/scoring.js';

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
  quality: z.number().min(0).max(1).optional(),
});

const settleJobSchema = z.object({
  failAfterEscrowRelease: z.boolean().optional().default(false),
});

const SYSTEM_REQUESTER_HANDLE = 'system-requester';

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
        escrow: { create: { amountTokens: payload.rewardTokens, status: 'LOCKED' } },
        auditLogs: { create: { action: 'JOB_CREATED', metadata: { rewardTokens: payload.rewardTokens } } },
      },
      include: { escrow: true },
    });

    return reply.status(201).send(job);
  });

  app.get('/jobs/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const job = await app.prisma.job.findUnique({
      where: { id: params.id },
      include: { submissions: true, escrow: true, payouts: true },
    });
    if (!job) return reply.status(404).send({ error: 'JobNotFound' });
    return reply.send(job);
  });

  app.post('/jobs/:id/submissions', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = createSubmissionSchema.parse(request.body);

    const job = await app.prisma.job.findUnique({ where: { id: params.id } });
    if (!job) return reply.status(404).send({ error: 'JobNotFound' });

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
        metadata: { submissionId: submission.id, latencyMs: payload.latencyMs },
      },
    });

    return reply.status(201).send(submission);
  });

  app.post('/jobs/:id/score', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = scoreSubmissionSchema.parse(request.body);

    const submission = await app.prisma.submission.findFirst({
      where: { id: payload.submissionId, jobId: params.id },
    });
    if (!submission) return reply.status(404).send({ error: 'SubmissionNotFound' });

    const quality = payload.quality ?? estimateQualityFromContent(submission.content);
    const speed = calculateSpeed(submission.latencyMs);
    const score = computeFinalScore(quality, speed);

    const updated = await app.prisma.submission.update({
      where: { id: submission.id },
      data: { qualityScore: quality, speedScore: speed, finalScore: score, status: 'SCORED' },
    });

    await app.prisma.auditLog.create({
      data: {
        jobId: params.id,
        actorId: submission.workerId,
        action: 'SUBMISSION_SCORED',
        metadata: { submissionId: submission.id, quality, speed, score },
      },
    });

    return reply.send({ submission: updated, score, quality, speed, formula: 'quality*0.7 + speed*0.3' });
  });

  app.post('/jobs/:id/settle', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = settleJobSchema.parse(request.body ?? {});

    const result = await app.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: params.id },
        include: {
          escrow: true,
          submissions: {
            where: { status: 'SCORED' },
            orderBy: { finalScore: 'desc' },
            take: 3,
          },
        },
      });

      if (!job || !job.escrow) throw new Error('JobOrEscrowNotFound');
      if (job.submissions.length === 0) throw new Error('NoScoredSubmissions');

      const splits = [0.8, 0.15, 0.05];
      const payouts = job.submissions.map((s, idx) => ({
        jobId: job.id,
        userId: s.workerId,
        amountTokens: Math.floor(job.rewardTokens * splits[idx]!),
        rank: idx + 1,
        status: 'PAID',
      }));

      await tx.escrow.update({ where: { jobId: job.id }, data: { status: 'RELEASED', releasedAt: new Date() } });

      if (payload.failAfterEscrowRelease) throw new Error('SimulatedFailureAfterEscrowRelease');

      await tx.payout.createMany({ data: payouts });
      await tx.submission.update({ where: { id: job.submissions[0]!.id }, data: { status: 'WINNER' } });
      await tx.job.update({ where: { id: job.id }, data: { status: JobStatus.COMPLETED } });
      await tx.auditLog.create({
        data: {
          jobId: job.id,
          action: 'JOB_SETTLED',
          metadata: { winnerSubmissionId: job.submissions[0]!.id, payouts },
        },
      });

      return { jobId: job.id, payoutsCount: payouts.length, winnerSubmissionId: job.submissions[0]!.id };
    });

    return reply.send(result);
  });
}
