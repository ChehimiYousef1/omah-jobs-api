// utils/swaggerOption.ts
// Central OpenAPI definition — imported by server.ts
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'OMAH Connect API',
        version: '1.0.0',
        description: [
            'Full REST API for the **OMAH Connect** platform.',
            '',
            '### Authentication',
            'All protected endpoints require an `auth_token` HTTP-only cookie.',
            'Obtain it via `/api/auth/login`, `/api/auth/register/*`,',
            'or the Microsoft / GitHub OAuth flows.',
            '',
            '### Try it out',
            'Use the **Authorize** button (top-right) to attach your cookie,',
            'then click **Try it out** on any endpoint.',
        ].join('\n'),
        contact: {
            name: 'OMAH Connect Support',
            email: process.env.SUPPORT_EMAIL || 'Youssef@openmindsaihamburg.com',
        },
    },
    servers: [
        {
            url: `http://localhost:${PORT}`,
            description: 'Local development server',
        },
        // ✅ Render Deployment
        ...(process.env.RENDER_URL
            ? [
                {
                    url: process.env.RENDER_URL,
                    description: 'Render production server',
                },
            ]
            : []),
        // ✅ Optional: Other production URL
        ...(process.env.PRODUCTION_URL
            ? [
                {
                    url: process.env.PRODUCTION_URL,
                    description: 'Production server',
                },
            ]
            : []),
    ],
    components: {
        // ── Security ───────────────────────────────────────────────────────────
        securitySchemes: {
            cookieAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'auth_token', // matches the cookie set by all auth routes
                description: 'HTTP-only JWT cookie valid for 7 days. Set automatically on login / register / OAuth.',
            },
        },
        schemas: {
            // ════════════════════════════════════════════════════════════════════
            // AUTH
            // ════════════════════════════════════════════════════════════════════
            LoginBody: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email', example: 'jane@example.com' },
                    password: { type: 'string', format: 'password', example: 'MySecret123' },
                },
            },
            RegisterFreelancerBody: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                    name: { type: 'string', example: 'Jane Doe' },
                    email: { type: 'string', format: 'email', example: 'jane@example.com' },
                    password: { type: 'string', format: 'password', minLength: 8, example: 'MySecret123' },
                    headline: { type: 'string', nullable: true, example: 'Full-stack developer' },
                },
            },
            RegisterCompanyBody: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                    name: { type: 'string', example: 'Acme Corp' },
                    email: { type: 'string', format: 'email', example: 'hr@acme.com' },
                    password: { type: 'string', format: 'password', minLength: 8, example: 'CorpSecret123' },
                    headline: { type: 'string', nullable: true, example: 'We build great products' },
                },
            },
            AuthUserResponse: {
                type: 'object',
                description: 'Returned after any successful login or registration',
                properties: {
                    success: { type: 'boolean', example: true },
                    user: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', format: 'uuid', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
                            email: { type: 'string', example: 'jane@example.com' },
                            name: { type: 'string', example: 'Jane Doe' },
                            role: { type: 'string', enum: ['FREELANCER', 'COMPANY'], example: 'FREELANCER' },
                            avatar: { type: 'string', nullable: true, example: '/uploads/avatars/1710000000000.jpg' },
                            coverPage: { type: 'string', nullable: true, example: null },
                            headline: { type: 'string', nullable: true, example: 'Full-stack developer' },
                            bio: { type: 'string', nullable: true, example: null },
                        },
                    },
                },
            },
            MeResponse: {
                type: 'object',
                description: 'Response shape for GET /api/auth/me',
                properties: {
                    success: { type: 'boolean', example: true },
                    user: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', format: 'uuid', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
                            email: { type: 'string', example: 'jane@example.com' },
                            name: { type: 'string', example: 'Jane Doe' },
                            role: { type: 'string', enum: ['FREELANCER', 'COMPANY'], example: 'FREELANCER' },
                            avatar: { type: 'string', nullable: true, example: '/uploads/avatars/Jane_Doe_microsoft.png' },
                            coverPage: { type: 'string', nullable: true, example: null },
                        },
                    },
                },
            },
            CoverUpdateResponse: {
                type: 'object',
                description: 'Response shape for POST /api/auth/update-cover',
                properties: {
                    success: { type: 'boolean', example: true },
                    user: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', format: 'uuid', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
                            email: { type: 'string', example: 'jane@example.com' },
                            name: { type: 'string', example: 'Jane Doe' },
                            role: { type: 'string', enum: ['FREELANCER', 'COMPANY'], example: 'FREELANCER' },
                            avatar: { type: 'string', nullable: true, example: '/uploads/avatars/Jane_Doe_microsoft.png' },
                            coverPage: { type: 'string', nullable: true, example: '/uploads/covers/1710000000000.jpg' },
                        },
                    },
                },
            },
            ForgotPasswordBody: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { type: 'string', format: 'email', example: 'jane@example.com' },
                },
            },
            ResetPasswordBody: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                    token: {
                        type: 'string',
                        example: 'a3f1c29d8e4b7f2c...',
                        description: '64-char hex token delivered via the reset-password email link',
                    },
                    password: {
                        type: 'string',
                        format: 'password',
                        minLength: 8,
                        example: 'NewSecret123',
                        description: 'New password — minimum 8 characters',
                    },
                },
            },
            // ════════════════════════════════════════════════════════════════════
            // POSTS
            // ════════════════════════════════════════════════════════════════════
            Post: {
                type: 'object',
                description: 'Raw post record as stored in the database',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'p1a2b3c4-...' },
                    userId: { type: 'string', format: 'uuid', example: 'u1a2b3c4-...' },
                    title: { type: 'string', example: 'Hello World' },
                    description: { type: 'string', nullable: true, example: 'My first post content.' },
                    attachments: { type: 'string', example: '[]', description: 'JSON array string of attachment objects' },
                    visibility: { type: 'string', example: 'Anyone' },
                    postType: { type: 'string', example: 'text' },
                    created_at: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
                    updated_at: { type: 'string', format: 'date-time', example: '2024-01-15T11:00:00Z' },
                },
            },
            FeedPost: {
                type: 'object',
                description: 'Post as returned by the feed — includes denormalized author info and live interaction counts',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'p1a2b3c4-...' },
                    userId: { type: 'string', format: 'uuid', example: 'u1a2b3c4-...' },
                    title: { type: 'string', example: 'Hello World' },
                    description: { type: 'string', nullable: true, example: 'My first post.' },
                    attachments: { type: 'string', example: '[]', description: 'JSON array string of attachment objects' },
                    postType: { type: 'string', example: 'text' },
                    visibility: { type: 'string', example: 'Anyone' },
                    created_at: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
                    author_name: { type: 'string', nullable: true, example: 'Jane Doe' },
                    author_headline: { type: 'string', nullable: true, example: 'Full-stack developer' },
                    author_role: { type: 'string', nullable: true, example: 'FREELANCER' },
                    author_avatar: { type: 'string', nullable: true, example: '/uploads/avatars/jane.png' },
                    author_bio: { type: 'string', nullable: true, example: null },
                    likeCount: { type: 'integer', example: 5 },
                    commentCount: { type: 'integer', example: 2 },
                    repostCount: { type: 'integer', example: 1 },
                    liked: { type: 'boolean', example: false, description: 'True if the authenticated user has liked this post' },
                    reposted: { type: 'boolean', example: false, description: 'True if the authenticated user has reposted this post' },
                },
            },
            CreatePostBody: {
                type: 'object',
                description: 'multipart/form-data body for creating a post',
                properties: {
                    title: { type: 'string', example: 'Hello World', description: 'Post title' },
                    description: { type: 'string', example: 'My first post content.', description: 'Post body text' },
                    visibility: { type: 'string', example: 'Anyone', default: 'Anyone', description: '`Anyone` | `Connections` | `Only Me`' },
                    postType: { type: 'string', example: 'text', default: 'text', description: '`text` | `image` | `video` | `document` | `event`' },
                    file: { type: 'string', format: 'binary', nullable: true, description: 'Attachment file — max 200 MB; auto-routed to subfolder by MIME type' },
                    eventName: { type: 'string', nullable: true, example: 'OMAH Dev Meetup', description: 'Required when postType is `event`' },
                    eventDate: { type: 'string', nullable: true, example: '2024-06-15' },
                    eventTime: { type: 'string', nullable: true, example: '18:00' },
                    eventLocation: { type: 'string', nullable: true, example: 'Beirut, Lebanon' },
                    eventUrl: { type: 'string', nullable: true, example: 'https://meetup.example.com' },
                },
            },
            UpdatePostBody: {
                type: 'object',
                description: 'multipart/form-data body for updating a post — all fields optional; omitted fields keep their existing value',
                properties: {
                    title: { type: 'string', example: 'Updated title' },
                    description: { type: 'string', example: 'Updated description.' },
                    visibility: { type: 'string', example: 'public', description: '`Anyone` | `Connections` | `Only Me`' },
                    postType: { type: 'string', example: 'article', description: '`text` | `image` | `video` | `document` | `event`' },
                    file: { type: 'string', format: 'binary', nullable: true, description: 'Optional replacement attachment — omit to keep the existing file' },
                },
            },
            // ════════════════════════════════════════════════════════════════════
            // COMMENTS
            // ════════════════════════════════════════════════════════════════════
            CreateCommentBody: {
                type: 'object',
                required: ['body'],
                properties: {
                    body: {
                        type: 'string',
                        example: 'Great post!',
                    },
                    parent_id: {
                        type: 'string',
                        format: 'uuid',
                        nullable: true,
                        example: null,
                        description: 'UUID of the parent comment — omit for a top-level comment',
                    },
                },
            },
            CommentNode: {
                type: 'object',
                description: 'A comment, optionally containing nested replies',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'c1d2e3f4-...' },
                    body: { type: 'string', example: 'Great post!' },
                    parent_id: { type: 'string', format: 'uuid', nullable: true, example: null },
                    created_at: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
                    author_id: { type: 'string', format: 'uuid', example: 'u1a2b3c4-...' },
                    author_name: { type: 'string', example: 'Jane Doe' },
                    author_avatar: { type: 'string', nullable: true, example: null },
                    author_headline: { type: 'string', nullable: true, example: 'Full-stack developer' },
                    replies: {
                        type: 'array',
                        description: 'Nested reply comments (recursive)',
                        items: { $ref: '#/components/schemas/CommentNode' },
                    },
                },
            },
            // ════════════════════════════════════════════════════════════════════
            // INTERACTIONS
            // ════════════════════════════════════════════════════════════════════
            PostStats: {
                type: 'object',
                description: 'Aggregated interaction counts for a post',
                properties: {
                    likeCount: { type: 'integer', example: 42 },
                    commentCount: { type: 'integer', example: 7 },
                    repostCount: { type: 'integer', example: 3 },
                },
            },
            // ════════════════════════════════════════════════════════════════════
            // CONNECTIONS
            // ════════════════════════════════════════════════════════════════════
            ConnectionUser: {
                type: 'object',
                description: 'A user returned as part of the accepted connections list',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'u1a2b3c4-0000-0000-0000-000000000000' },
                    name: { type: 'string', example: 'Jane Doe' },
                    avatar: { type: 'string', nullable: true, example: '/uploads/jane.jpg' },
                    headline: { type: 'string', nullable: true, example: 'Full-stack developer' },
                },
            },
            MentionUser: {
                type: 'object',
                description: 'Lightweight user object returned by @mention autocomplete',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'u1a2b3c4-...' },
                    name: { type: 'string', example: 'Jane Doe' },
                    avatar: { type: 'string', nullable: true, example: null },
                    headline: { type: 'string', nullable: true, example: 'Full-stack developer' },
                },
            },
            // ════════════════════════════════════════════════════════════════════
            // MESSAGES
            // ════════════════════════════════════════════════════════════════════
            SendMessageBody: {
                type: 'object',
                required: ['recipient_id'],
                properties: {
                    recipient_id: {
                        type: 'string',
                        format: 'uuid',
                        example: 'u2b3c4d5-0000-0000-0000-000000000000',
                        description: 'UUID of the receiving user',
                    },
                    post_id: {
                        type: 'string',
                        format: 'uuid',
                        nullable: true,
                        example: 'p1a2b3c4-0000-0000-0000-000000000000',
                        description: 'UUID of the post being shared — used when type is `post_share`',
                    },
                    type: {
                        type: 'string',
                        example: 'post_share',
                        default: 'post_share',
                        description: 'Message type — e.g. `post_share` or `text`',
                    },
                    content: {
                        type: 'string',
                        example: "Thought you'd find this interesting!",
                        default: '',
                        description: 'Optional text body — can accompany a post share or stand alone',
                    },
                },
            },
            Message: {
                type: 'object',
                description: 'A message record as stored in the database',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'm1a2b3c4-...' },
                    sender_id: { type: 'string', format: 'uuid', example: 'u1a2b3c4-...' },
                    recipient_id: { type: 'string', format: 'uuid', example: 'u2b3c4d5-...' },
                    post_id: { type: 'string', format: 'uuid', nullable: true, example: null },
                    type: { type: 'string', example: 'post_share' },
                    content: { type: 'string', example: 'Check this out!' },
                    created_at: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
                },
            },
            // ════════════════════════════════════════════════════════════════════
            // GENERIC
            // ════════════════════════════════════════════════════════════════════
            SuccessResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                },
            },
            MessageResponse: {
                type: 'object',
                description: 'Generic success response with a human-readable message string',
                properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Operation completed successfully.' },
                },
            },
            ErrorResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'An unexpected error occurred.' },
                },
            },
        },
    },
    // ── Tags (controls sidebar order in Swagger UI) ─────────────────────────
    tags: [
        { name: 'Health', description: 'Server health & smoke-test endpoints' },
        { name: 'Auth', description: 'Login, register, OAuth, profile, password reset' },
        { name: 'Posts', description: 'Create, read, update, delete posts' },
        { name: 'Comments', description: 'Threaded comments on posts' },
        { name: 'Interactions', description: 'Likes, reposts, saves, reports' },
        { name: 'Connections', description: 'Follow, unfollow, block, accepted connections' },
        { name: 'Messages', description: 'Direct messages and post shares' },
    ],
};
export default swaggerDefinition;
