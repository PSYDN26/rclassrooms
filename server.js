const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const roomState = {
  tools: {
    studentAnnotationEnabled: false,
    studentWhiteboardEnabled: false,
  },
  pdfDataUrl: null,
  users: {},
};

function getTeacherSocketId() {
  return Object.entries(roomState.users).find(([, user]) => user.role === 'teacher')?.[0] || null;
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ name, role }) => {
    const normalizedRole = ['teacher', 'student', 'admin'].includes(role) ? role : 'admin';

    if (normalizedRole === 'teacher' && getTeacherSocketId() && getTeacherSocketId() !== socket.id) {
      socket.emit('join-error', { message: 'Teacher is already connected. Use student/admin instead.' });
      return;
    }

    roomState.users[socket.id] = {
      id: socket.id,
      name: name || `${normalizedRole}-${socket.id.slice(0, 4)}`,
      role: normalizedRole,
    };

    socket.emit('room-state', {
      tools: roomState.tools,
      pdfDataUrl: roomState.pdfDataUrl,
      users: Object.values(roomState.users),
    });

    io.emit('users-updated', Object.values(roomState.users));
  });

  socket.on('set-tools', (toolsUpdate) => {
    const requester = roomState.users[socket.id];
    if (!requester || requester.role !== 'teacher') return;

    roomState.tools = {
      ...roomState.tools,
      ...toolsUpdate,
    };

    io.emit('tools-updated', roomState.tools);
  });

  socket.on('set-pdf', ({ dataUrl }) => {
    const requester = roomState.users[socket.id];
    if (!requester || requester.role !== 'teacher') return;

    roomState.pdfDataUrl = dataUrl;
    io.emit('pdf-updated', { dataUrl });
  });

  socket.on('draw', (payload) => {
    const user = roomState.users[socket.id];
    if (!user) return;

    if (payload.board === 'pdf') {
      if (user.role === 'student' && !roomState.tools.studentAnnotationEnabled) return;
      if (user.role === 'admin') return;
    }

    if (payload.board === 'whiteboard') {
      if (user.role === 'student' && !roomState.tools.studentWhiteboardEnabled) return;
      if (user.role === 'admin') return;
    }

    socket.broadcast.emit('draw', {
      ...payload,
      userId: socket.id,
      role: user.role,
      name: user.name,
    });
  });

  socket.on('clear-board', ({ board }) => {
    const user = roomState.users[socket.id];
    if (!user || user.role !== 'teacher') return;

    io.emit('clear-board', { board });
  });

  socket.on('signal', (payload) => {
    const user = roomState.users[socket.id];
    if (!user || user.role === 'admin') return;

    const target = roomState.users[payload.target];
    if (!target || target.role === 'admin') return;

    io.to(payload.target).emit('signal', {
      from: socket.id,
      data: payload.data,
    });
  });

  socket.on('disconnect', () => {
    delete roomState.users[socket.id];
    io.emit('users-updated', Object.values(roomState.users));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Live classroom running at http://localhost:${PORT}`);
});
