// server.js - Полноценный сервер с поддержкой аудиозвонков и JSON API
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Хранилища данных
const rooms = new Map();           // Комнаты и их участники
const roomsInfo = new Map();       // Информация о комнатах (название, создатель и т.д.)
const users = new Map();           // Информация о пользователях
const callHistory = new Map();     // История звонков
const activeCalls = new Map();     // Активные звонки

// ============= JSON API =============

// Получить статус сервера
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    stats: {
      activeRooms: rooms.size,
      totalUsers: users.size,
      activeCalls: activeCalls.size,
      totalCallsToday: getTodayCallsCount()
    }
  });
});

// Получить список всех комнат
app.get('/api/rooms', (req, res) => {
  const roomsList = [];
  for (const [roomId, participants] of rooms.entries()) {
    roomsList.push({
      roomId: roomId,
      participants: participants.size,
      participantsList: Array.from(participants).map(socketId => ({
        socketId,
        userInfo: users.get(socketId) || { name: 'Аноним', type: 'unknown' }
      })),
      roomInfo: roomsInfo.get(roomId) || {
        name: roomId,
        createdAt: new Date().toISOString()
      }
    });
  }
  res.json({
    total: roomsList.length,
    rooms: roomsList
  });
});

// Получить информацию о конкретной комнате
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const participants = rooms.get(roomId);
  
  if (!participants) {
    return res.status(404).json({ error: 'Комната не найдена' });
  }
  
  res.json({
    roomId,
    participants: participants.size,
    participantsList: Array.from(participants).map(socketId => ({
      socketId,
      userInfo: users.get(socketId) || { name: 'Аноним', type: 'unknown' }
    })),
    roomInfo: roomsInfo.get(roomId) || {
      name: roomId,
      createdAt: new Date().toISOString()
    }
  });
});

// Создать комнату (через API)
app.post('/api/rooms', (req, res) => {
  const { roomId, roomName, createdBy, type = 'video' } = req.body;
  
  if (!roomId) {
    return res.status(400).json({ error: 'roomId обязателен' });
  }
  
  if (rooms.has(roomId)) {
    return res.status(409).json({ error: 'Комната уже существует' });
  }
  
  rooms.set(roomId, new Set());
  roomsInfo.set(roomId, {
    name: roomName || roomId,
    createdBy: createdBy || 'system',
    createdAt: new Date().toISOString(),
    type: type, // 'audio' или 'video'
    settings: req.body.settings || {}
  });
  
  res.status(201).json({
    success: true,
    roomId,
    message: 'Комната создана',
    roomInfo: roomsInfo.get(roomId)
  });
});

// Обновить информацию о комнате
app.put('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const updates = req.body;
  
  if (!rooms.has(roomId)) {
    return res.status(404).json({ error: 'Комната не найдена' });
  }
  
  const currentInfo = roomsInfo.get(roomId) || {};
  roomsInfo.set(roomId, { ...currentInfo, ...updates, updatedAt: new Date().toISOString() });
  
  // Уведомляем участников об изменениях
  io.to(roomId).emit('room-updated', roomsInfo.get(roomId));
  
  res.json({
    success: true,
    roomId,
    roomInfo: roomsInfo.get(roomId)
  });
});

// Удалить комнату
app.delete('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  
  if (!rooms.has(roomId)) {
    return res.status(404).json({ error: 'Комната не найдена' });
  }
  
  // Отключаем всех участников
  io.to(roomId).emit('room-closed', { roomId, reason: 'Комната закрыта администратором' });
  
  rooms.delete(roomId);
  roomsInfo.delete(roomId);
  
  res.json({
    success: true,
    message: 'Комната удалена'
  });
});

// Получить информацию о пользователе
app.get('/api/users/:socketId', (req, res) => {
  const { socketId } = req.params;
  const userInfo = users.get(socketId);
  
  if (!userInfo) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  res.json(userInfo);
});

