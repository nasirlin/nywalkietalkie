const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const cors = require('cors');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const app = express();
app.use(cors({
    origin: "*", 
    methods: ["GET", "POST"]
}));
app.get('/', (req, res) => {
    res.send('NY Walkietalkie Server is Running.');
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    },
    maxHttpBufferSize: 1e6
});

function generateRoomId() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('create_room', async () => {
        try {
            const roomId = generateRoomId();
            const hostToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
            
            await redis.set(`room:${roomId}`, hostToken, 'EX', 86400);

            socket.join(roomId);
            socket.emit('room_created', { roomId, hostToken });
            console.log(`[Create] Room ${roomId} created by ${socket.id}`);
        } catch (err) {
            console.error('Redis Error:', err);
            socket.emit('error_msg', '系統錯誤，無法建立房間');
        }
    });

    socket.on('join_room', async ({ roomId, token }) => {
        try {
            const storedHostToken = await redis.get(`room:${roomId}`);

            if (!storedHostToken) {
                socket.emit('error_msg', '找不到此房間代碼或房間已過期');
                return;
            }

            socket.join(roomId);
            const isHost = (token === storedHostToken);
            
            socket.emit('joined_success', { roomId, isHost });
            
            socket.to(roomId).emit('user_joined', { userId: socket.id });
            console.log(`[Join] ${socket.id} joined room ${roomId}. IsHost: ${isHost}`);
        } catch (err) {
            console.error('Redis Error:', err);
        }
    });

    socket.on('voice_data', ({ roomId, data }) => {
        socket.to(roomId).emit('play_audio', { userId: socket.id, data });
    });

    socket.on('video_frame', ({ roomId, frame }) => {
        socket.to(roomId).emit('update_video_frame', { userId: socket.id, frame });
    });

    socket.on('destroy_room', async ({ roomId, token }) => {
        const storedHostToken = await redis.get(`room:${roomId}`);
        
        if (token === storedHostToken) {
            io.in(roomId).emit('room_destroyed');
            await redis.del(`room:${roomId}`);
            io.in(roomId).disconnectSockets();
            console.log(`[Destroy] Room ${roomId} destroyed.`);
        } else {
            socket.emit('error_msg', '權限不足，無法解散房間');
        }
    });

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            socket.to(roomId).emit('user_left', socket.id);
        });
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});