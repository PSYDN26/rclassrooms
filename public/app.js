const socket = io();

const joinPanel = document.getElementById('join-panel');
const app = document.getElementById('app');
const nameInput = document.getElementById('name-input');
const roleInput = document.getElementById('role-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const whoami = document.getElementById('whoami');
const permissionStatus = document.getElementById('permission-status');
const teacherControls = document.getElementById('teacher-controls');
const toggleAnnotation = document.getElementById('toggle-annotation');
const toggleWhiteboard = document.getElementById('toggle-whiteboard');
const usersList = document.getElementById('users');
const tabs = [...document.querySelectorAll('.tab')];
const panels = [...document.querySelectorAll('.tab-panel')];
const clearPdfBtn = document.getElementById('clear-pdf');
const clearWhiteboardBtn = document.getElementById('clear-whiteboard');
const pdfUpload = document.getElementById('pdf-upload');
const pdfFrame = document.getElementById('pdf-frame');
const videoWrap = document.getElementById('videos');

const pdfCanvas = document.getElementById('pdf-canvas');
const whiteboardCanvas = document.getElementById('whiteboard-canvas');
const pdfCtx = pdfCanvas.getContext('2d');
const whiteboardCtx = whiteboardCanvas.getContext('2d');

let me = { role: 'admin', name: 'guest' };
let tools = {
  studentAnnotationEnabled: false,
  studentWhiteboardEnabled: false,
};
let participants = [];

const peers = new Map();
let localStream;

function resizeCanvas(canvas, ctx) {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = bounds.width * ratio;
  canvas.height = bounds.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ef4444';
}

function setPermissionText() {
  const canAnnotate = me.role === 'teacher' || (me.role === 'student' && tools.studentAnnotationEnabled);
  const canWhiteboard = me.role === 'teacher' || (me.role === 'student' && tools.studentWhiteboardEnabled);

  permissionStatus.textContent = `PDF annotate: ${canAnnotate ? 'enabled' : 'disabled'} | Whiteboard: ${canWhiteboard ? 'enabled' : 'disabled'}`;
}

function redrawUsers() {
  usersList.innerHTML = '';
  participants.forEach((user) => {
    const li = document.createElement('li');
    li.textContent = `${user.name} (${user.role})`;
    usersList.appendChild(li);
  });
}

function canDraw(board) {
  if (me.role === 'admin') return false;
  if (me.role === 'teacher') return true;
  if (board === 'pdf') return tools.studentAnnotationEnabled;
  if (board === 'whiteboard') return tools.studentWhiteboardEnabled;
  return false;
}

function setupDraw(canvas, ctx, board) {
  let drawing = false;
  let prev;

  function point(evt) {
    const r = canvas.getBoundingClientRect();
    return { x: evt.clientX - r.left, y: evt.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (evt) => {
    if (!canDraw(board)) return;
    drawing = true;
    prev = point(evt);
  });

  canvas.addEventListener('pointerup', () => {
    drawing = false;
  });

  canvas.addEventListener('pointerleave', () => {
    drawing = false;
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (!drawing || !prev || !canDraw(board)) return;

    const curr = point(evt);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();

    socket.emit('draw', { board, from: prev, to: curr });
    prev = curr;
  });
}

function applyRemoteDraw({ board, from, to }) {
  const ctx = board === 'pdf' ? pdfCtx : whiteboardCtx;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function clearBoard(board) {
  if (board === 'pdf') {
    const { width, height } = pdfCanvas.getBoundingClientRect();
    pdfCtx.clearRect(0, 0, width, height);
  } else {
    const { width, height } = whiteboardCanvas.getBoundingClientRect();
    whiteboardCtx.clearRect(0, 0, width, height);
  }
}

function createVideoRow(id, labelText) {
  const row = document.createElement('div');
  row.className = 'video-row';
  row.dataset.peer = id;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;

  const label = document.createElement('span');
  label.textContent = labelText;

  row.appendChild(video);
  row.appendChild(label);
  videoWrap.appendChild(row);

  return video;
}

async function initLocalMedia() {
  if (me.role === 'admin') {
    videoWrap.innerHTML = '<p>Admin spectator mode: audio/video disabled.</p>';
    return;
  }

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const myVideo = createVideoRow('local', `${me.name} (you)`);
  myVideo.muted = true;
  myVideo.srcObject = localStream;
}

function makePeerConnection(targetId, isInitiator) {
  if (peers.has(targetId) || !localStream) return;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  const remoteVideo = createVideoRow(targetId, `Peer ${targetId.slice(0, 4)}`);

  pc.ontrack = (event) => {
    [remoteVideo.srcObject] = event.streams;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { target: targetId, data: { candidate: event.candidate } });
    }
  };

  peers.set(targetId, { pc, remoteVideo });

  if (isInitiator) {
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('signal', {
          target: targetId,
          data: { sdp: pc.localDescription },
        });
      });
  }
}

