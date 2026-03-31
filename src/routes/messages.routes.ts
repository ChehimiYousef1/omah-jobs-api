import { Router, Request, Response } from 'express';
import sql from 'mssql';
import jwt from 'jsonwebtoken';
import { getPool } from './microsoft-auth.js';

const router = Router();

// =============================================================================
// POST /api/messages  — send a message or share a post
// =============================================================================

/**
 * @swagger
 * /api/messages:
 *   post:
 *     tags: [Messages]
 *     summary: Send a message or share a post
 *     description: >
 *       Creates a new message record. Supports two use cases driven by the
 *       `type` field:
 *
 *       - **`post_share`** *(default)* — share a post with another user.
 *         Pass the target post's UUID as `post_id`.
 *       - **`text`** (or any custom type) — plain direct message.
 *         Pass the text in `content` and omit `post_id`.
 *
 *       Requires a valid `auth_token` cookie. The sender is resolved from
 *       the JWT — it cannot be spoofed via the request body.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendMessageBody'
 *           examples:
 *             sharePost:
 *               summary: Share a post with a user
 *               value:
 *                 recipient_id: "u2b3c4d5-0000-0000-0000-000000000000"
 *                 post_id:      "p1a2b3c4-0000-0000-0000-000000000000"
 *                 type:         "post_share"
 *                 content:      "Thought you'd find this interesting!"
 *             directMessage:
 *               summary: Plain direct message (no post)
 *               value:
 *                 recipient_id: "u2b3c4d5-0000-0000-0000-000000000000"
 *                 type:         "text"
 *                 content:      "Hey, how are you?"
 *     responses:
 *       201:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *       400:
 *         description: Missing required field
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "recipient_id is required"
 *       401:
 *         description: Not authenticated — missing or invalid `auth_token` cookie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Not authenticated"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Failed to send message"
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.auth_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);
    const { recipient_id, post_id, type = 'post_share', content = '' } = req.body;

    if (!recipient_id) return res.status(400).json({ error: 'recipient_id is required' });

    const pool = await getPool();

    await pool.request()
      .input('id',           sql.UniqueIdentifier, undefined)
      .input('sender_id',    sql.UniqueIdentifier, decoded.userId)
      .input('recipient_id', sql.UniqueIdentifier, recipient_id)
      .input('post_id',      sql.UniqueIdentifier, post_id ?? null)
      .input('type',         sql.NVarChar(50),     type)
      .input('content',      sql.NVarChar(sql.MAX), content)
      .query(`
        INSERT INTO messages (id, sender_id, recipient_id, post_id, type, content, created_at)
        VALUES (NEWID(), @sender_id, @recipient_id, @post_id, @type, @content, SYSDATETIME())
      `);

    res.status(201).json({ success: true });
  } catch (e: any) {
    console.error('POST /api/messages error:', e);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;