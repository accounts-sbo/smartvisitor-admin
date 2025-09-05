# 🏷️ SmartVisitor Admin System

**SmartVisitor** is een geavanceerd RFID event tracking systeem met AI-powered automatisering. Dit admin systeem biedt real-time tag toewijzing en monitoring voor evenementen.

## 📋 Overzicht

SmartVisitor volgt evenementgasten met RFID tags en triggert geautomatiseerde responses:
- Arduino scanners → n8n webhook → MySQL database → diverse outputs (schermen, garderobe, audio, Telegram)
- Gasten krijgen RFID stickers/polsbandjes en worden gevolgd op meerdere locaties tijdens evenementen
- Event managers kunnen regels instellen via Telegram voice commands ("Wanneer Peter binnenkomt, stuur me een bericht")
- Het systeem bevat een admin interface voor tag toewijzing en real-time monitoring

## 🏗️ Architectuur

### Database (MySQL in Docker)
- **Host**: Hostinger VPS met root toegang
- **Database**: `sv_scans`
- **Belangrijke tabellen**: `projects`, `guests`, `tag_assignments`, `tag_inventory`, `scanners`, `project_scanners`, `pending_tag_assignments`

### Backend (Node.js/Express)
- **WebSocket server** voor real-time updates
- **REST API** voor tag toewijzing en monitoring
- **MySQL integratie** met connection pooling
- **Logging systeem** met rotatie

### Frontend (HTML/CSS/JavaScript)
- **Real-time admin interface** met WebSocket verbinding
- **Tag toewijzing workflow**: Admin selecteert scanner → klikt "Tag Koppelen" → wacht op scan → automatische toewijzing
- **Live monitoring** van scans en activiteit
- **Responsive design** voor desktop en mobiel

## 🚀 Snelle Start

### Vereisten
- Docker en Docker Compose
- MySQL database (bestaand)
- Node.js 18+ (voor development)

### Installatie

1. **Clone of download de bestanden naar `/opt/smartvisitor/`**:
```bash
cd /opt
sudo mkdir smartvisitor
cd smartvisitor
```

2. **Configureer environment variabelen**:
```bash
# Bewerk .env bestand
sudo nano .env

# Vervang 'your_secure_password_here' met je MySQL wachtwoord
MYSQL_ROOT_PASSWORD=jouw_mysql_wachtwoord
```

3. **Setup database schema**:
```bash
# Voer database setup script uit
mysql -u root -p sv_scans < database-setup.sql
```

4. **Build en start de containers**:
```bash
# Build en start de services
sudo docker-compose up --build -d

# Controleer logs
sudo docker-compose logs -f smartvisitor-admin
```

5. **Toegang tot admin interface**:
- Open browser naar: `http://jouw-server-ip:3000`
- WebSocket verbinding wordt automatisch gemaakt

## 📁 Bestandsstructuur

```
/opt/smartvisitor/
├── package.json              # Node.js dependencies
├── .env                      # Environment configuratie
├── docker-compose.yml        # Docker services configuratie
├── Dockerfile               # Container build instructies
├── .dockerignore            # Docker ignore regels
├── server.js                # Hoofd Node.js server
├── database-setup.sql       # Database schema en sample data
├── README.md               # Deze documentatie
├── public/
│   └── index.html          # Admin interface frontend
└── logs/                   # Log bestanden (auto-created)
```

## 🔧 Configuratie

### Environment Variabelen (.env)

```bash
# Database Configuratie
MYSQL_ROOT_PASSWORD=jouw_wachtwoord
DB_HOST=172.17.0.1
DB_USER=root
DB_NAME=sv_scans
DB_PORT=3306

# Applicatie Configuratie
NODE_ENV=production
PORT=3000

# Security
SESSION_SECRET=jouw_session_secret

# Logging
LOG_LEVEL=info

# WebSocket Configuratie
WS_HEARTBEAT_INTERVAL=30000

# API Configuratie
API_RATE_LIMIT=100
```

### Docker Compose Services

