import { Router } from 'express';
import sql from 'mssql';
import jwt from 'jsonwebtoken';
import { getPool } from './microsoft-auth.js';
const router = Router();
// =============================================================================
// GET /api/connections  — get current user's connections
// =============================================================================
/**
 * @swagger
 * /api/connections:
 *   get:
 *     tags: [Connections]
 *     summary: Get current user's accepted connections
 *     description: >
 *       Returns all users who have an `accepted` connection with the
 *       authenticated user, regardless of who sent the original request.
 *       Results are ordered alphabetically by name.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of accepted connections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 connections:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ConnectionUser'
 *             example:
 *               connections:
 *                 - id: "u1a2b3c4-0000-0000-0000-000000000000"
 *                   name: "Jane Doe"
 *                   avatar: null
 *                   headline: "Full-stack developer"
 *                 - id: "u2b3c4d5-0000-0000-0000-000000000000"
 *                   name: "John Smith"
 *                   avatar: "/uploads/john.jpg"
 *                   headline: "Product Designer"
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
 *               error: "Failed to fetch connections"
 */
router.get('/', async (req, res) => {
    try {
        const token = req.cookies?.auth_token;
        if (!token)
            return res.status(401).json({ error: 'Not authenticated' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const pool = await getPool();
        const result = await pool.request()
            .input('uid', sql.UniqueIdentifier, decoded.userId)
            .query(`
        SELECT
          u.id, u.name, u.avatar, u.headline
        FROM connections c
        JOIN users u ON (
          CASE WHEN c.sender_id = @uid THEN c.receiver_id ELSE c.sender_id END = u.id
        )
        WHERE (c.sender_id = @uid OR c.receiver_id = @uid)
          AND c.status = 'accepted'
        ORDER BY u.name ASC
      `);
        res.json({ connections: result.recordset });
    }
    catch (e) {
        console.error('GET /api/connections error:', e);
        res.status(500).json({ error: 'Failed to fetch connections' });
    }
});
export default router;
