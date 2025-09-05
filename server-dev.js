const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs').promises;

// Environment configuration
const config = {
    port: process.env.PORT || 3000,
    logLevel: process.env.LOG_LEVEL || 'info',
    wsHeartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000,
    apiRateLimit: parseInt(process.env.API_RATE_LIMIT) || 100
};

// Initialize Express app
const app = express();
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

// Mock data for development
const mockData = {
    projects: [
        {
            id: 1,
            name: 'Test Event',
            description: 'Test event voor SmartVisitor systeem',
            organization_id: 1,
            created_at: new Date().toISOString()
        }
    ],
    guests: [
        {
            id: 1,
            project_id: 1,
            name: 'Willem van Leunen',
            email: 'willem@example.com',
            vip: true,
            tag_id: 'Q3000E28011608000021C84A2622A4DBF',
            assigned_at: new Date().toISOString()
        },
        {
            id: 2,
            project_id: 1,
            name: 'Test Gast 1',
            email: 'test1@example.com',
            vip: false,
            tag_id: null,
            assigned_at: null
        },
        {
            id: 3,
            project_id: 1,
            name: 'Test Gast 2',
            email: 'test2@example.com',
            vip: false,
            tag_id: null,
            assigned_at: null
        }
    ],
    scanners: [
        {
            id: 1,
            name: 'VIP Ingang Scanner',
            mac_address: 'F0:F5:BD:54:36:A8',
            location: 'VIP Entrance',
            project_assigned_at: new Date().toISOString()
        },
        {
            id: 2,
            name: 'Hoofdingang Scanner',
            mac_address: 'F0:F5:BD:54:36:A9',
            location: 'Main Entrance',
            project_assigned_at: new Date().toISOString()
        }
    ],
    pendingAssignments: [],
    stats: {
        projects: 1,
        guests: 3,
        scanners: 2,
        assignments: 1,
        pending_assignments: 0,
        connected_clients: 0,
        uptime: 0
    }
};

// Logging setup
const logDir = path.join(__dirname, 'logs');
let logStream;

async function initializeLogging() {
    try {
        await fs.mkdir(logDir, { recursive: true });
        logStream = require('fs').createWriteStream(
            path.join(logDir, `smartvisitor-dev-${new Date().toISOString().split('T')[0]}.log`),
            { flags: 'a' }
        );
    } catch (error) {
        console.error('Failed to initialize logging:', error);
    }
}

function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        data
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    // Console output
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
    
    // File output
    if (logStream) {
        logStream.write(logLine);
    }
}

// Middleware setup
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrcAttr: ["'unsafe-inline'"]
        }
    }
}));

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(morgan('dev'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Favicon handler
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'mock (development mode)',
        mode: 'development'
    });
});

// Test scan trigger endpoint
app.get('/api/test-scan', (req, res) => {
    const tag_id = 'TEST' + Date.now();
    const scanner_mac = 'F0:F5:BD:54:36:A8'; // VIP Ingang Scanner MAC

    log('info', `Test scan triggered: ${tag_id} on scanner ${scanner_mac}`);

    // Simulate the tag scan
    const scanner = mockData.scanners.find(s => s.mac_address === scanner_mac);
    if (!scanner) {
        return res.status(404).json({ error: 'Scanner not found' });
    }

    const pendingAssignment = mockData.pendingAssignments.find(a => a.scannerId === scanner.id);
    if (!pendingAssignment) {
        return res.json({ message: 'No pending assignment for this scanner' });
    }

    // Complete the assignment
    const guest = mockData.guests.find(g => g.id === pendingAssignment.guestId);
    if (guest) {
        guest.tag_id = tag_id;
        guest.assigned_at = new Date().toISOString();
        mockData.stats.assignments++;
    }

    // Remove from pending
    const index = mockData.pendingAssignments.findIndex(a => a.id === pendingAssignment.id);
    if (index !== -1) {
        mockData.pendingAssignments.splice(index, 1);
        mockData.stats.pending_assignments = mockData.pendingAssignments.length;
    }

    // Broadcast successful assignment
    broadcastToClients({
        type: 'tag_assignment_completed',
        assignment: {
            ...pendingAssignment,
            tag_id,
            status: 'completed',
            completed_at: new Date().toISOString(),
            guest_name: guest ? guest.name : 'Unknown'
        }
    });

    log('info', `Test tag ${tag_id} assigned to guest ${guest ? guest.name : 'Unknown'}`);

    res.json({
        success: true,
        message: `Test tag assigned to ${guest ? guest.name : 'Unknown'}`,
        tag_id,
        guest_name: guest ? guest.name : 'Unknown'
    });
});

