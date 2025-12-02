const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'vgf-secret-key-2024';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Datenbank initialisieren
const db = new sqlite3.Database('./vgf_database.db', (err) => {
    if (err) {
        console.error('❌ Datenbankfehler:', err);
    } else {
        console.log('✅ Datenbank verbunden');
        initializeDatabase();
    }
});

// Datenbank-Tabellen erstellen
function initializeDatabase() {
    db.serialize(() => {
        // Users Tabelle
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            role TEXT NOT NULL,
            status TEXT DEFAULT 'aktiv',
            phone TEXT,
            hours REAL DEFAULT 0,
            permissions TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Shifts Tabelle
        db.run(`CREATE TABLE IF NOT EXISTS shifts (
            id TEXT PRIMARY KEY,
            employeeId TEXT,
            employeeName TEXT,
            date TEXT NOT NULL,
            startTime TEXT NOT NULL,
            endTime TEXT NOT NULL,
            location TEXT NOT NULL,
            type TEXT NOT NULL,
            notes TEXT,
            status TEXT DEFAULT 'geplant',
            viewedBy TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employeeId) REFERENCES users(id)
        )`);

        // TimeEntries Tabelle
        db.run(`CREATE TABLE IF NOT EXISTS time_entries (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            date TEXT NOT NULL,
            startTime TEXT NOT NULL,
            endTime TEXT,
            pauseDuration INTEGER DEFAULT 0,
            pauseStart TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(id)
        )`);

        // Standard-Admin erstellen
        createDefaultAdmin();
    });
}

// Standard-Admin anlegen
function createDefaultAdmin() {
    const adminId = 'admin-marvin';
    const hashedPassword = bcrypt.hashSync('vgf123', 10);
    
    const permissions = JSON.stringify({
        canManageShifts: true,
        canManageEmployees: true,
        canAssignShifts: true,
        canViewAllShifts: true,
        canEditOwnShifts: true
    });

    db.get('SELECT * FROM users WHERE id = ?', [adminId], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (id, username, password, name, email, role, permissions) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [adminId, 'marvinVGF', hashedPassword, 'Marvin', 'marvin@vgf-service.de', 'admin', permissions],
                (err) => {
                    if (err) {
                        console.error('❌ Fehler beim Erstellen des Admin-Users:', err);
                    } else {
                        console.log('✅ Admin-User erstellt: marvinVGF / vgf123');
                    }
                }
            );
        }
    });
}

// JWT Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Kein Token vorhanden' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Ungültiger Token' });
        }
        req.user = user;
        next();
    });
}

// ==================== AUTH ROUTES ====================

// Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }

        // Permissions parsen
        const permissions = user.permissions ? JSON.parse(user.permissions) : {};

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                email: user.email,
                role: user.role,
                status: user.status,
                phone: user.phone,
                hours: user.hours,
                permissions
            }
        });
    });
});

// ==================== USER ROUTES ====================

// Get all users
app.get('/api/users', authenticateToken, (req, res) => {
    db.all('SELECT * FROM users', [], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }

        const usersWithoutPasswords = users.map(user => {
            const { password, ...userWithoutPassword } = user;
            return {
                ...userWithoutPassword,
                permissions: user.permissions ? JSON.parse(user.permissions) : {}
            };
        });

        res.json(usersWithoutPasswords);
    });
});

