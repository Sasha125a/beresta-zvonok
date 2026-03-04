// server.js - Улучшенный сервер с диагностикой соединения
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // Увеличиваем таймауты для надежности
  pingTimeout: 60000,
  pingInterval: 25000
});

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
            max-width: 1400px;
            width: 100%;
        }
        
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
            font-size: 2.5em;
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
        }
        
        button {
            padding: 15px 30px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
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
        
        .success { background: #c6f6d5; color: #22543d; }
        .error { background: #fed7d7; color: #742a2a; }
        .info { background: #bee3f8; color: #2c5282; }
        .warning { background: #feebc8; color: #744210; }
        
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
            min-width: 400px;
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
        
        .debug-panel {
            margin-top: 20px;
            padding: 15px;
            background: #1a202c;
            color: #a0aec0;
            border-radius: 10px;
            font-family: monospace;
            font-size: 12px;
            max-height: 200px;
            overflow-y: auto;
            display: none;
        }
        
        .debug-panel.visible {
            display: block;
        }
        
        .debug-entry {
            margin: 5px 0;
            padding: 3px 0;
            border-bottom: 1px solid #2d3748;
        }
        
        .debug-time {
            color: #68d391;
            margin-right: 10px;
        }
        
        .toggle-debug {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #4a5568;
            color: white;
            border: none;
            border-radius: 30px;
            padding: 10px 20px;
            cursor: pointer;
            font-size: 14px;
            opacity: 0.7;
            z-index: 1000;
        }
        
        .toggle-debug:hover {
            opacity: 1;
        }
        
        .loader {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            display: inline-block;
            margin-left: 10px;
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
        <h1>📹 Видеозвонки</h1>
        
        <!-- Панель отладки -->
        <button class="toggle-debug" onclick="toggleDebug()">🐛 Показать отладку</button>
        <div id="debugPanel" class="debug-panel"></div>
        
        <!-- Секция настройки -->
        <div id="setupSection" class="setup-section">
            <div class="room-controls">
                <input type="text" id="roomInput" placeholder="Введите название комнаты" value="room1">
                <button onclick="joinRoom()" class="btn-primary" id="joinBtn">
                    <span id="joinBtnText">🔗 Подключиться</span>
                    <span id="joinBtnLoader" class="loader hidden"></span>
                </button>
            </div>
            <div id="setupStatus" class="status-message"></div>
        </div>
        
        <!-- Секция видео -->
        <div id="videoSection" class="video-section">
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
                <button onclick="testConnection()" class="btn-warning" id="testBtn">🔧 Тест соединения</button>
                <button onclick="hangUp()" class="btn-danger">📞 Завершить звонок</button>
            </div>
            
            <div id="callStatus" class="status-message"></div>
            <div id="connectionDetails" class="debug-panel" style="display: none;"></div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        // Глобальные переменные
        const socket = io({
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        let localStream = null;
        let peerConnection = null;
        let currentRoom = null;
        let isAudioEnabled = true;
        let isVideoEnabled = true;
        let debugEnabled = false;
        let connectionAttempts = 0;
        
        // Расширенная конфигурация ICE с множеством серверов
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.voipbuster.com:3478' },
                { urls: 'stun:stun.sipgate.net:3478' },
                { urls: 'stun:stun.voiparound.com:3478' },
                { urls: 'stun:stun.voipbuster.com:3478' },
                { urls: 'stun:stun.voipstunt.com:3478' },
                { urls: 'stun:stun.counterpath.com:3478' },
                { urls: 'stun:stun.1und1.de:3478' }
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
        
        // Функция отладки
        function debug(message, data = null) {
            const time = new Date().toLocaleTimeString();
            const debugMsg = \`[\${time}] \${message}\` + (data ? ': ' + JSON.stringify(data) : '');
            console.log(debugMsg);
            
            if (debugEnabled) {
                const panel = document.getElementById('debugPanel');
                const entry = document.createElement('div');
                entry.className = 'debug-entry';
                entry.innerHTML = \`<span class="debug-time">\${time}</span> \${message}\`;
                if (data) {
                    entry.innerHTML += ' <pre style="display:inline; color:#b794f4">' + JSON.stringify(data) + '</pre>';
                }
                panel.appendChild(entry);
                panel.scrollTop = panel.scrollHeight;
            }
        }
        
        function toggleDebug() {
            debugEnabled = !debugEnabled;
            const panel = document.getElementById('debugPanel');
            panel.classList.toggle('visible');
            document.querySelector('.toggle-debug').textContent = 
                debugEnabled ? '🔍 Скрыть отладку' : '🐛 Показать отладку';
        }
        
        function updateStatus(elementId, message, type) {
            const element = document.getElementById(elementId);
            element.textContent = message;
            element.className = 'status-message ' + type;
            debug('Статус: ' + message, {type: type});
        }
        
        // Тест соединения
        async function testConnection() {
            updateStatus('callStatus', '🔄 Тестирование соединения...', 'info');
            debug('Запуск теста соединения');
            
            try {
                // Тест STUN серверов
                const testPC = new RTCPeerConnection(configuration);
                let candidates = [];
                
                testPC.onicecandidate = (event) => {
                    if (event.candidate) {
                        candidates.push(event.candidate.candidate);
                        debug('Найден ICE кандидат', event.candidate.candidate);
                    }
                };
                
                // Создаем тестовый поток
                const testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                    .catch(() => null);
                
                if (testStream) {
                    testStream.getTracks().forEach(track => track.stop());
                }
                
                // Ждем кандидатов
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                if (candidates.length > 0) {
                    updateStatus('callStatus', '✅ STUN серверы работают. Найдено кандидатов: ' + candidates.length, 'success');
                } else {
                    updateStatus('callStatus', '⚠️ Не найдены ICE кандидаты. Возможны проблемы с NAT.', 'warning');
                }
                
                testPC.close();
                
            } catch (err) {
                debug('Ошибка теста: ' + err.message);
                updateStatus('callStatus', '❌ Ошибка теста: ' + err.message, 'error');
            }
        }
        
        // Подключение к комнате
        async function joinRoom() {
            const roomId = document.getElementById('roomInput').value.trim();
            if (!roomId) {
                alert('Введите название комнаты');
                return;
            }
            
            debug('Попытка подключения к комнате: ' + roomId);
            
            document.getElementById('joinBtn').disabled = true;
            document.getElementById('joinBtnText').classList.add('hidden');
            document.getElementById('joinBtnLoader').classList.remove('hidden');
            
            updateStatus('setupStatus', 'Запрос доступа к камере и микрофону...', 'info');
            
            try {
                // Запрашиваем доступ с явными ограничениями для совместимости
                localStream = await navigator.mediaDevices.getUserMedia({ 
                    video: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        frameRate: { ideal: 30 }
                    }, 
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                
                debug('Медиапоток получен', {
                    audio: localStream.getAudioTracks().length,
                    video: localStream.getVideoTracks().length
                });
                
                const localVideo = document.getElementById('localVideo');
                localVideo.srcObject = localStream;
                
                // Ждем начала воспроизведения
                await localVideo.play();
                debug('Локальное видео запущено');
                
                currentRoom = roomId;
                socket.emit('join-room', roomId);
                
            } catch (err) {
                debug('Ошибка доступа к медиа: ' + err.message);
                updateStatus('setupStatus', 'Ошибка доступа к камере/микрофону: ' + err.message, 'error');
                
                document.getElementById('joinBtn').disabled = false;
                document.getElementById('joinBtnText').classList.remove('hidden');
                document.getElementById('joinBtnLoader').classList.add('hidden');
            }
        }
        
        // Создание peer connection с улучшенной обработкой
        function createPeerConnection(peerId) {
            debug('Создание PeerConnection для: ' + peerId);
            
            const pc = new RTCPeerConnection(configuration);
            
            // Добавляем все треки из локального потока
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    pc.addTrack(track, localStream);
                    debug('Добавлен трек: ' + track.kind);
                });
            }
            
            // Обработка ICE кандидатов
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    debug('Отправка ICE кандидата', {type: event.candidate.type, protocol: event.candidate.protocol});
                    socket.emit('ice-candidate', {
                        target: peerId,
                        candidate: event.candidate
                    });
                }
            };
            
            // Мониторинг ICE состояния
            pc.oniceconnectionstatechange = () => {
                debug('ICE состояние: ' + pc.iceConnectionState);
                if (pc.iceConnectionState === 'connected') {
                    updateStatus('callStatus', '✅ Соединение установлено (P2P)', 'success');
                } else if (pc.iceConnectionState === 'failed') {
                    updateStatus('callStatus', '❌ Не удалось установить прямое соединение', 'error');
                    // Пробуем переподключиться
                    setTimeout(() => {
                        if (peerId) {
                            socket.emit('offer', {
                                target: peerId,
                                offer: peerConnection.localDescription
                            });
                        }
                    }, 2000);
                }
            };
            
            // Мониторинг состояния соединения
            pc.onconnectionstatechange = () => {
                debug('Состояние соединения: ' + pc.connectionState);
                if (pc.connectionState === 'connected') {
                    updateStatus('callStatus', '✅ Соединение активно', 'success');
                } else if (pc.connectionState === 'disconnected') {
                    updateStatus('callStatus', '⚠️ Соединение прервано', 'warning');
                } else if (pc.connectionState === 'failed') {
                    updateStatus('callStatus', '❌ Соединение потеряно', 'error');
                }
            };
            
            // Обработка удаленного потока
            pc.ontrack = (event) => {
                debug('Получен удаленный трек', {kind: event.track.kind});
                const remoteVideo = document.getElementById('remoteVideo');
                remoteVideo.srcObject = event.streams[0];
                remoteVideo.play().catch(e => debug('Ошибка воспроизведения: ' + e.message));
                updateStatus('callStatus', '✅ Видео собеседника получено', 'success');
            };
            
            // Сбор статистики
            pc.onicecandidateerror = (event) => {
                debug('Ошибка ICE кандидата', {errorCode: event.errorCode, url: event.url});
            };
            
            return pc;
        }
        
        // События сокета
        socket.on('connect', () => {
            debug('Подключено к серверу сигнализации');
        });
        
        socket.on('join-success', (roomId) => {
            debug('Успешно подключились к комнате: ' + roomId);
            
            document.getElementById('setupSection').style.display = 'none';
            document.getElementById('videoSection').style.display = 'block';
            
            updateStatus('callStatus', '🟡 Ожидание собеседника...', 'info');
            
            document.getElementById('joinBtn').disabled = false;
            document.getElementById('joinBtnText').classList.remove('hidden');
            document.getElementById('joinBtnLoader').classList.add('hidden');
        });
        
        socket.on('peer-joined', async (peerId) => {
            debug('Собеседник подключился: ' + peerId);
            updateStatus('callStatus', '🟡 Собеседник найден, устанавливаем соединение...', 'info');
            
            try {
                // Небольшая задержка для стабильности
                await new Promise(resolve => setTimeout(resolve, 500));
                
                peerConnection = createPeerConnection(peerId);
                
                // Создаем оффер с опциями для получения медиа
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                    iceRestart: true
                });
                
                await peerConnection.setLocalDescription(offer);
                debug('Создан оффер', {type: offer.type});
                
                // Отправляем оффер
                socket.emit('offer', {
                    target: peerId,
                    offer: offer
                });
                
            } catch (err) {
                debug('Ошибка создания оффера: ' + err.message);
                updateStatus('callStatus', 'Ошибка соединения: ' + err.message, 'error');
            }
        });
        
        socket.on('offer', async ({ offer, sender }) => {
            debug('Получен оффер от: ' + sender, {type: offer.type});
            updateStatus('callStatus', '🟡 Получен запрос на соединение...', 'info');
            
            try {
                if (!peerConnection) {
                    peerConnection = createPeerConnection(sender);
                }
                
                await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                debug('Установлено удаленное описание');
                
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                debug('Создан ответ');
                
                socket.emit('answer', {
                    target: sender,
                    answer: answer
                });
                
            } catch (err) {
                debug('Ошибка обработки оффера: ' + err.message);
                updateStatus('callStatus', 'Ошибка: ' + err.message, 'error');
            }
        });
        
        socket.on('answer', async ({ answer }) => {
            debug('Получен ответ');
            try {
                if (peerConnection && !peerConnection.currentRemoteDescription) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                    debug('Установлено удаленное описание из ответа');
                }
            } catch (err) {
                debug('Ошибка обработки ответа: ' + err.message);
            }
        });
        
        socket.on('ice-candidate', async ({ candidate }) => {
            debug('Получен ICE кандидат', {type: candidate.type});
            if (peerConnection) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    debug('Ошибка добавления ICE кандидата: ' + err.message);
                }
            }
        });
        
        socket.on('peer-disconnected', () => {
            debug('Собеседник отключился');
            updateStatus('callStatus', '🔴 Собеседник отключился', 'error');
            
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            
            document.getElementById('remoteVideo').srcObject = null;
            updateStatus('callStatus', '🟡 Ожидание нового собеседника...', 'info');
        });
        
        socket.on('room-full', () => {
            alert('Комната переполнена! Максимум 2 участника.');
            hangUp();
        });
        
        // Управление аудио/видео
        function toggleAudio() {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    isAudioEnabled = audioTrack.enabled;
                    document.getElementById('audioBtn').innerHTML = isAudioEnabled ? 
                        '🔊 Выключить микрофон' : '🔇 Включить микрофон';
                    debug('Аудио ' + (isAudioEnabled ? 'включено' : 'выключено'));
                }
            }
        }
        
        function toggleVideo() {
            if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    isVideoEnabled = videoTrack.enabled;
                    document.getElementById('videoBtn').innerHTML = isVideoEnabled ? 
                        '📹 Выключить камеру' : '📹 Включить камеру';
                    debug('Видео ' + (isVideoEnabled ? 'включено' : 'выключено'));
                }
            }
        }
        
        function hangUp() {
            debug('Завершение звонка');
            
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            
            document.getElementById('localVideo').srcObject = null;
            document.getElementById('remoteVideo').srcObject = null;
            
            if (currentRoom) {
                socket.emit('leave-room', currentRoom);
                currentRoom = null;
            }
            
            document.getElementById('setupSection').style.display = 'block';
            document.getElementById('videoSection').style.display = 'none';
            
            document.getElementById('joinBtn').disabled = false;
            document.getElementById('joinBtnText').classList.remove('hidden');
            document.getElementById('joinBtnLoader').classList.add('hidden');
        }
        
        // Обработка ошибок сокета
        socket.on('connect_error', (error) => {
            debug('Ошибка подключения к серверу: ' + error.message);
            updateStatus('setupStatus', 'Ошибка подключения к серверу', 'error');
        });
        
        socket.on('disconnect', (reason) => {
            debug('Отключено от сервера: ' + reason);
        });
        
        socket.on('reconnect', (attemptNumber) => {
            debug('Переподключено к серверу, попытка: ' + attemptNumber);
            if (currentRoom) {
                socket.emit('join-room', currentRoom);
            }
        });
    </script>
</body>
</html>
  `);
});

// Сигнальный сервер
io.on('connection', (socket) => {
  console.log('👤 Пользователь подключился:', socket.id);

  socket.on('join-room', (roomId) => {
    console.log(`📢 ${socket.id} пытается подключиться к комнате: ${roomId}`);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    
    if (room.size >= 2) {
      console.log(`❌ Комната ${roomId} переполнена`);
      socket.emit('room-full');
      return;
    }
    
    room.add(socket.id);
    socket.join(roomId);
    
    console.log(`✅ ${socket.id} подключился к ${roomId}. Участников: ${room.size}`);
    console.log('Текущие комнаты:', Array.from(rooms.entries()).map(([id, set]) => ({id, users: Array.from(set)})));
    
    socket.emit('join-success', roomId);
    
    if (room.size > 1) {
      // Уведомляем всех в комнате о новом участнике
      io.to(roomId).emit('peer-joined', socket.id);
      console.log(`📣 Уведомляем комнату ${roomId} о новом участнике`);
    }
  });

  socket.on('offer', (data) => {
    console.log(`📤 Оффер от ${socket.id} к ${data.target}`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    console.log(`📤 Ответ от ${socket.id} к ${data.target}`);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log(`📤 ICE кандидат от ${socket.id} к ${data.target}`);
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
    
    io.to(roomId).emit('peer-disconnected');
    
    if (room.size === 0) {
      rooms.delete(roomId);
    }
    
    console.log(`👋 ${socket.id} покинул комнату ${roomId}`);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 Сервер запущен на порту ' + PORT);
  console.log('📱 Откройте в двух браузерах: http://localhost:' + PORT);
  console.log('🔧 Для тестирования используйте комнату с одинаковым названием');
  console.log('='.repeat(50) + '\n');
});