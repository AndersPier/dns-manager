import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  RefreshCw, 
  Server, 
  Globe, 
  Container, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Trash2,
  ExternalLink,
  Settings,
  Activity,
  Database
} from 'lucide-react';
import './App.css';

function App() {
  const [health, setHealth] = useState(null);
  const [records, setRecords] = useState([]);
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    try {
      setError(null);
      const [healthRes, recordsRes, containersRes] = await Promise.all([
        axios.get('/api/health'),
        axios.get('/api/records'),
        axios.get('/api/containers')
      ]);
      
      setHealth(healthRes.data);
      setRecords(recordsRes.data.records);
      setContainers(containersRes.data.containers);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await axios.post('/api/sync');
      await fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (date) => {
    return date?.toLocaleTimeString() || 'Never';
  };

  const StatusCard = ({ title, value, icon: Icon, status = 'info', detail }) => (
    <div className={`status-card status-${status}`}>
      <div className="status-icon">
        <Icon size={24} />
      </div>
      <div className="status-content">
        <h3>{title}</h3>
        <div className="status-value">{value}</div>
        {detail && <div className="status-detail">{detail}</div>}
      </div>
    </div>
  );

  const ContainerCard = ({ container }) => (
    <div className={`container-card ${container.state}`}>
      <div className="container-header">
        <div className="container-icon">
          <Container size={20} />
        </div>
        <div className="container-info">
          <h4>{container.name}</h4>
          <span className={`status ${container.state}`}>{container.status}</span>
        </div>
      </div>
      
      {container.hosts && container.hosts.length > 0 && (
        <div className="container-hosts">
          <h5>Exposed Hosts:</h5>
          {container.hosts.map((host, index) => (
            <div key={index} className="host-item">
              <Globe size={16} />
              <span>{host}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const RecordCard = ({ record }) => (
    <div className="record-card">
      <div className="record-header">
        <div className="record-icon">
          <Database size={20} />
        </div>
        <div className="record-info">
          <h4>{record.hostname}</h4>
          <span className="record-id">Record ID: {record.recordId}</span>
        </div>
      </div>
      
      <div className="record-details">
        <div className="record-detail">
          <strong>Container:</strong> {record.containerId}
        </div>
        <div className="record-detail">
          <strong>Domain:</strong> {record.domain}
        </div>
        {record.subdomain && (
          <div className="record-detail">
            <strong>Subdomain:</strong> {record.subdomain}
          </div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="app loading">
        <div className="loading-spinner">
          <RefreshCw className="spin" size={48} />
          <p>Loading DNS Manager...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-title">
            <Server size={32} />
            <div>
              <h1>Dokploy DNS Manager</h1>
              <p>Automatic DNS management for containerized applications</p>
            </div>
          </div>
          
          <div className="header-actions">
            <button 
              onClick={handleSync} 
              disabled={syncing}
              className="sync-button"
            >
              <RefreshCw className={syncing ? 'spin' : ''} size={20} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            
            <a 
              href="/api-docs" 
              target="_blank" 
              rel="noopener noreferrer"
              className="docs-button"
            >
              <ExternalLink size={20} />
              API Docs
            </a>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          <span>Error: {error}</span>
        </div>
      )}

      <main className="main-content">
        {/* Status Overview */}
        <section className="section">
          <h2>System Status</h2>
          <div className="status-grid">
            <StatusCard
              title="Service Health"
              value={health?.status || 'Unknown'}
              icon={health?.status === 'healthy' ? CheckCircle : AlertCircle}
              status={health?.status === 'healthy' ? 'success' : 'error'}
              detail={`Last update: ${formatTime(lastUpdate)}`}
            />
            
            <StatusCard
              title="Managed Records"
              value={records.length}
              icon={Database}
              status="info"
              detail="Active DNS records"
            />
            
            <StatusCard
              title="Monitored Containers"
              value={containers.length}
              icon={Container}
              status="info"
              detail="Containers with Traefik labels"
            />
            
            <StatusCard
              title="Poll Interval"
              value={`${health?.config?.pollInterval || 'N/A'}s`}
              icon={Clock}
              status="info"
              detail={`Delete delay: ${health?.config?.deleteDelay || 'N/A'}s`}
            />
          </div>
        </section>

        {/* Configuration Status */}
        <section className="section">
          <h2>Configuration</h2>
          <div className="config-status">
            <div className={`config-item ${health?.config?.hasCredentials ? 'success' : 'error'}`}>
              <Settings size={20} />
              <span>Simply.com Credentials</span>
              {health?.config?.hasCredentials ? (
                <CheckCircle size={20} className="success" />
              ) : (
                <AlertCircle size={20} className="error" />
              )}
            </div>
          </div>
        </section>

        {/* DNS Records */}
        <section className="section">
          <h2>Active DNS Records</h2>
          {records.length === 0 ? (
            <div className="empty-state">
              <Database size={48} />
              <h3>No DNS records found</h3>
              <p>Start some containers with Traefik labels to see DNS records here.</p>
            </div>
          ) : (
            <div className="records-grid">
              {records.map((record, index) => (
                <RecordCard key={record.key || index} record={record} />
              ))}
            </div>
          )}
        </section>

        {/* Containers */}
        <section className="section">
          <h2>Monitored Containers</h2>
          {containers.length === 0 ? (
            <div className="empty-state">
              <Container size={48} />
              <h3>No containers found</h3>
              <p>Deploy containers with traefik.enable=true to see them here.</p>
            </div>
          ) : (
            <div className="containers-grid">
              {containers.map((container, index) => (
                <ContainerCard key={container.id || index} container={container} />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-info">
            <Activity size={16} />
            <span>Last updated: {formatTime(lastUpdate)}</span>
          </div>
          <div className="footer-links">
            <a href="https://dokploy.com" target="_blank" rel="noopener noreferrer">
              Dokploy
            </a>
            <a href="https://www.simply.com/en/docs/api/" target="_blank" rel="noopener noreferrer">
              Simply.com API
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;