import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../config/db.js';
import { createNotification } from '../services/notificationService.js';
const router = Router({ mergeParams: true });
// ── Auth helper ───────────────────────────────────────────────────────────────
const getUser = async (req) => {
    const token = req.cookies?.auth_token;
    if (!token)
        throw Object.assign(new Error('Not authenticated'), { status: 401 });
    const jwt = await import('jsonwebtoken');
    return jwt.default.verify(token, process.env.JWT_SECRET);
};
/* =========================
   STATS (public)
========================= */
/**
 * @swagger
 * /api/post-interactions/posts/{id}/stats:
 *   get:
 *     tags: [Interactions]
 *     summary: Get like, comment, and repost counts for a post
 *     description: >
 *       Returns aggregated interaction counts for a given post.
 *       This endpoint is public — no authentication required.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post
 *     responses:
 *       200:
 *         description: Interaction stats
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PostStats'
 *             example:
 *               likeCount: 42
 *               commentCount: 7
 *               repostCount: 3
 *       500:
 *         description: Failed to fetch stats
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/posts/:id/stats', async (req, res) => {
    try {
        const pool = await getPool();
        const { recordset } = await pool.request()
            .input('pid', sql.UniqueIdentifier, req.params.id)
            .query(`
        SELECT
          (SELECT COUNT(*) FROM post_likes   WHERE post_id = @pid) AS likeCount,
          (SELECT COUNT(*) FROM comments     WHERE post_id = @pid) AS commentCount,
          (SELECT COUNT(*) FROM post_reposts WHERE post_id = @pid) AS repostCount
      `);
        res.json(recordset[0]);
    }
    catch (e) {
        console.error('GET stats error:', e.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});
/* =========================
   LIKES
========================= */
/**
 * @swagger
 * /api/post-interactions/posts/{id}/like:
 *   post:
 *     tags: [Interactions]
 *     summary: Like a post
 *     description: >
 *       Adds a like for the authenticated user on the given post.
 *       Idempotent — silently does nothing if the user has already liked it.
 *       After responding, fires a `LIKE` notification to the post owner
 *       asynchronously (fire-and-forget).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to like
 *     responses:
 *       200:
 *         description: Liked successfully
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
 *       500:
 *         description: Failed to like
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   delete:
 *     tags: [Interactions]
 *     summary: Unlike a post
 *     description: Removes the authenticated user's like from the given post.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to unlike
 *     responses:
 *       200:
 *         description: Unliked successfully
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
 *       500:
 *         description: Failed to unlike
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/posts/:id/like', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const pool = await getPool();
        const me = decoded.userId;
        const pid = req.params.id;
        await pool.request()
            .input('uid', sql.UniqueIdentifier, me)
            .input('pid', sql.UniqueIdentifier, pid)
            .query(`
        IF NOT EXISTS (SELECT 1 FROM post_likes WHERE user_id=@uid AND post_id=@pid)
          INSERT INTO post_likes (user_id, post_id) VALUES (@uid, @pid)
      `);
        // ✅ Fetch post owner for notification
        const post = await pool.request()
            .input('pid', sql.UniqueIdentifier, pid)
            .query(`SELECT userId FROM posts WHERE id = @pid`);
        res.json({ success: true });
        // ✅ Fire-and-forget after response sent
        if (post.recordset[0]) {
            createNotification({
                recipientId: post.recordset[0].userId,
                actorId: me,
                type: 'LIKE',
                postId: pid,
            }).catch(err => console.error('LIKE notification failed:', err));
        }
    }
    catch (e) {
        console.error('POST like error:', e);
        res.status(e.status ?? 500).json({ error: e.message ?? 'Failed to like' });
    }
});
router.delete('/posts/:id/like', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const pool = await getPool();
        await pool.request()
            .input('uid', sql.UniqueIdentifier, decoded.userId)
            .input('pid', sql.UniqueIdentifier, req.params.id)
            .query(`DELETE FROM post_likes WHERE user_id=@uid AND post_id=@pid`);
        res.json({ success: true });
    }
    catch (e) {
        console.error('DELETE like error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to unlike' });
    }
});
/* =========================
   REPOSTS
========================= */
/**
 * @swagger
 * /api/post-interactions/posts/{id}/repost:
 *   post:
 *     tags: [Interactions]
 *     summary: Repost a post
 *     description: >
 *       Creates a repost record for the authenticated user.
 *       Returns `409` if the user has already reposted this post.
 *       Returns `404` if the post does not exist.
 *       After responding, fires a `REPOST` notification to the post owner
 *       asynchronously (fire-and-forget).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to repost
 *     responses:
 *       201:
 *         description: Reposted successfully
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
 *       404:
 *         description: Post not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Post not found"
 *       409:
 *         description: Already reposted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Already reposted"
 *       500:
 *         description: Failed to repost
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   delete:
 *     tags: [Interactions]
 *     summary: Undo a repost
 *     description: Removes the authenticated user's repost of the given post.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to un-repost
 *     responses:
 *       200:
 *         description: Repost removed successfully
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
 *       500:
 *         description: Failed to undo repost
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/posts/:id/repost', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const pool = await getPool();
        const me = decoded.userId;
        const pid = req.params.id;
        const already = await pool.request()
            .input('uid', sql.UniqueIdentifier, me)
            .input('pid', sql.UniqueIdentifier, pid)
            .query(`SELECT 1 FROM post_reposts WHERE user_id=@uid AND post_id=@pid`);
        if (already.recordset.length > 0)
            return res.status(409).json({ error: 'Already reposted' });
        const post = await pool.request()
            .input('pid', sql.UniqueIdentifier, pid)
            .query(`SELECT userId FROM posts WHERE id=@pid`);
        if (!post.recordset[0])
            return res.status(404).json({ error: 'Post not found' });
        await pool.request()
            .input('uid', sql.UniqueIdentifier, me)
            .input('pid', sql.UniqueIdentifier, pid)
            .query(`INSERT INTO post_reposts (user_id, post_id) VALUES (@uid, @pid)`);
        res.status(201).json({ success: true });
        // ✅ Fire-and-forget
        createNotification({
            recipientId: post.recordset[0].userId,
            actorId: me,
            type: 'REPOST',
            postId: pid,
        }).catch(err => console.error('REPOST notification failed:', err));
    }
    catch (e) {
        console.error('POST repost error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to repost' });
    }
});
router.delete('/posts/:id/repost', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const pool = await getPool();
        await pool.request()
            .input('uid', sql.UniqueIdentifier, decoded.userId)
            .input('pid', sql.UniqueIdentifier, req.params.id)
            .query(`DELETE FROM post_reposts WHERE user_id=@uid AND post_id=@pid`);
        res.json({ success: true });
    }
    catch (e) {
        console.error('DELETE repost error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to undo repost' });
    }
});
/* =========================
   SAVED POSTS
========================= */
/**
 * @swagger
 * /api/post-interactions/saved-posts:
 *   post:
 *     tags: [Interactions]
 *     summary: Save a post
 *     description: >
 *       Bookmarks the given post for the authenticated user.
 *       Idempotent — silently does nothing if already saved.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [post_id]
 *             properties:
 *               post_id:
 *                 type: string
 *                 format: uuid
 *                 example: "p1a2b3c4-0000-0000-0000-000000000000"
 *     responses:
 *       200:
 *         description: Post saved successfully
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
 *       500:
 *         description: Failed to save
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/post-interactions/saved-posts/{postId}:
 *   delete:
 *     tags: [Interactions]
 *     summary: Unsave a post
 *     description: Removes the given post from the authenticated user's saved list.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to unsave
 *     responses:
 *       200:
 *         description: Post unsaved successfully
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
 *       500:
 *         description: Failed to unsave
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/saved-posts', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const { post_id } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('uid', sql.UniqueIdentifier, decoded.userId)
            .input('pid', sql.UniqueIdentifier, post_id)
            .query(`
        IF NOT EXISTS (SELECT 1 FROM saved_posts WHERE user_id=@uid AND post_id=@pid)
          INSERT INTO saved_posts (user_id, post_id) VALUES (@uid, @pid)
      `);
        res.json({ success: true });
    }
    catch (e) {
        console.error('POST save error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to save' });
    }
});
router.delete('/saved-posts/:postId', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const pool = await getPool();
        await pool.request()
            .input('uid', sql.UniqueIdentifier, decoded.userId)
            .input('pid', sql.UniqueIdentifier, req.params.postId)
            .query(`DELETE FROM saved_posts WHERE user_id=@uid AND post_id=@pid`);
        res.json({ success: true });
    }
    catch (e) {
        console.error('DELETE save error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to unsave' });
    }
});
/* =========================
   FOLLOWERS
========================= */
/**
 * @swagger
 * /api/post-interactions/followers:
 *   post:
 *     tags: [Connections]
 *     summary: Follow a user
 *     description: >
 *       Follows the specified user. Idempotent — silently does nothing if
 *       already following. After responding, fires a `FOLLOW` notification
 *       to the followed user asynchronously (fire-and-forget).
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [following_id]
 *             properties:
 *               following_id:
 *                 type: string
 *                 format: uuid
 *                 example: "u2b3c4d5-0000-0000-0000-000000000000"
 *                 description: UUID of the user to follow
 *     responses:
 *       200:
 *         description: Followed successfully
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
 *       500:
 *         description: Failed to follow
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/post-interactions/followers/{userId}:
 *   delete:
 *     tags: [Connections]
 *     summary: Unfollow a user
 *     description: Removes the follow relationship between the authenticated user and the target user.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the user to unfollow
 *     responses:
 *       200:
 *         description: Unfollowed successfully
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
 *       500:
 *         description: Failed to unfollow
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/followers', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const { following_id } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('fid', sql.UniqueIdentifier, decoded.userId)
            .input('iid', sql.UniqueIdentifier, following_id)
            .query(`
        IF NOT EXISTS (SELECT 1 FROM followers WHERE follower_id=@fid AND following_id=@iid)
          INSERT INTO followers (follower_id, following_id) VALUES (@fid, @iid)
      `);
        res.json({ success: true });
        // ✅ Notify the person being followed
        createNotification({
            recipientId: following_id,
            actorId: decoded.userId,
            type: 'FOLLOW',
        }).catch(err => console.error('FOLLOW notification failed:', err));
    }
    catch (e) {
        console.error('POST follow error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to follow' });
    }
});
router.delete('/followers/:userId', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const pool = await getPool();
        await pool.request()
            .input('fid', sql.UniqueIdentifier, decoded.userId)
            .input('iid', sql.UniqueIdentifier, req.params.userId)
            .query(`DELETE FROM followers WHERE follower_id=@fid AND following_id=@iid`);
        res.json({ success: true });
    }
    catch (e) {
        console.error('DELETE follow error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to unfollow' });
    }
});
/* =========================
   BLOCKED USERS
========================= */
/**
 * @swagger
 * /api/post-interactions/blocked-users:
 *   post:
 *     tags: [Connections]
 *     summary: Block a user
 *     description: >
 *       Blocks the specified user. Idempotent — silently does nothing if
 *       already blocked. No notification is sent to the blocked user.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [blocked_id]
 *             properties:
 *               blocked_id:
 *                 type: string
 *                 format: uuid
 *                 example: "u3c4d5e6-0000-0000-0000-000000000000"
 *                 description: UUID of the user to block
 *     responses:
 *       200:
 *         description: User blocked successfully
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
 *       500:
 *         description: Failed to block
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/post-interactions/blocked-users/{userId}:
 *   delete:
 *     tags: [Connections]
 *     summary: Unblock a user
 *     description: Removes the block on the specified user.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the user to unblock
 *     responses:
 *       200:
 *         description: User unblocked successfully
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
 *       500:
 *         description: Failed to unblock
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/blocked-users', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const { blocked_id } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('blkr', sql.UniqueIdentifier, decoded.userId)
            .input('blkd', sql.UniqueIdentifier, blocked_id)
            .query(`
        IF NOT EXISTS (SELECT 1 FROM blocked_users WHERE blocker_id=@blkr AND blocked_id=@blkd)
          INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (@blkr, @blkd)
      `);
        res.json({ success: true });
    }
    catch (e) {
        console.error('POST block error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to block' });
    }
});
router.delete('/blocked-users/:userId', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const pool = await getPool();
        await pool.request()
            .input('blkr', sql.UniqueIdentifier, decoded.userId)
            .input('blkd', sql.UniqueIdentifier, req.params.userId)
            .query(`DELETE FROM blocked_users WHERE blocker_id=@blkr AND blocked_id=@blkd`);
        res.json({ success: true });
    }
    catch (e) {
        console.error('DELETE block error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to unblock' });
    }
});
/* =========================
   REPORT
========================= */
/**
 * @swagger
 * /api/post-interactions/posts/{id}/report:
 *   post:
 *     tags: [Interactions]
 *     summary: Report a post
 *     description: >
 *       Submits a report for the given post. Internally, this inserts a record
 *       into `contact_inquiries` with `account_type = 'POST_REPORT'`.
 *       The `reason` field is optional — defaults to `"Reported by user"`.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to report
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "This post contains spam."
 *                 description: Optional reason for the report — defaults to "Reported by user"
 *     responses:
 *       200:
 *         description: Report submitted successfully
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
 *       500:
 *         description: Failed to submit report
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/posts/:id/report', async (req, res) => {
    try {
        const decoded = await getUser(req);
        const { reason } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('a', sql.NVarChar(100), 'REPORT')
            .input('b', sql.NVarChar(100), req.params.id)
            .input('c', sql.NVarChar(255), decoded.userId)
            .input('d', sql.NVarChar(50), 'POST_REPORT')
            .input('e', sql.NVarChar(sql.MAX), reason ?? 'Reported by user')
            .query(`
        INSERT INTO contact_inquiries (first_name, last_name, email, account_type, message)
        VALUES (@a, @b, @c, @d, @e)
      `);
        res.json({ success: true });
    }
    catch (e) {
        console.error('POST report error:', e);
        res.status(e.status ?? 500).json({ error: 'Failed to report' });
    }
});
export default router;
