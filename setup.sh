#!/bin/bash

# Dokploy DNS Manager Setup Script
# This script helps you set up the DNS manager service

set -e

echo "🚀 Dokploy DNS Manager Setup"
echo "=============================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please install Docker Compose first."
    exit 1
fi

# Create directory structure
echo "📁 Creating directory structure..."
mkdir -p frontend/src
mkdir -p frontend/public
mkdir -p logs

# Check if required files exist
REQUIRED_FILES=(
    "server.js"
    "package.json"
    "Dockerfile"
    "docker-compose.yml"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Required file $file is missing."
        echo "Please ensure all files from the artifacts are in the current directory."
        exit 1
    fi
done

# Frontend files
FRONTEND_FILES=(
    "frontend/package.json"
    "frontend/src/App.js"
    "frontend/src/App.css"
    "frontend/src/index.js"
    "frontend/src/index.css"
    "frontend/public/index.html"
    "frontend/public/manifest.json"
)

echo "📋 Checking frontend files..."
missing_files=()
for file in "${FRONTEND_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -gt 0 ]; then
    echo "❌ Missing frontend files:"
    printf '   %s\n' "${missing_files[@]}"
    echo ""
    echo "Please create the frontend directory structure and copy the files:"
    echo "  mkdir -p frontend/src frontend/public"
    echo "  # Copy frontend files to their respective directories"
    exit 1
fi

# Function to prompt for environment variables
prompt_env_var() {
    local var_name=$1
    local prompt_text=$2
    local default_value=$3
    local is_required=$4
    
    if [ -n "$default_value" ]; then
        read -p "$prompt_text [$default_value]: " value
        value=${value:-$default_value}
    else
        while [ -z "$value" ] && [ "$is_required" = "true" ]; do
            read -p "$prompt_text: " value
            if [ -z "$value" ] && [ "$is_required" = "true" ]; then
                echo "❌ This field is required."
            fi
        done
        if [ -z "$value" ]; then
            read -p "$prompt_text: " value
        fi
    fi
    
    echo "$value"
}

echo ""
echo "🔧 Configuration"
echo "=================="
echo "Please provide the following information:"
echo ""

# Collect configuration
SIMPLY_ACCOUNT_NAME=$(prompt_env_var "SIMPLY_ACCOUNT_NAME" "Simply.com Account Name (e.g., S123456)" "" "true")
SIMPLY_API_KEY=$(prompt_env_var "SIMPLY_API_KEY" "Simply.com API Key" "" "true")
TARGET_DOMAIN=$(prompt_env_var "TARGET_DOMAIN" "Target Domain (where your server is hosted)" "" "true")
POLL_INTERVAL=$(prompt_env_var "POLL_INTERVAL_SECONDS" "Poll Interval in seconds" "30" "false")
DELETE_DELAY=$(prompt_env_var "DELETE_DELAY_SECONDS" "Delete Delay in seconds" "300" "false")
PORT=$(prompt_env_var "PORT" "Web Interface Port" "3000" "false")

# Update docker-compose.yml with the provided values
echo ""
echo "📝 Updating docker-compose.yml..."

# Create a temporary docker-compose file with the user's values
cat > docker-compose.yml << EOF
version: '3.8'

services:
  dokploy-dns-manager:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: dokploy-dns-manager
    restart: unless-stopped
    
    environment:
      # Simply.com API credentials
      - SIMPLY_ACCOUNT_NAME=${SIMPLY_ACCOUNT_NAME}
      - SIMPLY_API_KEY=${SIMPLY_API_KEY}
      
      # DNS configuration
      - TARGET_DOMAIN=${TARGET_DOMAIN}
      
      # Timing configuration
      - POLL_INTERVAL_SECONDS=${POLL_INTERVAL}
      - DELETE_DELAY_SECONDS=${DELETE_DELAY}
      
      # Server configuration
      - PORT=${PORT}
      - NODE_ENV=production
    
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./logs:/app/logs
    
    ports:
      - "${PORT}:${PORT}"
    
    # Traefik labels for integration with Dokploy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.dns-manager.rule=Host(\`dns-manager.${TARGET_DOMAIN}\`)"
      - "traefik.http.routers.dns-manager.entrypoints=websecure"
      - "traefik.http.routers.dns-manager.tls.certresolver=letsencrypt"
      - "traefik.http.services.dns-manager.loadbalancer.server.port=${PORT}"
    
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
        reservations:
          cpus: '0.1'
          memory: 64M
    
    healthcheck:
      test: ["CMD", "node", "-e", "const http = require('http'); const options = { hostname: 'localhost', port: ${PORT}, path: '/api/health', timeout: 2000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    
    security_opt:
      - no-new-privileges:true
    
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

networks:
  default:
    name: dokploy-dns-manager
    driver: bridge
EOF

echo "✅ Configuration updated."

# Build frontend
echo ""
echo "🏗️  Building frontend..."
cd frontend
if command -v npm &> /dev/null; then
    npm install
    npm run build
    echo "✅ Frontend built successfully."
else
    echo "❌ npm is not installed. Please install Node.js and npm."
    echo "You can build the frontend manually later with:"
    echo "  cd frontend && npm install && npm run build"
fi
cd ..

# Copy built frontend to public directory
if [ -d "frontend/build" ]; then
    echo "📂 Copying frontend build to public directory..."
    mkdir -p public
    cp -r frontend/build/* public/
    echo "✅ Frontend copied successfully."
fi

echo ""
echo "🐳 Building and starting Docker containers..."

# Build and start the service
if docker compose version &> /dev/null; then
    docker compose up -d --build
else
    docker-compose up -d --build
fi

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "📊 Service Information:"
echo "  • Web Interface: http://localhost:${PORT}"
echo "  • API Documentation: http://localhost:${PORT}/api-docs"
echo "  • Health Check: http://localhost:${PORT}/api/health"
echo ""
echo "🔗 Traefik URL (if configured): https://dns-manager.${TARGET_DOMAIN}"
echo ""
echo "📋 Next Steps:"
echo "  1. Verify the service is running: docker ps"
echo "  2. Check logs: docker logs dokploy-dns-manager"
echo "  3. Access the web interface"
echo "  4. Deploy containers with Traefik labels"
echo ""
echo "📚 Example Traefik labels for your containers:"
echo '  labels:'
echo '    - "traefik.enable=true"'
echo "    - \"traefik.http.routers.myapp.rule=Host(\`myapp.${TARGET_DOMAIN}\`)\""
echo '    - "traefik.http.routers.myapp.entrypoints=websecure"'
echo '    - "traefik.http.services.myapp.loadbalancer.server.port=3000"'
echo ""
echo "Happy deploying! 🚀"