#!/bin/bash
# ============================================================
#  OMAH Connect — Backend Setup Script
#  Run from the /server directory:  bash install.sh
# ============================================================

set -e  # Exit immediately on any error

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

# ── Helpers ───────────────────────────────────────────────────
ok()   { echo -e "${GREEN}  ✔  $1${NC}"; }
info() { echo -e "${CYAN}  ➜  $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠  $1${NC}"; }
fail() { echo -e "${RED}  ✘  $1${NC}"; exit 1; }
header() {
  echo ""
  echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"
  echo -e "${BOLD}${BLUE}  $1${NC}"
  echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"
}

# ════════════════════════════════════════════════════════════
# 1. NODE VERSION CHECK
# ════════════════════════════════════════════════════════════
header "Checking Node.js version"

if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node >= 18 from https://nodejs.org"
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js >= 18 required (found $NODE_VER). Please upgrade."
fi

ok "Node.js $NODE_VER"

# ════════════════════════════════════════════════════════════
# 2. NPM CHECK
# ════════════════════════════════════════════════════════════
header "Checking npm"

if ! command -v npm &>/dev/null; then
  fail "npm is not installed."
fi

ok "npm $(npm --version)"

# ════════════════════════════════════════════════════════════
# 3. INSTALL DEPENDENCIES
# ════════════════════════════════════════════════════════════
header "Installing npm dependencies"

if [ ! -f "package.json" ]; then
  fail "package.json not found. Run this script from the /server directory."
fi

info "Running npm install..."
npm install

ok "All dependencies installed"

# ════════════════════════════════════════════════════════════
# 4. INSTALL MISSING PACKAGES (safety check)
# ════════════════════════════════════════════════════════════
header "Verifying critical packages"

REQUIRED_DEPS=(
  "express"
  "cors"
  "cookie-parser"
  "dotenv"
  "mssql"
  "jsonwebtoken"
  "bcrypt"
  "multer"
  "nodemailer"
  "node-fetch"
  "swagger-jsdoc"
  "swagger-ui-express"
)

REQUIRED_DEV_DEPS=(
  "@types/express"
  "@types/cors"
  "@types/cookie-parser"
  "@types/jsonwebtoken"
  "@types/bcrypt"
  "@types/multer"
  "@types/nodemailer"
  "@types/mssql"
  "@types/node"
  "@types/swagger-jsdoc"
  "@types/swagger-ui-express"
  "tsx"
)

MISSING_DEPS=()
MISSING_DEV_DEPS=()

for pkg in "${REQUIRED_DEPS[@]}"; do
  if [ ! -d "node_modules/$pkg" ]; then
    MISSING_DEPS+=("$pkg")
  else
    ok "$pkg"
  fi
done

for pkg in "${REQUIRED_DEV_DEPS[@]}"; do
  if [ ! -d "node_modules/$pkg" ]; then
    MISSING_DEV_DEPS+=("$pkg")
  else
    ok "$pkg (dev)"
  fi
done

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  warn "Installing missing dependencies: ${MISSING_DEPS[*]}"
  npm install "${MISSING_DEPS[@]}"
fi

if [ ${#MISSING_DEV_DEPS[@]} -gt 0 ]; then
  warn "Installing missing dev dependencies: ${MISSING_DEV_DEPS[*]}"
  npm install --save-dev "${MISSING_DEV_DEPS[@]}"
fi

# ════════════════════════════════════════════════════════════
# 5. CREATE UPLOAD DIRECTORIES
# ════════════════════════════════════════════════════════════
header "Creating upload directories"

DIRS=(
  "uploads"
  "uploads/avatars"
  "uploads/covers"
  "uploads/posts"
  "uploads/posts/image"
  "uploads/posts/video"
  "uploads/posts/document"
)

for dir in "${DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    ok "Created: $dir"
  else
    info "Already exists: $dir"
  fi
done

# ════════════════════════════════════════════════════════════
# 6. CREATE SRC SUBDIRECTORIES
# ════════════════════════════════════════════════════════════
header "Creating source directories"

SRC_DIRS=(
  "src"
  "src/middleware"
  "routes"
  "config"
  "controllers"
  "services"
  "services/utils"
  "utils"
)

for dir in "${SRC_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    ok "Created: $dir"
  else
    info "Already exists: $dir"
  fi
done

# ════════════════════════════════════════════════════════════
# 7. .ENV CHECK
# ════════════════════════════════════════════════════════════
header "Checking .env file"

if [ ! -f ".env" ]; then
  warn ".env file not found — creating a template..."
  cat > .env << 'EOF'
# ── Server ────────────────────────────────────────────────
PORT=3001
NODE_ENV=development

# ── Database (SQL Server) ─────────────────────────────────
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=your_db_host
DB_NAME=your_db_name
DB_PORT=1433

# ── JWT ───────────────────────────────────────────────────
JWT_SECRET=change_this_to_a_long_random_secret

# ── Frontend ──────────────────────────────────────────────
CLIENT_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# ── Microsoft OAuth ───────────────────────────────────────
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/auth/microsoft/callback

# ── GitHub OAuth ──────────────────────────────────────────
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=http://localhost:3001/api/auth/github/callback

# ── SMTP (Nodemailer) ─────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# ── Swagger ───────────────────────────────────────────────
SUPPORT_EMAIL=Youssef@openmindsaihamburg.com
PRODUCTION_URL=
EOF
  ok ".env template created — fill in your values before starting the server"
else
  ok ".env file exists"
fi

# ════════════════════════════════════════════════════════════
# 8. TSCONFIG CHECK
# ════════════════════════════════════════════════════════════
header "Checking tsconfig.json"

if [ ! -f "tsconfig.json" ]; then
  warn "tsconfig.json not found — creating default..."
  cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./",
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "routes/**/*", "config/**/*", "controllers/**/*", "services/**/*", "utils/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
  ok "tsconfig.json created"
else
  ok "tsconfig.json exists"
fi

# ════════════════════════════════════════════════════════════
# DONE
# ════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✔  Setup complete!${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
echo -e "  1. Fill in your ${YELLOW}.env${NC} values (DB, JWT, OAuth, SMTP)"
echo -e "  2. Start the dev server:  ${YELLOW}npm run dev${NC}"
echo -e "  3. Open API docs:         ${YELLOW}http://localhost:3001/api/docs${NC}"
echo -e "  4. JSON spec:             ${YELLOW}http://localhost:3001/api/docs.json${NC}"
echo ""