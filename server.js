// server.js - Сервер для видеозвонков с русским интерфейсом
// Для запуска: npm install express socket.io && node server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Хранилище комнат и пользователей
const rooms = new Map();

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Видеозвонки - WebRTC</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 30px;
            max-width: 1200px;
            width: 100%;
        }
        
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
            font-size: 2.5em;
        }
        
        h1 i {
            color: #667eea;
            margin-right: 10px;
        }
        
        .setup-section {
            background: #f8f9fa;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 30px;
        }
        
        .room-controls {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            justify-content: center;
        }
        
        input {
            flex: 1;
            min-width: 250px;
            padding: 15px 20px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        
        button {
            padding: 15px 30px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .btn-primary {
            background: #667eea;
            color: white;
        }
        
        .btn-success {
            background: #48bb78;
            color: white;
        }
        
        .btn-danger {
            background: #f56565;
            color: white;
        }
        
        .btn-warning {
            background: #ed8936;
            color: white;
        }
        
        .status-message {
            margin-top: 15px;
            padding: 10px;
            border-radius: 8px;
            text-align: center;
            font-weight: 500;
        }
        
        .success {
            background: #c6f6d5;
            color: #22543d;
        }
        
        .error {
            background: #fed7d7;
            color: #742a2a;
        }
        
        .info {
            background: #bee3f8;
            color: #2c5282;
        }
        
        .video-section {
            display: none;
            margin-top: 20px;
        }
        
        .video-container {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            justify-content: center;
            margin-bottom: 20px;
        }
        
        .video-wrapper {
            flex: 1;
            min-width: 300px;
            position: relative;
        }
        
        .video-label {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.6);
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 14px;
            z-index: 1;
        }
        
        video {
            width: 100%;
            height: auto;
            border-radius: 15px;
            background: #2d3748;
            border: 3px solid #e2e8f0;
            aspect-ratio: 16/9;
            object-fit: cover;
        }
        
        .controls {
            display: flex;
            gap: 10px;
            justify-content: center;
            flex-wrap: wrap;
            margin-top: 20px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 15px;
        }
        
        .room-info {
            text-align: center;
            margin-bottom: 20px;
            padding: 15px;
            background: #ebf4ff;
            border-radius: 10px;
            font-size: 18px;
            font-weight: 500;
            color: #2c5282;
        }
        
        .loader {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>
            <i>📹</i> Видеозвонки
        </h1>
        
        <!-- Секция настройки -->
        <div id="setupSection" class="setup-section">
            <div class="room-controls">
                <input type="text" id="roomInput" placeholder="Введите название комнаты" value="default">
                <button onclick="joinRoom()" class="btn-primary" id="joinBtn">
                    <span id="joinBtnText">🔗 Создать или подключиться</span>
                    <span id="joinBtnLoader" class="loader hidden"></span>
                </button>
            </div>
            <div id="setupStatus" class="status-message"></div>
        </div>
        
        <!-- Секция видео -->
        <div id="videoSection" class="video-section">
            <div id="roomInfo" class="room-info"></div>
            
            <div class="video-container">
                <div class="video-wrapper">
                    <div class="video-label">Вы</div>
                    <video id="localVideo" autoplay playsinline muted></video>
                </div>
                <div class="video-wrapper">
                    <div class="video-label">Собеседник</div>
                    <video id="remoteVideo" autoplay playsinline></video>
                </div>
            </div>
            
            <div class="controls">
                <button onclick="toggleAudio()" class="btn-success" id="audioBtn">🔊 Выключить микрофон</button>
                <button onclick="toggleVideo()" class="btn-success" id="videoBtn">📹 Выключить камеру</button>
                <button onclick="hangUp()" class="btn-danger">📞 Завершить звонок</button>
            </div>
            
            <div id="callStatus" class="status-message"></div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let localStream = null;
        let peerConnection = null;
        let currentRoom = null;
        let isAudioEnabled = true;
        let isVideoEnabled = true;
        let isCallActive = false;
        
        // Конфигурация STUN серверов
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };
        
        // Функция для обновления статуса
        function updateStatus(elementId, message, type) {
            const element = document.getElementById(elementId);
            element.textContent = message;
            element.className = 'status-message ' + type;
        }
        
        // Подключение к комнате
        async function joinRoom() {
            const roomId = document.getElementById('roomInput').value.trim();
            if (!roomId) {
                alert('Введите название комнаты');
                return;
            }
            
            // Показываем загрузку
            document.getElementById('joinBtn').disabled = true;
            document.getElementById('joinBtnText').classList.add('hidden');
            document.getElementById('joinBtnLoader').classList.remove('hidden');
            updateStatus('setupStatus', 'Подключение к камере и микрофону...', 'info');
            
            try {
                // Запрашиваем доступ к медиаустройствам
                localStream = await navigator.mediaDevices.getUserMedia({ 
                    video: true, 
                    audio: true 
                });
                
                // Отображаем локальное видео
                const localVideo = document.getElementById('localVideo');
                localVideo.srcObject = localStream;
                
                // Сохраняем комнату
                currentRoom = roomId;
                
                // Подключаемся к комнате
                socket.emit('join-room', roomId);
                
                updateStatus('setupStatus', 'Подключение к комнате...', 'info');
                
            } catch (err) {
                console.error('Ошибка доступа к медиа:', err);
                updateStatus('setupStatus', 'Ошибка доступа к камере или микрофону: ' + err.message, 'error');
                
                document.getElementById('joinBtn').disabled = false;
                document.getElementById('joinBtnText').classList.remove('hidden');
                document.getElementById('joinBtnLoader').classList.add('hidden');
            }
        }
        
        // Создание peer connection
        function createPeerConnection(peerId) {
            const pc = new RTCPeerConnection(configuration);
            
            // Добавляем локальные треки
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    pc.addTrack(track, localStream);
                });
            }
            
            // Обработка ICE кандидатов
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', {
                        target: peerId,
                        candidate: event.candidate
                    });
                }
            };
            
            // Обработка состояния соединения
            pc.onconnectionstatechange = () => {
                console.log('Connection state:', pc.connectionState);
                if (pc.connectionState === 'connected') {
                    updateStatus('callStatus', '✅ Соединение установлено', 'success');
                    isCallActive = true;
                } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                    updateStatus('callStatus', '❌ Соединение потеряно', 'error');
                    isCallActive = false;
                }
            };
            
            // Обработка удаленного потока
            pc.ontrack = (event) => {
                console.log('Получен удаленный поток');
                const remoteVideo = document.getElementById('remoteVideo');
                remoteVideo.srcObject = event.streams[0];
                updateStatus('callStatus', '✅ Собеседник подключен', 'success');
            };
            
            // Обработка ICE состояния
            pc.oniceconnectionstatechange = () => {
                console.log('ICE state:', pc.iceConnectionState);
            };
            
            return pc;
        }
        
        // События сокета
        socket.on('join-success', (roomId) => {
            console.log('Успешно подключились к комнате:', roomId);
            
            // Показываем секцию видео
            document.getElementById('setupSection').style.display = 'none';
            document.getElementById('videoSection').style.display = 'block';
            
            document.getElementById('roomInfo').innerHTML = '📢 Комната: <strong>' + roomId + '</strong>';
            updateStatus('callStatus', '🟡 Ожидание собеседника...', 'info');
            
            document.getElementById('joinBtn').disabled = false;
            document.getElementById('joinBtnText').classList.remove('hidden');
            document.getElementById('joinBtnLoader').classList.add('hidden');
            updateStatus('setupStatus', '', '');
        });
        
        socket.on('peer-joined', async (peerId) => {
            console.log('Собеседник подключился:', peerId);
            updateStatus('callStatus', '🟡 Собеседник найден, устанавливаем соединение...', 'info');
            
            try {
                // Создаем peer connection
                peerConnection = createPeerConnection(peerId);
                
                // Создаем оффер
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await peerConnection.setLocalDescription(offer);
                
                // Отправляем оффер
                socket.emit('offer', {
                    target: peerId,
                    offer: offer
                });
                
            } catch (err) {
                console.error('Ошибка создания оффера:', err);
                updateStatus('callStatus', 'Ошибка соединения: ' + err.message, 'error');
            }
        });
        
        socket.on('offer', async ({ offer, sender }) => {
            console.log('Получен оффер от:', sender);
            updateStatus('callStatus', '🟡 Получен запрос на соединение...', 'info');
            
            try {
                // Создаем peer connection если его нет
                if (!peerConnection) {
                    peerConnection = createPeerConnection(sender);
                }
                
                // Устанавливаем удаленное описание
                await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                
                // Создаем ответ
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                // Отправляем ответ
                socket.emit('answer', {
                    target: sender,
                    answer: answer
                });
                
            } catch (err) {
                console.error('Ошибка обработки оффера:', err);
                updateStatus('callStatus', 'Ошибка соединения: ' + err.message, 'error');
            }
        });
        
        socket.on('answer', async ({ answer }) => {
            console.log('Получен ответ');
            try {
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                }
            } catch (err) {
                console.error('Ошибка обработки ответа:', err);
            }
        });
        
        socket.on('ice-candidate', async ({ candidate }) => {
            console.log('Получен ICE кандидат');
            if (peerConnection) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error('Ошибка добавления ICE кандидата:', err);
                }
            }
        });
        
        socket.on('peer-disconnected', () => {
            console.log('Собеседник отключился');
            updateStatus('callStatus', '🔴 Собеседник отключился', 'error');
            
            // Закрываем соединение
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            
            // Очищаем удаленное видео
            document.getElementById('remoteVideo').srcObject = null;
            
            // Пытаемся переподключиться
            updateStatus('callStatus', '🟡 Ожидание нового собеседника...', 'info');
        });
        
        socket.on('room-full', () => {
            alert('Комната переполнена! В данной версии поддерживается только 2 участника.');
            hangUp();
        });
        
        // Управление аудио
        function toggleAudio() {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    isAudioEnabled = audioTrack.enabled;
                    document.getElementById('audioBtn').innerHTML = isAudioEnabled ? 
                        '🔊 Выключить микрофон' : '🔇 Включить микрофон';
                    
                    if (peerConnection) {
                        // Отправляем информацию об изменении
                        socket.emit('audio-toggle', { enabled: isAudioEnabled });
                    }
                }
            }
        }
        
        // Управление видео
        function toggleVideo() {
            if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    isVideoEnabled = videoTrack.enabled;
                    document.getElementById('videoBtn').innerHTML = isVideoEnabled ? 
                        '📹 Выключить камеру' : '📹 Включить камеру';
                    
                    if (peerConnection) {
                        // Отправляем информацию об изменении
                        socket.emit('video-toggle', { enabled: isVideoEnabled });
                    }
                }
            }
        }
        
        // Завершение звонка
        function hangUp() {
            // Закрываем peer connection
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            
            // Останавливаем локальный стрим
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            
            // Очищаем видео элементы
            document.getElementById('localVideo').srcObject = null;
            document.getElementById('remoteVideo').srcObject = null;
            
            // Отправляем событие о выходе
            if (currentRoom) {
                socket.emit('leave-room', currentRoom);
                currentRoom = null;
            }
            
            // Возвращаемся к настройке
            document.getElementById('setupSection').style.display = 'block';
            document.getElementById('videoSection').style.display = 'none';
            
            // Сбрасываем кнопки
            document.getElementById('joinBtn').disabled = false;
            document.getElementById('joinBtnText').classList.remove('hidden');
            document.getElementById('joinBtnLoader').classList.add('hidden');
            
            updateStatus('setupStatus', '', '');
            isCallActive = false;
        }
        
        // Обработка ошибок
        socket.on('connect_error', (error) => {
            console.error('Ошибка подключения к серверу:', error);
            updateStatus('setupStatus', 'Ошибка подключения к серверу', 'error');
        });
        
        // Обработка закрытия страницы
        window.addEventListener('beforeunload', () => {
            if (currentRoom) {
                socket.emit('leave-room', currentRoom);
            }
        });
    </script>
