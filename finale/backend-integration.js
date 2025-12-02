// ==================== BACKEND INTEGRATION FÜR VGF SERVICE PLANER ====================
// Füge diesen Code NACH den State-Variablen (Zeile 1102) ein

// API Konfiguration
const API_URL = window.location.origin;
let authToken = localStorage.getItem('vgf_auth_token');
let wsConnection = null;

// API Helper Function
async function apiRequest(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authToken ? `Bearer ${authToken}` : ''
        }
    };
    
    if (data && method !== 'GET') {
        options.body = JSON.stringify(data);
    }
    
    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                handleLogout();
                throw new Error('Bitte erneut anmelden');
            }
            throw new Error('API Fehler');
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// WebSocket Connection
function connectWebSocket() {
    const wsUrl = API_URL.replace('http', 'ws');
    wsConnection = new WebSocket(wsUrl);
    
    wsConnection.onopen = () => {
        console.log('🔌 WebSocket verbunden');
    };
    
    wsConnection.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('📡 Update empfangen:', data.type);
        await loadData();
        renderContent();
    };
    
    wsConnection.onclose = () => {
        console.log('🔌 WebSocket getrennt - reconnect in 5s');
        setTimeout(connectWebSocket, 5000);
    };
}

// ==================== ERSETZE DIESE FUNKTIONEN ====================

// 1. ALTE loadData() ersetzen durch:
async function loadData() {
    try {
        const [usersData, shiftsData, entriesData] = await Promise.all([
            apiRequest('/api/users'),
            apiRequest('/api/shifts'),
            apiRequest('/api/time-entries')
        ]);
        
        users = usersData;
        shifts = shiftsData;
        timeEntries = entriesData;
    } catch (error) {
        console.error('Fehler beim Laden:', error);
        // Fallback zu localStorage für Offline-Modus
        users = JSON.parse(localStorage.getItem('vgf_users') || '[]');
        shifts = JSON.parse(localStorage.getItem('vgf_shifts') || '[]');
        timeEntries = JSON.parse(localStorage.getItem('vgf_time_entries') || '[]');
    }
}

// 2. ALLE saveData() Aufrufe entfernen - nicht mehr nötig!

// 3. ALTE handleLogin() ersetzen durch:
async function handleLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    if (!username || !password) {
        if (errorDiv) {
            errorDiv.textContent = 'Bitte alle Felder ausfüllen';
            errorDiv.style.display = 'block';
            setTimeout(() => errorDiv.style.display = 'none', 3000);
        }
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (!response.ok) {
            throw new Error('Ungültige Anmeldedaten');
        }
        
        const data = await response.json();
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('vgf_auth_token', authToken);
        
        document.querySelector('.login-overlay').classList.add('hidden');
        await init();
        connectWebSocket();
        
    } catch (error) {
        console.error('Login Fehler:', error);
        if (errorDiv) {
            errorDiv.textContent = error.message || 'Login fehlgeschlagen';
            errorDiv.style.display = 'block';
            setTimeout(() => errorDiv.style.display = 'none', 3000);
        }
    }
}

// 4. Mitarbeiter CRUD
async function saveEmployee(employeeData) {
    try {
        if (employeeData.id && users.find(u => u.id === employeeData.id)) {
            // Update
            await apiRequest(`/api/users/${employeeData.id}`, 'PUT', employeeData);
        } else {
            // Create
            await apiRequest('/api/users', 'POST', employeeData);
        }
        await loadData();
        renderContent();
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message);
    }
}

async function deleteEmployee(id) {
    if (!confirm('Mitarbeiter wirklich löschen?')) return;
    
    try {
        await apiRequest(`/api/users/${id}`, 'DELETE');
        await loadData();
        renderContent();
    } catch (error) {
        alert('Fehler beim Löschen: ' + error.message);
    }
}

// 5. Schichten CRUD
async function saveShift(shiftData) {
    try {
        if (shiftData.id && shifts.find(s => s.id === shiftData.id)) {
            // Update
            await apiRequest(`/api/shifts/${shiftData.id}`, 'PUT', shiftData);
        } else {
            // Create
            await apiRequest('/api/shifts', 'POST', shiftData);
        }
        await loadData();
        renderContent();
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message);
    }
}

