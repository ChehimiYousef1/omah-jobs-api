// src/services/notificationService.ts

import sql from 'mssql';
import { getPool } from '../config/db';
import { sendNotificationEmail, NotifType } from './utils/emailService';

interface CreateNotifOptions {
  recipientId:  string;
  actorId:      string;
  type:         NotifType;
  postId?:      string;
  commentId?:   string;
  commentBody?: string;
}

export async function createNotification(opts: CreateNotifOptions): Promise<void> {
  // Never notify yourself
  if (opts.recipientId === opts.actorId) return;

  const pool = await getPool();

  // 1. Persist to DB
  await pool.request()
    .input('user_id',    sql.UniqueIdentifier, opts.recipientId)
    .input('actor_id',   sql.UniqueIdentifier, opts.actorId)
    .input('type',       sql.NVarChar(20),     opts.type)
    .input('post_id',    sql.UniqueIdentifier, opts.postId    ?? null)
    .input('comment_id', sql.UniqueIdentifier, opts.commentId ?? null)
    .query(`
      INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
      VALUES (@user_id, @actor_id, @type, @post_id, @comment_id)
    `);

  // 2. Fetch names, email, avatar, post title for the email body
  const meta = (await pool.request()
    .input('rid', sql.UniqueIdentifier, opts.recipientId)
    .input('aid', sql.UniqueIdentifier, opts.actorId)
    .input('pid', sql.UniqueIdentifier, opts.postId ?? null)
    .query(`
      SELECT
        r.email    AS recipientEmail,
        r.name     AS recipientName,
        a.name     AS actorName,
        a.avatar   AS actorAvatar,
        p.title    AS postTitle
      FROM users r
      CROSS JOIN users a
      LEFT JOIN Posts p ON p.id = @pid
      WHERE r.id = @rid AND a.id = @aid
    `)).recordset[0];

  if (!meta) return;

  // 3. Send email — fire and forget, never blocks HTTP response
  sendNotificationEmail({
    toEmail:     meta.recipientEmail,
    toName:      meta.recipientName,
    actorName:   meta.actorName,
    actorAvatar: meta.actorAvatar
      ? `${process.env.API_URL || 'http://localhost:3001'}${meta.actorAvatar}`
      : undefined,
    type:        opts.type,
    postTitle:   meta.postTitle   ?? undefined,
    commentBody: opts.commentBody ?? undefined,
    postUrl:     opts.postId
      ? `${process.env.APP_URL || 'http://localhost:3000'}/posts/${opts.postId}`
      : undefined,
  });
}