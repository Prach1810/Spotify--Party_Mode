const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://127.0.0.1:3001",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Spotify API configuration
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

// In-memory storage for active sessions and votes
const activeSessions = new Map();
const songVotes = new Map();

// Spotify authentication endpoints
app.get('/auth/spotify', (req, res) => {
  const scopes = [
    'user-read-private',
    'user-read-email',
    'playlist-read-private',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-modify-playback-state',
    'user-read-playback-state',
    'user-read-currently-playing'
  ];
  
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authorizeURL);
});

app.get('/auth/spotify/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    
    // Get user info
    const user = await spotifyApi.getMe();
    // Encode user info as base64 to avoid URL issues
    const userBase64 = Buffer.from(JSON.stringify(user.body)).toString('base64');
    // Redirect to main page with tokens and user info in fragment
    res.redirect(`/#accessToken=${encodeURIComponent(access_token)}&refreshToken=${encodeURIComponent(refresh_token)}&user=${encodeURIComponent(userBase64)}`);
  } catch (error) {
    console.error('Error getting tokens:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Create a new jam session
app.post('/api/session/create', async (req, res) => {
  try {
    const { accessToken, playlistId, sessionName, username, userId } = req.body;
    if (!accessToken) {
      return res.status(401).json({ error: 'Access token required' });
    }
    spotifyApi.setAccessToken(accessToken);
    const sessionId = require('uuid').v4();
    const session = {
      id: sessionId,
      name: sessionName || 'New Jam Session',
      playlistId,
      accessToken,
      createdAt: new Date(),
      dj: { username, userId }, // DJ info
      participants: [],
      currentSong: null,
      queue: [],
      pendingRequests: [] // Song requests awaiting DJ approval
    };
    activeSessions.set(sessionId, session);
    // Get playlist tracks
    if (playlistId) {
      const playlist = await spotifyApi.getPlaylist(playlistId);
      session.queue = playlist.body.tracks.items.map(item => ({
        id: item.track.id,
        name: item.track.name,
        artist: item.track.artists[0].name,
        album: item.track.album.name,
        duration: item.track.duration_ms,
        uri: item.track.uri,
        votes: 0
      }));
    }
    res.json({ sessionId, session });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Join a jam session
app.post('/api/session/join', (req, res) => {
  const { sessionId, username } = req.body;
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (!session.participants.find(p => p.username === username)) {
    session.participants.push({ username, joinedAt: new Date() });
  }
  
  res.json({ session });
});

// Get session info
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({ session });
});

// Vote for a song
app.post('/api/session/:sessionId/vote', (req, res) => {
  const { sessionId } = req.params;
  const { songId, username, voteType } = req.body; // voteType: 'up' or 'down'
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const song = session.queue.find(s => s.id === songId);
  if (!song) {
    return res.status(404).json({ error: 'Song not found' });
  }
  
  // Initialize vote tracking for this song if not exists
  if (!songVotes.has(songId)) {
    songVotes.set(songId, new Map());
  }
  
  const songVoteMap = songVotes.get(songId);
  const userVote = songVoteMap.get(username);
  
  // Handle vote logic
  if (voteType === 'up') {
    if (userVote === 'up') {
      // Remove upvote
      songVoteMap.delete(username);
      song.votes--;
    } else if (userVote === 'down') {
      // Change downvote to upvote
      songVoteMap.set(username, 'up');
      song.votes += 2;
    } else {
      // Add upvote
      songVoteMap.set(username, 'up');
      song.votes++;
    }
  } else if (voteType === 'down') {
    if (userVote === 'down') {
      // Remove downvote
      songVoteMap.delete(username);
      song.votes++;
    } else if (userVote === 'up') {
      // Change upvote to downvote
      songVoteMap.set(username, 'down');
      song.votes -= 2;
    } else {
      // Add downvote
      songVoteMap.set(username, 'down');
      song.votes--;
    }
  }
  
  // Emit real-time update to all connected clients
  io.to(sessionId).emit('voteUpdate', {
    songId,
    votes: song.votes,
    userVotes: Object.fromEntries(songVoteMap)
  });
  
  res.json({ success: true, song });
});

// Search for songs to add to queue
app.get('/api/search', async (req, res) => {
  try {
    const { query, accessToken } = req.query;
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Access token required' });
    }
    
    spotifyApi.setAccessToken(accessToken);
    
    const results = await spotifyApi.searchTracks(query, { limit: 10 });
    
    const tracks = results.body.tracks.items.map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists[0].name,
      album: track.album.name,
      duration: track.duration_ms,
      uri: track.uri,
      albumArt: track.album.images[0]?.url
    }));
    
    res.json({ tracks });
  } catch (error) {
    console.error('Error searching tracks:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Add song to queue
app.post('/api/session/:sessionId/add-song', (req, res) => {
  const { sessionId } = req.params;
  const { song } = req.body;
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  // Add song to queue with 0 votes
  const newSong = {
    ...song,
    votes: 0
  };
  
  session.queue.push(newSong);
  
  // Emit real-time update
  io.to(sessionId).emit('queueUpdate', { queue: session.queue });
  
  res.json({ success: true, song: newSong });
});

// Play next song (highest voted)
app.post('/api/session/:sessionId/play-next', async (req, res) => {
  const { sessionId } = req.params;
  const { accessToken } = req.body;
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  // Sort queue by votes (highest first)
  session.queue.sort((a, b) => b.votes - a.votes);
  
  const nextSong = session.queue[0];
  if (!nextSong) {
    return res.status(400).json({ error: 'No songs in queue' });
  }
  
  try {
    spotifyApi.setAccessToken(accessToken);
    await spotifyApi.play({ uris: [nextSong.uri] });
    
    // Remove song from queue
    session.queue.shift();
    session.currentSong = nextSong;
    
    // Emit real-time update
    io.to(sessionId).emit('songPlayed', { 
      currentSong: nextSong, 
      queue: session.queue 
    });
    
    res.json({ success: true, currentSong: nextSong });
  } catch (error) {
    console.error('Error playing song:', error);
    res.status(500).json({ error: 'Failed to play song' });
  }
});

// User submits a song request
app.post('/api/session/:sessionId/request-song', (req, res) => {
  const { sessionId } = req.params;
  const { song, requestedBy } = req.body; // song: { id, name, artist, uri }, requestedBy: { username, userId }
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.pendingRequests.push({ ...song, requestedBy });
  io.to(sessionId).emit('pendingRequestsUpdate', { pendingRequests: session.pendingRequests });
  res.json({ success: true });
});

// DJ fetches pending requests
app.get('/api/session/:sessionId/pending-requests', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ pendingRequests: session.pendingRequests });
});

