const express = require('express');
const mysql = require('mysql2/promise');
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
    db: {
        host: process.env.DB_HOST || '172.17.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'sv_scans',
        port: process.env.DB_PORT || 3306,
        connectionLimit: 10,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true
    },
    logLevel: process.env.LOG_LEVEL || 'info',
    wsHeartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000,
    apiRateLimit: parseInt(process.env.API_RATE_LIMIT) || 100
};

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Database connection pool
let dbPool;

// WebSocket server
const wss = new WebSocket.Server({ server });

// Logging setup
const logDir = path.join(__dirname, 'logs');
let logStream;

async function initializeLogging() {
    try {
        await fs.mkdir(logDir, { recursive: true });
        logStream = require('fs').createWriteStream(
            path.join(logDir, `smartvisitor-${new Date().toISOString().split('T')[0]}.log`),
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

// Database initialization
async function initializeDatabase() {
    try {
        dbPool = mysql.createPool(config.db);
        
        // Test connection
        const connection = await dbPool.getConnection();
        await connection.ping();
        connection.release();
        
        log('info', 'Database connection established');
        
        // Create pending_tag_assignments table if it doesn't exist
        await createPendingTagAssignmentsTable();
        
        return true;
    } catch (error) {
        log('error', 'Database connection failed', error.message);
        throw error;
    }
}

async function createPendingTagAssignmentsTable() {
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS pending_tag_assignments (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            project_id BIGINT NOT NULL,
            guest_id BIGINT NOT NULL,
            scanner_id BIGINT NOT NULL,
            status ENUM('waiting', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            completed_at DATETIME(6) NULL,
            tag_id VARCHAR(255) NULL,
            
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE,
            FOREIGN KEY (scanner_id) REFERENCES scanners(id) ON DELETE CASCADE,
            
            INDEX idx_status_created (status, created_at),
            INDEX idx_project_guest (project_id, guest_id),
            INDEX idx_scanner_status (scanner_id, status)
        )
    `;
    
    try {
        await dbPool.execute(createTableSQL);
        log('info', 'pending_tag_assignments table ready');
    } catch (error) {
        log('error', 'Failed to create pending_tag_assignments table', error.message);
        throw error;
    }
}

// Middleware setup
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    }
}));

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
if (logStream) {
    app.use(morgan('combined', { stream: logStream }));
}
app.use(morgan('dev'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbPool ? 'connected' : 'disconnected'
    });
});

// WebSocket connection handling
const connectedClients = new Set();

wss.on('connection', (ws, req) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.clientId = clientId;
    connectedClients.add(ws);
    
    log('info', `WebSocket client connected: ${clientId}`);
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to SmartVisitor Admin',
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
        log('info', `WebSocket client disconnected: ${clientId}`);
    });
    
    // Handle errors
    ws.on('error', (error) => {
        log('error', `WebSocket error for client ${clientId}`, error.message);
        connectedClients.delete(ws);
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

// Broadcast to subscribed clients
function broadcastToSubscribers(eventType, message) {
    const messageStr = JSON.stringify({ ...message, type: eventType });
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && 
            client.subscriptions && 
            client.subscriptions.has(eventType)) {
            client.send(messageStr);
        }
    });
}

// API Routes

// Get all projects
app.get('/api/projects', async (req, res) => {
    try {
        const [rows] = await dbPool.execute(
            'SELECT * FROM projects ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (error) {
        log('error', 'Failed to fetch projects', error.message);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// Get project details with guests and scanners
app.get('/api/projects/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        
        // Get project details
        const [projectRows] = await dbPool.execute(
            'SELECT * FROM projects WHERE id = ?',
            [projectId]
        );
        
        if (projectRows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        // Get guests for this project
        const [guestRows] = await dbPool.execute(`
            SELECT g.*, ta.tag_id, ta.assigned_at
            FROM guests g
            LEFT JOIN tag_assignments ta ON g.id = ta.guest_id AND ta.project_id = ?
            WHERE g.project_id = ?
            ORDER BY g.name
        `, [projectId, projectId]);
        
        // Get scanners for this project
        const [scannerRows] = await dbPool.execute(`
            SELECT s.*, ps.assigned_at as project_assigned_at
            FROM scanners s
            INNER JOIN project_scanners ps ON s.id = ps.scanner_id
            WHERE ps.project_id = ?
            ORDER BY s.name
        `, [projectId]);
        
        res.json({
            project: projectRows[0],
            guests: guestRows,
            scanners: scannerRows
        });
    } catch (error) {
        log('error', 'Failed to fetch project details', error.message);
        res.status(500).json({ error: 'Failed to fetch project details' });
    }
});

// Start tag assignment process
app.post('/api/tag-assignment/start', async (req, res) => {
    try {
        const { projectId, guestId, scannerId } = req.body;

        if (!projectId || !guestId || !scannerId) {
            return res.status(400).json({
                error: 'Missing required fields: projectId, guestId, scannerId'
            });
        }

        // Cancel any existing pending assignments for this guest
        await dbPool.execute(`
            UPDATE pending_tag_assignments
            SET status = 'cancelled'
            WHERE guest_id = ? AND project_id = ? AND status = 'waiting'
        `, [guestId, projectId]);

        // Create new pending assignment
        const [result] = await dbPool.execute(`
            INSERT INTO pending_tag_assignments (project_id, guest_id, scanner_id, status)
            VALUES (?, ?, ?, 'waiting')
        `, [projectId, guestId, scannerId]);

        const assignmentId = result.insertId;

        // Get guest and scanner details for response
        const [guestRows] = await dbPool.execute(
            'SELECT * FROM guests WHERE id = ?',
            [guestId]
        );

        const [scannerRows] = await dbPool.execute(
            'SELECT * FROM scanners WHERE id = ?',
            [scannerId]
        );

        const assignment = {
            id: assignmentId,
            projectId,
            guestId,
            scannerId,
            status: 'waiting',
            guest: guestRows[0],
            scanner: scannerRows[0],
            createdAt: new Date().toISOString()
        };

        // Broadcast to all clients
        broadcastToClients({
            type: 'tag_assignment_started',
            assignment
        });

        log('info', `Tag assignment started for guest ${guestId} on scanner ${scannerId}`);

        res.json({
            success: true,
            assignment
        });

    } catch (error) {
        log('error', 'Failed to start tag assignment', error.message);
        res.status(500).json({ error: 'Failed to start tag assignment' });
    }
});

// Cancel tag assignment
app.post('/api/tag-assignment/cancel', async (req, res) => {
    try {
        const { assignmentId } = req.body;

        if (!assignmentId) {
            return res.status(400).json({ error: 'Missing assignmentId' });
        }

        await dbPool.execute(`
            UPDATE pending_tag_assignments
            SET status = 'cancelled'
            WHERE id = ? AND status = 'waiting'
        `, [assignmentId]);

        // Broadcast cancellation
        broadcastToClients({
            type: 'tag_assignment_cancelled',
            assignmentId
        });

        log('info', `Tag assignment ${assignmentId} cancelled`);

        res.json({ success: true });

    } catch (error) {
        log('error', 'Failed to cancel tag assignment', error.message);
        res.status(500).json({ error: 'Failed to cancel tag assignment' });
    }
});

// Get pending assignments
app.get('/api/tag-assignments/pending', async (req, res) => {
    try {
        const [rows] = await dbPool.execute(`
            SELECT
                pta.*,
                g.name as guest_name,
                g.email as guest_email,
                s.name as scanner_name,
                s.mac_address as scanner_mac,
                p.name as project_name
            FROM pending_tag_assignments pta
            JOIN guests g ON pta.guest_id = g.id
            JOIN scanners s ON pta.scanner_id = s.id
            JOIN projects p ON pta.project_id = p.id
            WHERE pta.status = 'waiting'
            ORDER BY pta.created_at DESC
        `);

        res.json(rows);
    } catch (error) {
        log('error', 'Failed to fetch pending assignments', error.message);
        res.status(500).json({ error: 'Failed to fetch pending assignments' });
    }
});

// Handle tag scan from n8n webhook
app.post('/api/tag-scan', async (req, res) => {
    try {
        const { tag_id, scanner_mac, timestamp } = req.body;

        if (!tag_id || !scanner_mac) {
            return res.status(400).json({
                error: 'Missing required fields: tag_id, scanner_mac'
            });
        }

        log('info', `Tag scan received: ${tag_id} on scanner ${scanner_mac}`);

        // Find scanner by MAC address
        const [scannerRows] = await dbPool.execute(
            'SELECT * FROM scanners WHERE mac_address = ?',
            [scanner_mac]
        );

        if (scannerRows.length === 0) {
            log('warn', `Unknown scanner MAC: ${scanner_mac}`);
            return res.status(404).json({ error: 'Scanner not found' });
        }

        const scanner = scannerRows[0];

        // Check for pending assignments for this scanner
        const [pendingRows] = await dbPool.execute(`
            SELECT pta.*, g.name as guest_name, p.name as project_name
            FROM pending_tag_assignments pta
            JOIN guests g ON pta.guest_id = g.id
            JOIN projects p ON pta.project_id = p.id
            WHERE pta.scanner_id = ? AND pta.status = 'waiting'
            ORDER BY pta.created_at ASC
            LIMIT 1
        `, [scanner.id]);

        if (pendingRows.length > 0) {
            // Complete the tag assignment
            const assignment = pendingRows[0];

            await dbPool.execute(`
                UPDATE pending_tag_assignments
                SET status = 'completed', completed_at = NOW(), tag_id = ?
                WHERE id = ?
            `, [tag_id, assignment.id]);

            // Create or update tag assignment record
            await dbPool.execute(`
                INSERT INTO tag_assignments (project_id, guest_id, tag_id, assigned_at)
                VALUES (?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                tag_id = VALUES(tag_id),
                assigned_at = VALUES(assigned_at)
            `, [assignment.project_id, assignment.guest_id, tag_id]);

            // Broadcast successful assignment
            broadcastToClients({
                type: 'tag_assignment_completed',
                assignment: {
                    ...assignment,
                    tag_id,
                    status: 'completed',
                    completed_at: new Date().toISOString()
                }
            });

            log('info', `Tag ${tag_id} assigned to guest ${assignment.guest_name}`);

            res.json({
                success: true,
                message: `Tag assigned to ${assignment.guest_name}`,
                assignment: {
                    guest_name: assignment.guest_name,
                    tag_id,
                    project_name: assignment.project_name
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

    } catch (error) {
        log('error', 'Failed to process tag scan', error.message);
        res.status(500).json({ error: 'Failed to process tag scan' });
    }
});

// Get recent scans
app.get('/api/scans/recent', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;

        // This would need to be adapted based on your actual scans table structure
        // For now, we'll return tag assignments as recent activity
        const [rows] = await dbPool.execute(`
            SELECT
                ta.tag_id,
                ta.assigned_at as timestamp,
                g.name as guest_name,
                p.name as project_name,
                'assignment' as scan_type
            FROM tag_assignments ta
            JOIN guests g ON ta.guest_id = g.id
            JOIN projects p ON ta.project_id = p.id
            ORDER BY ta.assigned_at DESC
            LIMIT ?
        `, [limit]);

        res.json(rows);
    } catch (error) {
        log('error', 'Failed to fetch recent scans', error.message);
        res.status(500).json({ error: 'Failed to fetch recent scans' });
    }
});

// Get system statistics
app.get('/api/stats', async (req, res) => {
    try {
        const [projectCount] = await dbPool.execute('SELECT COUNT(*) as count FROM projects');
        const [guestCount] = await dbPool.execute('SELECT COUNT(*) as count FROM guests');
        const [scannerCount] = await dbPool.execute('SELECT COUNT(*) as count FROM scanners');
        const [assignmentCount] = await dbPool.execute('SELECT COUNT(*) as count FROM tag_assignments');
        const [pendingCount] = await dbPool.execute(
            'SELECT COUNT(*) as count FROM pending_tag_assignments WHERE status = "waiting"'
        );

        res.json({
            projects: projectCount[0].count,
            guests: guestCount[0].count,
            scanners: scannerCount[0].count,
            assignments: assignmentCount[0].count,
            pending_assignments: pendingCount[0].count,
            connected_clients: connectedClients.size,
            uptime: process.uptime()
        });
    } catch (error) {
        log('error', 'Failed to fetch statistics', error.message);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Remove tag assignment
app.delete('/api/tag-assignment/:guestId', async (req, res) => {
    try {
        const { guestId } = req.params;
        const { projectId } = req.query;

        if (!projectId) {
            return res.status(400).json({ error: 'Missing projectId parameter' });
        }

        // Remove tag assignment
        await dbPool.execute(
            'DELETE FROM tag_assignments WHERE guest_id = ? AND project_id = ?',
            [guestId, projectId]
        );

        // Cancel any pending assignments
        await dbPool.execute(`
            UPDATE pending_tag_assignments
            SET status = 'cancelled'
            WHERE guest_id = ? AND project_id = ? AND status = 'waiting'
        `, [guestId, projectId]);

        // Broadcast update
        broadcastToClients({
            type: 'tag_assignment_removed',
            guestId: parseInt(guestId),
            projectId: parseInt(projectId)
        });

        log('info', `Tag assignment removed for guest ${guestId} in project ${projectId}`);

        res.json({ success: true });

    } catch (error) {
        log('error', 'Failed to remove tag assignment', error.message);
        res.status(500).json({ error: 'Failed to remove tag assignment' });
    }
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

    // Close database pool
    if (dbPool) {
        await dbPool.end();
        log('info', 'Database pool closed');
    }

    // Close log stream
    if (logStream) {
        logStream.end();
    }

    process.exit(0);
}

// WebSocket heartbeat
setInterval(() => {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.ping();
        } else {
            connectedClients.delete(client);
        }
    });
}, config.wsHeartbeatInterval);

// Server initialization
async function startServer() {
    try {
        // Initialize logging
        await initializeLogging();
        log('info', 'Logging initialized');

        // Initialize database
        await initializeDatabase();
        log('info', 'Database initialized');

        // Start server
        server.listen(config.port, () => {
            log('info', `SmartVisitor Admin Server started on port ${config.port}`);
            log('info', `Environment: ${process.env.NODE_ENV || 'development'}`);
            log('info', `WebSocket heartbeat interval: ${config.wsHeartbeatInterval}ms`);
        });

    } catch (error) {
        log('error', 'Failed to start server', error.message);
        process.exit(1);
    }
}

// Start the server
startServer();
