import { Router } from 'express';
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { getPool } from './microsoft-auth.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();
// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (_req, file, cb) => {
        const sub = file.mimetype.startsWith('video/') ? 'video'
            : file.mimetype.startsWith('image/') ? 'image'
                : 'document';
        const dir = path.join(__dirname, '..', 'uploads', 'posts', sub);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });
// ── Auth helper ───────────────────────────────────────────────────────────────
const getUser = (req) => {
    const token = req.cookies?.auth_token;
    if (!token)
        throw Object.assign(new Error('Not authenticated'), { status: 401 });
    return jwt.verify(token, process.env.JWT_SECRET);
};
// =============================================================================
// GET /api/posts  — feed
// =============================================================================
/**
 * @swagger
 * /api/posts:
 *   get:
 *     tags: [Posts]
 *     summary: Get posts feed
 *     description: >
 *       Returns all posts ordered by `created_at DESC`.
 *       Works for both guests and authenticated users:
 *
 *       - **Guest** (no cookie): `liked` and `reposted` flags are always `false`.
 *         Posts with `visibility = 'Only Me'` are excluded.
 *       - **Authenticated**: `liked` and `reposted` reflect the current user's
 *         interactions. The user's own `Only Me` posts are included.
 *
 *       Each post includes denormalized author fields (`author_name`,
 *       `author_headline`, `author_role`, `author_avatar`, `author_bio`) and
 *       live interaction counts (`likeCount`, `commentCount`, `repostCount`).
 *     responses:
 *       200:
 *         description: Array of posts with author info and interaction counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 posts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/FeedPost'
 *             example:
 *               posts:
 *                 - id: "p1a2b3c4-0000-0000-0000-000000000000"
 *                   userId: "u1a2b3c4-0000-0000-0000-000000000000"
 *                   title: "Hello World"
 *                   description: "My first post"
 *                   attachments: "[]"
 *                   postType: "text"
 *                   visibility: "Anyone"
 *                   created_at: "2024-01-15T10:30:00Z"
 *                   author_name: "Jane Doe"
 *                   author_headline: "Full-stack developer"
 *                   author_role: "FREELANCER"
 *                   author_avatar: "/uploads/avatars/jane.png"
 *                   author_bio: null
 *                   likeCount: 5
 *                   commentCount: 2
 *                   repostCount: 1
 *                   liked: false
 *                   reposted: false
 *       500:
 *         description: Failed to fetch posts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', async (req, res) => {
    try {
        let userId = null;
        try {
            userId = getUser(req).userId;
        }
        catch { /* guest — no likes/reposts */ }
        const pool = await getPool();
        const result = await pool.request()
            .input('uid', sql.UniqueIdentifier, userId)
            .query(`
        SELECT
          p.id, p.userId, p.title, p.description,
          p.attachments, p.postType, p.visibility, p.created_at,
          u.name        AS author_name,
          u.headline    AS author_headline,
          u.role        AS author_role,
          u.avatar      AS author_avatar,
          u.bio         AS author_bio,
          (SELECT COUNT(*) FROM post_likes   WHERE post_id = p.id) AS likeCount,
          (SELECT COUNT(*) FROM comments     WHERE post_id = p.id) AS commentCount,
          (SELECT COUNT(*) FROM post_reposts WHERE post_id = p.id) AS repostCount,
          CASE WHEN @uid IS NOT NULL AND EXISTS (
            SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = @uid
          ) THEN 1 ELSE 0 END AS liked,
          CASE WHEN @uid IS NOT NULL AND EXISTS (
            SELECT 1 FROM post_reposts WHERE post_id = p.id AND user_id = @uid
          ) THEN 1 ELSE 0 END AS reposted
        FROM posts p
        JOIN users u ON u.id = p.userId
        WHERE p.visibility != 'Only Me'
           OR p.userId = @uid
        ORDER BY p.created_at DESC
      `);
        res.json({ posts: result.recordset });
    }
    catch (e) {
        console.error('GET /api/posts error:', e);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});