// DJ approves a song request
app.post('/api/session/:sessionId/approve-request', (req, res) => {
  const { sessionId } = req.params;
  const { songId, userId } = req.body; // userId: DJ's userId
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.dj.userId !== userId) return res.status(403).json({ error: 'Only DJ can approve requests' });
  const idx = session.pendingRequests.findIndex(s => s.id === songId);
  if (idx === -1) return res.status(404).json({ error: 'Request not found' });
  const song = session.pendingRequests.splice(idx, 1)[0];
  session.queue.push({ ...song, votes: 0 });
  io.to(sessionId).emit('queueUpdate', { queue: session.queue });
  io.to(sessionId).emit('pendingRequestsUpdate', { pendingRequests: session.pendingRequests });
  res.json({ success: true });
});

// DJ denies a song request
app.post('/api/session/:sessionId/deny-request', (req, res) => {
  const { sessionId } = req.params;
  const { songId, userId } = req.body; // userId: DJ's userId
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.dj.userId !== userId) return res.status(403).json({ error: 'Only DJ can deny requests' });
  session.pendingRequests = session.pendingRequests.filter(s => s.id !== songId);
  io.to(sessionId).emit('pendingRequestsUpdate', { pendingRequests: session.pendingRequests });
  res.json({ success: true });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('joinSession', (sessionId) => {
    socket.join(sessionId);
    console.log(`User ${socket.id} joined session ${sessionId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 