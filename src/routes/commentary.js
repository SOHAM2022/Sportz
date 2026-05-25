import { Router } from "express";
import { db } from "../db/db.js";
import { commentary } from "../db/schema.js";
import {
  createCommentarySchema,
  listCommentaryQuerySchema,
} from "../validation/commentary.js";
import { matchIdParamSchema } from "../validation/matches.js";
import { desc, eq } from "drizzle-orm";

const MAX_LIMIT = 100;
export const commentaryRouter = Router({ mergeParams: true });

commentaryRouter.post("/", async (req, res) => {
  try {
    // Validate matchId from params
    const paramParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return res.status(400).json({
        error: "Invalid match ID",
        details: paramParsed.error.format(),
      });
    }

    // Validate request body
    const bodyParsed = createCommentarySchema.safeParse({
      ...req.body,
      matchId: paramParsed.data.id,
    });
    
    if (!bodyParsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: bodyParsed.error.format(),
      });
    }
    const [newCommentary] = await db
      .insert(commentary)
      .values(bodyParsed.data)
      .returning();

    if (res.app.locals.broadcastCommentary) {
      res.app.locals.broadcastCommentary(paramParsed.data.id, newCommentary);
    }

    res.status(201).json({ data: newCommentary });
  } catch (error) {
    console.error("Error creating commentary:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

commentaryRouter.get("/", async (req, res) => {
  try {
    // Validate matchId from params
    const paramParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return res.status(400).json({
        error: "Invalid match ID",
        details: paramParsed.error.format(),
      });
    }

    // Validate query parameters
    const queryParsed = listCommentaryQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      return res.status(400).json({
        error: "Invalid query parameters",
        details: queryParsed.error.format(),
      });
    }

    const limit = Math.min(queryParsed.data.limit ?? MAX_LIMIT, MAX_LIMIT);

    const results = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, paramParsed.data.id))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    res.json({ data: results });
  } catch (error) {
    console.error("Error fetching commentary:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});