- **smartvisitor-admin**: Hoofd applicatie container
- **db-check**: Database connectiviteit check
- **Health checks**: Automatische service monitoring
- **Volume mapping**: Logs persistentie

## 📡 API Documentatie

### Endpoints

#### Projecten
- `GET /api/projects` - Lijst alle projecten
- `GET /api/projects/:id` - Project details met gasten en scanners

#### Tag Toewijzing
- `POST /api/tag-assignment/start` - Start tag toewijzing proces
- `POST /api/tag-assignment/cancel` - Annuleer wachtende toewijzing
- `GET /api/tag-assignments/pending` - Lijst wachtende toewijzingen
- `DELETE /api/tag-assignment/:guestId` - Verwijder tag toewijzing

#### Scans en Monitoring
- `POST /api/tag-scan` - Webhook voor n8n tag scans
- `GET /api/scans/recent` - Recente scan activiteit
- `GET /api/stats` - Systeem statistieken

#### System
- `GET /health` - Health check endpoint

### WebSocket Events

#### Client → Server
```javascript
{
  "type": "subscribe",
  "events": ["tag_assignment_started", "tag_assignment_completed", "tag_scan"]
}
```

#### Server → Client
```javascript
// Tag toewijzing gestart
{
  "type": "tag_assignment_started",
  "assignment": { ... }
}

// Tag toewijzing voltooid
{
  "type": "tag_assignment_completed", 
  "assignment": { ... }
}

// Tag scan ontvangen
{
  "type": "tag_scan",
  "scan": { ... }
}
```

## 🔄 Tag Toewijzing Workflow

1. **Admin selecteert project** in dropdown
2. **Kies scanner** uit beschikbare scanners voor project
3. **Klik "Tag Koppelen"** naast gast zonder tag
4. **Modal opent** met wacht status
5. **Scan RFID tag** op geselecteerde scanner
6. **Automatische toewijzing** en real-time update
7. **Bevestiging** en UI refresh

## 🔗 n8n Integratie

### Webhook Update
Wijzig je n8n webhook URL naar:
```
http://jouw-server-ip:3000/api/tag-scan
```

### Payload Format
```javascript
{
  "tag_id": "Q3000E28011608000021C84A2622A4DBF",
  "scanner_mac": "F0:F5:BD:54:36:A8", 
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 📊 Monitoring en Logging

### Log Bestanden
- **Locatie**: `/opt/smartvisitor/logs/`
- **Format**: JSON per regel
- **Rotatie**: Dagelijks
- **Retentie**: Handmatig beheer

### Health Monitoring
- **Health endpoint**: `http://server:3000/health`
- **Docker health checks**: Automatisch
- **WebSocket heartbeat**: Elke 30 seconden

### Statistieken Dashboard
- Aantal projecten, gasten, scanners
- Actieve tag toewijzingen
- Verbonden clients
- Wachtende toewijzingen

## 🛠️ Troubleshooting

### Veelvoorkomende Problemen

#### 1. Database Verbinding Mislukt
```bash
# Controleer database status
sudo docker ps | grep mysql

# Test database verbinding
mysql -h 172.17.0.1 -u root -p sv_scans

# Controleer logs
sudo docker-compose logs smartvisitor-admin
```

#### 2. WebSocket Verbinding Mislukt
```bash
# Controleer firewall
sudo ufw status
sudo ufw allow 3000

# Test WebSocket verbinding
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: test" -H "Sec-WebSocket-Version: 13" \
  http://localhost:3000
```

#### 3. Container Start Problemen
```bash
# Rebuild containers
sudo docker-compose down
sudo docker-compose up --build -d

# Controleer container status
sudo docker-compose ps

# Bekijk gedetailleerde logs
sudo docker-compose logs --tail=100 smartvisitor-admin
```

#### 4. Poort Conflicten
```bash
# Controleer welke processen poort 3000 gebruiken
sudo netstat -tulpn | grep :3000

# Wijzig poort in docker-compose.yml indien nodig
ports:
  - "3001:3000"  # Gebruik poort 3001 extern
```

