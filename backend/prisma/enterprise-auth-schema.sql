-- Enterprise Authentication Schema Extensions
-- Add these tables to your existing schema

-- User Sessions Table - Core session management
CREATE TABLE user_sessions (
    id                    VARCHAR(30) PRIMARY KEY,
    user_id               VARCHAR(30) NOT NULL,
    session_id            VARCHAR(30) UNIQUE NOT NULL,
    refresh_token         VARCHAR(500) UNIQUE,
    device_fingerprint    VARCHAR(255) NOT NULL,
    device_name           VARCHAR(100),
    device_trust_level    ENUM('TRUSTED', 'VERIFIED', 'UNKNOWN', 'SUSPICIOUS') DEFAULT 'UNKNOWN',
    ip_address            VARCHAR(45) NOT NULL, -- IPv6 compatible
    location              VARCHAR(255),
    user_agent            TEXT,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_activity_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at            TIMESTAMP NOT NULL,
    is_active             BOOLEAN DEFAULT TRUE,
    terminated_at         TIMESTAMP NULL,
    termination_reason    VARCHAR(100),
    risk_score            INT DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
    
    -- Indexes for performance
    INDEX idx_user_sessions_user_id (user_id),
    INDEX idx_user_sessions_session_id (session_id),
    INDEX idx_user_sessions_device (device_fingerprint),
    INDEX idx_user_sessions_active (is_active, expires_at),
    INDEX idx_user_sessions_activity (last_activity_at),
    
    -- Foreign key constraint
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Trusted Devices Table - Device management
CREATE TABLE trusted_devices (
    id                    VARCHAR(30) PRIMARY KEY,
    user_id               VARCHAR(30) NOT NULL,
    device_hash           VARCHAR(255) NOT NULL,
    device_name           VARCHAR(100),
    device_type           ENUM('MOBILE', 'TABLET', 'DESKTOP', 'UNKNOWN') DEFAULT 'UNKNOWN',
    fingerprint_data      JSON, -- Store device fingerprint details
    trust_level           ENUM('TRUSTED', 'VERIFIED', 'PENDING') DEFAULT 'PENDING',
    first_seen_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trust_granted_at      TIMESTAMP NULL,
    trust_granted_by      VARCHAR(30) NULL, -- Admin user ID who granted trust
    is_active             BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Unique constraint per user
    UNIQUE KEY unique_user_device (user_id, device_hash),
    
    -- Indexes
    INDEX idx_trusted_devices_user (user_id),
    INDEX idx_trusted_devices_hash (device_hash),
    INDEX idx_trusted_devices_trust (trust_level, is_active),
    
    -- Foreign key
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (trust_granted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Security Events Table - Comprehensive audit trail
CREATE TABLE security_events (
    id                    VARCHAR(30) PRIMARY KEY,
    user_id               VARCHAR(30),
    session_id            VARCHAR(30),
    event_type            VARCHAR(50) NOT NULL,
    event_category        ENUM('AUTHENTICATION', 'AUTHORIZATION', 'SESSION', 'RISK', 'ADMIN') NOT NULL,
    severity              ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') DEFAULT 'LOW',
    description           TEXT,
    ip_address            VARCHAR(45),
    user_agent            TEXT,
    device_fingerprint    VARCHAR(255),
    location              VARCHAR(255),
    risk_score            INT DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
    metadata              JSON, -- Store additional event-specific data
    timestamp             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for querying
    INDEX idx_security_events_user (user_id, timestamp),
    INDEX idx_security_events_session (session_id),
    INDEX idx_security_events_type (event_type, timestamp),
    INDEX idx_security_events_severity (severity, timestamp),
    INDEX idx_security_events_risk (risk_score, timestamp),
    INDEX idx_security_events_timestamp (timestamp),
    
    -- Foreign keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (session_id) REFERENCES user_sessions(session_id) ON DELETE SET NULL
);

-- Risk Assessments Table - Store risk analysis results
CREATE TABLE risk_assessments (
    id                    VARCHAR(30) PRIMARY KEY,
    user_id               VARCHAR(30) NOT NULL,
    session_id            VARCHAR(30),
    assessment_type       ENUM('LOGIN', 'TRANSACTION', 'ACCESS', 'BEHAVIORAL') NOT NULL,
    overall_risk_score    INT NOT NULL CHECK (overall_risk_score >= 0 AND overall_risk_score <= 100),
    risk_level            ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    factors               JSON NOT NULL, -- Store risk factors array
    recommendations       JSON, -- Store security recommendations
    device_risk           INT DEFAULT 0,
    location_risk         INT DEFAULT 0,
    behavioral_risk       INT DEFAULT 0,
    temporal_risk         INT DEFAULT 0,
    pattern_risk          INT DEFAULT 0,
    ip_address            VARCHAR(45),
    device_fingerprint    VARCHAR(255),
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_risk_assessments_user (user_id, created_at),
    INDEX idx_risk_assessments_session (session_id),
    INDEX idx_risk_assessments_score (overall_risk_score, created_at),
    INDEX idx_risk_assessments_level (risk_level, created_at),
    
    -- Foreign keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES user_sessions(session_id) ON DELETE SET NULL
);

-- Session Policies Table - Role-based session configuration
CREATE TABLE session_policies (
    id                        VARCHAR(30) PRIMARY KEY,
    role                      VARCHAR(50) NOT NULL UNIQUE,
    max_concurrent_sessions   INT NOT NULL DEFAULT 3 CHECK (max_concurrent_sessions > 0),
    session_timeout_minutes   INT NOT NULL DEFAULT 480 CHECK (session_timeout_minutes > 0),
    device_trust_level        ENUM('LENIENT', 'STRICT', 'VERY_STRICT', 'ZERO_TRUST') DEFAULT 'STRICT',
    location_policy           ENUM('GLOBAL', 'MONITORED', 'RESTRICTED') DEFAULT 'MONITORED',
    require_mfa               BOOLEAN DEFAULT FALSE,
    require_hardware_token    BOOLEAN DEFAULT FALSE,
    allow_password_reset      BOOLEAN DEFAULT TRUE,
    force_password_change     BOOLEAN DEFAULT FALSE,
    is_active                 BOOLEAN DEFAULT TRUE,
    created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Index
    INDEX idx_session_policies_role (role, is_active)
);

-- IP Reputation Table - Track IP addresses and their reputation
CREATE TABLE ip_reputation (
    id                    VARCHAR(30) PRIMARY KEY,
    ip_address            VARCHAR(45) NOT NULL UNIQUE,
    reputation_score      INT DEFAULT 50 CHECK (reputation_score >= 0 AND reputation_score <= 100),
    reputation_level      ENUM('TRUSTED', 'NEUTRAL', 'SUSPICIOUS', 'MALICIOUS') DEFAULT 'NEUTRAL',
    country               VARCHAR(2), -- ISO country code
    city                  VARCHAR(100),
    organization          VARCHAR(255),
    is_vpn                BOOLEAN DEFAULT FALSE,
    is_tor                BOOLEAN DEFAULT FALSE,
    is_proxy              BOOLEAN DEFAULT FALSE,
    threat_feeds          JSON, -- Store threat intelligence sources
    first_seen_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_ip_reputation_address (ip_address),
    INDEX idx_ip_reputation_score (reputation_score),
    INDEX idx_ip_reputation_level (reputation_level),
    INDEX idx_ip_reputation_country (country)
);

-- Login Attempts Table - Track all login attempts for analysis
CREATE TABLE login_attempts (
    id                    VARCHAR(30) PRIMARY KEY,
    email                 VARCHAR(255) NOT NULL,
    user_id               VARCHAR(30), -- NULL if user not found
    attempt_result        ENUM('SUCCESS', 'FAILED_PASSWORD', 'FAILED_USER_NOT_FOUND', 'FAILED_ACCOUNT_LOCKED', 'FAILED_RISK_BLOCKED') NOT NULL,
    ip_address            VARCHAR(45) NOT NULL,
    user_agent            TEXT,
    device_fingerprint    VARCHAR(255),
    location              VARCHAR(255),
    risk_score            INT DEFAULT 0,
    failure_reason        VARCHAR(255),
    session_id            VARCHAR(30), -- Set on successful login
    attempt_timestamp     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for analysis
    INDEX idx_login_attempts_email (email, attempt_timestamp),
    INDEX idx_login_attempts_user (user_id, attempt_timestamp),
    INDEX idx_login_attempts_ip (ip_address, attempt_timestamp),
    INDEX idx_login_attempts_result (attempt_result, attempt_timestamp),
    INDEX idx_login_attempts_risk (risk_score, attempt_timestamp),
    
    -- Foreign keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (session_id) REFERENCES user_sessions(session_id) ON DELETE SET NULL
);

-- Insert default session policies
INSERT INTO session_policies (id, role, max_concurrent_sessions, session_timeout_minutes, device_trust_level, location_policy, require_mfa, require_hardware_token) VALUES
('sp_student', 'STUDENT', 3, 480, 'LENIENT', 'GLOBAL', FALSE, FALSE),
('sp_instructor', 'INSTRUCTOR', 5, 720, 'STRICT', 'MONITORED', FALSE, FALSE),
('sp_admin', 'ADMIN', 2, 240, 'VERY_STRICT', 'RESTRICTED', TRUE, FALSE),
('sp_super_admin', 'SUPER_ADMIN', 1, 120, 'ZERO_TRUST', 'RESTRICTED', TRUE, TRUE);

-- Create views for common queries

-- Active Sessions View
CREATE VIEW v_active_sessions AS
SELECT 
    us.id,
    us.user_id,
    us.session_id,
    us.device_name,
    us.ip_address,
    us.location,
    us.created_at,
    us.last_activity_at,
    us.expires_at,
    us.risk_score,
    us.device_trust_level,
    u.email,
    u.role,
    CASE 
        WHEN us.expires_at < NOW() THEN 'EXPIRED'
        WHEN us.last_activity_at < DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 'IDLE'
        ELSE 'ACTIVE'
    END as session_status
FROM user_sessions us
JOIN users u ON us.user_id = u.id
WHERE us.is_active = TRUE;

-- Security Events Summary View
CREATE VIEW v_security_events_summary AS
SELECT 
    DATE(timestamp) as event_date,
    event_category,
    severity,
    COUNT(*) as event_count,
    COUNT(DISTINCT user_id) as affected_users,
    AVG(risk_score) as avg_risk_score
FROM security_events 
WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp), event_category, severity
ORDER BY event_date DESC;

-- User Risk Profile View
CREATE VIEW v_user_risk_profiles AS
SELECT 
    u.id as user_id,
    u.email,
    u.role,
    COUNT(DISTINCT us.session_id) as active_sessions,
    AVG(us.risk_score) as avg_session_risk,
    MAX(us.risk_score) as max_session_risk,
    COUNT(DISTINCT td.device_hash) as trusted_devices,
    COUNT(DISTINCT se.id) as security_events_30d,
    MAX(se.timestamp) as last_security_event
FROM users u
LEFT JOIN user_sessions us ON u.id = us.user_id AND us.is_active = TRUE
LEFT JOIN trusted_devices td ON u.id = td.user_id AND td.is_active = TRUE
LEFT JOIN security_events se ON u.id = se.user_id AND se.timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE u.status = 'ACTIVE'
GROUP BY u.id, u.email, u.role;