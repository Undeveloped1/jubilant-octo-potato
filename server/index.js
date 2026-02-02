/**
 * Zombie Extraction Game - Multiplayer WebSocket Server
 * 
 * Handles room management and message relay between host and guest players.
 * Uses host-authority model: server only relays, never validates game logic.
 */

const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const ROOM_CODE_LENGTH = 6;
const ROOM_TIMEOUT = 30000; // 30 seconds to allow rejoin
const HEARTBEAT_INTERVAL = 10000; // 10 seconds

// Room storage
const rooms = new Map();
// Socket to room mapping for quick lookup
const socketToRoom = new Map();

// Generate random room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0, O, 1, I)
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Generate unique room code
function getUniqueRoomCode() {
    let code;
    let attempts = 0;
    do {
        code = generateRoomCode();
        attempts++;
    } while (rooms.has(code) && attempts < 100);
    return code;
}

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

console.log(`[Server] Zombie Game Multiplayer Server starting on port ${PORT}`);

// Heartbeat to detect dead connections
function heartbeat() {
    this.isAlive = true;
}

// Handle new connections
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[Server] Client connected: ${ws.id}`);
    
    ws.on('pong', heartbeat);
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (err) {
            console.error(`[Server] Invalid message from ${ws.id}:`, err.message);
            send(ws, { type: 'error', message: 'Invalid message format' });
        }
    });
    
    ws.on('close', () => {
        console.log(`[Server] Client disconnected: ${ws.id}`);
        handleDisconnect(ws);
    });
    
    ws.on('error', (err) => {
        console.error(`[Server] WebSocket error for ${ws.id}:`, err.message);
    });
    
    // Send welcome message
    send(ws, { type: 'connected', id: ws.id });
});

// Heartbeat interval to clean up dead connections
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log(`[Server] Terminating dead connection: ${ws.id}`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// Send message to socket
function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Handle incoming messages
function handleMessage(ws, message) {
    switch (message.type) {
        case 'create_room':
            handleCreateRoom(ws);
            break;
            
        case 'join_room':
            handleJoinRoom(ws, message.roomCode);
            break;
            
        case 'leave_room':
            handleLeaveRoom(ws);
            break;
            
        case 'game_state':
            relayToGuest(ws, message);
            break;
            
        case 'player_input':
            relayToHost(ws, message);
            break;
            
        case 'game_event':
            relayToPeer(ws, message);
            break;
            
        case 'ping':
            send(ws, { type: 'pong', timestamp: message.timestamp });
            break;
            
        default:
            console.log(`[Server] Unknown message type from ${ws.id}: ${message.type}`);
    }
}

// Create a new room
function handleCreateRoom(ws) {
    // Check if already in a room
    if (socketToRoom.has(ws.id)) {
        send(ws, { type: 'room_error', message: 'Already in a room' });
        return;
    }
    
    const roomCode = getUniqueRoomCode();
    
    const room = {
        code: roomCode,
        hostId: ws.id,
        hostSocket: ws,
        guestId: null,
        guestSocket: null,
        created: Date.now(),
        state: 'waiting' // waiting, playing, ended
    };
    
    rooms.set(roomCode, room);
    socketToRoom.set(ws.id, roomCode);
    
    console.log(`[Server] Room created: ${roomCode} by ${ws.id}`);
    
    send(ws, {
        type: 'room_created',
        roomCode: roomCode,
        isHost: true
    });
}

// Join an existing room
function handleJoinRoom(ws, roomCode) {
    // Normalize room code
    roomCode = (roomCode || '').toUpperCase().trim();
    
    // Check if already in a room
    if (socketToRoom.has(ws.id)) {
        send(ws, { type: 'room_error', message: 'Already in a room' });
        return;
    }
    
    const room = rooms.get(roomCode);
    
    if (!room) {
        send(ws, { type: 'room_error', message: 'Room not found' });
        return;
    }
    
    if (room.guestId) {
        send(ws, { type: 'room_error', message: 'Room is full' });
        return;
    }
    
    // Join the room
    room.guestId = ws.id;
    room.guestSocket = ws;
    room.state = 'playing';
    socketToRoom.set(ws.id, roomCode);
    
    console.log(`[Server] Player ${ws.id} joined room ${roomCode}`);
    
    // Notify guest
    send(ws, {
        type: 'room_joined',
        roomCode: roomCode,
        isHost: false
    });
    
    // Notify host
    if (room.hostSocket) {
        send(room.hostSocket, {
            type: 'player_joined',
            playerId: ws.id
        });
    }
}

// Leave current room
function handleLeaveRoom(ws) {
    const roomCode = socketToRoom.get(ws.id);
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) {
        socketToRoom.delete(ws.id);
        return;
    }
    
    removePlayerFromRoom(ws, room);
}

// Handle player disconnect
function handleDisconnect(ws) {
    const roomCode = socketToRoom.get(ws.id);
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) {
        socketToRoom.delete(ws.id);
        return;
    }
    
    removePlayerFromRoom(ws, room, true);
}

// Remove player from room
function removePlayerFromRoom(ws, room, isDisconnect = false) {
    const isHost = room.hostId === ws.id;
    
    console.log(`[Server] ${isHost ? 'Host' : 'Guest'} ${ws.id} left room ${room.code}`);
    
    socketToRoom.delete(ws.id);
    
    if (isHost) {
        // Host left - notify guest and close room
        if (room.guestSocket) {
            send(room.guestSocket, {
                type: 'host_disconnected',
                message: 'Host has left the game'
            });
            socketToRoom.delete(room.guestId);
        }
        rooms.delete(room.code);
        console.log(`[Server] Room ${room.code} closed (host left)`);
    } else {
        // Guest left - notify host, room stays open
        room.guestId = null;
        room.guestSocket = null;
        room.state = 'waiting';
        
        if (room.hostSocket) {
            send(room.hostSocket, {
                type: 'player_disconnected',
                message: 'Guest has left the game'
            });
        }
        
        // Set timeout to close empty room
        setTimeout(() => {
            const currentRoom = rooms.get(room.code);
            if (currentRoom && !currentRoom.guestId && currentRoom.state === 'waiting') {
                // Still waiting with no guest, keep room open for host
                // Room will be cleaned up when host disconnects
            }
        }, ROOM_TIMEOUT);
    }
}

// Relay game state from host to guest
function relayToGuest(ws, message) {
    const roomCode = socketToRoom.get(ws.id);
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== ws.id) return; // Only host can send game state
    
    if (room.guestSocket) {
        send(room.guestSocket, message);
    }
}

// Relay input from guest to host
function relayToHost(ws, message) {
    const roomCode = socketToRoom.get(ws.id);
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room || room.guestId !== ws.id) return; // Only guest can send input
    
    if (room.hostSocket) {
        send(room.hostSocket, message);
    }
}

// Relay game events to peer (either direction)
function relayToPeer(ws, message) {
    const roomCode = socketToRoom.get(ws.id);
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) return;
    
    if (room.hostId === ws.id && room.guestSocket) {
        send(room.guestSocket, message);
    } else if (room.guestId === ws.id && room.hostSocket) {
        send(room.hostSocket, message);
    }
}

// Log server stats periodically
setInterval(() => {
    console.log(`[Server] Stats: ${wss.clients.size} clients, ${rooms.size} rooms`);
}, 60000);

console.log(`[Server] Ready and listening on port ${PORT}`);