async function deleteShift(id) {
    if (!confirm('Schicht wirklich löschen?')) return;
    
    try {
        await apiRequest(`/api/shifts/${id}`, 'DELETE');
        await loadData();
        renderContent();
    } catch (error) {
        alert('Fehler beim Löschen: ' + error.message);
    }
}

// 6. Zeiterfassung
async function startTimer() {
    const entry = {
        id: Date.now().toString(),
        userId: currentUser.id,
        date: new Date().toISOString().split('T')[0],
        startTime: new Date().toISOString(),
        endTime: null,
        pauseDuration: 0,
        pauseStart: null
    };
    
    try {
        await apiRequest('/api/time-entries', 'POST', entry);
        activeTimer = entry;
        await loadData();
        startLiveTimer();
        renderContent();
    } catch (error) {
        alert('Fehler beim Starten: ' + error.message);
    }
}

async function stopTimer() {
    if (!activeTimer) return;
    
    try {
        const endTime = new Date().toISOString();
        await apiRequest(`/api/time-entries/${activeTimer.id}`, 'PUT', {
            endTime,
            pauseDuration: activeTimer.pauseDuration,
            pauseStart: null
        });
        
        activeTimer = null;
        await loadData();
        renderContent();
    } catch (error) {
        alert('Fehler beim Stoppen: ' + error.message);
    }
}

async function pauseTimer() {
    if (!activeTimer) return;
    
    try {
        if (activeTimer.pauseStart) {
            // Resume
            const pauseEnd = new Date();
            const pauseStart = new Date(activeTimer.pauseStart);
            const additionalPause = pauseEnd - pauseStart;
            activeTimer.pauseDuration = (activeTimer.pauseDuration || 0) + additionalPause;
            activeTimer.pauseStart = null;
        } else {
            // Pause
            activeTimer.pauseStart = new Date().toISOString();
        }
        
        await apiRequest(`/api/time-entries/${activeTimer.id}`, 'PUT', {
            pauseDuration: activeTimer.pauseDuration,
            pauseStart: activeTimer.pauseStart
        });
        
        await loadData();
        renderContent();
    } catch (error) {
        alert('Fehler: ' + error.message);
    }
}

// 7. Logout
function handleLogout() {
    localStorage.removeItem('vgf_auth_token');
    authToken = null;
    currentUser = null;
    
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    
    document.querySelector('.login-overlay').classList.remove('hidden');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

// 8. Backup (vom Server)
async function createBackup() {
    try {
        const backupData = {
            version: '2.0',
            timestamp: new Date().toISOString(),
            exportedBy: currentUser.username,
            data: {
                users: await apiRequest('/api/users'),
                shifts: await apiRequest('/api/shifts'),
                timeEntries: await apiRequest('/api/time-entries')
            }
        };
        
        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        const timestamp = new Date().toISOString().split('T')[0];
        link.download = `VGF_Backup_${timestamp}.json`;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        alert('✅ Backup erfolgreich erstellt!');
    } catch (error) {
        alert('❌ Fehler beim Erstellen des Backups:\n' + error.message);
    }
}

// ==================== ANLEITUNG ====================
/*
1. Füge diesen gesamten Code NACH Zeile 1102 (nach "let activeTimer = null;") ein

2. Ersetze die alte handleLogin() Funktion (suche nach "function handleLogin()")

3. Ersetze die alte loadData() Funktion (suche nach "function loadData()")

4. Finde alle Stellen wo "saveData()" aufgerufen wird und entferne diese Zeilen

5. Ersetze alle Funktionen die Daten speichern:
   - createEmployee() → nutze saveEmployee()
   - updateEmployee() → nutze saveEmployee()
   - deleteEmployeeById() → nutze deleteEmployee()
   - Ähnlich für Schichten

6. In der init() Funktion nach loadData() hinzufügen:
   connectWebSocket();

7. Alle logout() Aufrufe durch handleLogout() ersetzen
*/
