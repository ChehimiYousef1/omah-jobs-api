import * as sql from 'mssql';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'YourStrong!Passw0rd',
    server: process.env.DB_HOST || process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'omah_jobs',
    port: Number(process.env.DB_PORT) || 1433,
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};
const migrations = [
    {
        version: '001_migrations_log',
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
    {
        version: '002_create_users',
        description: 'Create users table',
        steps: [
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
      BEGIN
        CREATE TABLE users (
          id                  UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          email               NVARCHAR(255)    NOT NULL,
          password            NVARCHAR(255)    NULL,
          name                NVARCHAR(255)    NOT NULL,
          role                NVARCHAR(20)     NOT NULL
                                CONSTRAINT CHK_users_role
                                CHECK (role IN ('FREELANCER','COMPANY','ADMIN')),
          bio                 NVARCHAR(MAX)    NULL,
          avatar              NVARCHAR(500)    NULL,
          coverPage           NVARCHAR(500)    NULL,
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
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_users_email' AND object_id = OBJECT_ID('users'))
      BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX UQ_users_email ON users(email);
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_role' AND object_id = OBJECT_ID('users'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_users_role ON users(role) INCLUDE (id, name, avatar, headline);
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_reset_token' AND object_id = OBJECT_ID('users'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_users_reset_token ON users(reset_token) WHERE reset_token IS NOT NULL;
      END
      `,
        ],
    },
    {
        version: '003_create_skills',
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
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_skills_name' AND object_id = OBJECT_ID('skills'))
      BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX UQ_skills_name ON skills(name);
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_skills_category' AND object_id = OBJECT_ID('skills'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_skills_category ON skills(category) INCLUDE (id, name);
      END
      `,
        ],
    },
    {
        version: '004_create_opportunities',
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
          type             NVARCHAR(20)     NULL CONSTRAINT CHK_opp_type CHECK (type IN ('FULL_TIME','PART_TIME','CONTRACT','FREELANCE')),
          experience_level NVARCHAR(20)     NULL CONSTRAINT CHK_opp_exp CHECK (experience_level IN ('ENTRY','INTERMEDIATE','SENIOR','EXPERT')),
          status           NVARCHAR(20)     NOT NULL DEFAULT 'ACTIVE' CONSTRAINT CHK_opp_status CHECK (status IN ('ACTIVE','CLOSED','EXPIRED')),
          view_count       INT              NOT NULL DEFAULT 0,
          created_by_id    UNIQUEIDENTIFIER NOT NULL,
          created_at       DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at       DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_opportunities PRIMARY KEY (id),
          CONSTRAINT FK_opp_user FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE NO ACTION
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_opp_status_deadline' AND object_id = OBJECT_ID('opportunities'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_opp_status_deadline ON opportunities(status, deadline) INCLUDE (id, title, type, experience_level, budget_min, budget_max, created_by_id);
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_opp_created_by' AND object_id = OBJECT_ID('opportunities'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_opp_created_by ON opportunities(created_by_id) INCLUDE (id, title, status, created_at);
      END
      `,
        ],
    },
    {
        version: '005_create_applications',
        description: 'Create applications table',
        steps: [
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'applications')
      BEGIN
        CREATE TABLE applications (
          id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          status          NVARCHAR(20)     NOT NULL DEFAULT 'PENDING' CONSTRAINT CHK_app_status CHECK (status IN ('PENDING','REVIEWING','ACCEPTED','REJECTED','WITHDRAWN')),
          cover_letter    NVARCHAR(MAX)    NULL,
          proposed_budget DECIMAL(10,2)    NULL,
          user_id         UNIQUEIDENTIFIER NOT NULL,
          opportunity_id  UNIQUEIDENTIFIER NOT NULL,
          created_at      DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at      DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_applications PRIMARY KEY (id),
          CONSTRAINT FK_app_user        FOREIGN KEY (user_id)        REFERENCES users(id)         ON DELETE NO ACTION,
          CONSTRAINT FK_app_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE NO ACTION,
          CONSTRAINT UQ_app_user_opp UNIQUE (user_id, opportunity_id)
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_opportunity' AND object_id = OBJECT_ID('applications'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_app_opportunity ON applications(opportunity_id, status) INCLUDE (id, user_id, created_at);
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_user_status' AND object_id = OBJECT_ID('applications'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_app_user_status ON applications(user_id, status) INCLUDE (id, opportunity_id, created_at);
      END
      `,
        ],
    },
    {
        version: '006_create_courses_enrollments',
        description: 'Create courses and enrollments tables',
        steps: [
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'courses')
      BEGIN
        CREATE TABLE courses (
          id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          title         NVARCHAR(255)    NOT NULL,
          description   NVARCHAR(MAX)    NULL,
          difficulty    NVARCHAR(20)     NULL CONSTRAINT CHK_course_diff CHECK (difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED','EXPERT')),
          content       NVARCHAR(MAX)    NULL,
          duration      INT              NULL,
          thumbnail_url NVARCHAR(500)    NULL,
          is_published  BIT              NOT NULL DEFAULT 0,
          created_by_id UNIQUEIDENTIFIER NULL,
          created_at    DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at    DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_courses PRIMARY KEY (id),
          CONSTRAINT FK_course_author FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_courses_published' AND object_id = OBJECT_ID('courses'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_courses_published ON courses(is_published, difficulty) INCLUDE (id, title, thumbnail_url, duration, created_by_id);
      END
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
          CONSTRAINT FK_enroll_user   FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE NO ACTION,
          CONSTRAINT FK_enroll_course FOREIGN KEY (course_id) REFERENCES courses(id)  ON DELETE CASCADE,
          CONSTRAINT UQ_enroll_user_course UNIQUE (user_id, course_id)
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_enroll_course' AND object_id = OBJECT_ID('enrollments'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_enroll_course ON enrollments(course_id, completed) INCLUDE (id, user_id, progress);
      END
      `,
        ],
    },
    {
        version: '007_create_user_skills',
        description: 'Create user_skills junction table',
        steps: [
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_skills')
      BEGIN
        CREATE TABLE user_skills (
          id                UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id           UNIQUEIDENTIFIER NOT NULL,
          skill_id          UNIQUEIDENTIFIER NOT NULL,
          proficiency_level NVARCHAR(20)     NULL CONSTRAINT CHK_us_proficiency CHECK (proficiency_level IN ('BEGINNER','INTERMEDIATE','ADVANCED','EXPERT')),
          years_experience  INT              NULL,
          created_at        DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_user_skills PRIMARY KEY (id),
          CONSTRAINT FK_us_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
          CONSTRAINT FK_us_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
          CONSTRAINT UQ_user_skill UNIQUE (user_id, skill_id)
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_us_skill' AND object_id = OBJECT_ID('user_skills'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_us_skill ON user_skills(skill_id) INCLUDE (user_id, proficiency_level);
      END
      `,
        ],
    },
    {
        version: '008_create_profile_sections',
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
          CONSTRAINT FK_exp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exp_user' AND object_id = OBJECT_ID('experience'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_exp_user ON experience(user_id) INCLUDE (id, title, company, is_current, start_date);
      END
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
          CONSTRAINT FK_edu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_edu_user' AND object_id = OBJECT_ID('education'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_edu_user ON education(user_id) INCLUDE (id, degree, institution, end_date);
      END
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
          CONSTRAINT FK_port_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_port_user_featured' AND object_id = OBJECT_ID('portfolio'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_port_user_featured ON portfolio(user_id, is_featured DESC) INCLUDE (id, title, image_url, project_url);
      END
      `,
        ],
    },
    {
        version: '009_create_contact_inquiries',
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
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ci_status' AND object_id = OBJECT_ID('contact_inquiries'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_ci_status ON contact_inquiries(status, created_at DESC) INCLUDE (id, email, first_name, last_name);
      END
      `,
        ],
    },
    {
        version: '010_create_posts',
        description: 'Create Posts table',
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
          postType    NVARCHAR(50)     NOT NULL DEFAULT 'text' CONSTRAINT CHK_post_type CHECK (postType IN ('text','image','video','link','document','repost','event')),
          visibility  NVARCHAR(100)    NOT NULL DEFAULT 'Anyone' CONSTRAINT CHK_post_visibility CHECK (visibility IN ('Anyone','Connections only','Only me','public','connections','private')),
          created_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_Posts PRIMARY KEY (id),
          CONSTRAINT FK_post_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE NO ACTION
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_posts_feed' AND object_id = OBJECT_ID('Posts'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_posts_feed ON Posts(created_at DESC) INCLUDE (id, userId, postType, title, visibility, description, attachments);
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_posts_user_created' AND object_id = OBJECT_ID('Posts'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_posts_user_created ON Posts(userId, created_at DESC) INCLUDE (id, postType, visibility, title);
      END
      `,
        ],
    },
    {
        version: '011_create_post_meta',
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
          CONSTRAINT FK_mention_post FOREIGN KEY (postId)          REFERENCES Posts(id) ON DELETE CASCADE,
          CONSTRAINT FK_mention_user FOREIGN KEY (mentionedUserId) REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT UQ_mention UNIQUE (postId, mentionedUserId)
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_mention_user' AND object_id = OBJECT_ID('PostMentions'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_mention_user ON PostMentions(mentionedUserId) INCLUDE (postId);
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PostHashtags')
      BEGIN
        CREATE TABLE PostHashtags (
          id      UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          postId  UNIQUEIDENTIFIER NOT NULL,
          hashtag NVARCHAR(100)    NOT NULL,
          CONSTRAINT PK_PostHashtags PRIMARY KEY (id),
          CONSTRAINT FK_hashtag_post FOREIGN KEY (postId) REFERENCES Posts(id) ON DELETE CASCADE
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_hashtag_tag' AND object_id = OBJECT_ID('PostHashtags'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_hashtag_tag ON PostHashtags(hashtag) INCLUDE (postId);
      END
      `,
        ],
    },
    {
        version: '012_create_social_tables',
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
          CONSTRAINT PK_followers   PRIMARY KEY (id),
          CONSTRAINT FK_follower_user  FOREIGN KEY (follower_id)  REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT FK_following_user FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT UQ_follow         UNIQUE (follower_id, following_id),
          CONSTRAINT CHK_no_self_follow CHECK (follower_id <> following_id)
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_followers_following' AND object_id = OBJECT_ID('followers'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_followers_following ON followers(following_id) INCLUDE (follower_id, created_at);
      END
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
          CONSTRAINT FK_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT FK_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT UQ_block          UNIQUE (blocker_id, blocked_id),
          CONSTRAINT CHK_no_self_block CHECK  (blocker_id <> blocked_id)
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_blocked_blocked_id' AND object_id = OBJECT_ID('blocked_users'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_blocked_blocked_id ON blocked_users(blocked_id) INCLUDE (blocker_id);
      END
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
          CONSTRAINT FK_saved_user FOREIGN KEY (user_id) REFERENCES users(id)  ON DELETE NO ACTION,
          CONSTRAINT FK_saved_post FOREIGN KEY (post_id) REFERENCES Posts(id)  ON DELETE CASCADE,
          CONSTRAINT UQ_saved UNIQUE (user_id, post_id)
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_saved_user' AND object_id = OBJECT_ID('saved_posts'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_saved_user ON saved_posts(user_id, saved_at DESC) INCLUDE (post_id);
      END
      `,
        ],
    },
    {
        version: '013_create_post_interactions',
        description: 'Create post_likes, post_reposts, comments, post_interactions tables',
        steps: [
            // post_likes
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'post_likes')
      BEGIN
        CREATE TABLE post_likes (
          id       UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id  UNIQUEIDENTIFIER NOT NULL,
          post_id  UNIQUEIDENTIFIER NOT NULL,
          created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
        );
        ALTER TABLE post_likes ADD CONSTRAINT PK_post_likes PRIMARY KEY (id);
        ALTER TABLE post_likes ADD CONSTRAINT FK_like_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION;
        ALTER TABLE post_likes ADD CONSTRAINT FK_like_post FOREIGN KEY (post_id) REFERENCES Posts(id) ON DELETE CASCADE;
        ALTER TABLE post_likes ADD CONSTRAINT UQ_like UNIQUE (user_id, post_id);
      END
      `,
            `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_like_post' AND object_id = OBJECT_ID('post_likes'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_like_post ON post_likes(post_id, created_at) INCLUDE (user_id);
      END
      `,
            // post_reposts
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'post_reposts')
      BEGIN
        CREATE TABLE post_reposts (
          id       UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id  UNIQUEIDENTIFIER NOT NULL,
          post_id  UNIQUEIDENTIFIER NOT NULL,
          created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
        );
        ALTER TABLE post_reposts ADD CONSTRAINT PK_post_reposts PRIMARY KEY (id);
        ALTER TABLE post_reposts ADD CONSTRAINT FK_repost_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION;
        ALTER TABLE post_reposts ADD CONSTRAINT FK_repost_post FOREIGN KEY (post_id) REFERENCES Posts(id) ON DELETE CASCADE;
        ALTER TABLE post_reposts ADD CONSTRAINT UQ_repost UNIQUE (user_id, post_id);
      END
      `,
            // comments
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'comments')
      BEGIN
        CREATE TABLE comments (
          id        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id   UNIQUEIDENTIFIER NOT NULL,
          post_id   UNIQUEIDENTIFIER NOT NULL,
          content   NVARCHAR(MAX) NOT NULL,
          created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
        );
        ALTER TABLE comments ADD CONSTRAINT PK_comments PRIMARY KEY (id);
        ALTER TABLE comments ADD CONSTRAINT FK_comment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION;
        ALTER TABLE comments ADD CONSTRAINT FK_comment_post FOREIGN KEY (post_id) REFERENCES Posts(id) ON DELETE CASCADE;
      END
      `,
            // post_interactions (optional aggregated table)
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'post_interactions')
      BEGIN
        CREATE TABLE post_interactions (
          post_id UNIQUEIDENTIFIER NOT NULL,
          likes_count INT NOT NULL DEFAULT 0,
          reposts_count INT NOT NULL DEFAULT 0,
          comments_count INT NOT NULL DEFAULT 0,
          updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_post_interactions PRIMARY KEY (post_id),
          CONSTRAINT FK_pi_post FOREIGN KEY (post_id) REFERENCES Posts(id) ON DELETE CASCADE
        );
      END
      `
        ],
    },
    {
        version: '014_create_notifications',
        description: 'Create notifications table',
        steps: [
            `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'notifications')
      BEGIN
        CREATE TABLE notifications (
          id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          user_id    UNIQUEIDENTIFIER NOT NULL,
          actor_id   UNIQUEIDENTIFIER NOT NULL,
          type       NVARCHAR(20)     NOT NULL CONSTRAINT CHK_notif_type CHECK (type IN ('LIKE','REPOST','FOLLOW','COMMENT','APPLICATION','MENTION')),
          post_id    UNIQUEIDENTIFIER NULL,
          comment_id UNIQUEIDENTIFIER NULL,
          is_read    BIT              NOT NULL DEFAULT 0,
          created_at DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_notifications PRIMARY KEY (id),
          CONSTRAINT FK_notif_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE NO ACTION,
          CONSTRAINT FK_notif_actor   FOREIGN KEY (actor_id)   REFERENCES users(id)    ON DELETE NO ACTION,
          CONSTRAINT FK_notif_post    FOREIGN KEY (post_id)    REFERENCES Posts(id)    ON DELETE NO ACTION,
          CONSTRAINT FK_notif_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE NO ACTION
        );
      END
      `,
            `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notif_inbox' AND object_id = OBJECT_ID('notifications'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_notif_inbox ON notifications(user_id, is_read, created_at DESC) INCLUDE (id, actor_id, type, post_id, comment_id);
      END
      `,
        ],
    },
    {
        version: '015_stored_procedures',
        description: 'Create stored procedures',
        steps: [
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
        UPDATE users SET profile_completion = @score, profile_updated_at = SYSDATETIME(), updated_at = SYSDATETIME() WHERE id = @user_id;
        SELECT @score AS profile_completion;
      END
      `,
        ],
    },
];
async function runMigrations() {
    let pool;
    try {
        pool = await sql.connect(config);
        console.log('Connected to MSSQL successfully.');
        for (const migration of migrations) {
            console.log(`Running migration: ${migration.version} - ${migration.description}`);
            const start = Date.now();
            for (const step of migration.steps) {
                await pool.request().query(step);
            }
            const duration = Date.now() - start;
            console.log(`Migration ${migration.version} completed in ${duration}ms`);
            await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE version = '${migration.version}')
        BEGIN
          INSERT INTO migrations_log(version, description, applied_at, duration_ms)
          VALUES('${migration.version}', '${migration.description}', SYSDATETIME(), ${duration});
        END
      `);
        }
        console.log('All migrations completed successfully.');
    }
    catch (err) {
        console.error('Migration error:', err);
    }
    finally {
        await pool?.close();
    }
}
// Execute migrations
export default runMigrations;