// Reset all tags (for testing)
app.get('/api/test-reset-tags', (req, res) => {
    mockData.guests.forEach(guest => {
        guest.tag_id = null;
        guest.assigned_at = null;
    });
    mockData.stats.assignments = 0;
    mockData.pendingAssignments = [];
    mockData.stats.pending_assignments = 0;

    broadcastToClients({
        type: 'data_updated',
        message: 'All tags reset'
    });

    log('info', 'All tags reset for testing');
    res.json({ success: true, message: 'All tags reset' });
});

// Show test endpoints
app.get('/api/test-help', (req, res) => {
    res.json({
        message: 'SmartVisitor Test Endpoints',
        endpoints: {
            '/api/test-scan': 'Trigger a test tag scan for pending assignment',
            '/api/test-reset-tags': 'Reset all tag assignments',
            '/api/test-help': 'Show this help'
        },
        usage: {
            workflow: [
                '1. Select a project and scanner in the web interface',
                '2. Click "Tag Koppelen" for a guest',
                '3. Visit /api/test-scan to simulate a tag scan',
                '4. Use /api/test-reset-tags to reset all tags for testing'
            ]
        }
    });
});

// WebSocket connection handling
const connectedClients = new Set();

wss.on('connection', (ws, req) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.clientId = clientId;
    connectedClients.add(ws);
    
    log('info', `WebSocket client connected: ${clientId}`);
    
    // Update stats
    mockData.stats.connected_clients = connectedClients.size;
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to SmartVisitor Admin (Development Mode)',
        clientId: clientId,
        timestamp: new Date().toISOString()
    }));
    
    // Handle client messages
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            await handleWebSocketMessage(ws, data);
        } catch (error) {
            log('error', 'WebSocket message error', error.message);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });
    
    // Handle client disconnect
    ws.on('close', () => {
        connectedClients.delete(ws);
        mockData.stats.connected_clients = connectedClients.size;
        log('info', `WebSocket client disconnected: ${clientId}`);
    });
    
    // Handle errors
    ws.on('error', (error) => {
        log('error', `WebSocket error for client ${clientId}`, error.message);
        connectedClients.delete(ws);
        mockData.stats.connected_clients = connectedClients.size;
    });
});

// WebSocket message handler
async function handleWebSocketMessage(ws, data) {
    switch (data.type) {
        case 'ping':
            ws.send(JSON.stringify({
                type: 'pong',
                timestamp: new Date().toISOString()
            }));
            break;
            
        case 'subscribe':
            // Handle subscription to specific events
            ws.subscriptions = ws.subscriptions || new Set();
            if (data.events) {
                data.events.forEach(event => ws.subscriptions.add(event));
            }
            break;
            
        default:
            log('warn', `Unknown WebSocket message type: ${data.type}`);
    }
}

