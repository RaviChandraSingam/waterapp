# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage — serve with nginx, proxy /api to backend at runtime
FROM nginx:alpine AS runner

# Install envsubst (part of gettext)
RUN apk add --no-cache gettext

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config template — uses $BACKEND_URL injected at container start
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
\n\
  # Proxy API calls to the backend\n\
  location /api {\n\
    proxy_pass $BACKEND_URL;\n\
    proxy_set_header Host $host;\n\
    proxy_set_header X-Real-IP $remote_addr;\n\
  }\n\
\n\
  # SPA fallback\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/app.conf.template

# Entrypoint: substitute env vars into nginx config, then start nginx
COPY <<'EOF' /docker-entrypoint.sh
#!/bin/sh
set -e
: "${BACKEND_URL:=http://localhost:3000}"
envsubst '$BACKEND_URL' < /etc/nginx/conf.d/app.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g "daemon off;"
EOF

RUN chmod +x /docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