</body>
</html>
  `);
});

// Сигнальный сервер
io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

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
    socket.join(roomId);
    
    console.log('Сокет ' + socket.id + ' подключился к комнате ' + roomId + '. Участников: ' + room.size);
    
    // Уведомляем клиента об успешном подключении
    socket.emit('join-success', roomId);
    
    // Уведомляем других участников
    socket.to(roomId).emit('peer-joined', socket.id);
  });

  socket.on('offer', (data) => {
    console.log('Оффер от ' + socket.id + ' к ' + data.target);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    console.log('Ответ от ' + socket.id + ' к ' + data.target);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log('ICE кандидат от ' + socket.id + ' к ' + data.target);
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
  let roomId = specificRoom;
  
  if (!roomId) {
    // Ищем комнату пользователя
    for (const [rId, members] of rooms.entries()) {
      if (members.has(socket.id)) {
        roomId = rId;
        break;
      }
    }
  }
  
  if (roomId && rooms.has(roomId)) {
    const room = rooms.get(roomId);
    room.delete(socket.id);
    
    socket.to(roomId).emit('peer-disconnected');
    
    if (room.size === 0) {
      rooms.delete(roomId);
    }
    
    console.log('Сокет ' + socket.id + ' покинул комнату ' + roomId);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Сервер запущен на порту ' + PORT);
  console.log('Откройте http://localhost:' + PORT + ' в двух браузерах для тестирования');
});