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
        const storedHostToken = await redis.get(`room:${roomId}`);
        const isHost = (token && token === storedHostToken);
        

        const usersInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        
        socket.join(roomId);

        socket.emit('joined_success', { roomId, isHost, allUsers: usersInRoom });
        

        socket.to(roomId).emit('user_joined', socket.id);


        if (roomSpeaker[roomId]) {
            socket.emit('channel_busy', roomSpeaker[roomId]);
        }
        
        updateUserCount(roomId);
    });

    socket.on('create_room', async () => {
        const roomId = Math.floor(10000000 + Math.random() * 90000000).toString();
        const hostToken = Math.random().toString(36).substring(2);
        await redis.set(`room:${roomId}`, hostToken, 'EX', 86400);
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
        const storedHostToken = await redis.get(`room:${roomId}`);
        if (token === storedHostToken) {
            io.to(roomId).emit('room_destroyed');
            io.socketsLeave(roomId);
            await redis.del(`room:${roomId}`);
            delete roomSpeaker[roomId];
        }
    });

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            if (roomSpeaker[roomId] === socket.id) {
                delete roomSpeaker[roomId];
                socket.to(roomId).emit('channel_free');
            }
            socket.to(roomId).emit('user_left', socket.id);

            setTimeout(() => updateUserCount(roomId), 100);
        });
    });
    
    function updateUserCount(roomId) {

        const room = io.sockets.adapter.rooms.get(roomId);
        if(room) {
            io.to(roomId).emit('update_user_count', room.size);
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Signaling Server running on port ${PORT}`));