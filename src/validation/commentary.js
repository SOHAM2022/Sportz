import { z } from "zod";

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const createCommentarySchema = z.object({
  matchId: z.coerce.number().int().positive(),
  minute: z.number().int().nonnegative(),
  sequence: z.number().int(),
  period: z.string().min(1),
  eventType: z.string().min(1),
  actor: z.string().optional(),
  team: z.string().optional(),
  message: z.string().min(1),
  metadata: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional(),
});