// Обновить информацию о пользователе
app.put('/api/users/:socketId', (req, res) => {
  const { socketId } = req.params;
  const updates = req.body;
  
  const currentInfo = users.get(socketId) || {};
  users.set(socketId, { ...currentInfo, ...updates, updatedAt: new Date().toISOString() });
  
  res.json({
    success: true,
    userInfo: users.get(socketId)
  });
});

// Получить историю звонков
app.get('/api/calls/history', (req, res) => {
  const { limit = 50, roomId } = req.query;
  let history = Array.from(callHistory.values());
  
  if (roomId) {
    history = history.filter(call => call.roomId === roomId);
  }
  
  // Сортируем по времени (новые сверху)
  history.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  
  // Ограничиваем количество
  history = history.slice(0, parseInt(limit));
  
  res.json({
    total: history.length,
    calls: history
  });
});

// Получить активные звонки
app.get('/api/calls/active', (req, res) => {
  const active = Array.from(activeCalls.values());
  res.json({
    total: active.length,
    calls: active
  });
});

// Инициировать звонок через API
app.post('/api/calls/start', (req, res) => {
  const { roomId, callerId, calleeId, type = 'video' } = req.body;
  
  if (!roomId || !callerId) {
    return res.status(400).json({ error: 'roomId и callerId обязательны' });
  }
  
  const callId = generateCallId();
  const callInfo = {
    callId,
    roomId,
    callerId,
    calleeId: calleeId || null,
    type,
    startTime: new Date().toISOString(),
    status: 'initiated',
    participants: [callerId]
  };
  
  activeCalls.set(callId, callInfo);
  
  // Уведомляем через сокет, если нужно
  if (calleeId) {
    io.to(calleeId).emit('incoming-call', callInfo);
  }
  
  res.status(201).json(callInfo);
});

// Завершить звонок через API
app.post('/api/calls/end/:callId', (req, res) => {
  const { callId } = req.params;
  const { endedBy } = req.body;
  
  const call = activeCalls.get(callId);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }
  
  const endedCall = {
    ...call,
    endedBy: endedBy || 'system',
    endTime: new Date().toISOString(),
    status: 'ended',
    duration: calculateDuration(call.startTime)
  };
  
  activeCalls.delete(callId);
  
  // Сохраняем в историю
  const historyId = 'hist_' + Date.now();
  callHistory.set(historyId, endedCall);
  
  // Уведомляем участников
  if (call.participants) {
    call.participants.forEach(participantId => {
      io.to(participantId).emit('call-ended', endedCall);
    });
  }
  
  res.json(endedCall);
});

// Получить статистику
app.get('/api/stats', (req, res) => {
  const stats = {
    timestamp: new Date().toISOString(),
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    },
    rooms: {
      total: rooms.size,
      details: Array.from(rooms.entries()).map(([id, participants]) => ({
        id,
        participants: participants.size
      }))
    },
    users: {
      total: users.size,
      online: io.engine.clientsCount
    },
    calls: {
      active: activeCalls.size,
      totalToday: getTodayCallsCount()
    }
  };
  
  res.json(stats);
});

// Webhook для внешних сервисов
app.post('/api/webhook/:event', (req, res) => {
  const { event } = req.params;
  const data = req.body;
  
  console.log(`📡 Webhook получен: ${event}`, data);
  
  // Обрабатываем разные события
  switch(event) {
    case 'call-started':
      // Логика для внешнего сервиса
      break;
    case 'call-ended':
      // Логика для внешнего сервиса
      break;
    case 'user-joined':
      // Логика для внешнего сервиса
      break;
    default:
      // Неизвестное событие
  }
  
  res.json({
    success: true,
    event,
    received: data,
    timestamp: new Date().toISOString()
  });
});

