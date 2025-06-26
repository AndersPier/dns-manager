# Dokploy DNS Manager

Automatic DNS management for Dokploy containers with Simply.com API integration. This service monitors Docker containers with Traefik labels and automatically creates/deletes CNAME records at Simply.com when containers are started or stopped.

## Features

- 🔄 **Automatic DNS Management**: Creates and deletes CNAME records based on container lifecycle
- 🏷️ **Traefik Integration**: Monitors containers with `traefik.enable=true` labels
- ⏱️ **Configurable Delays**: Customizable deletion delay to handle container restarts
- 🌐 **Modern Web Interface**: Responsive React frontend with real-time status
- 📚 **API Documentation**: Built-in Swagger/OpenAPI documentation
- 🪶 **Lightweight**: Optimized for minimal CPU and memory usage
- 🔧 **Easy Configuration**: Environment variable-based setup

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Dokploy deployment platform with Traefik
- Simply.com account with API access

### 1. Clone Repository

```bash
git clone https://github.com/AndersPier/dns-manager.git
cd dns-manager
```

### 2. Configure Environment Variables

Edit the `docker-compose.yml` file and update the environment variables:

```yaml
environment:
  # Simply.com API credentials (REQUIRED)
  - SIMPLY_ACCOUNT_NAME=S123456           # Your Simply.com account name
  - SIMPLY_API_KEY=your_api_key_here      # Your Simply.com API key
  
  # DNS configuration (REQUIRED)
  - TARGET_DOMAIN=your-server.com         # Target domain for CNAME records
  
  # Optional timing configuration
  - POLL_INTERVAL_SECONDS=30              # Container check interval
  - DELETE_DELAY_SECONDS=300              # Delay before deleting DNS records
  
  # Optional server configuration
  - PORT=3000                             # Web interface port
```

### 3. Deploy with Docker Compose

```bash
# Build and start the service
docker-compose up -d

# View logs
docker-compose logs -f dokploy-dns-manager
```

### 4. Access the Interface

- **Web Interface**: http://localhost:3000
- **API Documentation**: http://localhost:3000/api-docs
- **Health Check**: http://localhost:3000/api/health

## How It Works

### Container Detection

The service monitors Docker containers and looks for:

1. **Traefik Enabled**: `traefik.enable=true` label
2. **Host Rules**: Traefik router rules with `Host()` declarations

Example container labels:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myapp.rule=Host(`app.example.com`)"
  - "traefik.http.services.myapp.loadbalancer.server.port=3000"
```

### DNS Record Management

When a container with valid Traefik labels is detected:

1. **Extracts hostname** from Traefik `Host()` rules
2. **Creates CNAME record** pointing to your target domain
3. **Monitors container state** continuously
4. **Schedules deletion** when container stops (with configurable delay)
5. **Cancels deletion** if container restarts before delay expires

### Example Flow

1. Container starts with label: `traefik.http.routers.app.rule=Host(\`app.example.com\`)`
2. Service creates CNAME: `app.example.com` → `your-server.com`
3. Container stops
4. Service waits 5 minutes (configurable)
5. If container doesn't restart, CNAME record is deleted

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SIMPLY_ACCOUNT_NAME` | Yes | - | Your Simply.com account name (e.g., S123456) |
| `SIMPLY_API_KEY` | Yes | - | Your Simply.com API key |
| `TARGET_DOMAIN` | Yes | - | Target domain for CNAME records |
| `POLL_INTERVAL_SECONDS` | No | 30 | How often to check containers |
| `DELETE_DELAY_SECONDS` | No | 300 | Delay before deleting DNS records |
| `PORT` | No | 3000 | Port for web interface |

### Simply.com API Setup

1. Log into your Simply.com account
2. Go to API settings
3. Generate an API key
4. Note your account name (usually starts with 'S')

### Traefik Integration

The service works with standard Traefik labels. Containers must have:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.{service}.rule=Host(`{domain}`)"
```

Supported Host rule formats:
- `Host(\`example.com\`)`
- `Host("example.com")`
- `Host(example.com)`

## API Endpoints

### Core Endpoints

- `GET /api/health` - Service health and configuration status
- `GET /api/records` - List all managed DNS records
- `GET /api/containers` - List all monitored containers
- `POST /api/sync` - Force manual synchronization

### Web Interface

- `/` - Main dashboard
- `/api-docs` - Swagger API documentation

## Monitoring and Logging

### Log Levels

The service provides structured logging:

- `[INFO]` - Normal operations (record creation/deletion, sync events)
- `[WARN]` - Non-critical issues (invalid labels, missing domains)
- `[ERROR]` - Critical issues (API failures, connection errors)

### Health Checks

Built-in health check endpoint provides:
- Service status
- Configuration validation
- Last update timestamp
- Active record count

### Monitoring Integration

The service exposes metrics suitable for monitoring:
- Container count via `/api/containers`
- Record count via `/api/records`
- Health status via `/api/health`

## Troubleshooting

### Common Issues

**No records created:**
- Verify `traefik.enable=true` label exists
- Check Host() rule format in Traefik labels
- Ensure Simply.com credentials are correct

**Records not deleted:**
- Check `DELETE_DELAY_SECONDS` setting
- Verify container actually stopped (not just restarted)
- Check logs for API errors

**API errors:**
- Verify Simply.com credentials
- Check domain ownership in Simply.com account
- Ensure API key has DNS management permissions

### Debug Mode

View detailed logs:
```bash
docker-compose logs -f dokploy-dns-manager
```

Check service health:
```bash
curl http://localhost:3000/api/health
```

Force manual sync:
```bash
curl -X POST http://localhost:3000/api/sync
```

## Development

### Local Development

1. **Start backend:**
```bash
npm install
npm run dev
```

2. **Start frontend:**
```bash
cd frontend
npm install
npm start
```

### Building

```bash
# Build frontend
npm run build-frontend

# Build Docker image
docker build -t dokploy-dns-manager .
```

## Security Considerations

- Service runs as non-root user
- Minimal attack surface with Alpine Linux base
- Read-only Docker socket access
- Environment variable-based secrets
- HTTPS support through Traefik

## Performance

The service is optimized for minimal resource usage:

- **Memory**: ~64MB runtime, 256MB limit
- **CPU**: ~0.1 cores average, 0.5 cores limit
- **Network**: Minimal API calls to Simply.com
- **Storage**: Stateless operation (no persistent storage required)

## License

MIT License - feel free to modify and distribute.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and questions:

1. Check this README
2. Review the logs
3. Test API endpoints manually
4. Check Dokploy and Simply.com documentation