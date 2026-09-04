const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const WIN_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function checkWin(board) {
  for (const combo of WIN_COMBOS) {
    const [a,b,c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], combo };
    }
  }
  return null;
}

function checkDraw(board) {
  return board.every(cell => cell !== '');
}

io.on('connection', (socket) => {
  console.log(`Jugador conectado: ${socket.id}`);

  socket.on('create-room', (playerName, callback) => {
    let code;
    do { code = generateCode(); } while (rooms[code]);

    rooms[code] = {
      players: [{ id: socket.id, name: playerName, mark: 'X' }],
      board: Array(9).fill(''),
      currentTurn: 'X',
      scores: { X: 0, O: 0, draws: 0 }
    };

    socket.join(code);
    socket.roomCode = code;
    callback({ code, mark: 'X', room: rooms[code] });
  });

  socket.on('join-room', (code, playerName, callback) => {
    code = code.toUpperCase().trim();
    const room = rooms[code];

    if (!room) return callback({ error: 'Sala no encontrada' });
    if (room.players.length >= 2) return callback({ error: 'Sala llena' });

    room.players.push({ id: socket.id, name: playerName, mark: 'O' });
    socket.join(code);
    socket.roomCode = code;

    callback({ code, mark: 'O', room });
    io.to(code).emit('game-start', {
      players: room.players,
      currentTurn: room.currentTurn,
      scores: room.scores
    });
  });

  socket.on('make-move', ({ index }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.mark !== room.currentTurn) return;
    if (room.board[index] !== '') return;

    room.board[index] = player.mark;
    io.to(code).emit('board-update', {
      board: room.board,
      lastMove: { index, mark: player.mark },
      currentTurn: room.currentTurn === 'X' ? 'O' : 'X'
    });

    room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';

    const result = checkWin(room.board);
    if (result) {
      room.scores[result.winner]++;
      io.to(code).emit('game-over', {
        winner: result.winner,
        combo: result.combo,
        scores: room.scores,
        players: room.players
      });
      room.board = Array(9).fill('');
      room.currentTurn = 'X';
      return;
    }

    if (checkDraw(room.board)) {
      room.scores.draws++;
      io.to(code).emit('game-over', {
        winner: null,
        combo: null,
        scores: room.scores,
        players: room.players
      });
      room.board = Array(9).fill('');
      room.currentTurn = 'X';
      return;
    }
  });

  socket.on('play-again', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.board = Array(9).fill('');
    room.currentTurn = 'X';
    io.to(code).emit('new-round', {
      board: room.board,
      currentTurn: room.currentTurn,
      scores: room.scores
    });
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const player = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      delete rooms[code];
    } else {
      io.to(code).emit('player-left', {
        name: player ? player.name : 'Jugador',
        players: room.players
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
