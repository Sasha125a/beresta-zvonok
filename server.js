// server.js - Полноценный сервер для звонков (Signaling + Client)
// Для запуска: npm install express socket.io && node server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // В продакшене лучше ограничить конкретными доменами
    methods: ["GET", "POST"]
  }
});

// Хранилище комнат и пользователей
const rooms = new Map(); // roomId -> Set of socket ids
const userRooms = new Map(); // socketId -> roomId

// Раздаём статический клиентский HTML
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>WebRTC Video Call</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
        video { width: 45%; max-width: 500px; margin: 10px; border: 1px solid #ccc; background: #f0f0f0; }
        #controls { margin: 20px; }
        input, button { padding: 10px; margin: 5px; font-size: 16px; }
        #roomStatus { color: #666; margin: 10px; }
        .error { color: red; }
        .success { color: green; }
    </style>
</head>
<body>
    <h1>WebRTC Video Call</h1>
    
    <div id="setup">
        <input type="text" id="roomInput" placeholder="Enter room name" value="default">
        <button onclick="joinRoom()">Join/Create Room</button>
    </div>
    
    <div id="roomStatus"></div>
    
    <div id="videos" style="display: none;">
        <video id="localVideo" autoplay muted playsinline></video>
        <video id="remoteVideo" autoplay playsinline></video>
    </div>
    
    <div id="controls" style="display: none;">
        <button onclick="toggleMute()" id="muteBtn">Mute Audio</button>
        <button onclick="toggleVideo()" id="videoBtn">Stop Video</button>
        <button onclick="hangUp()">Hang Up</button>
    </div>
    
    <div id="status"></div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let localStream;
        let peerConnection;
        let currentRoom;
        let isMuted = false;
        let isVideoStopped = false;
        
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        async function joinRoom() {
            const roomId = document.getElementById('roomInput').value.trim();
            if (!roomId) return;
            
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                document.getElementById('localVideo').srcObject = localStream;
                
                currentRoom = roomId;
                socket.emit('join-room', roomId);
                
                document.getElementById('setup').style.display = 'none';
                document.getElementById('videos').style.display = 'block';
                document.getElementById('controls').style.display = 'block';
                document.getElementById('roomStatus').innerHTML = '<span class="success">Joined room: ' + roomId + '</span>';
            } catch (err) {
                document.getElementById('status').innerHTML = '<span class="error">Error: ' + err.message + '</span>';
            }
        }
        
        socket.on('peer-joined', async (peerId) => {
            document.getElementById('status').innerHTML = '<span class="success">Peer joined, establishing connection...</span>';
            
            peerConnection = new RTCPeerConnection(configuration);
            
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', {
                        target: peerId,
                        candidate: event.candidate
                    });
                }
            };
            
            peerConnection.ontrack = (event) => {
                document.getElementById('remoteVideo').srcObject = event.streams[0];
            };
            
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('offer', {
                target: peerId,
                offer: offer
            });
        });
        
        socket.on('offer', async ({ offer, sender }) => {
            document.getElementById('status').innerHTML = '<span class="success">Received offer, answering...</span>';
            
            peerConnection = new RTCPeerConnection(configuration);
            
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', {
                        target: sender,
                        candidate: event.candidate
                    });
                }
            };
            
            peerConnection.ontrack = (event) => {
                document.getElementById('remoteVideo').srcObject = event.streams[0];
            };
            
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('answer', {
                target: sender,
                answer: answer
            });
        });
        
        socket.on('answer', async ({ answer }) => {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            document.getElementById('status').innerHTML = '<span class="success">Connected!</span>';
        });
        
        socket.on('ice-candidate', async ({ candidate }) => {
            if (peerConnection) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Error adding ICE candidate', e);
                }
            }
        });
        
        socket.on('peer-disconnected', () => {
            document.getElementById('status').innerHTML = '<span class="error">Peer disconnected</span>';
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            document.getElementById('remoteVideo').srcObject = null;
        });
        
        function toggleMute() {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    isMuted = !audioTrack.enabled;
                    document.getElementById('muteBtn').textContent = isMuted ? 'Unmute Audio' : 'Mute Audio';
                }
            }
        }
        
        function toggleVideo() {
            if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    isVideoStopped = !videoTrack.enabled;
                    document.getElementById('videoBtn').textContent = isVideoStopped ? 'Start Video' : 'Stop Video';
                }
            }
        }
        
        function hangUp() {
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            socket.emit('leave-room', currentRoom);
            document.getElementById('remoteVideo').srcObject = null;
            document.getElementById('setup').style.display = 'block';
            document.getElementById('videos').style.display = 'none';
            document.getElementById('controls').style.display = 'none';
            document.getElementById('roomStatus').innerHTML = '';
            document.getElementById('status').innerHTML = '';
        }
        
        socket.on('room-full', () => {
            alert('Room is full! This demo supports only 2 participants.');
            hangUp();
        });
    </script>
</body>
</html>
  `);
});

// Сигнальный сервер (WebSocket)
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    
    if (room.size >= 2) {
      socket.emit('room-full');
      return;
    }
    
    room.add(socket.id);
    userRooms.set(socket.id, roomId);
    socket.join(roomId);
    
    console.log('Socket ' + socket.id + ' joined room ' + roomId + '. Participants: ' + room.size);
    
    socket.to(roomId).emit('peer-joined', socket.id);
  });

  socket.on('offer', (data) => {
    console.log('Offer from ' + socket.id + ' to ' + data.target);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    console.log('Answer from ' + socket.id + ' to ' + data.target);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log('ICE candidate from ' + socket.id + ' to ' + data.target);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('leave-room', (roomId) => {
    handleDisconnect(socket, roomId);
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
});

function handleDisconnect(socket, specificRoom = null) {
  const roomId = specificRoom || userRooms.get(socket.id);
  
  if (roomId && rooms.has(roomId)) {
    const room = rooms.get(roomId);
    room.delete(socket.id);
    
    socket.to(roomId).emit('peer-disconnected');
    
    if (room.size === 0) {
      rooms.delete(roomId);
    }
    
    console.log('Socket ' + socket.id + ' left room ' + roomId);
  }
  
  userRooms.delete(socket.id);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('Open http://localhost:' + PORT + ' in two browsers to test');
});