// ============= Веб-интерфейс =============
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Видео и Аудио звонки</title>
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
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        h1 {
            text-align: center;
            color: white;
            margin-bottom: 30px;
            font-size: 2.5em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        
        .main-panel {
            display: grid;
            grid-template-columns: 300px 1fr;
            gap: 20px;
        }
        
        /* Боковая панель */
        .sidebar {
            background: white;
            border-radius: 20px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        
        .sidebar h2 {
            color: #333;
            margin-bottom: 20px;
            font-size: 1.3em;
            border-bottom: 2px solid #f0f0f0;
            padding-bottom: 10px;
        }
        
        .user-info {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 20px;
        }
        
        .user-info input {
            width: 100%;
            padding: 10px;
            margin: 10px 0;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
        }
        
        .call-type-selector {
            display: flex;
            gap: 10px;
            margin: 15px 0;
        }
        
        .call-type-btn {
            flex: 1;
            padding: 10px;
            border: 2px solid #e0e0e0;
            background: white;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .call-type-btn.active {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }
        
        .room-list {
            max-height: 300px;
            overflow-y: auto;
        }
        
        .room-item {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.3s;
            border-left: 4px solid #667eea;
        }
        
        .room-item:hover {
            transform: translateX(5px);
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .room-item .room-name {
            font-weight: 600;
            color: #333;
        }
        
        .room-item .room-type {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        
        .room-item .participants {
            font-size: 12px;
            color: #48bb78;
        }
        
        /* Основная область */
        .main-content {
            background: white;
            border-radius: 20px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
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
        
        .room-controls input,
        .room-controls select {
            padding: 15px 20px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 16px;
            flex: 1;
            min-width: 200px;
        }
        
        button {
            padding: 15px 30px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
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
        
        .video-section {
            display: none;
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
        
        .audio-only .video-wrapper video {
            display: none;
        }
        
        .audio-only .video-wrapper {
            background: #4a5568;
            border-radius: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 200px;
        }
        
        .audio-only .video-wrapper::before {
            content: "🎤 Аудио звонок";
            color: white;
            font-size: 24px;
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
        
        .loader {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            display: inline-block;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .hidden {
            display: none;
        }
        
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            border-bottom: 2px solid #f0f0f0;
            padding-bottom: 10px;
        }
        
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border-radius: 8px 8px 0 0;
            transition: all 0.3s;
        }
        
        .tab:hover {
            background: #f0f0f0;
        }
        
        .tab.active {
            background: #667eea;
            color: white;
        }
        
        .api-docs {
            background: #1a202c;
            color: #a0aec0;
            padding: 20px;
            border-radius: 10px;
            font-family: monospace;
            margin-top: 20px;
        }
        
        .api-docs h3 {
            color: white;
            margin-bottom: 15px;
        }
        
        .api-endpoint {
            margin: 10px 0;
            padding: 10px;
            background: #2d3748;
            border-radius: 5px;
        }
        
        .method {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-weight: bold;
            margin-right: 10px;
        }
        
        .method.get { background: #48bb78; color: white; }
        .method.post { background: #4299e1; color: white; }
        .method.put { background: #ed8936; color: white; }
        .method.delete { background: #f56565; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📹 Видео и Аудио звонки</h1>
        
        <div class="main-panel">
            <!-- Боковая панель -->
            <div class="sidebar">
                <h2>👤 Пользователь</h2>
                <div class="user-info">
                    <input type="text" id="userName" placeholder="Ваше имя" value="Пользователь">
                    <div class="call-type-selector">
                        <button class="call-type-btn active" onclick="setCallType('video')" id="typeVideoBtn">📹 Видео</button>
                        <button class="call-type-btn" onclick="setCallType('audio')" id="typeAudioBtn">🎤 Аудио</button>
                    </div>
                </div>
                
                <h2>📋 Активные комнаты</h2>
                <div class="room-list" id="roomList">
                    <div class="room-item" onclick="joinRoomFromList('default')">
                        <div class="room-name">default</div>
                        <div class="room-type">📹 Видео комната</div>
                        <div class="participants">👥 0 участников</div>
                    </div>
                </div>
                
                <h2>📊 Статус</h2>
                <div id="sidebarStatus" class="status-message info">Подключение...</div>
                
                <h2>🔧 API</h2>
                <button onclick="showApiDocs()" class="btn-warning" style="width: 100%;">📚 Показать документацию API</button>
            </div>
            
            <!-- Основной контент -->
            <div class="main-content">
                <!-- Вкладки -->
                <div class="tabs">
                    <div class="tab active" onclick="switchTab('call')" id="tabCall">📞 Звонок</div>
                    <div class="tab" onclick="switchTab('api')" id="tabApi">🔌 API тестер</div>
                </div>
                
                <!-- Вкладка звонка -->
                <div id="callTab">
                    <div class="setup-section" id="setupSection">
                        <div class="room-controls">
                            <input type="text" id="roomInput" placeholder="Название комнаты" value="room1">
                            <select id="callTypeSelect">
                                <option value="video">📹 Видеозвонок</option>
                                <option value="audio">🎤 Аудиозвонок</option>
                            </select>
                            <button onclick="joinRoom()" class="btn-primary" id="joinBtn">
                                <span id="joinBtnText">🔗 Подключиться</span>
                                <span id="joinBtnLoader" class="loader hidden"></span>
                            </button>
                        </div>
                        <div id="setupStatus" class="status-message"></div>
                    </div>
                    
                    <div class="video-section" id="videoSection">
                        <div class="video-container" id="videoContainer">
                            <div class="video-wrapper">
                                <div class="video-label" id="localLabel">Вы</div>
                                <video id="localVideo" autoplay playsinline muted></video>
                            </div>
                            <div class="video-wrapper">
                                <div class="video-label" id="remoteLabel">Собеседник</div>
                                <video id="remoteVideo" autoplay playsinline></video>
                            </div>
                        </div>
                        
                        <div class="controls">
                            <button onclick="toggleAudio()" class="btn-success" id="audioBtn">🔊 Выключить микрофон</button>
                            <button onclick="toggleVideo()" class="btn-success" id="videoBtn" style="display: none;">📹 Выключить камеру</button>
                            <button onclick="testConnection()" class="btn-warning">🔧 Тест соединения</button>
                            <button onclick="hangUp()" class="btn-danger">📞 Завершить звонок</button>
                        </div>
                        
                        <div id="callStatus" class="status-message"></div>
                    </div>
                </div>
                
                <!-- Вкладка API тестера -->
                <div id="apiTab" style="display: none;">
                    <h3>🔌 Тестирование API</h3>
                    
                    <div class="room-controls" style="margin-bottom: 20px;">
                        <select id="apiMethod">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                        </select>
                        <input type="text" id="apiEndpoint" placeholder="/api/status" value="/api/status">
                        <button onclick="testApi()" class="btn-primary">Отправить</button>
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <textarea id="apiBody" placeholder="JSON тело запроса (для POST/PUT)" rows="5" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #e0e0e0;"></textarea>
                    </div>
                    
                    <div id="apiResponse" style="background: #1a202c; color: #a0aec0; padding: 20px; border-radius: 10px; font-family: monospace; white-space: pre-wrap; min-height: 200px;">
                        Ответ появится здесь...
                    </div>
                    
                    <!-- Документация API -->
                    <div class="api-docs" id="apiDocs" style="display: none;">
                        <h3>📚 Документация API</h3>
                        
                        <div class="api-endpoint">
                            <span class="method get">GET</span> /api/status - Статус сервера
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method get">GET</span> /api/rooms - Список комнат
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method get">GET</span> /api/rooms/:roomId - Информация о комнате
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method post">POST</span> /api/rooms - Создать комнату
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method put">PUT</span> /api/rooms/:roomId - Обновить комнату
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method delete">DELETE</span> /api/rooms/:roomId - Удалить комнату
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method get">GET</span> /api/users/:socketId - Информация о пользователе
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method get">GET</span> /api/calls/history - История звонков
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method get">GET</span> /api/calls/active - Активные звонки
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method post">POST</span> /api/calls/start - Инициировать звонок
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method post">POST</span> /api/calls/end/:callId - Завершить звонок
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method get">GET</span> /api/stats - Статистика сервера
                        </div>
                        
                        <div class="api-endpoint">
                            <span class="method post">POST</span> /api/webhook/:event - Webhook для внешних сервисов
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        // Глобальные переменные
        const socket = io({
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000
        });
        
        let localStream = null;
        let peerConnection = null;
        let currentRoom = null;
        let currentCallType = 'video';
        let isAudioEnabled = true;
        let isVideoEnabled = true;
        let userName = 'Пользователь';
        let mySocketId = null;
        
        // Конфигурация ICE
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
        
        // ============= Вспомогательные функции =============
        function updateStatus(elementId, message, type) {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = message;
                element.className = 'status-message ' + type;
            }
            console.log(\`[\${type}] \${message}\`);
        }
        
        function setCallType(type) {
            currentCallType = type;
            document.getElementById('typeVideoBtn').classList.toggle('active', type === 'video');
            document.getElementById('typeAudioBtn').classList.toggle('active', type === 'audio');
            document.getElementById('callTypeSelect').value = type;
            
            // Показываем/скрываем кнопку видео
            document.getElementById('videoBtn').style.display = type === 'video' ? 'inline-block' : 'none';
            
            // Обновляем класс контейнера
            const container = document.getElementById('videoContainer');
            if (type === 'audio') {
                container.classList.add('audio-only');
            } else {
                container.classList.remove('audio-only');
            }
        }
        
        // ============= API функции =============
        async function testApi() {
            const method = document.getElementById('apiMethod').value;
            let endpoint = document.getElementById('apiEndpoint').value;
            const body = document.getElementById('apiBody').value;
            
            // Добавляем базовый URL если нужно
            if (!endpoint.startsWith('http')) {
                endpoint = window.location.origin + endpoint;
            }
            
            const options = {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            if ((method === 'POST' || method === 'PUT') && body) {
                options.body = body;
            }
            
            try {
                const response = await fetch(endpoint, options);
                const data = await response.json();
                
                document.getElementById('apiResponse').innerHTML = JSON.stringify(data, null, 2);
            } catch (err) {
                document.getElementById('apiResponse').innerHTML = '❌ Ошибка: ' + err.message;
            }
        }
        
        function showApiDocs() {
            const docs = document.getElementById('apiDocs');
            docs.style.display = docs.style.display === 'none' ? 'block' : 'none';
        }
        
        function switchTab(tab) {
            const callTab = document.getElementById('callTab');
            const apiTab = document.getElementById('apiTab');
            const tabCall = document.getElementById('tabCall');
            const tabApi = document.getElementById('tabApi');
            
            if (tab === 'call') {
                callTab.style.display = 'block';
                apiTab.style.display = 'none';
                tabCall.classList.add('active');
                tabApi.classList.remove('active');
            } else {
                callTab.style.display = 'none';
                apiTab.style.display = 'block';
                tabCall.classList.remove('active');
                tabApi.classList.add('active');
            }
        }
        
        // ============= Обновление списка комнат =============
        async function updateRoomList() {
            try {
                const response = await fetch('/api/rooms');
                const data = await response.json();
                
                const roomList = document.getElementById('roomList');
                roomList.innerHTML = '';
                
                data.rooms.forEach(room => {
                    const type = room.roomInfo?.type || 'video';
                    const typeIcon = type === 'video' ? '📹' : '🎤';
                    
                    const roomItem = document.createElement('div');
                    roomItem.className = 'room-item';
                    roomItem.onclick = () => joinRoomFromList(room.roomId);
                    roomItem.innerHTML = \`
                        <div class="room-name">\${room.roomId}</div>
                        <div class="room-type">\${typeIcon} \${type === 'video' ? 'Видео' : 'Аудио'} комната</div>
                        <div class="participants">👥 \${room.participants} участников</div>
                    \`;
                    
                    roomList.appendChild(roomItem);
                });
                
                updateStatus('sidebarStatus', \`✅ Онлайн: \${data.total} комнат\`, 'success');
            } catch (err) {
                updateStatus('sidebarStatus', '❌ Ошибка загрузки', 'error');
            }
        }
        
        function joinRoomFromList(roomId) {
            document.getElementById('roomInput').value = roomId;
            joinRoom();
        }
        
        // ============= WebRTC функции =============
        async function testConnection() {
            updateStatus('callStatus', '🔄 Тестирование соединения...', 'info');
            
            try {
                const testPC = new RTCPeerConnection(configuration);
                let candidates = [];
                
                testPC.onicecandidate = (event) => {
                    if (event.candidate) {
                        candidates.push(event.candidate.candidate);
                    }
                };
                
                // Создаем тестовый поток
                const constraints = currentCallType === 'video' 
                    ? { video: true, audio: true }
                    : { audio: true };
                
                const testStream = await navigator.mediaDevices.getUserMedia(constraints)
                    .catch(() => null);
                
                if (testStream) {
                    testStream.getTracks().forEach(track => track.stop());
                }
                
                // Ждем кандидатов
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                if (candidates.length > 0) {
                    updateStatus('callStatus', \`✅ Найдено \${candidates.length} ICE кандидатов\`, 'success');
                } else {
                    updateStatus('callStatus', '⚠️ Нет ICE кандидатов', 'warning');
                }
                
                testPC.close();
                
            } catch (err) {
                updateStatus('callStatus', '❌ Ошибка: ' + err.message, 'error');
            }
        }
        
        async function joinRoom() {
            const roomId = document.getElementById('roomInput').value.trim();
            const callType = document.getElementById('callTypeSelect').value;
            
            if (!roomId) {
                alert('Введите название комнаты');
                return;
            }
            
            setCallType(callType);
            
            document.getElementById('joinBtn').disabled = true;
            document.getElementById('joinBtnText').classList.add('hidden');
            document.getElementById('joinBtnLoader').classList.remove('hidden');
            
            updateStatus('setupStatus', 'Запрос доступа к устройствам...', 'info');
            
            try {
                // Запрашиваем доступ в зависимости от типа звонка
                const constraints = callType === 'video' 
                    ? { 
                        video: {
                            width: { ideal: 640 },
                            height: { ideal: 480 },
                            frameRate: { ideal: 30 }
                        }, 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true
                        }
                    }
                    : { 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        } 
                    };
                
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
                
                // Обновляем интерфейс
                const localVideo = document.getElementById('localVideo');
                if (callType === 'video') {
                    localVideo.srcObject = localStream;
                } else {
                    // Для аудио показываем заглушку
                    localVideo.srcObject = null;
                }
                
                // Сохраняем имя пользователя
                userName = document.getElementById('userName').value.trim() || 'Пользователь';
                
                // Отправляем информацию о пользователе на сервер
                if (mySocketId) {
                    await fetch(\`/api/users/\${mySocketId}\`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            name: userName,
                            type: callType,
                            joinedAt: new Date().toISOString()
                        })
                    });
                }
                
                currentRoom = roomId;
                socket.emit('join-room', { roomId, userInfo: { name: userName, type: callType } });
                
            } catch (err) {
                updateStatus('setupStatus', 'Ошибка: ' + err.message, 'error');
                
                document.getElementById('joinBtn').disabled = false;
                document.getElementById('joinBtnText').classList.remove('hidden');
                document.getElementById('joinBtnLoader').classList.add('hidden');
            }
        }
        
        function createPeerConnection(peerId) {
            const pc = new RTCPeerConnection(configuration);
            
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    pc.addTrack(track, localStream);
                });
            }
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', {
                        target: peerId,
                        candidate: event.candidate
                    });
                }
            };
            
            pc.oniceconnectionstatechange = () => {
                console.log('ICE состояние:', pc.iceConnectionState);
                if (pc.iceConnectionState === 'connected') {
                    updateStatus('callStatus', '✅ Соединение установлено', 'success');
                    
                    // Отправляем информацию о начале звонка
                    fetch('/api/calls/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            roomId: currentRoom,
                            callerId: mySocketId,
                            type: currentCallType
                        })
                    });
                }
            };
            
            pc.ontrack = (event) => {
                console.log('Получен удаленный трек');
                const remoteVideo = document.getElementById('remoteVideo');
                remoteVideo.srcObject = event.streams[0];
            };
            
            return pc;
        }
        
        // ============= События сокета =============
        socket.on('connect', () => {
            mySocketId = socket.id;
            updateStatus('setupStatus', '✅ Подключено к серверу', 'success');
            updateRoomList();
            setInterval(updateRoomList, 5000);
        });
        
        socket.on('join-success', (data) => {
            console.log('Подключились к комнате:', data);
            
            document.getElementById('setupSection').style.display = 'none';
            document.getElementById('videoSection').style.display = 'block';
            
            updateStatus('callStatus', '🟡 Ожидание собеседника...', 'info');
            
            document.getElementById('joinBtn').disabled = false;
            document.getElementById('joinBtnText').classList.remove('hidden');
            document.getElementById('joinBtnLoader').classList.add('hidden');
        });
        
        socket.on('peer-joined', async (peerId) => {
            console.log('Собеседник подключился:', peerId);
            updateStatus('callStatus', '🟡 Собеседник найден, соединение...', 'info');
            
            try {
                await new Promise(resolve => setTimeout(resolve, 500));
                
                peerConnection = createPeerConnection(peerId);
                
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: currentCallType === 'video'
                });
                
                await peerConnection.setLocalDescription(offer);
                
                socket.emit('offer', {
                    target: peerId,
                    offer: offer
                });
                
            } catch (err) {
                updateStatus('callStatus', 'Ошибка: ' + err.message, 'error');
            }
        });
        
        socket.on('offer', async ({ offer, sender }) => {
            console.log('Получен оффер');
            updateStatus('callStatus', '🟡 Получен запрос на соединение...', 'info');
            
            try {
                if (!peerConnection) {
                    peerConnection = createPeerConnection(sender);
                }
                
                await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                socket.emit('answer', {
                    target: sender,
                    answer: answer
                });
                
            } catch (err) {
                updateStatus('callStatus', 'Ошибка: ' + err.message, 'error');
            }
        });
        
        socket.on('answer', async ({ answer }) => {
            console.log('Получен ответ');
            try {
                if (peerConnection && !peerConnection.currentRemoteDescription) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                }
            } catch (err) {
                console.error('Ошибка:', err);
            }
        });
        
        socket.on('ice-candidate', async ({ candidate }) => {
            console.log('Получен ICE кандидат');
            if (peerConnection) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error('Ошибка:', err);
                }
            }
        });
        
        socket.on('peer-disconnected', () => {
            console.log('Собеседник отключился');
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
        
        // ============= Управление звонком =============
        function toggleAudio() {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    isAudioEnabled = audioTrack.enabled;
                    document.getElementById('audioBtn').innerHTML = isAudioEnabled ? 
                        '🔊 Выключить микрофон' : '🔇 Включить микрофон';
                }
            }
        }
        
        function toggleVideo() {
            if (localStream && currentCallType === 'video') {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    isVideoEnabled = videoTrack.enabled;
                    document.getElementById('videoBtn').innerHTML = isVideoEnabled ? 
                        '📹 Выключить камеру' : '📹 Включить камеру';
                }
            }
        }
        
        function hangUp() {
            // Завершаем звонок через API
            if (currentRoom && mySocketId) {
                // Ищем активный звонок (в реальном приложении нужно передавать callId)
                fetch('/api/calls/active')
                    .then(res => res.json())
                    .then(data => {
                        const myCall = data.calls.find(call => 
                            call.roomId === currentRoom && 
                            call.participants.includes(mySocketId)
                        );
                        if (myCall) {
                            fetch(\`/api/calls/end/\${myCall.callId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ endedBy: mySocketId })
                            });
                        }
                    })
                    .catch(err => console.error('Ошибка при завершении звонка:', err));
            }
            
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
        
        // ============= Вспомогательные функции =============
        function generateCallId() {
            return 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        
        function calculateDuration(startTime) {
            const start = new Date(startTime);
            const now = new Date();
            const diff = Math.floor((now - start) / 1000);
            const minutes = Math.floor(diff / 60);
            const seconds = diff % 60;
            return \`\${minutes}:\${seconds.toString().padStart(2, '0')}\`;
        }
        
        function getTodayCallsCount() {
            const today = new Date().toDateString();
            let count = 0;
            for (const [_, call] of callHistory) {
                if (new Date(call.startTime).toDateString() === today) {
                    count++;
                }
            }
            return count;
        }
    </script>
</body>
</html>
  `);
});

// ============= Socket.IO обработчики =============
io.on('connection', (socket) => {
  console.log('👤 Пользователь подключился:', socket.id);
  
  // Сохраняем информацию о пользователе
  users.set(socket.id, {
    connectedAt: new Date().toISOString(),
    socketId: socket.id
  });

  socket.on('join-room', ({ roomId, userInfo }) => {
    console.log(\`📢 \${socket.id} подключается к комнате: \${roomId}\`);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    
    if (room.size >= 2) {
      console.log(\`❌ Комната \${roomId} переполнена\`);
      socket.emit('room-full');
      return;
    }
    
    room.add(socket.id);
    socket.join(roomId);
    
    // Обновляем информацию о пользователе
    const userData = users.get(socket.id) || {};
    users.set(socket.id, { ...userData, ...userInfo, roomId, joinedAt: new Date().toISOString() });
    
    // Обновляем информацию о комнате
    if (!roomsInfo.has(roomId)) {
      roomsInfo.set(roomId, {
        name: roomId,
        createdAt: new Date().toISOString(),
        createdBy: socket.id,
        type: userInfo?.type || 'video'
      });
    }
    
    console.log(\`✅ \${socket.id} подключился к \${roomId}. Участников: \${room.size}\`);
    
    socket.emit('join-success', { roomId, participants: Array.from(room) });
    
    if (room.size > 1) {
      io.to(roomId).emit('peer-joined', socket.id);
    }
    
    // Обновляем списки комнат для всех
    io.emit('rooms-updated');
  });

  socket.on('offer', (data) => {
    console.log(\`📤 Оффер от \${socket.id} к \${data.target}\`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    console.log(\`📤 Ответ от \${socket.id} к \${data.target}\`);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log(\`📤 ICE кандидат от \${socket.id} к \${data.target}\`);
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
      roomsInfo.delete(roomId);
    }
    
    console.log(\`👋 \${socket.id} покинул комнату \${roomId}\`);
  }
  
  // Удаляем пользователя
  users.delete(socket.id);
  
  // Обновляем списки
  io.emit('rooms-updated');
}

// ============= Вспомогательные функции =============
function generateCallId() {
  return 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function calculateDuration(startTime) {
  const start = new Date(startTime);
  const now = new Date();
  const diff = Math.floor((now - start) / 1000);
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  return \`\${minutes}:\${seconds.toString().padStart(2, '0')}\`;
}

function getTodayCallsCount() {
  const today = new Date().toDateString();
  let count = 0;
  for (const [_, call] of callHistory) {
    if (new Date(call.startTime).toDateString() === today) {
      count++;
    }
  }
  return count;
}

// ============= Запуск сервера =============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Сервер запущен на порту ' + PORT);
  console.log('📱 Веб-интерфейс: http://localhost:' + PORT);
  console.log('🔌 API Endpoint: http://localhost:' + PORT + '/api');
  console.log('📚 Документация API доступна в веб-интерфейсе');
  console.log('='.repeat(60) + '\n');
});
