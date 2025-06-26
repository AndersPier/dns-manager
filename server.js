const express = require('express');
const Docker = require('dockerode');
const axios = require('axios');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const cors = require('cors');
const path = require('path');

const app = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Environment variables with defaults
const config = {
  accountName: process.env.SIMPLY_ACCOUNT_NAME || '',
  apiKey: process.env.SIMPLY_API_KEY || '',
  deleteDelay: parseInt(process.env.DELETE_DELAY_SECONDS) || 300, // 5 minutes default
  pollInterval: parseInt(process.env.POLL_INTERVAL_SECONDS) || 30, // 30 seconds default
  port: parseInt(process.env.PORT) || 3000,
  targetDomain: process.env.TARGET_DOMAIN || '' // The target domain for CNAME records
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// State management
const managedRecords = new Map(); // container_id -> {recordId, hostname, deleteTimer}
const deletePendingRecords = new Map(); // container_id -> timeout_id

// Logging utility
const log = {
  info: (msg, data = {}) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, data),
  error: (msg, data = {}) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, data),
  warn: (msg, data = {}) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, data)
};

// Simply.com API client
class SimplyAPI {
  constructor(accountName, apiKey) {
    this.accountName = accountName;
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.simply.com/2';
    this.auth = Buffer.from(`${accountName}:${apiKey}`).toString('base64');
  }