// =============================================================================
// POST /api/posts  — create post
// =============================================================================
/**
 * @swagger
 * /api/posts:
 *   post:
 *     tags: [Posts]
 *     summary: Create a new post
 *     description: >
 *       Creates a post with optional file attachment (image, video, or document —
 *       max **200 MB**). Multer auto-routes the file into the correct subfolder
 *       under `/uploads/posts/` based on MIME type.
 *
 *       **Post types:**
 *       - `text` — plain text post (no file required)
 *       - `image` / `video` / `document` — pass the file in the `file` field
 *       - `event` — omit `file`; pass `eventName` + optional event detail fields
 *
 *       The `attachments` column is stored as a JSON array string and
 *       returned as-is. The response includes full author info and zeroed
 *       interaction counters so the frontend can optimistically render the post.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/CreatePostBody'
 *           examples:
 *             textPost:
 *               summary: Plain text post
 *               value:
 *                 title: "Hello World"
 *                 description: "My first post"
 *                 visibility: "Anyone"
 *                 postType: "text"
 *             imagePost:
 *               summary: Post with image attachment
 *               value:
 *                 title: "Check out this photo"
 *                 description: "Taken at the conference"
 *                 postType: "image"
 *                 visibility: "Anyone"
 *             eventPost:
 *               summary: Event post
 *               value:
 *                 title: "Join us!"
 *                 postType: "event"
 *                 visibility: "Anyone"
 *                 eventName: "OMAH Dev Meetup"
 *                 eventDate: "2024-06-15"
 *                 eventTime: "18:00"
 *                 eventLocation: "Beirut, Lebanon"
 *                 eventUrl: "https://meetup.example.com"
 *     responses:
 *       201:
 *         description: Post created — returns full post with author info and zeroed counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 post:
 *                   $ref: '#/components/schemas/FeedPost'
 *             example:
 *               post:
 *                 id: "p1a2b3c4-0000-0000-0000-000000000000"
 *                 userId: "u1a2b3c4-0000-0000-0000-000000000000"
 *                 title: "Hello World"
 *                 description: "My first post"
 *                 attachments: "[]"
 *                 postType: "text"
 *                 visibility: "Anyone"
 *                 created_at: "2024-01-15T10:30:00Z"
 *                 author_name: "Jane Doe"
 *                 author_headline: "Full-stack developer"
 *                 author_role: "FREELANCER"
 *                 author_avatar: "/uploads/avatars/jane.png"
 *                 author_bio: null
 *                 likeCount: 0
 *                 commentCount: 0
 *                 repostCount: 0
 *                 liked: false
 *                 reposted: false
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Not authenticated"
 *       500:
 *         description: Failed to create post
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', upload.single('file'), async (req, res) => {
    try {
        const { userId } = getUser(req);
        const { title = '', description = '', visibility = 'Anyone', postType = 'text', eventName, eventDate, eventTime, eventLocation, eventUrl } = req.body;
        // Build attachments JSON
        let attachments = [];
        if (req.file) {
            const sub = req.file.mimetype.startsWith('video/') ? 'video'
                : req.file.mimetype.startsWith('image/') ? 'image'
                    : 'document';
            attachments = [{
                    type: sub,
                    url: `/uploads/posts/${sub}/${req.file.filename}`,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    size: req.file.size,
                }];
        }
        if (postType === 'event' && eventName) {
            attachments = [{
                    type: 'event',
                    name: eventName,
                    date: eventDate ?? null,
                    time: eventTime ?? null,
                    location: eventLocation ?? null,
                    eventUrl: eventUrl ?? null,
                }];
        }
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, undefined) // NEWID() below
            .input('userId', sql.UniqueIdentifier, userId)
            .input('title', sql.NVarChar(500), title.trim())
            .input('description', sql.NVarChar(sql.MAX), description.trim())
            .input('attachments', sql.NVarChar(sql.MAX), JSON.stringify(attachments))
            .input('postType', sql.NVarChar(50), postType)
            .input('visibility', sql.NVarChar(50), visibility)
            .query(`
        INSERT INTO posts (id, userId, title, description, attachments, postType, visibility, created_at, updated_at)
        OUTPUT INSERTED.*
        VALUES (NEWID(), @userId, @title, @description, @attachments, @postType, @visibility, SYSDATETIME(), SYSDATETIME());
      `);
        const post = result.recordset[0];
        // Fetch author info to return full post shape (matches Feed.tsx expectations)
        const userResult = await pool.request()
            .input('uid', sql.UniqueIdentifier, userId)
            .query(`SELECT name, headline, role, avatar, bio FROM users WHERE id = @uid`);
        const author = userResult.recordset[0];
        res.status(201).json({
            post: {
                ...post,
                author_name: author?.name ?? null,
                author_headline: author?.headline ?? null,
                author_role: author?.role ?? null,
                author_avatar: author?.avatar ?? null,
                author_bio: author?.bio ?? null,
                likeCount: 0, commentCount: 0, repostCount: 0,
                liked: false, reposted: false,
            },
        });
    }
    catch (e) {
        console.error('POST /api/posts error:', e);
        const status = e.status ?? 500;
        res.status(status).json({ error: e.message ?? 'Failed to create post' });
    }
});
// =============================================================================
// DELETE /api/posts/:id
// =============================================================================
/**
 * @swagger
 * /api/posts/{id}:
 *   delete:
 *     tags: [Posts]
 *     summary: Delete a post (owner only)
 *     description: >
 *       Permanently deletes the post. Ownership is verified by comparing the
 *       JWT `userId` against the post's `userId` column — attempting to delete
 *       another user's post returns `403`.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to delete
 *     responses:
 *       200:
 *         description: Post deleted successfully
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
 *         description: Authenticated user is not the post owner
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Unauthorized"
 *       404:
 *         description: Post not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Post not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   put:
 *     tags: [Posts]
 *     summary: Update a post (owner only)
 *     description: >
 *       Updates post fields and optionally replaces the attachment.
 *       Accepts `multipart/form-data` so a new file can be uploaded.
 *       All body fields are optional — omitted fields fall back to the existing
 *       stored value. The file is auto-routed to the correct subfolder based on
 *       MIME type (max **200 MB**).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to update
 *     requestBody:
 *       required: false
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePostBody'
 *     responses:
 *       200:
 *         description: Post updated — returns full updated post record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 post:
 *                   $ref: '#/components/schemas/Post'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Authenticated user is not the post owner
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
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id', async (req, res) => {
    try {
        const { userId } = getUser(req);
        const pool = await getPool();
        const check = await pool.request()
            .input('pid', sql.UniqueIdentifier, req.params.id)
            .query(`SELECT userId FROM posts WHERE id = @pid`);
        if (!check.recordset[0])
            return res.status(404).json({ error: 'Post not found' });
        if (check.recordset[0].userId !== userId)
            return res.status(403).json({ error: 'Unauthorized' });
        await pool.request()
            .input('pid', sql.UniqueIdentifier, req.params.id)
            .query(`DELETE FROM posts WHERE id = @pid`);
        res.json({ success: true });
    }
    catch (e) {
        console.error('DELETE /api/posts/:id error:', e);
        res.status(e.status ?? 500).json({ error: e.message ?? 'Failed to delete post' });
    }
});
// =============================================================================
// PUT /api/posts/:id
// =============================================================================
router.put('/:id', upload.single('file'), async (req, res) => {
    try {
        const { userId } = getUser(req);
        const pool = await getPool();
        const check = await pool.request()
            .input('pid', sql.UniqueIdentifier, req.params.id)
            .query(`SELECT * FROM posts WHERE id = @pid`);
        if (!check.recordset[0])
            return res.status(404).json({ error: 'Post not found' });
        if (check.recordset[0].userId !== userId)
            return res.status(403).json({ error: 'Unauthorized' });
        const existing = check.recordset[0];
        const { title, description, visibility, postType } = req.body;
        let attachments = existing.attachments;
        if (req.file) {
            const sub = req.file.mimetype.startsWith('video/') ? 'video'
                : req.file.mimetype.startsWith('image/') ? 'image'
                    : 'document';
            attachments = JSON.stringify([{
                    type: sub,
                    url: `/uploads/posts/${sub}/${req.file.filename}`,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    size: req.file.size,
                }]);
        }
        const result = await pool.request()
            .input('pid', sql.UniqueIdentifier, req.params.id)
            .input('title', sql.NVarChar(500), title ?? existing.title)
            .input('description', sql.NVarChar(sql.MAX), description ?? existing.description)
            .input('visibility', sql.NVarChar(50), visibility ?? existing.visibility)
            .input('postType', sql.NVarChar(50), postType ?? existing.postType)
            .input('attachments', sql.NVarChar(sql.MAX), attachments)
            .query(`
        UPDATE posts
        SET title=@title, description=@description,
            visibility=@visibility, postType=@postType,
            attachments=@attachments, updated_at=SYSDATETIME()
        WHERE id=@pid;
        SELECT * FROM posts WHERE id=@pid;
      `);
        res.json({ success: true, post: result.recordset[0] });
    }
    catch (e) {
        console.error('PUT /api/posts/:id error:', e);
        res.status(e.status ?? 500).json({ error: e.message ?? 'Failed to update post' });
    }
});
export default router;
