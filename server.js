const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Data file path
const DATA_FILE = path.join(__dirname, 'vgf-data.json');

// Initialize data structure
let appData = {
    users: [],
    shifts: [],
    timeEntries: [],
    lastModified: new Date().toISOString()
};

// Load data from file on startup
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        appData = JSON.parse(data);
        console.log('✅ Data loaded from file');
    } catch (error) {
        console.log('📝 No existing data file, starting fresh');
        await saveData();
    }
}

// Save data to file
async function saveData() {
    try {
        appData.lastModified = new Date().toISOString();
        await fs.writeFile(DATA_FILE, JSON.stringify(appData, null, 2));
        console.log('💾 Data saved');
    } catch (error) {
        console.error('❌ Error saving data:', error);
    }
}

// Ensure default admin exists
function ensureDefaultAdmin() {
    if (!appData.users.find(u => u.username === 'marvinVGF')) {
        appData.users.push({
            id: 'admin-marvin',
            name: 'Marvin',
            username: 'marvinVGF',
            password: 'vgf123',
            role: 'admin',
            regNumber: '',
            email: 'marvin@vgf-service.de',
            phone: '',
            status: 'aktiv',
            hours: 0,
            overtime: 0,
            pushNotification: true,
            lastSeen: new Date().toLocaleString('de-DE'),
            permissions: {
                canManageShifts: true,
                canManageEmployees: true,
                canAssignShifts: true,
                canViewAllShifts: true,
                canEditOwnShifts: true
            }
        });
    }
}

// API Endpoints

// Get all data
app.get('/api/data', (req, res) => {
    res.json(appData);
});

// Get data timestamp for sync check
app.get('/api/sync', (req, res) => {
    res.json({ lastModified: appData.lastModified });
});

// Update all data
app.post('/api/data', async (req, res) => {
    try {
        const { users, shifts, timeEntries } = req.body;
        
        if (users) appData.users = users;
        if (shifts) appData.shifts = shifts;
        if (timeEntries) appData.timeEntries = timeEntries;
        
        await saveData();
        
        res.json({ 
            success: true, 
            lastModified: appData.lastModified 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Update users only
app.post('/api/users', async (req, res) => {
    try {
        appData.users = req.body;
        await saveData();
        res.json({ success: true, lastModified: appData.lastModified });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update shifts only
app.post('/api/shifts', async (req, res) => {
    try {
        appData.shifts = req.body;
        await saveData();
        res.json({ success: true, lastModified: appData.lastModified });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update time entries only
app.post('/api/timeentries', async (req, res) => {
    try {
        appData.timeEntries = req.body;
        await saveData();
        res.json({ success: true, lastModified: appData.lastModified });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        users: appData.users.length,
        shifts: appData.shifts.length,
        timeEntries: appData.timeEntries.length
    });
});

// Initialize and start server
async function start() {
    await loadData();
    ensureDefaultAdmin();
    await saveData();
    
    app.listen(PORT, () => {
        console.log(`🚀 VGF Service Server running on port ${PORT}`);
        console.log(`📊 Users: ${appData.users.length}`);
        console.log(`📅 Shifts: ${appData.shifts.length}`);
        console.log(`⏱️  Time Entries: ${appData.timeEntries.length}`);
    });
}

start();
