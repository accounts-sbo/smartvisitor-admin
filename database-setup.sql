-- SmartVisitor Database Setup Script
-- This script creates the necessary tables and indexes for the SmartVisitor admin system

-- Use the SmartVisitor database
USE sv_scans;

-- Create pending_tag_assignments table for real-time tag assignment workflow
CREATE TABLE IF NOT EXISTS pending_tag_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    guest_id BIGINT NOT NULL,
    scanner_id BIGINT NOT NULL,
    status ENUM('waiting', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    completed_at DATETIME(6) NULL,
    tag_id VARCHAR(255) NULL,
    
    -- Foreign key constraints
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE,
    FOREIGN KEY (scanner_id) REFERENCES scanners(id) ON DELETE CASCADE,
    
    -- Indexes for performance
    INDEX idx_status_created (status, created_at),
    INDEX idx_project_guest (project_id, guest_id),
    INDEX idx_scanner_status (scanner_id, status),
    INDEX idx_created_at (created_at)
);

-- Ensure tag_assignments table exists with proper structure
CREATE TABLE IF NOT EXISTS tag_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    guest_id BIGINT NOT NULL,
    tag_id VARCHAR(255) NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    
    -- Foreign key constraints
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE,
    
    -- Unique constraint to prevent duplicate assignments
    UNIQUE KEY unique_project_guest (project_id, guest_id),
    UNIQUE KEY unique_project_tag (project_id, tag_id),
    
    -- Indexes for performance
    INDEX idx_project_id (project_id),
    INDEX idx_guest_id (guest_id),
    INDEX idx_tag_id (tag_id),
    INDEX idx_assigned_at (assigned_at)
);

-- Ensure projects table exists
CREATE TABLE IF NOT EXISTS projects (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    organization_id BIGINT,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    
    INDEX idx_organization_id (organization_id),
    INDEX idx_created_at (created_at)
);

-- Ensure guests table exists
CREATE TABLE IF NOT EXISTS guests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    vip BOOLEAN DEFAULT FALSE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    
    INDEX idx_project_id (project_id),
    INDEX idx_name (name),
    INDEX idx_email (email),
    INDEX idx_vip (vip)
);

-- Ensure scanners table exists
CREATE TABLE IF NOT EXISTS scanners (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    mac_address VARCHAR(17) NOT NULL UNIQUE,
    location VARCHAR(255),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    last_heartbeat DATETIME(6),
    
    INDEX idx_mac_address (mac_address),
    INDEX idx_name (name),
    INDEX idx_last_heartbeat (last_heartbeat)
);

-- Ensure project_scanners table exists (many-to-many relationship)
CREATE TABLE IF NOT EXISTS project_scanners (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    scanner_id BIGINT NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (scanner_id) REFERENCES scanners(id) ON DELETE CASCADE,
    
    UNIQUE KEY unique_project_scanner (project_id, scanner_id),
    
    INDEX idx_project_id (project_id),
    INDEX idx_scanner_id (scanner_id)
);

-- Create organizations table if it doesn't exist
CREATE TABLE IF NOT EXISTS organizations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    
    INDEX idx_name (name)
);

-- Create scans table for historical scan data (optional, for future use)
CREATE TABLE IF NOT EXISTS scans (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    scanner_id BIGINT NOT NULL,
    tag_id VARCHAR(255) NOT NULL,
    guest_id BIGINT NULL,
    scanned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (scanner_id) REFERENCES scanners(id) ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL,
    
    INDEX idx_project_id (project_id),
    INDEX idx_scanner_id (scanner_id),
    INDEX idx_tag_id (tag_id),
    INDEX idx_guest_id (guest_id),
    INDEX idx_scanned_at (scanned_at),
    INDEX idx_project_scanned (project_id, scanned_at)
);

-- Insert sample data if tables are empty (for testing)
INSERT IGNORE INTO organizations (id, name, description) VALUES 
(1, 'Something Breaks Out', 'Event organization company');

INSERT IGNORE INTO projects (id, name, description, organization_id) VALUES 
(1, 'Test Event', 'Test event for SmartVisitor system', 1);

-- Sample guest (if not exists)
INSERT IGNORE INTO guests (id, project_id, name, email, vip) VALUES 
(1, 1, 'Willem van Leunen', 'willem@example.com', TRUE);

-- Sample scanner (if not exists)
INSERT IGNORE INTO scanners (id, name, mac_address, location) VALUES 
(1, 'VIP Ingang Scanner', 'F0:F5:BD:54:36:A8', 'VIP Entrance');

-- Link scanner to project (if not exists)
INSERT IGNORE INTO project_scanners (project_id, scanner_id) VALUES 
(1, 1);

-- Sample tag assignment (if not exists)
INSERT IGNORE INTO tag_assignments (project_id, guest_id, tag_id) VALUES 
(1, 1, 'Q3000E28011608000021C84A2622A4DBF');

-- Clean up old pending assignments (older than 1 hour)
DELETE FROM pending_tag_assignments 
WHERE status = 'waiting' AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR);

-- Show table status
SELECT 
    'pending_tag_assignments' as table_name,
    COUNT(*) as row_count,
    COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting_count,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count
FROM pending_tag_assignments

UNION ALL

SELECT 
    'tag_assignments' as table_name,
    COUNT(*) as row_count,
    NULL as waiting_count,
    NULL as completed_count,
    NULL as cancelled_count
FROM tag_assignments

UNION ALL

SELECT 
    'projects' as table_name,
    COUNT(*) as row_count,
    NULL as waiting_count,
    NULL as completed_count,
    NULL as cancelled_count
FROM projects

UNION ALL

SELECT 
    'guests' as table_name,
    COUNT(*) as row_count,
    NULL as waiting_count,
    NULL as completed_count,
    NULL as cancelled_count
FROM guests

UNION ALL

SELECT 
    'scanners' as table_name,
    COUNT(*) as row_count,
    NULL as waiting_count,
    NULL as completed_count,
    NULL as cancelled_count
FROM scanners;

-- Show current assignments
SELECT 
    p.name as project_name,
    g.name as guest_name,
    ta.tag_id,
    ta.assigned_at
FROM tag_assignments ta
JOIN projects p ON ta.project_id = p.id
JOIN guests g ON ta.guest_id = g.id
ORDER BY ta.assigned_at DESC
LIMIT 10;