### Log Analyse

#### Belangrijke Log Patronen
```bash
# Bekijk real-time logs
sudo docker-compose logs -f smartvisitor-admin

# Filter op errors
sudo docker-compose logs smartvisitor-admin | grep ERROR

# Database verbinding logs
sudo docker-compose logs smartvisitor-admin | grep "Database"

# WebSocket verbinding logs
sudo docker-compose logs smartvisitor-admin | grep "WebSocket"
```

#### Log Locaties
- **Container logs**: `sudo docker-compose logs`
- **Applicatie logs**: `/opt/smartvisitor/logs/`
- **System logs**: `/var/log/docker/`

## 🔒 Security Overwegingen

### Productie Security
1. **Wijzig standaard wachtwoorden** in `.env`
2. **Gebruik HTTPS** met reverse proxy (nginx/Apache)
3. **Firewall configuratie** - alleen noodzakelijke poorten
4. **Regular updates** van Docker images
5. **Backup strategie** voor database en configuratie

### Aanbevolen Firewall Regels
```bash
# Alleen SSH en HTTP/HTTPS
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000  # SmartVisitor admin (tijdelijk)
sudo ufw enable
```

## 🔄 Updates en Onderhoud

### Applicatie Updates
```bash
# Stop services
sudo docker-compose down

# Backup huidige configuratie
sudo cp -r /opt/smartvisitor /opt/smartvisitor-backup-$(date +%Y%m%d)

# Update bestanden (vervang met nieuwe versies)
# ...

# Rebuild en start
sudo docker-compose up --build -d
```

### Database Backup
```bash
# Maak database backup
mysqldump -u root -p sv_scans > smartvisitor-backup-$(date +%Y%m%d).sql

# Restore database (indien nodig)
mysql -u root -p sv_scans < smartvisitor-backup-20240115.sql
```

### Log Rotatie
```bash
# Handmatige log cleanup (ouder dan 30 dagen)
find /opt/smartvisitor/logs -name "*.log" -mtime +30 -delete

# Setup automatische log rotatie
sudo nano /etc/logrotate.d/smartvisitor
```

## 📈 Performance Optimalisatie

### Database Optimalisatie
```sql
-- Analyseer query performance
EXPLAIN SELECT * FROM tag_assignments WHERE project_id = 1;

-- Optimaliseer tabellen
OPTIMIZE TABLE tag_assignments, pending_tag_assignments;

-- Controleer index gebruik
SHOW INDEX FROM tag_assignments;
```

### Applicatie Monitoring
```bash
# Container resource gebruik
sudo docker stats smartvisitor-admin

# Memory en CPU monitoring
sudo docker exec smartvisitor-admin top

# Disk usage
sudo du -sh /opt/smartvisitor/
```

## 🤝 Bijdragen

### Development Setup
```bash
# Clone repository
git clone <repository-url>
cd smartvisitor-admin

# Install dependencies
npm install

# Start development server
npm run dev

# Run with nodemon for auto-reload
npm install -g nodemon
nodemon server.js
```

### Code Style
- **ESLint** configuratie voor code kwaliteit
- **Prettier** voor code formatting
- **JSDoc** voor functie documentatie
- **Git hooks** voor pre-commit checks

## 📞 Support

### Contact Informatie
- **Project**: SmartVisitor RFID Event Tracking
- **Organisatie**: Something Breaks Out
- **Documentatie**: Deze README.md

### Nuttige Commands Samenvatting
```bash
# Start systeem
sudo docker-compose up -d

# Stop systeem
sudo docker-compose down

# Bekijk logs
sudo docker-compose logs -f

# Restart service
sudo docker-compose restart smartvisitor-admin

# Database toegang
mysql -u root -p sv_scans

# Health check
curl http://localhost:3000/health
```

---

**🎉 SmartVisitor Admin System is nu klaar voor gebruik!**

Ga naar `http://jouw-server-ip:3000` om de admin interface te openen en begin met het toewijzen van RFID tags aan je evenementgasten.
