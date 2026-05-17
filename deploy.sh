#!/usr/bin/env bash
# =============================================================================
# WaterApp — Cloud Deployment Script
# =============================================================================
# Deploys:
#   • Backend  → Google Cloud Run  (service: water-backend, region: us-central1)
#   • Frontend → Firebase Hosting  (project: waterapp-prod-492407)
#
# Prerequisites (one-time setup — see SETUP section below):
#   1. gcloud CLI installed and authenticated
#   2. Firebase CLI installed  (npm i -g firebase-tools)
#   3. Docker installed and running
#   4. PROJECT_ID env var set (or hardcode below)
#
# Usage:
#   ./deploy.sh              # deploy everything
#   ./deploy.sh backend      # deploy backend only
#   ./deploy.sh frontend     # deploy frontend only
#   ./deploy.sh push         # git commit+push only (no cloud deploy)
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-waterapp-prod-492407}"
REGION="us-central1"
BACKEND_SERVICE="water-backend"
BACKEND_IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/app-repo/water-backend"
FIREBASE_PROJECT="${PROJECT_ID}"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────
check_prereqs() {
  info "Checking prerequisites..."
  command -v gcloud  >/dev/null 2>&1 || error "gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
  command -v docker  >/dev/null 2>&1 || error "Docker not found. Install from https://docs.docker.com/get-docker/"
  command -v firebase >/dev/null 2>&1 || error "Firebase CLI not found. Run: npm install -g firebase-tools"
  docker info >/dev/null 2>&1        || error "Docker daemon is not running. Start Docker Desktop."

  info "Authenticating Docker with Artifact Registry..."
  gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
}

git_push() {
  info "Committing and pushing changes..."
  cd "$REPO_ROOT"

  # Stage all tracked modified files
  git add backend/src web/src
  if git diff --cached --quiet; then
    warn "No staged changes — skipping commit."
  else
    git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')"
  fi

  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  git push origin "$BRANCH"
  info "Pushed to origin/$BRANCH"
}

deploy_backend() {
  info "========== Deploying Backend to Cloud Run =========="
  cd "$REPO_ROOT/backend"

  info "Building Docker image: ${BACKEND_IMAGE}"
  docker build -t "$BACKEND_IMAGE" .

  info "Pushing image to Artifact Registry..."
  docker push "$BACKEND_IMAGE"

  info "Deploying to Cloud Run..."
  gcloud run deploy "$BACKEND_SERVICE" \
    --image "$BACKEND_IMAGE" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --timeout 300s \
    --set-secrets "DATABASE_URL=DATABASE_URL:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest" \
    --project "$PROJECT_ID"

  BACKEND_URL="$(gcloud run services describe "$BACKEND_SERVICE" \
    --region "$REGION" --project "$PROJECT_ID" \
    --format 'value(status.url)')"
  info "Backend live at: ${BACKEND_URL}"
}

deploy_frontend() {
  info "========== Deploying Frontend to Firebase Hosting =========="
  cd "$REPO_ROOT/web"

  info "Installing npm dependencies..."
  npm install --silent

  info "Building production bundle..."
  npm run build

  info "Deploying to Firebase Hosting..."
  cd "$REPO_ROOT"
  firebase deploy --only hosting --project "$FIREBASE_PROJECT" --non-interactive

  info "Frontend live at: https://${FIREBASE_PROJECT}.web.app"
}

# ── Option: use Cloud Build (CI/CD) instead of local build ───────────────────
cloud_build_deploy() {
  info "Triggering Google Cloud Build (remote build + deploy)..."
  cd "$REPO_ROOT"
  gcloud builds submit \
    --config cloudbuild.yaml \
    --project "$PROJECT_ID" \
    .
  info "Cloud Build triggered. Monitor at:"
  info "  https://console.cloud.google.com/cloud-build/builds?project=${PROJECT_ID}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
MODE="${1:-all}"

case "$MODE" in
  push)
    git_push
    ;;
  backend)
    check_prereqs
    deploy_backend
    ;;
  frontend)
    check_prereqs
    deploy_frontend
    ;;
  cloudbuild)
    git_push
    cloud_build_deploy
    ;;
  all)
    git_push
    check_prereqs
    deploy_backend
    deploy_frontend
    ;;
  *)
    echo "Usage: $0 [push|backend|frontend|cloudbuild|all]"
    exit 1
    ;;
esac

info "Done."

# =============================================================================
# SETUP GUIDE (one-time, run these manually)
# =============================================================================
#
# 1. Install gcloud CLI
#    https://cloud.google.com/sdk/docs/install
#    Then: gcloud auth login
#          gcloud auth application-default login
#
# 2. Install Firebase CLI
#    npm install -g firebase-tools
#    firebase login
#
# 3. Set your Google Cloud project
#    gcloud config set project waterapp-prod-492407
#
# 4. Ensure Artifact Registry repo exists
#    gcloud artifacts repositories create app-repo \
#      --repository-format=docker \
#      --location=us-central1 \
#      --project=waterapp-prod-492407
#
# 5. Store backend secrets (only needed once or when they change)
#    gcloud secrets create DATABASE_URL --project=waterapp-prod-492407
#    echo -n "your-db-url" | gcloud secrets versions add DATABASE_URL --data-file=-
#
#    gcloud secrets create GEMINI_API_KEY --project=waterapp-prod-492407
#    echo -n "your-api-key" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
#
# 6. Make this script executable (one-time)
#    chmod +x deploy.sh
#
# RECOMMENDED APPROACH: use 'cloudbuild' mode to let Google do the build
# remotely — no need for local Docker:
#    ./deploy.sh cloudbuild
#
# =============================================================================
