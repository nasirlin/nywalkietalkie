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

io.on('connection', (socket) => {
    
    socket.on('join_room', async ({ roomId, token }) => {
        const storedHostToken = await redis.get(`room:${roomId}:token`);
        
        const isHost = (token && token === storedHostToken);
        
        await redis.sadd(`room:${roomId}:users`, socket.id);
        
        const allMembers = await redis.smembers(`room:${roomId}:users`);
        const otherUsers = allMembers.filter(id => id !== socket.id);

        socket.join(roomId);

        socket.emit('joined_success', { 
            roomId, 
            isHost, 
            usersToConnect: otherUsers 
        });

        socket.to(roomId).emit('user_joined', socket.id);

        if (roomSpeaker[roomId]) {
            socket.emit('channel_busy', roomSpeaker[roomId]);
        }
        
        io.to(roomId).emit('update_user_count', allMembers.length);
    });

    socket.on('create_room', async () => {
        const roomId = Math.floor(10000000 + Math.random() * 90000000).toString();
        const hostToken = Math.random().toString(36).substring(2);
        
        await redis.set(`room:${roomId}:token`, hostToken, 'EX', 86400);
        await redis.del(`room:${roomId}:users`);
        
        socket.emit('room_created', { roomId, hostToken });
    });

    socket.on('sending_signal', (payload) => {
        io.to(payload.userToSignal).emit('user_joined_signal', { 
            signal: payload.signal, 
            callerID: payload.callerID 
        });
    });

    socket.on('returning_signal', (payload) => {
        io.to(payload.callerID).emit('receiving_returned_signal', { 
            signal: payload.signal, 
            id: socket.id 
        });
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

    socket.on('destroy_room', async ({ roomId, token }) => {
        const storedHostToken = await redis.get(`room:${roomId}:token`);
        if (token === storedHostToken) {
            io.to(roomId).emit('room_destroyed');
            io.socketsLeave(roomId);
            await redis.del(`room:${roomId}:token`);
            await redis.del(`room:${roomId}:users`);
            delete roomSpeaker[roomId];
        }
    });

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach(async (roomId) => {
            await redis.srem(`room:${roomId}:users`, socket.id);
            
            if (roomSpeaker[roomId] === socket.id) {
                delete roomSpeaker[roomId];
                socket.to(roomId).emit('channel_free');
            }
            
            socket.to(roomId).emit('user_left', socket.id);
            
            const remaining = await redis.scard(`room:${roomId}:users`);
            io.to(roomId).emit('update_user_count', remaining);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Redis-Backed Signaling Server running on ${PORT}`));