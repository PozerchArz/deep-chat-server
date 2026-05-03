const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

app.use(express.json());
// Отдача статических файлов (HTML, CSS, JS)
const path = require('path');
app.use(express.static('public'));

// Главная страница — отдаём index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let users = [];
let chats = [];
let onlineUsers = {};

app.post('/register', (req, res) => {
    const { nickname, password } = req.body;
    if (!nickname || !password) return res.status(400).json({ error: 'Нужен ник и пароль' });
    if (users.find(u => u.nickname.toLowerCase() === nickname.toLowerCase())) {
        return res.status(400).json({ error: 'Ник занят' });
    }
    const colors = ['#ff00ff', '#00ffff', '#ffaa00', '#ff4444', '#44ff44', '#ffff00'];
    const user = {
        id: crypto.randomUUID(),
        nickname,
        password: crypto.createHash('sha256').update(password).digest('hex'),
        avatarColor: colors[Math.floor(Math.random() * colors.length)],
        lastSeen: new Date()
    };
    users.push(user);
    res.json({ id: user.id, nickname: user.nickname, avatarColor: user.avatarColor });
});

app.post('/login', (req, res) => {
    const { nickname, password } = req.body;
    const hash = crypto.createHash('sha256').update(password || '').digest('hex');
    const user = users.find(u => u.nickname.toLowerCase() === (nickname||'').toLowerCase() && u.password === hash);
    if (!user) return res.status(401).json({ error: 'Неверный ник или пароль' });
    res.json({ id: user.id, nickname: user.nickname, avatarColor: user.avatarColor });
});

app.get('/users', (req, res) => {
    res.json(users.map(u => ({ id: u.id, nickname: u.nickname, avatarColor: u.avatarColor, online: !!onlineUsers[u.id] })));
});

io.on('connection', (socket) => {
    console.log('🔌', socket.id);
    let currentUser = null;

    socket.on('authenticate', (userId) => {
        const user = users.find(u => u.id === userId);
        if (!user) { socket.disconnect(); return; }
        currentUser = user;
        onlineUsers[user.id] = true;
        socket.userId = user.id;
        socket.join(user.id);
        io.emit('users:online', Object.keys(onlineUsers).length);
        io.emit('user:online', { id: user.id, online: true });
        const userChats = chats.filter(c => c.participants.includes(user.id));
        socket.emit('chats:list', userChats.map(c => {
            const other = users.find(u => u.id === c.participants.find(p => p !== user.id));
            const last = c.messages[c.messages.length - 1];
            return { id: other?.id, name: other?.nickname, avatarColor: other?.avatarColor, lastMessage: last?.text, lastTime: last?.time };
        }));
    });

    socket.on('message:send', (data) => {
        if (!currentUser) return;
        const { chatId, text } = data;
        if (!text || !text.trim()) return;
        let chat = chats.find(c => c.id === chatId);
        if (!chat) {
            const target = users.find(u => u.id === chatId);
            if (!target) return;
            chat = { id: crypto.randomUUID(), type: 'private', participants: [currentUser.id, target.id], messages: [] };
            chats.push(chat);
        }
        const msg = {
            id: crypto.randomUUID(),
            from: currentUser.id,
            fromNickname: currentUser.nickname,
            fromColor: currentUser.avatarColor,
            text: text.trim(),
            time: new Date().toISOString()
        };
        chat.messages.push(msg);
        chat.participants.forEach(pid => io.to(pid).emit('message:new', { chatId: chat.id, message: msg }));
    });

    socket.on('typing:start', (chatId) => {
        if (!currentUser) return;
        const chat = chats.find(c => c.id === chatId);
        if (chat) chat.participants.forEach(p => { if (p !== currentUser.id) io.to(p).emit('typing:start', { chatId }); });
    });

    socket.on('typing:stop', (chatId) => {
        if (!currentUser) return;
        const chat = chats.find(c => c.id === chatId);
        if (chat) chat.participants.forEach(p => { if (p !== currentUser.id) io.to(p).emit('typing:stop', { chatId }); });
    });

    socket.on('disconnect', () => {
        if (currentUser) { delete onlineUsers[currentUser.id]; io.emit('users:online', Object.keys(onlineUsers).length); }
        console.log('🔌', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('🚀 Deep Chat на порту', PORT));