// Create user
app.post('/api/users', authenticateToken, async (req, res) => {
    const { id, username, password, name, email, role, phone, permissions } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const permissionsJson = JSON.stringify(permissions || {});

    db.run(
        `INSERT INTO users (id, username, password, name, email, role, phone, permissions) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, username, hashedPassword, name, email, role, phone, permissionsJson],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Benutzer konnte nicht erstellt werden' });
            }
            broadcastUpdate('users');
            res.json({ success: true, id });
        }
    );
});

// Update user
app.put('/api/users/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { name, email, role, status, phone, hours, permissions } = req.body;

    const permissionsJson = JSON.stringify(permissions || {});

    db.run(
        `UPDATE users SET name = ?, email = ?, role = ?, status = ?, phone = ?, hours = ?, permissions = ? 
         WHERE id = ?`,
        [name, email, role, status, phone, hours, permissionsJson, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update fehlgeschlagen' });
            }
            broadcastUpdate('users');
            res.json({ success: true });
        }
    );
});

// Delete user
app.delete('/api/users/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
        }
        broadcastUpdate('users');
        res.json({ success: true });
    });
});

// ==================== SHIFT ROUTES ====================

// Get all shifts
app.get('/api/shifts', authenticateToken, (req, res) => {
    db.all('SELECT * FROM shifts', [], (err, shifts) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }

        const shiftsWithParsedData = shifts.map(shift => ({
            ...shift,
            viewedBy: shift.viewedBy ? JSON.parse(shift.viewedBy) : []
        }));

        res.json(shiftsWithParsedData);
    });
});

// Create shift
app.post('/api/shifts', authenticateToken, (req, res) => {
    const { id, employeeId, employeeName, date, startTime, endTime, location, type, notes, status, viewedBy } = req.body;

    const viewedByJson = JSON.stringify(viewedBy || []);

    db.run(
        `INSERT INTO shifts (id, employeeId, employeeName, date, startTime, endTime, location, type, notes, status, viewedBy) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, employeeId, employeeName, date, startTime, endTime, location, type, notes, status, viewedByJson],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Schicht konnte nicht erstellt werden' });
            }
            broadcastUpdate('shifts');
            res.json({ success: true, id });
        }
    );
});

// Update shift
app.put('/api/shifts/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { employeeId, employeeName, date, startTime, endTime, location, type, notes, status, viewedBy } = req.body;

    const viewedByJson = JSON.stringify(viewedBy || []);

    db.run(
        `UPDATE shifts SET employeeId = ?, employeeName = ?, date = ?, startTime = ?, endTime = ?, 
         location = ?, type = ?, notes = ?, status = ?, viewedBy = ? WHERE id = ?`,
        [employeeId, employeeName, date, startTime, endTime, location, type, notes, status, viewedByJson, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update fehlgeschlagen' });
            }
            broadcastUpdate('shifts');
            res.json({ success: true });
        }
    );
});

// Delete shift
app.delete('/api/shifts/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM shifts WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
        }
        broadcastUpdate('shifts');
        res.json({ success: true });
    });
});

// ==================== TIME ENTRY ROUTES ====================

// Get all time entries
app.get('/api/time-entries', authenticateToken, (req, res) => {
    db.all('SELECT * FROM time_entries', [], (err, entries) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(entries);
    });
});

// Create time entry
app.post('/api/time-entries', authenticateToken, (req, res) => {
    const { id, userId, date, startTime, endTime, pauseDuration, pauseStart } = req.body;

    db.run(
        `INSERT INTO time_entries (id, userId, date, startTime, endTime, pauseDuration, pauseStart) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, date, startTime, endTime, pauseDuration, pauseStart],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Zeiterfassung konnte nicht erstellt werden' });
            }
            broadcastUpdate('timeEntries');
            res.json({ success: true, id });
        }
    );
});

// Update time entry
app.put('/api/time-entries/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { endTime, pauseDuration, pauseStart } = req.body;

    db.run(
        `UPDATE time_entries SET endTime = ?, pauseDuration = ?, pauseStart = ? WHERE id = ?`,
        [endTime, pauseDuration, pauseStart, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update fehlgeschlagen' });
            }
            broadcastUpdate('timeEntries');
            res.json({ success: true });
        }
    );
});

// ==================== WEBSOCKET FÜR ECHTZEIT-UPDATES ====================

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Set();

wss.on('connection', (ws) => {
    console.log('🔌 Neuer WebSocket Client verbunden');
    clients.add(ws);

    ws.on('close', () => {
        console.log('🔌 WebSocket Client getrennt');
        clients.delete(ws);
    });
});

function broadcastUpdate(type) {
    const message = JSON.stringify({ type, timestamp: new Date().toISOString() });
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ==================== STATIC FILES ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== SERVER STARTEN ====================

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║   🚀 VGF Service Backend Server läuft!       ║
║                                               ║
║   🌐 URL: http://localhost:${PORT}              ║
║   📊 WebSocket: ws://localhost:${PORT}          ║
║                                               ║
║   👤 Admin Login:                            ║
║      Benutzername: marvinVGF                 ║
║      Passwort: vgf123                        ║
╚═══════════════════════════════════════════════╝
    `);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Server wird heruntergefahren...');
    db.close((err) => {
        if (err) {
            console.error('❌ Fehler beim Schließen der Datenbank:', err);
        } else {
            console.log('✅ Datenbank geschlossen');
        }
        process.exit(0);
    });
});
