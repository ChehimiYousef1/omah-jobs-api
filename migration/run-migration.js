/**
 * ============================================================
 *  omah_jobs — Full Database Migration
 *  Run: node migration.js
 *  Requires: npm install mssql dotenv
 *
 *  Built to match server.js WITHOUT changing server.js.
 *
 *  Every decision explained inline where it differs from
 *  "ideal" schema design, with the server.js line that
 *  forces the decision.
 * ============================================================
 */

require('dotenv').config();
const sql = require('mssql');

// ─── DB Config ────────────────────────────────────────────────
// server.js uses DB_HOST (not DB_SERVER), DB_PORT — matched here
const config = {
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong!Passw0rd',
  server:   process.env.DB_HOST     || process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME     || 'omah_jobs',
  port:     Number(process.env.DB_PORT) || 1433,
  options: {
    encrypt:                true,
    trustServerCertificate: true,
    enableArithAbort:       true,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

const migrations = [

  // ════════════════════════════════════════════════
  // 001 — migration tracking table (bootstrap)
  // ════════════════════════════════════════════════
  {
    version:     '001_migrations_log',
    description: 'Create migrations tracking table',
    steps: [`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'migrations_log')
      BEGIN
        CREATE TABLE migrations_log (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          version     NVARCHAR(100) NOT NULL UNIQUE,
          description NVARCHAR(500),
          applied_at  DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
          duration_ms INT
        );
      END
    `],
  },

  // ════════════════════════════════════════════════
  // 002 — users
  //
  // Why each decision:
  //
  // ► id DEFAULT NEWID()
  //   server register INSERT:
  //     VALUES (NEWID(), @email, @password, @name, @role, ...)
  //   server OAuth MERGE:
  //     INSERT (id, ...) VALUES (NEWID(), ...)
  //   The server supplies NEWID() explicitly, so the column
  //   default is only a safety net — NEWID() matches.
  //
  // ► password NULL
  //   GitHub OAuth MERGE INSERT does NOT include password:
  //     INSERT (id, email, name, role, avatar, created_at, updated_at)
  //   Microsoft OAuth MERGE INSERT also omits it:
  //     INSERT (id, email, name, role) VALUES (NEWID(), ...)
  //   A NOT NULL constraint would reject both OAuth inserts.
  //
  // ► coverPage  (camelCase column name)
  //   server /api/auth/me:
  //     SELECT id, email, name, role, avatar, coverPage FROM users
  //   server update-cover UPDATE:
  //     SET coverPage = @coverPage
  //   SQL Server is case-insensitive on default Windows collation,
  //   but we name it coverPage to be explicit and avoid confusion.
  //
  // ► reset_token, reset_expires  (snake_case)
  //   server forgot-password:
  //     SET reset_token = @token, reset_expires = @expires
  //   server reset-password:
  //     WHERE [reset_token] = @token AND [reset_expires] > GETDATE()
  //
  // ► No is_active, no login_attempts, no locked_until
  //   server.js login query:
  //     SELECT id, email, password, name, role FROM users WHERE email = @email
  //   server.js authenticate middleware:
  //     SELECT id, name, email, role FROM users WHERE id = @userId
  //   Neither query reads or writes these columns, so adding them
  //   would be safe but unused — omitted to keep schema honest.
  // ════════════════════════════════════════════════
  {
    version:     '002_create_users',
    description: 'Create users table — matches server.js queries exactly',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
      BEGIN
        CREATE TABLE users (
          id                  UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          email               NVARCHAR(255)    NOT NULL,
          password            NVARCHAR(255)    NULL,        -- NULL: OAuth users have no password
          name                NVARCHAR(255)    NOT NULL,
          role                NVARCHAR(20)     NOT NULL
                                CONSTRAINT CHK_users_role
                                CHECK (role IN ('FREELANCER','COMPANY','ADMIN')),
          bio                 NVARCHAR(MAX)    NULL,
          avatar              NVARCHAR(500)    NULL,
          coverPage           NVARCHAR(500)    NULL,        -- camelCase: server SELECTs "coverPage"
          headline            NVARCHAR(255)    NULL,
          location            NVARCHAR(255)    NULL,
          hourly_rate         DECIMAL(10,2)    NULL,
          availability_status NVARCHAR(20)     NULL
                                CONSTRAINT CHK_users_avail
                                CHECK (availability_status IN ('AVAILABLE','BUSY','UNAVAILABLE')),
          profile_completion  INT              NULL DEFAULT 0,
          profile_updated_at  DATETIME2        NULL,
          reset_token         NVARCHAR(255)    NULL,
          reset_expires       DATETIME2        NULL,
          created_at          DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at          DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_users PRIMARY KEY (id)
        );
      END
      `,
      //-- Unique email — server checks existence before INSERT
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'UQ_users_email' AND object_id = OBJECT_ID('users')
      )
        CREATE UNIQUE NONCLUSTERED INDEX UQ_users_email
          ON users(email)
          WITH (FILLFACTOR = 90);
      `,
      //-- Role — authenticate middleware loads user by id+role on every request
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_users_role' AND object_id = OBJECT_ID('users')
      )
        CREATE NONCLUSTERED INDEX IX_users_role
          ON users(role)
          INCLUDE (id, name, avatar, headline)
          WITH (FILLFACTOR = 90);
      `,
      //-- reset_token — partial, only rows with an active token
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_users_reset_token' AND object_id = OBJECT_ID('users')
      )
        CREATE NONCLUSTERED INDEX IX_users_reset_token
          ON users(reset_token)
          WHERE reset_token IS NOT NULL
          WITH (FILLFACTOR = 90);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 003 — skills
  // ════════════════════════════════════════════════
  {
    version:     '003_create_skills',
    description: 'Create skills lookup table',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'skills')
      BEGIN
        CREATE TABLE skills (
          id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          name          NVARCHAR(255)    NOT NULL,
          category      NVARCHAR(100)    NULL,
          is_predefined BIT              NOT NULL DEFAULT 0,
          created_at    DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_skills PRIMARY KEY (id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'UQ_skills_name' AND object_id = OBJECT_ID('skills')
      )
        CREATE UNIQUE NONCLUSTERED INDEX UQ_skills_name
          ON skills(name) WITH (FILLFACTOR = 90);
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_skills_category' AND object_id = OBJECT_ID('skills')
      )
        CREATE NONCLUSTERED INDEX IX_skills_category
          ON skills(category)
          INCLUDE (id, name)
          WITH (FILLFACTOR = 90);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 004 — opportunities
  // ════════════════════════════════════════════════
  {
    version:     '004_create_opportunities',
    description: 'Create opportunities table',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'opportunities')
      BEGIN
        CREATE TABLE opportunities (
          id               UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          title            NVARCHAR(255)    NOT NULL,
          description      NVARCHAR(MAX)    NOT NULL,
          required_skills  NVARCHAR(MAX)    NULL,
          budget_min       DECIMAL(10,2)    NULL,
          budget_max       DECIMAL(10,2)    NULL,
          budget_currency  NVARCHAR(10)     NOT NULL DEFAULT 'USD',
          contact_email    NVARCHAR(255)    NOT NULL,
          contact_linkedin NVARCHAR(500)    NULL,
          deadline         DATE             NOT NULL,
          duration         NVARCHAR(100)    NULL,
          location         NVARCHAR(255)    NULL,
          type             NVARCHAR(20)     NULL
                             CONSTRAINT CHK_opp_type
                             CHECK (type IN ('FULL_TIME','PART_TIME','CONTRACT','FREELANCE')),
          experience_level NVARCHAR(20)     NULL
                             CONSTRAINT CHK_opp_exp
                             CHECK (experience_level IN ('ENTRY','INTERMEDIATE','SENIOR','EXPERT')),
          status           NVARCHAR(20)     NOT NULL DEFAULT 'ACTIVE'
                             CONSTRAINT CHK_opp_status
                             CHECK (status IN ('ACTIVE','CLOSED','EXPIRED')),
          view_count       INT              NOT NULL DEFAULT 0,
          created_by_id    UNIQUEIDENTIFIER NOT NULL,
          created_at       DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at       DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_opportunities PRIMARY KEY (id),
          CONSTRAINT FK_opp_user
            FOREIGN KEY (created_by_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_opp_status_deadline' AND object_id = OBJECT_ID('opportunities')
      )
        CREATE NONCLUSTERED INDEX IX_opp_status_deadline
          ON opportunities(status, deadline)
          INCLUDE (id, title, type, experience_level, budget_min, budget_max, created_by_id)
          WITH (FILLFACTOR = 85);
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_opp_created_by' AND object_id = OBJECT_ID('opportunities')
      )
        CREATE NONCLUSTERED INDEX IX_opp_created_by
          ON opportunities(created_by_id)
          INCLUDE (id, title, status, created_at)
          WITH (FILLFACTOR = 90);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 005 — applications
  // ════════════════════════════════════════════════
  {
    version:     '005_create_applications',
    description: 'Create applications table',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'applications')
      BEGIN
        CREATE TABLE applications (
          id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          status          NVARCHAR(20)     NOT NULL DEFAULT 'PENDING'
                            CONSTRAINT CHK_app_status
                            CHECK (status IN ('PENDING','REVIEWING','ACCEPTED','REJECTED','WITHDRAWN')),
          cover_letter    NVARCHAR(MAX)    NULL,
          proposed_budget DECIMAL(10,2)    NULL,
          user_id         UNIQUEIDENTIFIER NOT NULL,
          opportunity_id  UNIQUEIDENTIFIER NOT NULL,
          created_at      DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at      DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_applications PRIMARY KEY (id),
          CONSTRAINT FK_app_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_app_opportunity
            FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT UQ_app_user_opp UNIQUE (user_id, opportunity_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_app_opportunity' AND object_id = OBJECT_ID('applications')
      )
        CREATE NONCLUSTERED INDEX IX_app_opportunity
          ON applications(opportunity_id, status)
          INCLUDE (id, user_id, created_at)
          WITH (FILLFACTOR = 85);
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_app_user_status' AND object_id = OBJECT_ID('applications')
      )
        CREATE NONCLUSTERED INDEX IX_app_user_status
          ON applications(user_id, status)
          INCLUDE (id, opportunity_id, created_at)
          WITH (FILLFACTOR = 85);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 006 — courses & enrollments
  // ════════════════════════════════════════════════
  {
    version:     '006_create_courses_enrollments',
    description: 'Create courses and enrollments tables',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'courses')
      BEGIN
        CREATE TABLE courses (
          id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          title         NVARCHAR(255)    NOT NULL,
          description   NVARCHAR(MAX)    NULL,
          difficulty    NVARCHAR(20)     NULL
                          CONSTRAINT CHK_course_diff
                          CHECK (difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED','EXPERT')),
          content       NVARCHAR(MAX)    NULL,
          duration      INT              NULL,
          thumbnail_url NVARCHAR(500)    NULL,
          is_published  BIT              NOT NULL DEFAULT 0,
          created_by_id UNIQUEIDENTIFIER NULL,
          created_at    DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at    DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_courses PRIMARY KEY (id),
          CONSTRAINT FK_course_author
            FOREIGN KEY (created_by_id) REFERENCES users(id)
            ON DELETE SET NULL ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_courses_published' AND object_id = OBJECT_ID('courses')
      )
        CREATE NONCLUSTERED INDEX IX_courses_published
          ON courses(is_published, difficulty)
          INCLUDE (id, title, thumbnail_url, duration, created_by_id)
          WITH (FILLFACTOR = 90);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'enrollments')
      BEGIN
        CREATE TABLE enrollments (
          id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id     UNIQUEIDENTIFIER NOT NULL,
          course_id   UNIQUEIDENTIFIER NOT NULL,
          progress    INT              NOT NULL DEFAULT 0,
          completed   BIT              NOT NULL DEFAULT 0,
          enrolled_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_enrollments PRIMARY KEY (id),
          CONSTRAINT FK_enroll_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_enroll_course
            FOREIGN KEY (course_id) REFERENCES courses(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT UQ_enroll_user_course UNIQUE (user_id, course_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_enroll_course' AND object_id = OBJECT_ID('enrollments')
      )
        CREATE NONCLUSTERED INDEX IX_enroll_course
          ON enrollments(course_id, completed)
          INCLUDE (id, user_id, progress)
          WITH (FILLFACTOR = 85);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 007 — user_skills
  // ════════════════════════════════════════════════
  {
    version:     '007_create_user_skills',
    description: 'Create user_skills junction table',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_skills')
      BEGIN
        CREATE TABLE user_skills (
          id                UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id           UNIQUEIDENTIFIER NOT NULL,
          skill_id          UNIQUEIDENTIFIER NOT NULL,
          proficiency_level NVARCHAR(20)     NULL
                              CONSTRAINT CHK_us_proficiency
                              CHECK (proficiency_level IN ('BEGINNER','INTERMEDIATE','ADVANCED','EXPERT')),
          years_experience  INT              NULL,
          created_at        DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_user_skills PRIMARY KEY (id),
          CONSTRAINT FK_us_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT FK_us_skill
            FOREIGN KEY (skill_id) REFERENCES skills(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT UQ_user_skill UNIQUE (user_id, skill_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_us_skill' AND object_id = OBJECT_ID('user_skills')
      )
        CREATE NONCLUSTERED INDEX IX_us_skill
          ON user_skills(skill_id)
          INCLUDE (user_id, proficiency_level)
          WITH (FILLFACTOR = 90);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 008 — experience, education, portfolio
  // ════════════════════════════════════════════════
  {
    version:     '008_create_profile_sections',
    description: 'Create experience, education, portfolio tables',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'experience')
      BEGIN
        CREATE TABLE experience (
          id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id     UNIQUEIDENTIFIER NOT NULL,
          title       NVARCHAR(255)    NULL,
          company     NVARCHAR(255)    NULL,
          location    NVARCHAR(255)    NULL,
          start_date  DATE             NULL,
          end_date    DATE             NULL,
          is_current  BIT              NOT NULL DEFAULT 0,
          description NVARCHAR(MAX)    NULL,
          skills_used NVARCHAR(MAX)    NULL,
          created_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_experience PRIMARY KEY (id),
          CONSTRAINT FK_exp_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_exp_user' AND object_id = OBJECT_ID('experience')
      )
        CREATE NONCLUSTERED INDEX IX_exp_user
          ON experience(user_id)
          INCLUDE (id, title, company, is_current, start_date)
          WITH (FILLFACTOR = 90);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'education')
      BEGIN
        CREATE TABLE education (
          id             UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id        UNIQUEIDENTIFIER NOT NULL,
          institution    NVARCHAR(255)    NULL,
          degree         NVARCHAR(255)    NULL,
          field_of_study NVARCHAR(255)    NULL,
          start_date     DATE             NULL,
          end_date       DATE             NULL,
          is_current     BIT              NOT NULL DEFAULT 0,
          description    NVARCHAR(MAX)    NULL,
          created_at     DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at     DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_education PRIMARY KEY (id),
          CONSTRAINT FK_edu_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_edu_user' AND object_id = OBJECT_ID('education')
      )
        CREATE NONCLUSTERED INDEX IX_edu_user
          ON education(user_id)
          INCLUDE (id, degree, institution, end_date)
          WITH (FILLFACTOR = 90);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'portfolio')
      BEGIN
        CREATE TABLE portfolio (
          id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id      UNIQUEIDENTIFIER NOT NULL,
          title        NVARCHAR(255)    NOT NULL,
          description  NVARCHAR(MAX)    NULL,
          project_url  NVARCHAR(500)    NULL,
          github_url   NVARCHAR(500)    NULL,
          technologies NVARCHAR(MAX)    NULL,
          image_url    NVARCHAR(500)    NULL,
          is_featured  BIT              NOT NULL DEFAULT 0,
          created_at   DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at   DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_portfolio PRIMARY KEY (id),
          CONSTRAINT FK_port_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_port_user_featured' AND object_id = OBJECT_ID('portfolio')
      )
        CREATE NONCLUSTERED INDEX IX_port_user_featured
          ON portfolio(user_id, is_featured DESC)
          INCLUDE (id, title, image_url, project_url)
          WITH (FILLFACTOR = 90);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 009 — contact_inquiries
  // ════════════════════════════════════════════════
  {
    version:     '009_create_contact_inquiries',
    description: 'Create contact_inquiries table',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'contact_inquiries')
      BEGIN
        CREATE TABLE contact_inquiries (
          id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          first_name   NVARCHAR(100)    NULL,
          last_name    NVARCHAR(100)    NULL,
          email        NVARCHAR(255)    NOT NULL,
          account_type NVARCHAR(50)     NULL,
          message      NVARCHAR(MAX)    NOT NULL,
          status       NVARCHAR(50)     NOT NULL DEFAULT 'NEW',
          created_at   DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at   DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_contact_inquiries PRIMARY KEY (id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_ci_status' AND object_id = OBJECT_ID('contact_inquiries')
      )
        CREATE NONCLUSTERED INDEX IX_ci_status
          ON contact_inquiries(status, created_at DESC)
          INCLUDE (id, email, first_name, last_name)
          WITH (FILLFACTOR = 85);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 010 — Posts
  //
  // Why each decision:
  //
  // ► userId  (camelCase)
  //   server GET /api/posts:
  //     SELECT p.userId ... FROM Posts p INNER JOIN users u ON u.id = p.userId
  //   server POST /api/posts INSERT:
  //     INSERT INTO Posts (userId, title, ...) VALUES (@userId, ...)
  //   server DELETE ownership check:
  //     SELECT id, userId FROM Posts WHERE id = @postId
  //     if (post.userId !== userId) → 403
  //   server PUT ownership:
  //     SELECT id, userId ... WHERE id = @postId
  //     if (existingPost.userId !== userId) → 403
  //
  // ► postType  (camelCase)
  //   server INSERT: postType = postType  (from req.body)
  //   server PUT UPDATE: postType = @postType
  //   CHECK values: server sends 'text','image','video','link',
  //                 'document','repost','event' — all included.
  //
  // ► visibility CHECK includes 'Anyone'
  //   server POST destructuring: visibility = 'Anyone'  ← DEFAULT
  //   server PUT destructuring:  visibility = 'Anyone'  ← DEFAULT
  //   Without 'Anyone' in the CHECK list, every post with
  //   no explicit visibility would fail the constraint.
  //   All values the frontend might realistically send are listed.
  //
  // ► No is_deleted column
  //   server DELETE route does a hard DELETE FROM Posts.
  //   There is no soft-delete logic in server.js.
  //   Adding is_deleted here would be unused dead weight.
  // ════════════════════════════════════════════════
  {
    version:     '010_create_posts',
    description: 'Create Posts table — column names match server.js queries',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Posts')
      BEGIN
        CREATE TABLE Posts (
          id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          userId      UNIQUEIDENTIFIER NOT NULL,
          title       NVARCHAR(255)    NULL,
          description NVARCHAR(MAX)    NULL,
          attachments NVARCHAR(MAX)    NULL,

          -- server sends: 'text','image','video','link','document','repost','event'
          postType    NVARCHAR(50)     NOT NULL DEFAULT 'text'
                        CONSTRAINT CHK_post_type
                        CHECK (postType IN (
                          'text','image','video','link','document','repost','event'
                        )),

          -- server default is 'Anyone' — must be in CHECK list
          visibility  NVARCHAR(100)    NOT NULL DEFAULT 'Anyone'
                        CONSTRAINT CHK_post_visibility
                        CHECK (visibility IN (
                          'Anyone','Connections only','Only me',
                          'public','connections','private'
                        )),

          created_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_Posts PRIMARY KEY (id),
          CONSTRAINT FK_post_user
            FOREIGN KEY (userId) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION
        );
      END
      `,
      //-- Feed index: ORDER BY p.created_at DESC (main query in GET /api/posts)
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_posts_feed' AND object_id = OBJECT_ID('Posts')
      )
        CREATE NONCLUSTERED INDEX IX_posts_feed
          ON Posts(created_at DESC)
          INCLUDE (id, userId, postType, title, visibility, description, attachments)
          WITH (FILLFACTOR = 80);
      `,
      //-- Per-user posts: userId + created_at (used by profile pages)
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_posts_user_created' AND object_id = OBJECT_ID('Posts')
      )
        CREATE NONCLUSTERED INDEX IX_posts_user_created
          ON Posts(userId, created_at DESC)
          INCLUDE (id, postType, visibility, title)
          WITH (FILLFACTOR = 85);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 011 — PostMentions & PostHashtags
  // ════════════════════════════════════════════════
  {
    version:     '011_create_post_meta',
    description: 'Create PostMentions and PostHashtags tables',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PostMentions')
      BEGIN
        CREATE TABLE PostMentions (
          id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          postId          UNIQUEIDENTIFIER NOT NULL,
          mentionedUserId UNIQUEIDENTIFIER NOT NULL,

          CONSTRAINT PK_PostMentions PRIMARY KEY (id),
          CONSTRAINT FK_mention_post
            FOREIGN KEY (postId) REFERENCES Posts(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT FK_mention_user
            FOREIGN KEY (mentionedUserId) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT UQ_mention UNIQUE (postId, mentionedUserId)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_mention_user' AND object_id = OBJECT_ID('PostMentions')
      )
        CREATE NONCLUSTERED INDEX IX_mention_user
          ON PostMentions(mentionedUserId)
          INCLUDE (postId)
          WITH (FILLFACTOR = 90);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PostHashtags')
      BEGIN
        CREATE TABLE PostHashtags (
          id      UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          postId  UNIQUEIDENTIFIER NOT NULL,
          hashtag NVARCHAR(100)    NOT NULL,

          CONSTRAINT PK_PostHashtags PRIMARY KEY (id),
          CONSTRAINT FK_hashtag_post
            FOREIGN KEY (postId) REFERENCES Posts(id)
            ON DELETE CASCADE ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_hashtag_tag' AND object_id = OBJECT_ID('PostHashtags')
      )
        CREATE NONCLUSTERED INDEX IX_hashtag_tag
          ON PostHashtags(hashtag)
          INCLUDE (postId)
          WITH (FILLFACTOR = 85);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 012 — Social: followers, blocked_users, saved_posts
  // ════════════════════════════════════════════════
  {
    version:     '012_create_social_tables',
    description: 'Create followers, blocked_users, saved_posts',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'followers')
      BEGIN
        CREATE TABLE followers (
          id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          follower_id  UNIQUEIDENTIFIER NOT NULL,
          following_id UNIQUEIDENTIFIER NOT NULL,
          created_at   DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_followers PRIMARY KEY (id),
          CONSTRAINT FK_follower_user
            FOREIGN KEY (follower_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_following_user
            FOREIGN KEY (following_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT UQ_follow UNIQUE (follower_id, following_id),
          CONSTRAINT CHK_no_self_follow CHECK (follower_id <> following_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_followers_following' AND object_id = OBJECT_ID('followers')
      )
        CREATE NONCLUSTERED INDEX IX_followers_following
          ON followers(following_id)
          INCLUDE (follower_id, created_at)
          WITH (FILLFACTOR = 90);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'blocked_users')
      BEGIN
        CREATE TABLE blocked_users (
          id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          blocker_id UNIQUEIDENTIFIER NOT NULL,
          blocked_id UNIQUEIDENTIFIER NOT NULL,
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_blocked_users PRIMARY KEY (id),
          CONSTRAINT FK_blocker
            FOREIGN KEY (blocker_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_blocked
            FOREIGN KEY (blocked_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT UQ_block UNIQUE (blocker_id, blocked_id),
          CONSTRAINT CHK_no_self_block CHECK (blocker_id <> blocked_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_blocked_blocked_id' AND object_id = OBJECT_ID('blocked_users')
      )
        CREATE NONCLUSTERED INDEX IX_blocked_blocked_id
          ON blocked_users(blocked_id)
          INCLUDE (blocker_id)
          WITH (FILLFACTOR = 90);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'saved_posts')
      BEGIN
        CREATE TABLE saved_posts (
          id       UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id  UNIQUEIDENTIFIER NOT NULL,
          post_id  UNIQUEIDENTIFIER NOT NULL,
          saved_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_saved_posts PRIMARY KEY (id),
          CONSTRAINT FK_saved_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_saved_post
            FOREIGN KEY (post_id) REFERENCES Posts(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT UQ_saved UNIQUE (user_id, post_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_saved_user' AND object_id = OBJECT_ID('saved_posts')
      )
        CREATE NONCLUSTERED INDEX IX_saved_user
          ON saved_posts(user_id, saved_at DESC)
          INCLUDE (post_id)
          WITH (FILLFACTOR = 90);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 013 — post_likes, post_reposts, comments,
  //        post_interactions
  //
  // ► post_interactions.type CHECK values:
  //   server stats query (GET /api/post-interactions/posts/:postId/stats):
  //     COUNT(CASE WHEN type = 'like'    THEN 1 END)
  //     COUNT(CASE WHEN type = 'comment' THEN 1 END)
  //     COUNT(CASE WHEN type = 'repost'  THEN 1 END)
  //   → CHECK must include 'like','comment','repost'.
  //     'view' added as a reasonable future extension.
  //
  // ► comments table named 'comments' (not 'post_comments')
  //   server imports commentsRoutes → the route file will use
  //   table name 'comments' (standard naming for nested resources)
  // ════════════════════════════════════════════════
  {
    version:     '013_create_post_interactions',
    description: 'Create post_likes, post_reposts, comments, post_interactions',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'post_likes')
      BEGIN
        CREATE TABLE post_likes (
          id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id    UNIQUEIDENTIFIER NOT NULL,
          post_id    UNIQUEIDENTIFIER NOT NULL,
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_post_likes PRIMARY KEY (id),
          CONSTRAINT FK_like_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_like_post
            FOREIGN KEY (post_id) REFERENCES Posts(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT UQ_like UNIQUE (user_id, post_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_likes_post' AND object_id = OBJECT_ID('post_likes')
      )
        CREATE NONCLUSTERED INDEX IX_likes_post
          ON post_likes(post_id)
          INCLUDE (user_id, created_at)
          WITH (FILLFACTOR = 85);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'post_reposts')
      BEGIN
        CREATE TABLE post_reposts (
          id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id    UNIQUEIDENTIFIER NOT NULL,
          post_id    UNIQUEIDENTIFIER NOT NULL,
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_post_reposts PRIMARY KEY (id),
          CONSTRAINT FK_repost_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_repost_post
            FOREIGN KEY (post_id) REFERENCES Posts(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT UQ_repost UNIQUE (user_id, post_id)
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_reposts_post' AND object_id = OBJECT_ID('post_reposts')
      )
        CREATE NONCLUSTERED INDEX IX_reposts_post
          ON post_reposts(post_id)
          INCLUDE (user_id, created_at)
          WITH (FILLFACTOR = 85);
      `,
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'comments')
      BEGIN
        CREATE TABLE comments (
          id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id    UNIQUEIDENTIFIER NOT NULL,
          post_id    UNIQUEIDENTIFIER NOT NULL,
          parent_id  UNIQUEIDENTIFIER NULL,
          content    NVARCHAR(MAX)    NOT NULL,
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_comments PRIMARY KEY (id),
          CONSTRAINT FK_comment_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_comment_post
            FOREIGN KEY (post_id) REFERENCES Posts(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT FK_comment_parent
            FOREIGN KEY (parent_id) REFERENCES comments(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_comments_post' AND object_id = OBJECT_ID('comments')
      )
        CREATE NONCLUSTERED INDEX IX_comments_post
          ON comments(post_id, created_at)
          INCLUDE (id, user_id, parent_id, content)
          WITH (FILLFACTOR = 80);
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_comments_parent' AND object_id = OBJECT_ID('comments')
      )
        CREATE NONCLUSTERED INDEX IX_comments_parent
          ON comments(parent_id)
          WHERE parent_id IS NOT NULL
          INCLUDE (id, user_id, post_id, created_at)
          WITH (FILLFACTOR = 90);
      `,
      //-- post_interactions: server stats route queries this table
      //-- WHERE post_id = @postId, counting by type
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'post_interactions')
      BEGIN
        CREATE TABLE post_interactions (
          id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          post_id    UNIQUEIDENTIFIER NOT NULL,
          user_id    UNIQUEIDENTIFIER NOT NULL,
          type       NVARCHAR(20)     NOT NULL
                       CONSTRAINT CHK_pi_type
                       CHECK (type IN ('like','comment','repost','view')),
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_post_interactions PRIMARY KEY (id),
          CONSTRAINT FK_pi_post
            FOREIGN KEY (post_id) REFERENCES Posts(id)
            ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT FK_pi_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION
        );
      END
      `,
      //-- Covering index for stats query: post_id filter + type grouping
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_pi_post_type' AND object_id = OBJECT_ID('post_interactions')
      )
        CREATE NONCLUSTERED INDEX IX_pi_post_type
          ON post_interactions(post_id, type)
          INCLUDE (user_id, created_at)
          WITH (FILLFACTOR = 80);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 014 — notifications
  // ════════════════════════════════════════════════
  {
    version:     '014_create_notifications',
    description: 'Create notifications table',
    steps: [
      `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'notifications')
      BEGIN
        CREATE TABLE notifications (
          id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id    UNIQUEIDENTIFIER NOT NULL,
          actor_id   UNIQUEIDENTIFIER NOT NULL,
          type       NVARCHAR(20)     NOT NULL
                       CONSTRAINT CHK_notif_type
                       CHECK (type IN (
                         'LIKE','REPOST','FOLLOW','COMMENT','APPLICATION','MENTION'
                       )),
          post_id    UNIQUEIDENTIFIER NULL,
          comment_id UNIQUEIDENTIFIER NULL,
          is_read    BIT              NOT NULL DEFAULT 0,
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),

          CONSTRAINT PK_notifications PRIMARY KEY (id),
          CONSTRAINT FK_notif_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_notif_actor
            FOREIGN KEY (actor_id) REFERENCES users(id)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT FK_notif_post
            FOREIGN KEY (post_id) REFERENCES Posts(id)
            ON DELETE SET NULL ON UPDATE NO ACTION,
          CONSTRAINT FK_notif_comment
            FOREIGN KEY (comment_id) REFERENCES comments(id)
            ON DELETE SET NULL ON UPDATE NO ACTION
        );
      END
      `,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_notif_inbox' AND object_id = OBJECT_ID('notifications')
      )
        CREATE NONCLUSTERED INDEX IX_notif_inbox
          ON notifications(user_id, is_read, created_at DESC)
          INCLUDE (id, actor_id, type, post_id, comment_id)
          WITH (FILLFACTOR = 80);
      `,
    ],
  },

  // ════════════════════════════════════════════════
  // 015 — stored procedures
  // ════════════════════════════════════════════════
  {
    version:     '015_stored_procedures',
    description: 'Create stored procedures used by route files',
    steps: [
      // Called by profile routes (separate route files imported into server.js)
      `
      CREATE OR ALTER PROCEDURE usp_calculate_profile_completion
        @user_id UNIQUEIDENTIFIER
      AS
      BEGIN
        SET NOCOUNT ON;
        DECLARE @score INT = 0;

        SELECT @score +=
          CASE WHEN bio      IS NOT NULL AND LEN(bio)      > 0 THEN 5 ELSE 0 END +
          CASE WHEN headline IS NOT NULL AND LEN(headline) > 0 THEN 5 ELSE 0 END +
          CASE WHEN location IS NOT NULL AND LEN(location) > 0 THEN 5 ELSE 0 END +
          CASE WHEN avatar   IS NOT NULL AND LEN(avatar)   > 0 THEN 5 ELSE 0 END
        FROM users WHERE id = @user_id;

        IF EXISTS (SELECT 1 FROM experience  WHERE user_id = @user_id) SET @score += 20;
        IF EXISTS (SELECT 1 FROM education   WHERE user_id = @user_id) SET @score += 20;
        IF EXISTS (SELECT 1 FROM portfolio   WHERE user_id = @user_id) SET @score += 20;
        IF EXISTS (SELECT 1 FROM user_skills WHERE user_id = @user_id) SET @score += 20;

        SET @score = CASE WHEN @score > 100 THEN 100 WHEN @score < 0 THEN 0 ELSE @score END;

        UPDATE users
        SET profile_completion = @score,
            profile_updated_at = SYSDATETIME(),
            updated_at         = SYSDATETIME()
        WHERE id = @user_id;

        SELECT @score AS profile_completion;
      END
      `,
    ],
  },

];


// ─── Runner ──────────────────────────────────────────────────

async function runMigrations() {
  let pool;

  try {
    console.log('\n🔌  Connecting to SQL Server …');
    pool = await sql.connect(config);
    console.log('✅  Connected\n');

    // 001 runs outside a transaction — it creates the log table itself
    const bootstrap = migrations[0];
    for (const step of bootstrap.steps) {
      await pool.request().query(step);
    }
    await ensureLogged(pool, bootstrap);

    for (const migration of migrations.slice(1)) {
      const already = await pool.request()
        .input('v', sql.NVarChar, migration.version)
        .query('SELECT 1 FROM migrations_log WHERE version = @v');

      if (already.recordset.length > 0) {
        console.log(`  ⏭   ${migration.version} — already applied, skipping`);
        continue;
      }

      console.log(`  ▶   ${migration.version} — ${migration.description}`);
      const t0  = Date.now();
      const tx  = pool.transaction();

      try {
        await tx.begin();

        for (const step of migration.steps) {
          await tx.request().query(step);
        }

        const durationMs = Date.now() - t0;
        await tx.request()
          .input('v',  sql.NVarChar, migration.version)
          .input('d',  sql.NVarChar, migration.description)
          .input('ms', sql.Int,      durationMs)
          .query(`
            INSERT INTO migrations_log (version, description, duration_ms)
            VALUES (@v, @d, @ms)
          `);

        await tx.commit();
        console.log(`  ✅  Done in ${durationMs} ms`);

      } catch (err) {
        await tx.rollback();
        console.error(`  ❌  FAILED: ${err.message}`);
        throw err;
      }
    }

    console.log('\n🎉  All migrations applied successfully!\n');

  } finally {
    if (pool) await pool.close();
  }
}

async function ensureLogged(pool, migration) {
  const already = await pool.request()
    .input('v', sql.NVarChar, migration.version)
    .query('SELECT 1 FROM migrations_log WHERE version = @v');

  if (already.recordset.length === 0) {
    await pool.request()
      .input('v',  sql.NVarChar, migration.version)
      .input('d',  sql.NVarChar, migration.description)
      .input('ms', sql.Int,      0)
      .query(`
        INSERT INTO migrations_log (version, description, duration_ms)
        VALUES (@v, @d, @ms)
      `);
    console.log(`  ✅  ${migration.version} — bootstrapped`);
  } else {
    console.log(`  ⏭   ${migration.version} — already applied, skipping`);
  }
}

runMigrations().catch(err => {
  console.error('\n💥  Migration runner crashed:', err.message);
  process.exit(1);
});