async function handleSignal({ from, data }) {
  if (me.role === 'admin') return;

  if (!peers.has(from)) {
    makePeerConnection(from, false);
  }

  const entry = peers.get(from);
  if (!entry) return;

  const { pc } = entry;

  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { target: from, data: { sdp: pc.localDescription } });
    }
  }

  if (data.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
}

joinBtn.addEventListener('click', async () => {
  me = {
    name: nameInput.value.trim() || 'Anonymous',
    role: roleInput.value,
  };

  socket.emit('join-room', me);
});

pdfUpload.addEventListener('change', async (evt) => {
  if (me.role !== 'teacher') return;
  const [file] = evt.target.files;
  if (!file) return;

  const dataUrl = await fileToDataUrl(file);
  socket.emit('set-pdf', { dataUrl });
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

toggleAnnotation.addEventListener('change', () => {
  socket.emit('set-tools', { studentAnnotationEnabled: toggleAnnotation.checked });
});

toggleWhiteboard.addEventListener('change', () => {
  socket.emit('set-tools', { studentWhiteboardEnabled: toggleWhiteboard.checked });
});

clearPdfBtn.addEventListener('click', () => socket.emit('clear-board', { board: 'pdf' }));
clearWhiteboardBtn.addEventListener('click', () => socket.emit('clear-board', { board: 'whiteboard' }));

tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabs.forEach((tab) => tab.classList.remove('active'));
    panels.forEach((panel) => panel.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

socket.on('join-error', ({ message }) => {
  joinError.textContent = message;
});

socket.on('room-state', async (state) => {
  tools = state.tools;
  participants = state.users;

  joinPanel.classList.add('hidden');
  app.classList.remove('hidden');

  whoami.textContent = `${me.name} (${me.role})`;
  redrawUsers();

  if (me.role === 'teacher') {
    teacherControls.classList.remove('hidden');
    clearPdfBtn.classList.remove('hidden');
    clearWhiteboardBtn.classList.remove('hidden');
  }

  toggleAnnotation.checked = tools.studentAnnotationEnabled;
  toggleWhiteboard.checked = tools.studentWhiteboardEnabled;
  setPermissionText();

  if (state.pdfDataUrl) {
    pdfFrame.src = state.pdfDataUrl;
  } else {
    pdfFrame.srcdoc = '<p style="padding:1rem">Teacher can upload a PDF file.</p>';
  }

  await initLocalMedia();

  if (me.role !== 'admin') {
    participants
      .filter((u) => u.id !== socket.id && u.role !== 'admin')
      .forEach((u) => makePeerConnection(u.id, true));
  }
});

socket.on('users-updated', (users) => {
  participants = users;
  redrawUsers();
});

socket.on('tools-updated', (updatedTools) => {
  tools = updatedTools;
  toggleAnnotation.checked = tools.studentAnnotationEnabled;
  toggleWhiteboard.checked = tools.studentWhiteboardEnabled;
  setPermissionText();
});

socket.on('pdf-updated', ({ dataUrl }) => {
  pdfFrame.src = dataUrl;
});

socket.on('draw', applyRemoteDraw);
socket.on('clear-board', ({ board }) => clearBoard(board));
socket.on('signal', handleSignal);

window.addEventListener('resize', () => {
  resizeCanvas(pdfCanvas, pdfCtx);
  resizeCanvas(whiteboardCanvas, whiteboardCtx);
});

resizeCanvas(pdfCanvas, pdfCtx);
resizeCanvas(whiteboardCanvas, whiteboardCtx);
setupDraw(pdfCanvas, pdfCtx, 'pdf');
setupDraw(whiteboardCanvas, whiteboardCtx, 'whiteboard');
