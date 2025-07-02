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

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const activeSessions = new Map();
const songVotes = new Map();

app.get('/auth/spotify', (req, res) => {
  const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  });
  const scopes = [
    'streaming',
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
  const { code, error } = req.query;
  if (error || !code) {
    console.error('Auth error:', error);
    return res.status(400).send('Spotify authentication failed.');
  }
  try {
    const spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI
    });
    const data = await spotifyApi.authorizationCodeGrant(code);
    const access_token = data.body.access_token;
    const refresh_token = data.body.refresh_token;
    spotifyApi.setAccessToken(access_token);

    const user = await spotifyApi.getMe();
    const userBase64 = Buffer.from(JSON.stringify(user.body)).toString('base64');

    res.redirect(`/#accessToken=${encodeURIComponent(access_token)}&refreshToken=${encodeURIComponent(refresh_token)}&user=${encodeURIComponent(userBase64)}`);
  } catch (err) {
    console.error('Token error:', err);
    res.status(500).send('Authentication failed');
  }
});

app.post('/api/session/create', async (req, res) => {
  try {
    const { accessToken, playlistId, sessionName, username, userId } = req.body;
    if (!accessToken) return res.status(401).json({ error: 'Access token required' });

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(accessToken);

    const sessionId = require('uuid').v4();
    const session = {
      id: sessionId,
      name: sessionName || 'New Jam Session',
      playlistId,
      accessToken,
      dj: { username, userId },
      participants: [],
      currentSong: null,
      queue: [],
      pendingRequests: [],
      songsPlayed: 0
    };

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

    activeSessions.set(sessionId, session);
    res.json({ sessionId, session });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.post('/api/session/join', (req, res) => {
  const { sessionId, username, userId } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.participants.some(p => p.userId === userId)) {
    session.participants.push({ username, userId, joinedAt: new Date() });
  }
  res.json({ session });
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ session });
});

app.post('/api/session/:sessionId/vote', (req, res) => {
  const { sessionId } = req.params;
  const { songId, username, voteType } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const song = session.queue.find(s => s.id === songId);
  if (!song) return res.status(404).json({ error: 'Song not found' });

  if (!songVotes.has(songId)) songVotes.set(songId, new Map());
  const voteMap = songVotes.get(songId);
  const prevVote = voteMap.get(username);

  if (voteType === 'up') {
    if (prevVote === 'up') { voteMap.delete(username); song.votes--; }
    else if (prevVote === 'down') { voteMap.set(username, 'up'); song.votes += 2; }
    else { voteMap.set(username, 'up'); song.votes++; }
  } else {
    if (prevVote === 'down') { voteMap.delete(username); song.votes++; }
    else if (prevVote === 'up') { voteMap.set(username, 'down'); song.votes -= 2; }
    else { voteMap.set(username, 'down'); song.votes--; }
  }

  io.to(sessionId).emit('voteUpdate', { songId, votes: song.votes, userVotes: Object.fromEntries(voteMap) });
  res.json({ success: true, song });
});

app.get('/api/search', async (req, res) => {
  try {
    const { query, accessToken } = req.query;
    if (!accessToken) return res.status(401).json({ error: 'Access token required' });

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(accessToken);

    const results = await spotifyApi.searchTracks(query, { limit: 10 });
    const tracks = results.body.tracks.items.map(t => ({
      id: t.id,
      name: t.name,
      artist: t.artists[0].name,
      album: t.album.name,
      duration: t.duration_ms,
      uri: t.uri,
      albumArt: t.album.images[0]?.url
    }));

    res.json({ tracks });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/session/:sessionId/add-song', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const newSong = { ...req.body.song, votes: 0 };
  session.queue.push(newSong);
  io.to(session.id).emit('queueUpdate', { queue: session.queue });
  res.json({ success: true, song: newSong });
});

app.post('/api/session/:sessionId/play-next', async (req, res) => {
  const { sessionId } = req.params;
  const { accessToken } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.queue.sort((a,b) => b.votes - a.votes);
  const next = session.queue.shift();
  if (!next) return res.status(400).json({ error: 'No songs' });

  try {
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(accessToken);

    await spotifyApi.play({ uris: [next.uri] });
    session.currentSong = next;
    session.songsPlayed = (session.songsPlayed || 0) + 1;

    io.to(sessionId).emit('songPlayed', {
      currentSong: next,
      queue: session.queue,
      songsPlayed: session.songsPlayed
    });

    res.json({ success: true, currentSong: next, songsPlayed: session.songsPlayed });
  } catch (err) {
    console.error('Play-next error:', err);
    res.status(500).json({ error: 'Failed to play next' });
  }
});

app.post('/api/session/:sessionId/request-song', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.pendingRequests.push(req.body.song);
  io.to(session.id).emit('pendingRequestsUpdate', { pendingRequests: session.pendingRequests });
  io.to(session.id).emit('newSongRequest', req.body.song);
  res.json({ success: true });
});

app.get('/api/session/:sessionId/pending-requests', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ pendingRequests: session.pendingRequests });
});

app.post('/api/session/:sessionId/approve-request', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const idx = session.pendingRequests.findIndex(s => s.id === req.body.songId);
  if (idx === -1) return res.status(404).json({ error: 'Request not found' });
  const song = session.pendingRequests.splice(idx, 1)[0];
  session.queue.push({ ...song, votes: 0 });
  io.to(session.id).emit('queueUpdate', { queue: session.queue });
  io.to(session.id).emit('pendingRequestsUpdate', { pendingRequests: session.pendingRequests });
  res.json({ success: true });
});

app.post('/api/session/:sessionId/deny-request', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.pendingRequests = session.pendingRequests.filter(s => s.id !== req.body.songId);
  io.to(session.id).emit('pendingRequestsUpdate', { pendingRequests: session.pendingRequests });
  res.json({ success: true });
});

io.on('connection', socket => {
  socket.on('joinSession', sessionId => socket.join(sessionId));
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
