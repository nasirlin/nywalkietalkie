const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const cors = require('cors');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const roomSpeaker = {}; 

function generateRoomId() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function broadcastRoomCount(roomId) {
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    io.to(roomId).emit('update_user_count', count);
}

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('create_room', async () => {
        const roomId = generateRoomId();
        const hostToken = Math.random().toString(36).substring(2);
        await redis.set(`room:${roomId}`, hostToken, 'EX', 86400);
        
        socket.join(roomId);
        socket.emit('room_created', { roomId, hostToken });
        broadcastRoomCount(roomId);
    });

    socket.on('join_room', async ({ roomId, token }) => {
        const storedHostToken = await redis.get(`room:${roomId}`);
        if (!storedHostToken) {
            socket.emit('error_msg', 'Invalid Channel ID');
            return;
        }
        socket.join(roomId);
        const isHost = (token === storedHostToken);
        socket.emit('joined_success', { roomId, isHost });
        broadcastRoomCount(roomId);

        if (roomSpeaker[roomId]) {
            socket.emit('channel_busy', roomSpeaker[roomId]);
        }
    });

    socket.on('start_talking', (roomId) => {
        if (!roomSpeaker[roomId]) {
            roomSpeaker[roomId] = socket.id;
            socket.to(roomId).emit('channel_busy', socket.id);
        }
    });

    socket.on('stop_talking', (roomId) => {
        if (roomSpeaker[roomId] === socket.id) {
            delete roomSpeaker[roomId];
            socket.to(roomId).emit('channel_free');
        }
    });

    socket.on('voice_data', ({ roomId, data }) => {
        if (roomSpeaker[roomId] === socket.id) {
            socket.to(roomId).emit('play_audio', { userId: socket.id, data });
        }
    });

    socket.on('video_frame', ({ roomId, frame }) => {
        socket.to(roomId).emit('update_video_frame', { userId: socket.id, frame });
    });

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            if (roomSpeaker[roomId] === socket.id) {
                delete roomSpeaker[roomId];
                socket.to(roomId).emit('channel_free');
            }
            socket.to(roomId).emit('user_left', socket.id);
        });
    });

    socket.on('disconnect', () => {
    });
    
    socket.on('disconnect', () => {
    });
});

io.of("/").adapter.on("leave-room", (room, id) => {
    if(room !== id) {
        const count = io.sockets.adapter.rooms.get(room)?.size || 0;
        io.to(room).emit('update_user_count', count);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));