  async createCNAMERecord(domain, name, target, ttl = 3600) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/my/products/${domain}/dns/records`,
        {
          type: 'CNAME',
          name: name,
          data: target,
          ttl: ttl
        },
        {
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      log.info(`Created CNAME record: ${name}.${domain} -> ${target}`, { recordId: response.data.record[0].id });
      return response.data.record[0].id;
    } catch (error) {
      log.error(`Failed to create CNAME record: ${name}.${domain}`, { error: error.message });
      throw error;
    }
  }

  async deleteRecord(domain, recordId) {
    try {
      await axios.delete(
        `${this.baseUrl}/my/products/${domain}/dns/records/${recordId}`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`
          }
        }
      );
      
      log.info(`Deleted DNS record`, { domain, recordId });
      return true;
    } catch (error) {
      log.error(`Failed to delete DNS record`, { domain, recordId, error: error.message });
      throw error;
    }
  }

  async listRecords(domain) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/dns/${domain}/records`,
        {
          headers: {
            'Authorization': `Basic ${this.auth}`
          }
        }
      );
      return response.data.records || [];
    } catch (error) {
      log.error(`Failed to list DNS records for domain: ${domain}`, { error: error.message });
      throw error;
    }
  }
}

const simplyAPI = new SimplyAPI(config.accountName, config.apiKey);

// Container monitoring functions
function extractTraefikHosts(labels) {
  const hosts = [];
  
  // Check various Traefik label patterns
  const patterns = [
    /^traefik\.http\.routers\.(.+)\.rule$/,
    /^traefik\.enable$/
  ];
  
  for (const [key, value] of Object.entries(labels)) {
    if (key.includes('traefik.http.routers') && key.includes('.rule')) {
      // Extract Host() rules from Traefik router rules
      const hostMatches = value.match(/Host\(`([^`]+)`\)/g);
      if (hostMatches) {
        hostMatches.forEach(match => {
          const host = match.match(/Host\(`([^`]+)`\)/)[1];
          hosts.push(host);
        });
      }
      
      // Also handle Host() without backticks
      const hostMatches2 = value.match(/Host\(([^)]+)\)/g);
      if (hostMatches2) {
        hostMatches2.forEach(match => {
          const host = match.match(/Host\(([^)]+)\)/)[1].replace(/['"]/g, '');
          hosts.push(host);
        });
      }
    }
  }
  
  return [...new Set(hosts)]; // Remove duplicates
}

async function createDNSRecordsForContainer(container) {
  try {
    const containerInfo = await container.inspect();
    const labels = containerInfo.Config.Labels || {};
    const containerId = containerInfo.Id.substring(0, 12);
    
    // Skip if Traefik is not enabled
    if (labels['traefik.enable'] !== 'true') {
      return;
    }
    
    const hosts = extractTraefikHosts(labels);
    
    if (hosts.length === 0) {
      log.warn(`No valid hosts found in Traefik labels for container ${containerId}`);
      return;
    }
    
    for (const host of hosts) {
      // Extract subdomain and domain
      const parts = host.split('.');
      if (parts.length < 2) {
        log.warn(`Invalid hostname format: ${host}`);
        continue;
      }
      
      const subdomain = parts.slice(0, -2).join('.');
      const domain = parts.slice(-2).join('.');
      
      if (!subdomain) {
        log.warn(`No subdomain found for host: ${host}`);
        continue;
      }
      
      try {
        const recordId = await simplyAPI.createCNAMERecord(
          domain,
          subdomain,
          config.targetDomain || host,
          3600
        );
        
        // Store the managed record
        const recordKey = `${containerId}-${host}`;
        managedRecords.set(recordKey, {
          recordId,
          hostname: host,
          domain,
          subdomain,
          containerId
        });
        
        log.info(`DNS record created for container`, {
          containerId,
          hostname: host,
          recordId
        });
        
      } catch (error) {
        log.error(`Failed to create DNS record for ${host}`, { error: error.message });
      }
    }
    
  } catch (error) {
    log.error(`Error processing container for DNS creation`, { error: error.message });
  }
}

async function scheduleRecordDeletion(containerId) {
  // Cancel any existing deletion timer
  if (deletePendingRecords.has(containerId)) {
    clearTimeout(deletePendingRecords.get(containerId));
  }
  
  const timer = setTimeout(async () => {
    try {
      // Find all records for this container
      const recordsToDelete = [];
      for (const [key, record] of managedRecords.entries()) {
        if (record.containerId === containerId) {
          recordsToDelete.push({ key, record });
        }
      }
      
      // Delete the DNS records
      for (const { key, record } of recordsToDelete) {
        try {
          await simplyAPI.deleteRecord(record.domain, record.recordId);
          managedRecords.delete(key);
          log.info(`DNS record deleted for stopped container`, {
            containerId,
            hostname: record.hostname,
            recordId: record.recordId
          });
        } catch (error) {
          log.error(`Failed to delete DNS record for stopped container`, {
            containerId,
            hostname: record.hostname,
            error: error.message
          });
        }
      }
      
      deletePendingRecords.delete(containerId);
      
    } catch (error) {
      log.error(`Error during scheduled record deletion`, { containerId, error: error.message });
    }
  }, config.deleteDelay * 1000);
  
  deletePendingRecords.set(containerId, timer);
  log.info(`Scheduled DNS record deletion in ${config.deleteDelay} seconds`, { containerId });
}

async function monitorContainers() {
  try {
    const containers = await docker.listContainers({ all: true });
    const runningContainerIds = new Set();
    
    // Process running containers
    for (const containerInfo of containers) {
      if (containerInfo.State === 'running') {
        const containerId = containerInfo.Id.substring(0, 12);
        runningContainerIds.add(containerId);
        
        // Check if we already manage records for this container
        const hasRecords = Array.from(managedRecords.keys()).some(key => key.startsWith(containerId));
        
        if (!hasRecords) {
          const container = docker.getContainer(containerInfo.Id);
          await createDNSRecordsForContainer(container);
        }
        
        // Cancel any pending deletion for running containers
        if (deletePendingRecords.has(containerId)) {
          clearTimeout(deletePendingRecords.get(containerId));
          deletePendingRecords.delete(containerId);
          log.info(`Cancelled scheduled deletion for restarted container`, { containerId });
        }
      }
    }
    
    // Schedule deletion for stopped containers
    for (const [key, record] of managedRecords.entries()) {
      if (!runningContainerIds.has(record.containerId) && !deletePendingRecords.has(record.containerId)) {
        await scheduleRecordDeletion(record.containerId);
      }
    }
    
  } catch (error) {
    log.error(`Error monitoring containers`, { error: error.message });
  }
}

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Dokploy DNS Manager API',
      version: '1.0.0',
      description: 'Automatic DNS management for Dokploy containers with Simply.com',
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: 'Development server',
      },
    ],
  },
  apis: ['./server.js'],
};

const specs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// API Routes

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Service is healthy
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    config: {
      pollInterval: config.pollInterval,
      deleteDelay: config.deleteDelay,
      hasCredentials: !!(config.accountName && config.apiKey)
    }
  });
});

/**
 * @swagger
 * /api/records:
 *   get:
 *     summary: Get all managed DNS records
 *     responses:
 *       200:
 *         description: List of managed DNS records
 */
app.get('/api/records', (req, res) => {
  const records = Array.from(managedRecords.entries()).map(([key, record]) => ({
    key,
    ...record
  }));
  
  res.json({
    records,
    pendingDeletions: Array.from(deletePendingRecords.keys()),
    total: records.length
  });
});

/**
 * @swagger
 * /api/containers:
 *   get:
 *     summary: Get all containers with Traefik labels
 *     responses:
 *       200:
 *         description: List of containers
 */
app.get('/api/containers', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const traefikContainers = [];
    
    for (const containerInfo of containers) {
      const container = docker.getContainer(containerInfo.Id);
      const details = await container.inspect();
      const labels = details.Config.Labels || {};
      
      if (labels['traefik.enable'] === 'true') {
        const hosts = extractTraefikHosts(labels);
        traefikContainers.push({
          id: containerInfo.Id.substring(0, 12),
          name: containerInfo.Names[0],
          state: containerInfo.State,
          status: containerInfo.Status,
          hosts,
          labels: Object.keys(labels).filter(key => key.startsWith('traefik.')).reduce((obj, key) => {
            obj[key] = labels[key];
            return obj;
          }, {})
        });
      }
    }
    
    res.json({ containers: traefikContainers });
  } catch (error) {
    log.error('Failed to list containers', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/sync:
 *   post:
 *     summary: Force synchronization of DNS records
 *     responses:
 *       200:
 *         description: Sync completed
 */
app.post('/api/sync', async (req, res) => {
  try {
    log.info('Manual sync triggered');
    await monitorContainers();
    res.json({ message: 'Sync completed', timestamp: new Date().toISOString() });
  } catch (error) {
    log.error('Manual sync failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Serve React frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  log.error('Unhandled error', { error: error.message });
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
async function startServer() {
  // Validate configuration
  if (!config.accountName || !config.apiKey) {
    log.error('Missing required environment variables: SIMPLY_ACCOUNT_NAME and SIMPLY_API_KEY');
    process.exit(1);
  }
  
  app.listen(config.port, () => {
    log.info(`DNS Manager started on port ${config.port}`, {
      config: {
        pollInterval: config.pollInterval,
        deleteDelay: config.deleteDelay,
        targetDomain: config.targetDomain
      }
    });
    
    log.info(`API documentation available at http://localhost:${config.port}/api-docs`);
    log.info(`Web interface available at http://localhost:${config.port}`);
  });
  
  // Start container monitoring
  log.info('Starting container monitoring...');
  await monitorContainers(); // Initial sync
  
  setInterval(async () => {
    await monitorContainers();
  }, config.pollInterval * 1000);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('Received SIGTERM, shutting down gracefully...');
  // Clear all pending deletion timers
  for (const timer of deletePendingRecords.values()) {
    clearTimeout(timer);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('Received SIGINT, shutting down gracefully...');
  // Clear all pending deletion timers
  for (const timer of deletePendingRecords.values()) {
    clearTimeout(timer);
  }
  process.exit(0);
});

startServer().catch(error => {
  log.error('Failed to start server', { error: error.message });
  process.exit(1);
});