// Broadcast to all connected clients
function broadcastToClients(message) {
    const messageStr = JSON.stringify(message);
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

// API Routes

// Get all projects
app.get('/api/projects', (req, res) => {
    log('info', 'Projects requested');
    res.json(mockData.projects);
});

// Get project details with guests and scanners
app.get('/api/projects/:id', (req, res) => {
    const projectId = parseInt(req.params.id);
    const project = mockData.projects.find(p => p.id === projectId);
    
    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    const projectGuests = mockData.guests.filter(g => g.project_id === projectId);
    const projectScanners = mockData.scanners;
    
    res.json({
        project: project,
        guests: projectGuests,
        scanners: projectScanners
    });
});

// Start tag assignment process
app.post('/api/tag-assignment/start', (req, res) => {
    const { projectId, guestId, scannerId } = req.body;

    if (!projectId || !guestId || !scannerId) {
        return res.status(400).json({
            error: 'Missing required fields: projectId, guestId, scannerId'
        });
    }

    // Find guest and scanner
    const guest = mockData.guests.find(g => g.id === parseInt(guestId));
    const scanner = mockData.scanners.find(s => s.id === parseInt(scannerId));

    if (!guest || !scanner) {
        return res.status(404).json({ error: 'Guest or scanner not found' });
    }

    // Create pending assignment
    const assignmentId = Date.now();
    const assignment = {
        id: assignmentId,
        projectId: parseInt(projectId),
        guestId: parseInt(guestId),
        scannerId: parseInt(scannerId),
        status: 'waiting',
        guest: guest,
        scanner: scanner,
        createdAt: new Date().toISOString()
    };

    mockData.pendingAssignments.push(assignment);
    mockData.stats.pending_assignments = mockData.pendingAssignments.length;

    // Broadcast to all clients
    broadcastToClients({
        type: 'tag_assignment_started',
        assignment
    });

    log('info', `Tag assignment started for guest ${guest.name} on scanner ${scanner.name}`);

    res.json({
        success: true,
        assignment
    });
});

// Cancel tag assignment
app.post('/api/tag-assignment/cancel', (req, res) => {
    const { assignmentId } = req.body;

    if (!assignmentId) {
        return res.status(400).json({ error: 'Missing assignmentId' });
    }

    // Remove from pending assignments
    const index = mockData.pendingAssignments.findIndex(a => a.id === parseInt(assignmentId));
    if (index !== -1) {
        mockData.pendingAssignments.splice(index, 1);
        mockData.stats.pending_assignments = mockData.pendingAssignments.length;
    }

    // Broadcast cancellation
    broadcastToClients({
        type: 'tag_assignment_cancelled',
        assignmentId: parseInt(assignmentId)
    });

    log('info', `Tag assignment ${assignmentId} cancelled`);

    res.json({ success: true });
});

// Get pending assignments
app.get('/api/tag-assignments/pending', (req, res) => {
    res.json(mockData.pendingAssignments);
});

// Handle tag scan from n8n webhook (mock)
app.post('/api/tag-scan', (req, res) => {
    const { tag_id, scanner_mac, timestamp } = req.body;

    if (!tag_id || !scanner_mac) {
        return res.status(400).json({
            error: 'Missing required fields: tag_id, scanner_mac'
        });
    }

    log('info', `Tag scan received: ${tag_id} on scanner ${scanner_mac}`);

    // Find scanner by MAC address
    const scanner = mockData.scanners.find(s => s.mac_address === scanner_mac);

    if (!scanner) {
        log('warn', `Unknown scanner MAC: ${scanner_mac}`);
        return res.status(404).json({ error: 'Scanner not found' });
    }

    // Check for pending assignments for this scanner
    const pendingAssignment = mockData.pendingAssignments.find(a => a.scannerId === scanner.id);

    if (pendingAssignment) {
        // Complete the tag assignment
        const guest = mockData.guests.find(g => g.id === pendingAssignment.guestId);
        if (guest) {
            guest.tag_id = tag_id;
            guest.assigned_at = new Date().toISOString();
            mockData.stats.assignments++;
        }

        // Remove from pending
        const index = mockData.pendingAssignments.findIndex(a => a.id === pendingAssignment.id);
        if (index !== -1) {
            mockData.pendingAssignments.splice(index, 1);
            mockData.stats.pending_assignments = mockData.pendingAssignments.length;
        }

        // Broadcast successful assignment
        broadcastToClients({
            type: 'tag_assignment_completed',
            assignment: {
                ...pendingAssignment,
                tag_id,
                status: 'completed',
                completed_at: new Date().toISOString(),
                guest_name: guest ? guest.name : 'Unknown'
            }
        });

        log('info', `Tag ${tag_id} assigned to guest ${guest ? guest.name : 'Unknown'}`);

        res.json({
            success: true,
            message: `Tag assigned to ${guest ? guest.name : 'Unknown'}`,
            assignment: {
                guest_name: guest ? guest.name : 'Unknown',
                tag_id,
                project_name: 'Test Event'
            }
        });
    } else {
        // Regular scan - broadcast to clients
        broadcastToClients({
            type: 'tag_scan',
            scan: {
                tag_id,
                scanner_mac,
                scanner_name: scanner.name,
                timestamp: timestamp || new Date().toISOString()
            }
        });

        res.json({
            success: true,
            message: 'Scan recorded'
        });
    }
});

// Get recent scans (mock)
app.get('/api/scans/recent', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;

    // Return mock recent activity
    const recentScans = mockData.guests
        .filter(g => g.tag_id)
        .map(g => ({
            tag_id: g.tag_id,
            timestamp: g.assigned_at,
            guest_name: g.name,
            project_name: 'Test Event',
            scan_type: 'assignment'
        }))
        .slice(0, limit);

    res.json(recentScans);
});

