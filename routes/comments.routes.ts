// src/routes/comments.routes.ts

import { Router } from 'express';
import type { Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../config/db.js';
import jwt from 'jsonwebtoken';


const router = Router({ mergeParams: true }); // ← mergeParams lets us read :postId

// ── Auth helper ───────────────────────────────────────────────────────────────
function getUser(req: Request): { userId: string; name: string } | null {
  try {
    const token = req.cookies?.auth_token;
    if (!token) return null;
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);
    return { userId: decoded.userId, name: decoded.name ?? decoded.username ?? '' };
  } catch { return null; }
}

// ── GET /api/posts/:postId/comments ──────────────────────────────────────────

/**
 * @swagger
 * /api/posts/{postId}/comments:
 *   get:
 *     tags: [Comments]
 *     summary: Get all comments for a post
 *     description: >
 *       Returns all top-level comments with their replies nested underneath.
 *       Nesting is done in JavaScript to avoid a recursive CTE, ordered by
 *       `created_at ASC`.
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post
 *     responses:
 *       200:
 *         description: Nested comment tree
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comments:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CommentNode'
 *             example:
 *               comments:
 *                 - id: "c1d2e3f4-..."
 *                   body: "Great post!"
 *                   parent_id: null
 *                   created_at: "2024-01-15T10:30:00Z"
 *                   author_id: "u1a2b3c4-..."
 *                   author_name: "Jane Doe"
 *                   author_avatar: null
 *                   author_headline: "Full-stack developer"
 *                   replies:
 *                     - id: "d2e3f4g5-..."
 *                       body: "Thanks!"
 *                       parent_id: "c1d2e3f4-..."
 *                       created_at: "2024-01-15T11:00:00Z"
 *                       author_id: "u2b3c4d5-..."
 *                       author_name: "John Smith"
 *                       author_avatar: null
 *                       author_headline: null
 *                       replies: []
 *       500:
 *         description: Failed to fetch comments
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool   = await getPool();
    const postId = req.params.postId;

    const { recordset } = await pool.request()
      .input('pid', sql.UniqueIdentifier, postId)
      .query(`
        SELECT
          c.id,
          c.content          AS body,
          c.parent_id,
          c.created_at,
          c.user_id          AS author_id,
          u.name             AS author_name,
          u.avatar           AS author_avatar,
          u.headline         AS author_headline
        FROM comments c
        JOIN Users u ON u.id = c.user_id
        WHERE c.post_id = @pid
        ORDER BY c.created_at ASC
      `);

    // Nest replies under their parent in JS — avoids a recursive CTE
    const map   = new Map<string, any>();
    const roots: any[] = [];

    for (const row of recordset) {
      map.set(row.id, { ...row, replies: [] });
    }
    for (const row of recordset) {
      const node = map.get(row.id)!;
      if (row.parent_id && map.has(row.parent_id)) {
        map.get(row.parent_id)!.replies.push(node);
      } else {
        roots.push(node);
      }
    }

    res.json({ comments: roots });
  } catch (e: any) {
    console.error('GET comments error:', e.message);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// ── POST /api/posts/:postId/comments ─────────────────────────────────────────

/**
 * @swagger
 * /api/posts/{postId}/comments:
 *   post:
 *     tags: [Comments]
 *     summary: Add a comment to a post
 *     description: >
 *       Creates a new top-level comment or a reply (when `parent_id` is
 *       provided). Requires a valid `auth_token` cookie.
 *       Returns the full comment object including author details.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCommentBody'
 *           examples:
 *             topLevel:
 *               summary: Top-level comment
 *               value:
 *                 body: "Great post!"
 *             reply:
 *               summary: Reply to another comment
 *               value:
 *                 body: "I agree!"
 *                 parent_id: "c1d2e3f4-0000-0000-0000-000000000000"
 *     responses:
 *       201:
 *         description: Comment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comment:
 *                   $ref: '#/components/schemas/CommentNode'
 *             example:
 *               comment:
 *                 id: "d2e3f4g5-..."
 *                 body: "Great post!"
 *                 parent_id: null
 *                 created_at: "2024-01-15T10:30:00Z"
 *                 author_id: "u1a2b3c4-..."
 *                 author_name: "Jane Doe"
 *                 author_avatar: null
 *                 author_headline: "Full-stack developer"
 *                 replies: []
 *       400:
 *         description: Body is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Body is required"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Not authenticated"
 *       500:
 *         description: Failed to post comment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { body, parent_id } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Body is required' });

  try {
    const pool   = await getPool();
    const postId = req.params.postId;

    const { recordset } = await pool.request()
      .input('pid',  sql.UniqueIdentifier, postId)
      .input('uid',  sql.UniqueIdentifier, user.userId)
      .input('body', sql.NVarChar(sql.MAX), body.trim())
      .input('par',  sql.UniqueIdentifier, parent_id ?? null)
      .query(`
        INSERT INTO comments (post_id, user_id, content, parent_id)
        OUTPUT
          INSERTED.id,
          INSERTED.content   AS body,
          INSERTED.parent_id,
          INSERTED.created_at,
          INSERTED.user_id   AS author_id
        VALUES (@pid, @uid, @body, @par)
      `);

    const inserted = recordset[0];

    // Fetch author details to return a fully-shaped comment object
    const { recordset: userRows } = await pool.request()
      .input('uid', sql.UniqueIdentifier, user.userId)
      .query(`SELECT name AS author_name, avatar AS author_avatar, headline AS author_headline FROM Users WHERE id = @uid`);

    res.status(201).json({
      comment: { ...inserted, ...userRows[0], replies: [] },
    });
  } catch (e: any) {
    console.error('POST comment error:', e.message);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// ── DELETE /api/posts/:postId/comments/:commentId ────────────────────────────

/**
 * @swagger
 * /api/posts/{postId}/comments/{commentId}:
 *   delete:
 *     tags: [Comments]
 *     summary: Delete a comment
 *     description: >
 *       Permanently deletes a comment. Only the original author can delete
 *       their own comment — the query filters by both `comment id` and
 *       `user_id`, so attempting to delete someone else's comment returns 403.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the comment to delete
 *     responses:
 *       200:
 *         description: Comment deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Not authenticated"
 *       403:
 *         description: Not allowed or comment not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Not allowed or comment not found"
 *       500:
 *         description: Failed to delete comment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:commentId', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const pool = await getPool();

    // Only allow the author to delete their own comment
    const { rowsAffected } = await pool.request()
      .input('cid', sql.UniqueIdentifier, req.params.commentId)
      .input('uid', sql.UniqueIdentifier, user.userId)
      .query(`DELETE FROM comments WHERE id = @cid AND user_id = @uid`);

    if (rowsAffected[0] === 0)
      return res.status(403).json({ error: 'Not allowed or comment not found' });

    res.json({ success: true });
  } catch (e: any) {
    console.error('DELETE comment error:', e.message);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// ── GET /api/posts/:postId/comments/mentions-search ──────────────────────────

/**
 * @swagger
 * /api/posts/{postId}/comments/mentions-search:
 *   get:
 *     tags: [Comments]
 *     summary: Search users for @mention autocomplete
 *     description: >
 *       Returns up to 8 users whose name matches the `q` query parameter.
 *       Used to power the @mention autocomplete inside the comment editor.
 *       Requires authentication — returns an empty array silently if not logged in.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post (required by the router, not used in query)
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           example: "jane"
 *         description: Partial name to search for
 *     responses:
 *       200:
 *         description: Matching users (max 8, ordered by name ASC)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MentionUser'
 *             example:
 *               users:
 *                 - id: "u1a2b3c4-..."
 *                   name: "Jane Doe"
 *                   avatar: null
 *                   headline: "Full-stack developer"
 */
router.get('/mentions-search', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ users: [] });

  const q = `%${(req.query.q as string) ?? ''}%`;

  try {
    const pool = await getPool();
    const { recordset } = await pool.request()
      .input('q', sql.NVarChar(100), q)
      .query(`
        SELECT TOP 8
          id,
          name,
          avatar,
          headline
        FROM Users
        WHERE name LIKE @q
        ORDER BY name ASC
      `);

    res.json({ users: recordset });
  } catch (e: any) {
    console.error('mentions-search error:', e.message);
    res.json({ users: [] });
  }
});

export default router;