# OMAH Connect — API Reference

| | |
|---|---|
| **Base URL** | `http://localhost:3001` |
| **Swagger UI** | [http://localhost:3001/api/docs](http://localhost:3001/api/docs) |
| **JSON Spec** | [http://localhost:3001/api/docs.json](http://localhost:3001/api/docs.json) |
| **Version** | 1.0.0 |

---

## Authentication

All protected endpoints require an **HTTP-only JWT cookie** named `auth_token`, valid for **7 days**.

Obtain it via:
- `POST /api/auth/login`
- `POST /api/auth/register/freelancer` or `/company`
- Microsoft / GitHub OAuth flows

> Use the **Authorize** button in Swagger UI to attach your cookie before trying protected endpoints.

---

## 🏥 Health

### `POST /api/test`
Smoke-test — confirms the server is running.

| | |
|---|---|
| **Auth** | None |
| **Body** | None |
| **Returns** | `200 { success: true }` |

---

## 🔐 Auth

### `POST /api/auth/register/freelancer`
Register a new freelancer account. Sets `auth_token` cookie on success.

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ name, email, password, headline? }` |
| **Returns** | `201` [AuthUserResponse](#authUserResponse) \| `400` \| `409 email exists` |

---

### `POST /api/auth/register/company`
Register a new company account. Sets `auth_token` cookie on success.

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ name, email, password, headline? }` |
| **Returns** | `201` [AuthUserResponse](#authUserResponse) \| `400` \| `409 email exists` |

---

### `POST /api/auth/login`
Log in with email and password. Sets `auth_token` cookie on success.

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ email, password }` |
| **Returns** | `200` [AuthUserResponse](#authUserResponse) \| `400` \| `401 invalid credentials` |

> **Security:** Returns a generic error message to prevent email enumeration.

---

### `POST /api/auth/logout`
Clear the `auth_token` cookie. Works for all auth methods.

| | |
|---|---|
| **Auth** | Required |
| **Body** | None |
| **Returns** | `200 { success: true }` |

---

### `GET /api/auth/me`
Get the currently authenticated user's profile from the database.

| | |
|---|---|
| **Auth** | Required |
| **Returns** | `200` [MeResponse](#meResponse) \| `401` \| `404 user deleted` |

> Falls back to the `token` cookie for backward compatibility.

---

### `POST /api/auth/forgot-password`
Request a password-reset email. Token expires in **15 minutes**.

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ email }` |
| **Returns** | `200` [MessageResponse](#messageResponse) (always) \| `400` |

> **Security:** Always returns 200 — prevents user enumeration.

---

### `POST /api/auth/reset-password`
Reset password using the token delivered via email.

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ token, password }` (password min 8 chars) |
| **Returns** | `200` [MessageResponse](#messageResponse) \| `400 invalid/expired` \| `400 short password` |

---

### `POST /api/auth/update-avatar`
Upload a new avatar image. Saved to `/uploads/avatars/`.

| | |
|---|---|
| **Auth** | Required |
| **Body** | `multipart/form-data { avatar: <file> }` |
| **Returns** | `200` [AuthUserResponse](#authUserResponse) \| `400` \| `401` \| `404` |

---

### `POST /api/auth/update-cover`
Upload a new cover photo. Saved to `/uploads/covers/`.

| | |
|---|---|
| **Auth** | Required |
| **Body** | `multipart/form-data { cover: <file> }` |
| **Returns** | `200` [CoverUpdateResponse](#coverUpdateResponse) \| `400` \| `401` \| `404` |

---

### `GET /api/auth/microsoft`
Initiate Microsoft OAuth 2.0 flow. Generates CSRF state token and redirects.

| | |
|---|---|
| **Auth** | None |
| **Returns** | `302 →` Microsoft authorization page |
| **Env vars** | `MICROSOFT_CLIENT_ID`, `MICROSOFT_REDIRECT_URI` |

---

### `GET /api/auth/microsoft/callback`
Microsoft OAuth callback — called by Microsoft after user authorizes.

| | |
|---|---|
| **Auth** | None |
| **Query** | `?code=&state=&error=` |
| **Success** | `302 → FRONTEND_URL/social/feed` + sets `auth_token` cookie |
| **Failure** | `302 → FRONTEND_URL/login?error=<reason>` |

**Error reasons:** `invalid_state` · `missing_code` · `token_exchange_failed` · `email_missing` · `authentication_failed`

---

### `GET /api/auth/github`
Initiate GitHub OAuth flow. Requests `read:user user:email` scopes.

| | |
|---|---|
| **Auth** | None |
| **Returns** | `302 →` GitHub authorization page |
| **Env vars** | `GITHUB_CLIENT_ID`, `GITHUB_REDIRECT_URI` |

---

### `GET /api/auth/github/callback`
GitHub OAuth callback — called by GitHub after user authorizes.

| | |
|---|---|
| **Auth** | None |
| **Query** | `?code=&state=&error=` |
| **Success** | `302 → FRONTEND_URL/social/feed` + sets `auth_token` cookie |
| **Failure** | `302 → FRONTEND_URL/login?error=<reason>` |

**Error reasons:** `access_denied` · `missing_code` · `invalid_state` · `token_exchange_failed` · `user_fetch_failed` · `email_missing` · `authentication_failed`

---

## 📝 Posts

### `GET /api/posts`
Get the posts feed. Works for both guests and authenticated users.

| | |
|---|---|
| **Auth** | Optional |
| **Returns** | `200 { posts:` [FeedPost](#feedPost)`[] }` \| `500` |

> - **Guest:** `liked` and `reposted` always `false`. `Only Me` posts excluded.
> - **Authenticated:** `liked`/`reposted` reflect current user. Own `Only Me` posts included.

---

### `POST /api/posts`
Create a new post with optional file attachment.

| | |
|---|---|
| **Auth** | Required |
| **Body** | `multipart/form-data` — see fields below |
| **Returns** | `201 { post:` [FeedPost](#feedPost) `}` \| `401` |

**Body fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | No | Post title |
| `description` | string | No | Post body text |
| `visibility` | string | No | `Anyone` \| `Connections` \| `Only Me` (default: `Anyone`) |
| `postType` | string | No | `text` \| `image` \| `video` \| `document` \| `event` (default: `text`) |
| `file` | binary | No | Attachment — max **200 MB**, auto-routed by MIME type |
| `eventName` | string | No | Required when `postType=event` |
| `eventDate` | string | No | e.g. `2024-06-15` |
| `eventTime` | string | No | e.g. `18:00` |
| `eventLocation` | string | No | e.g. `Beirut, Lebanon` |
| `eventUrl` | string | No | External event URL |

---

### `DELETE /api/posts/:id`
Permanently delete a post. Owner only.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `id` = post UUID |
| **Returns** | `200 { success: true }` \| `401` \| `403` \| `404` |

---

### `PUT /api/posts/:id`
Update a post. Owner only. All fields optional — omitted fields keep existing values.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `id` = post UUID |
| **Body** | `multipart/form-data { title?, description?, visibility?, postType?, file? }` |
| **Returns** | `200 { success: true, post:` [Post](#post) `}` \| `401` \| `403` \| `404` |

---

## 💬 Comments

### `GET /api/posts/:postId/comments`
Get all comments for a post as a nested tree.

| | |
|---|---|
| **Auth** | None |
| **Params** | `postId` = post UUID |
| **Returns** | `200 { comments:` [CommentNode](#commentNode)`[] }` |

> Replies are nested under their parent via the `replies[]` array (recursive).

---

### `POST /api/posts/:postId/comments`
Add a top-level comment or a reply to an existing comment.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `postId` = post UUID |
| **Body** | `{ body, parent_id? }` |
| **Returns** | `201 { comment:` [CommentNode](#commentNode) `}` \| `400` \| `401` |

---

### `DELETE /api/posts/:postId/comments/:commentId`
Delete a comment. Author only.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `postId`, `commentId` |
| **Returns** | `200 { success: true }` \| `401` \| `403` |

---

### `GET /api/posts/:postId/comments/mentions-search`
Search users for `@mention` autocomplete. Returns up to **8** matches.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `postId` = post UUID |
| **Query** | `?q=<partial name>` |
| **Returns** | `200 { users:` [MentionUser](#mentionUser)`[] }` |

---

## ⚡ Interactions

### `GET /api/post-interactions/posts/:id/stats`
Get live interaction counts for a post.

| | |
|---|---|
| **Auth** | None |
| **Params** | `id` = post UUID |
| **Returns** | `200` [PostStats](#postStats) |

---

### `POST /api/post-interactions/posts/:id/like`
Like a post. Idempotent — no error if already liked.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `id` = post UUID |
| **Returns** | `200 { success: true }` \| `401` |

> Fires a `LIKE` notification to the post owner asynchronously.

---

### `DELETE /api/post-interactions/posts/:id/like`
Unlike a post.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `id` = post UUID |
| **Returns** | `200 { success: true }` \| `401` |

---

### `POST /api/post-interactions/posts/:id/repost`
Repost a post.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `id` = post UUID |
| **Returns** | `201 { success: true }` \| `401` \| `404` \| `409 already reposted` |

> Fires a `REPOST` notification to the post owner asynchronously.

---

### `DELETE /api/post-interactions/posts/:id/repost`
Undo a repost.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `id` = post UUID |
| **Returns** | `200 { success: true }` \| `401` |

---

### `POST /api/post-interactions/saved-posts`
Save / bookmark a post. Idempotent.

| | |
|---|---|
| **Auth** | Required |
| **Body** | `{ post_id }` |
| **Returns** | `200 { success: true }` \| `401` |

---

### `DELETE /api/post-interactions/saved-posts/:postId`
Remove a saved post.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `postId` = post UUID |
| **Returns** | `200 { success: true }` \| `401` |

---

### `POST /api/post-interactions/posts/:id/report`
Report a post.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `id` = post UUID |
| **Body** | `{ reason? }` (defaults to `"Reported by user"`) |
| **Returns** | `200 { success: true }` \| `401` |

---

## 🤝 Connections

### `GET /api/connections`
Get the current user's accepted connections (alphabetical order).

| | |
|---|---|
| **Auth** | Required |
| **Returns** | `200 { connections:` [ConnectionUser](#connectionUser)`[] }` |

> Bidirectional — returns connections regardless of who originally sent the request.

---

### `POST /api/post-interactions/followers`
Follow a user. Idempotent.

| | |
|---|---|
| **Auth** | Required |
| **Body** | `{ following_id }` |
| **Returns** | `200 { success: true }` \| `401` |

> Fires a `FOLLOW` notification to the followed user asynchronously.

---

### `DELETE /api/post-interactions/followers/:userId`
Unfollow a user.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `userId` = target user UUID |
| **Returns** | `200 { success: true }` \| `401` |

---

### `POST /api/post-interactions/blocked-users`
Block a user. Idempotent. No notification sent to blocked user.

| | |
|---|---|
| **Auth** | Required |
| **Body** | `{ blocked_id }` |
| **Returns** | `200 { success: true }` \| `401` |

---

### `DELETE /api/post-interactions/blocked-users/:userId`
Unblock a user.

| | |
|---|---|
| **Auth** | Required |
| **Params** | `userId` = target user UUID |
| **Returns** | `200 { success: true }` \| `401` |

---

## ✉️ Messages

### `POST /api/messages`
Send a direct message or share a post with another user.

| | |
|---|---|
| **Auth** | Required |
| **Body** | `{ recipient_id, post_id?, type?, content? }` |
| **Returns** | `201 { success: true }` \| `400` \| `401` |

**Body fields:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `recipient_id` | UUID | ✅ | — | Receiving user's UUID |
| `post_id` | UUID | No | null | Post being shared |
| `type` | string | No | `post_share` | `post_share` \| `text` |
| `content` | string | No | `""` | Optional message text |

> Sender is resolved from the JWT — cannot be spoofed via the request body.

---

## 📦 Response Schemas

### AuthUserResponse {#authUserResponse}
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "jane@example.com",
    "name": "Jane Doe",
    "role": "FREELANCER | COMPANY",
    "avatar": "/uploads/avatars/...",
    "coverPage": null,
    "headline": "Full-stack developer",
    "bio": null
  }
}
```

### MeResponse {#meResponse}
```json
{
  "success": true,
  "user": { "id", "email", "name", "role", "avatar", "coverPage" }
}
```

### CoverUpdateResponse {#coverUpdateResponse}
```json
{
  "success": true,
  "user": { "id", "email", "name", "role", "avatar", "coverPage" }
}
```

### FeedPost {#feedPost}
```json
{
  "id": "uuid", "userId": "uuid",
  "title": "Hello World", "description": "...",
  "attachments": "[]", "postType": "text", "visibility": "Anyone",
  "created_at": "2024-01-15T10:30:00Z",
  "author_name": "Jane Doe", "author_headline": "...",
  "author_role": "FREELANCER", "author_avatar": "...", "author_bio": null,
  "likeCount": 5, "commentCount": 2, "repostCount": 1,
  "liked": false, "reposted": false
}
```

### Post {#post}
```json
{
  "id": "uuid", "userId": "uuid", "title": "...", "description": "...",
  "attachments": "[]", "visibility": "Anyone", "postType": "text",
  "created_at": "...", "updated_at": "..."
}
```

### CommentNode {#commentNode}
```json
{
  "id": "uuid", "body": "Great post!", "parent_id": null,
  "created_at": "...", "author_id": "uuid",
  "author_name": "Jane Doe", "author_avatar": null, "author_headline": "...",
  "replies": [ /* recursive CommentNode[] */ ]
}
```

### PostStats {#postStats}
```json
{ "likeCount": 42, "commentCount": 7, "repostCount": 3 }
```

### ConnectionUser {#connectionUser}
```json
{ "id": "uuid", "name": "Jane Doe", "avatar": "...", "headline": "..." }
```

### MentionUser {#mentionUser}
```json
{ "id": "uuid", "name": "Jane Doe", "avatar": null, "headline": "..." }
```

### Message {#message}
```json
{
  "id": "uuid", "sender_id": "uuid", "recipient_id": "uuid",
  "post_id": null, "type": "post_share",
  "content": "Check this out!", "created_at": "..."
}
```

### SuccessResponse
```json
{ "success": true }
```

### MessageResponse {#messageResponse}
```json
{ "success": true, "message": "Operation completed successfully." }
```

### ErrorResponse
```json
{ "success": false, "error": "An unexpected error occurred." }
```

---

## HTTP Status Codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `302` | Redirect (OAuth flows) |
| `400` | Bad Request — validation / missing fields |
| `401` | Unauthorized — missing or invalid `auth_token` |
| `403` | Forbidden — authenticated but not the resource owner |
| `404` | Not Found |
| `409` | Conflict — duplicate (e.g. already reposted) |
| `500` | Internal Server Error |

---

## Contact

| | |
|---|---|
| **Primary** | Youssef@openmindsaihamburg.com |
| **Secondary** | chehimi030@gmail.com |
| **Swagger UI** | http://localhost:3001/api/docs |