// Get system statistics
app.get('/api/stats', (req, res) => {
    mockData.stats.uptime = process.uptime();
    mockData.stats.connected_clients = connectedClients.size;
    res.json(mockData.stats);
});

// Remove tag assignment
app.delete('/api/tag-assignment/:guestId', (req, res) => {
    const guestId = parseInt(req.params.guestId);
    const { projectId } = req.query;

    if (!projectId) {
        return res.status(400).json({ error: 'Missing projectId parameter' });
    }

    // Find and update guest
    const guest = mockData.guests.find(g => g.id === guestId);
    if (guest) {
        guest.tag_id = null;
        guest.assigned_at = null;
        mockData.stats.assignments = Math.max(0, mockData.stats.assignments - 1);
    }

    // Broadcast update
    broadcastToClients({
        type: 'tag_assignment_removed',
        guestId: guestId,
        projectId: parseInt(projectId)
    });

    log('info', `Tag assignment removed for guest ${guestId} in project ${projectId}`);

    res.json({ success: true });
});

// Error handling middleware
app.use((error, req, res, next) => {
    log('error', 'Unhandled error', error.message);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// WebSocket heartbeat
setInterval(() => {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.ping();
        } else {
            connectedClients.delete(client);
        }
    });
    mockData.stats.connected_clients = connectedClients.size;
}, config.wsHeartbeatInterval);

// Server initialization
async function startServer() {
    try {
        // Initialize logging
        await initializeLogging();
        log('info', 'Logging initialized');

        log('info', 'Starting in DEVELOPMENT mode with mock data');

        // Start server
        server.listen(config.port, () => {
            log('info', `SmartVisitor Admin Server (DEV) started on port ${config.port}`);
            log('info', `Environment: development (mock data)`);
            log('info', `WebSocket heartbeat interval: ${config.wsHeartbeatInterval}ms`);
            log('info', `Access: http://localhost:${config.port}`);
        });

    } catch (error) {
        log('error', 'Failed to start server', error.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
    log('info', `Received ${signal}, starting graceful shutdown`);

    // Close WebSocket server
    wss.close(() => {
        log('info', 'WebSocket server closed');
    });

    // Close HTTP server
    server.close(() => {
        log('info', 'HTTP server closed');
    });

    // Close log stream
    if (logStream) {
        logStream.end();
    }

    process.exit(0);
}

// Start the server
startServer();
