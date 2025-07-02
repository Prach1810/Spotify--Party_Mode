// Global state
let currentUser = null; // Spotify user
let currentSession = null; // Session object
let socket = null; // socket.io connection
let accessToken = null; // Spotify token
let isDJ = false; // DJ flag
let pendingRequests = []; // DJ request list
let spotifyPlayer = null; // Spotify Web Playback SDK player
let deviceId = null; // Web playback device ID
let isPlaying = false; // Playback state

// DOM elements
const elements = {
  loginBtn: document.getElementById('loginBtn'),
  userInfo: document.getElementById('userInfo'),
  username: document.getElementById('username'),
  logoutBtn: document.getElementById('logoutBtn'),
  createSessionBtn: document.getElementById('createSessionBtn'),
  joinSessionBtn: document.getElementById('joinSessionBtn'),
  welcomeSection: document.getElementById('welcomeSection'),
  sessionInterface: document.getElementById('sessionInterface'),
  createModal: document.getElementById('createModal'),
  joinModal: document.getElementById('joinModal'),
  sessionName: document.getElementById('sessionName'),
  playlistId: document.getElementById('playlistId'),
  createConfirmBtn: document.getElementById('createConfirmBtn'),
  createCancelBtn: document.getElementById('createCancelBtn'),
  sessionCode: document.getElementById('sessionCode'),
  usernameInput: document.getElementById('usernameInput'),
  joinConfirmBtn: document.getElementById('joinConfirmBtn'),
  joinCancelBtn: document.getElementById('joinCancelBtn'),
  sessionTitle: document.getElementById('sessionTitle'),
  sessionCodeText: document.getElementById('sessionCodeText'),
  participantCount: document.getElementById('participantCount'),
  playNextBtn: document.getElementById('playNextBtn'),
  currentSongSection: document.getElementById('currentSongSection'),
  currentSongArt: document.getElementById('currentSongArt'),
  currentSongName: document.getElementById('currentSongName'),
  currentSongArtist: document.getElementById('currentSongArtist'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  searchResults: document.getElementById('searchResults'),
  queueList: document.getElementById('queueList'),
  statsSection: document.getElementById('statsSection'),
  totalVotes: document.getElementById('totalVotes'),
  songsPlayed: document.getElementById('songsPlayed'),
  activeUsers: document.getElementById('activeUsers'),
  pendingRequests: document.getElementById('pendingRequests'),
  djToastContainer: document.getElementById('djToastContainer'),
};

// App init
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuthStatus();
  // If redirected from Spotify OAuth
  if (window.location.hash.includes('accessToken=')) {
    handleSpotifyCallback();
  }
});

function setupEventListeners() {
  elements.loginBtn.addEventListener('click', handleSpotifyLogin);
  elements.logoutBtn.addEventListener('click', handleLogout);

  elements.createSessionBtn.addEventListener('click', () => showModal('createModal'));
  elements.joinSessionBtn.addEventListener('click', () => showModal('joinModal'));
  elements.createCancelBtn.addEventListener('click', () => hideModal('createModal'));
  elements.joinCancelBtn.addEventListener('click', () => hideModal('joinModal'));
  elements.createConfirmBtn.addEventListener('click', handleCreateSession);
  elements.joinConfirmBtn.addEventListener('click', handleJoinSession);

  elements.playNextBtn.addEventListener('click', handlePlayNext);
  elements.searchBtn.addEventListener('click', handleSearch);
  elements.searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleSearch(); });
}

function checkAuthStatus() {
  const token = localStorage.getItem('spotify_access_token');
  if (token) {
    accessToken = token;
    currentUser = JSON.parse(localStorage.getItem('spotify_user') || '{}');
    updateAuthUI(true);
  }
}

function handleSpotifyLogin() {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_user');
  window.location.href = '/auth/spotify';
}

function handleLogout() {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_user');
  accessToken = null;
  currentUser = null;
  updateAuthUI(false);
  showWelcomeSection();
}

function updateAuthUI(isLoggedIn) {
  if (isLoggedIn) {
    elements.loginBtn.classList.add('hidden');
    elements.userInfo.classList.remove('hidden');
    elements.username.textContent = currentUser.display_name || 'User';
    setTimeout(initializeSpotifyPlayer, 1000);
  } else {
    elements.loginBtn.classList.remove('hidden');
    elements.userInfo.classList.add('hidden');
  }
}

function showModal(id) {
  if (!accessToken) return alert('Connect Spotify first!');
  elements[id].classList.remove('hidden');
}

function hideModal(id) {
  elements[id].classList.add('hidden');
}

async function handleSpotifyCallback() {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash.replace(/&/g, '&'));
  const token = params.get('accessToken');
  const refreshToken = params.get('refreshToken');
  const user64 = params.get('user');
  let user = null;
  if (user64) {
    try { user = JSON.parse(atob(user64)); } catch {}
  }
  if (token && user) {
    accessToken = token;
    currentUser = user;
    localStorage.setItem('spotify_access_token', token);
    localStorage.setItem('spotify_user', JSON.stringify(user));
    updateAuthUI(true);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// --- Spotify Player Setup ---
function initializeSpotifyPlayer() {
  if (!accessToken) return setTimeout(initializeSpotifyPlayer, 1000);
  if (!window.Spotify) return setTimeout(initializeSpotifyPlayer, 1000);

  spotifyPlayer = new Spotify.Player({
    name: 'CTRL THE AUX Web Player',
    getOAuthToken: cb => cb(accessToken),
    volume: 0.5,
  });

  spotifyPlayer.addListener('ready', ({ device_id }) => { deviceId = device_id; });
  ['initialization_error','authentication_error','account_error'].forEach(evt => {
    spotifyPlayer.addListener(evt, ({ message }) => console.error(`${evt}:`, message));
  });

  spotifyPlayer.connect().then(success => console.log(success ? 'Player ready!' : 'Failed to connect'));
}

async function playSongOnWebPlayer(uri) {
  if (!spotifyPlayer || !deviceId) return alert('Spotify Web Player not ready'), false;
  try {
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [uri] }),
    });
    if (res.ok) {
      isPlaying = true;
      return true;
    } else {
      console.error('Play failed:', res.statusText);
      return false;
    }
  } catch (err) {
    console.error('Play error:', err);
    return false;
  }
}

// --- Session functions ---
function showWelcomeSection() {
  elements.welcomeSection.classList.remove('hidden');
  elements.sessionInterface.classList.add('hidden');
  elements.statsSection.classList.add('hidden');
}

function showSessionInterface() {
  elements.welcomeSection.classList.add('hidden');
  elements.sessionInterface.classList.remove('hidden');
  elements.statsSection.classList.remove('hidden');
  updateSessionUI();
}

function updateSessionUI() {
  if (!currentSession) return;
  elements.sessionTitle.textContent = currentSession.name;
  elements.sessionCodeText.textContent = currentSession.id;
  elements.participantCount.textContent = `${currentSession.participants.length} participants`;
  if (currentSession.currentSong) showCurrentSong(currentSession.currentSong);
  updateQueueDisplay();
  updateStats();
}

async function handleCreateSession() {
  const name = elements.sessionName.value.trim();
  const playlist = elements.playlistId.value.trim() || null;
  if (!name) return alert('Enter session name');
  try {
    const res = await fetch('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken,
        sessionName: name,
        playlistId: playlist,
        username: currentUser.display_name,
        userId: currentUser.id,
        songsPlayed: 0,
      }),
    });
    const data = await res.json();
    if (data.sessionId) {
      currentSession = data.session;
      isDJ = data.session.dj.userId === currentUser.id;
      hideModal('createModal');
      showSessionInterface();
      connectToSession(data.sessionId);
      updateDJUI();
    } else alert('Create failed');
  } catch (err) {
    console.error(err);
    alert('Error creating session');
  }
}

async function handleJoinSession() {
  const sid = elements.sessionCode.value.trim();
  const uname = elements.usernameInput.value.trim();
  if (!sid || !uname) return alert('Enter code & name');
  try {
    const verify = await fetch(`/api/session/${sid}`);
    if (!verify.ok) throw new Error('Session not found');
    const join = await fetch('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, username: uname, userId: currentUser.id }),
    });
    if (!join.ok) throw new Error('Join failed');
    const data = await join.json();
    currentSession = data.session;
    isDJ = data.session.dj.userId === currentUser.id;
    hideModal('joinModal');
    showSessionInterface();
    connectToSession(sid);
    updateDJUI();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

function connectToSession(sessionId) {
  socket = io();
  socket.emit('joinSession', sessionId);

  socket.on('newSongRequest', song => { if (isDJ) showDJPopup(song); });
  socket.on('voteUpdate', data => { updateSongVotes(data.songId, data.votes); updateStats(); });
  socket.on('queueUpdate', data => { currentSession.queue = data.queue; updateQueueDisplay(); updateStats(); });
  socket.on('songPlayed', data => {
    currentSession.currentSong = data.currentSong;
    currentSession.queue = data.queue;
    currentSession.songsPlayed = data.songsPlayed || 0;
    showCurrentSong(data.currentSong);
    updateQueueDisplay();
    updateStats();
  });
  socket.on('pendingRequestsUpdate', data => { pendingRequests = data.pendingRequests; updatePendingRequestsUI(); });

  if (isDJ) {
    fetch(`/api/session/${sessionId}/pending-requests`)
      .then(r => r.json())
      .then(d => { pendingRequests = d.pendingRequests || []; updatePendingRequestsUI(); })
      .catch(console.error);
  }
}

function showCurrentSong(song) {
  elements.currentSongSection.classList.remove('hidden');
  elements.currentSongName.textContent = song.name;
  elements.currentSongArtist.textContent = song.artist;
  if (song.albumArt) {
    elements.currentSongArt.src = song.albumArt;
    elements.currentSongArt.style.display = 'block';
  } else {
    elements.currentSongArt.style.display = 'none';
  }
}

// --- Search, Add, Request ---
async function handleSearch() {
  const q = elements.searchInput.value.trim();
  if (!q) return;
  try {
    const res = await fetch(`/api/search?query=${encodeURIComponent(q)}&accessToken=${accessToken}`);
    const data = await res.json();
    displaySearchResults(data.tracks);
  } catch (err) {
    console.error('Search err:', err);
  }
}

function displaySearchResults(tracks) {
  elements.searchResults.innerHTML = '';
  tracks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'song-card rounded-lg p-4 flex items-center justify-between';
    div.innerHTML = `
      <div class="flex items-center space-x-3">
        <img src="${t.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-10 h-10 rounded">
        <div>
          <h4 class="text-white font-semibold">${t.name}</h4>
          <p class="text-gray-300 text-sm">${t.artist}</p>
        </div>
      </div>
      <div class="flex space-x-2">
        <button class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg"><i class="fas fa-play"></i></button>
        <button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg"></button>
      </div>
    `;
    const [playBtn, actionBtn] = div.querySelectorAll('button');
    playBtn.onclick = () => playSongOnWebPlayer(t.uri);

    actionBtn.textContent = isDJ ? 'Add to Queue' : 'Request Song';
    actionBtn.onclick = () => isDJ ? addSongToQueue(t) : requestSong(t);

    elements.searchResults.appendChild(div);
  });
}

async function addSongToQueue(t) {
  if (!currentSession) return;
  try {
    const res = await fetch(`/api/session/${currentSession.id}/add-song`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        song: { id: t.id, name: t.name, artist: t.artist, uri: t.uri, albumArt: t.albumArt, votes: 0 },
      }),
    });
    const d = await res.json();
    if (d.success) {
      elements.searchInput.value = '';
      elements.searchResults.innerHTML = '';
    }
  } catch (err) {
    console.error(err);
  }
}

async function requestSong(t) {
  if (!currentSession) return;
  try {
    const res = await fetch(`/api/session/${currentSession.id}/request-song`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        song: { id: t.id, name: t.name, artist: t.artist, uri: t.uri, albumArt: t.albumArt },
        requestedBy: { username: currentUser.display_name, userId: currentUser.id },
      }),
    });
    const d = await res.json();
    if (d.success) {
      elements.searchInput.value = '';
      elements.searchResults.innerHTML = '<p class="text-green-400">Request sent!</p>';
    }
  } catch (err) {
    console.error(err);
  }
}

// --- Approve / Deny ---
async function approveRequest(songId) {
  if (!currentSession) return;
  await fetch(`/api/session/${currentSession.id}/approve-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, userId: currentUser.id }),
  });
}

async function denyRequest(songId) {
  if (!currentSession) return;
  await fetch(`/api/session/${currentSession.id}/deny-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, userId: currentUser.id }),
  });
}

function updatePendingRequestsUI() {
  if (!isDJ) return;
  if (pendingRequests.length === 0) {
    elements.pendingRequests.innerHTML = '<p class="text-gray-400">No pending song requests.</p>';
  } else {
    elements.pendingRequests.innerHTML = pendingRequests.map(req => `
      <div class="song-card rounded-lg p-4 flex items-center justify-between mb-2">
        <div class="flex items-center space-x-3">
          <img src="${req.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-10 h-10 rounded">
          <div>
            <h4 class="text-white font-semibold">${req.name}</h4>
            <p class="text-gray-300 text-sm">${req.artist}</p>
            <p class="text-xs text-gray-400">Requested by: ${req.requestedBy.username}</p>
          </div>
        </div>
        <div class="flex space-x-2">
          <button class="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded" onclick="approveRequest('${req.id}')">Approve</button>
          <button class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded" onclick="denyRequest('${req.id}')">Deny</button>
        </div>
      </div>
    `).join('');
  }
}

// DJ notification toaster
function showDJPopup(song) {
  const toast = document.createElement('div');
  toast.className = "flex items-center justify-between bg-[#121212] text-white p-4 rounded-lg shadow-lg space-x-4 w-[400px] animate-fadeIn";
  toast.innerHTML = `
    <div class="flex items-center space-x-4">
      <img src="${song.albumArt}" class="w-14 h-14 rounded" />
      <div>
        <div class="font-semibold text-lg">Song Request:</div>
        <div class="font-bold text-base">${song.name}</div>
        <div class="text-gray-400 text-sm">${song.artist}</div>
      </div>
    </div>
    <div class="flex space-x-2">
      <button class="deny-btn ...">✕ Deny</button>
      <button class="accept-btn ...">Accept ✔</button>
    </div>
  `;

  toast.querySelector('.accept-btn').onclick = () => { approveRequest(song.id); toast.remove(); };
  toast.querySelector('.deny-btn').onclick = () => { denyRequest(song.id); toast.remove(); };
  elements.djToastContainer.appendChild(toast);

  setTimeout(() => { if (elements.djToastContainer.contains(toast)) toast.remove(); }, 10000);
}

// --- Queue, Voting & Stats ---
function updateQueueDisplay() {
  if (!currentSession?.queue?.length) {
    elements.queueList.innerHTML = '<p class="text-gray-300 text-center py-8">No songs in queue.</p>';
    return;
  }
  const sorted = [...currentSession.queue].sort((a, b) => b.votes - a.votes);
  elements.queueList.innerHTML = sorted.map((s, idx) => `
    <div class="song-card rounded-lg p-4 flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <img src="${s.albumArt}" class="w-12 h-12 rounded" />
        <div class="text-center">
          <div class="text-2xl font-bold text-white">${idx+1}</div>
          <div class="text-sm text-gray-300">${s.votes} votes</div>
        </div>
        <div>
          <h4 class="text-white font-semibold">${s.name}</h4>
          <p class="text-gray-300">${s.artist}</p>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <button onclick="voteSong('${s.id}','up')" class="bg-green-500 ...">👍</button>
        <button onclick="voteSong('${s.id}','down')" class="bg-red-500 ...">👎</button>
      </div>
    </div>
  `).join('');
}

async function voteSong(songId, type) {
  if (!currentSession || !currentUser) return;
  try {
    await fetch(`/api/session/${currentSession.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songId,
        username: currentUser.display_name,
        voteType: type,
      }),
    });
  } catch (err) { console.error(err); }
}

function updateSongVotes(songId, votes) {
  const song = currentSession.queue.find(s => s.id === songId);
  if (song) { song.votes = votes; updateQueueDisplay(); }
}

async function handlePlayNext() {
  if (!currentSession) return;
  const queue = [...currentSession.queue].sort((a, b) => b.votes - a.votes);
  const next = queue.shift();
  if (!next) return alert('No songs in queue');
  const played = await playSongOnWebPlayer(next.uri);
  if (played) {
    currentSession.queue = queue;
    currentSession.currentSong = next;
    currentSession.songsPlayed = (currentSession.songsPlayed || 0) + 1;
    showCurrentSong(next);
    updateQueueDisplay();
    updateStats();
    socket?.emit('songPlayed', {
      currentSong: next,
      queue,
      songsPlayed: currentSession.songsPlayed,
    });
  } else {
    try {
      const res = await fetch(`/api/session/${currentSession.id}/play-next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      const d = await res.json();
      if (!d.success) alert('No songs or failed to play');
    } catch (err) { console.error(err); }
  }
}

function updateStats() {
  if (!currentSession) return;
  const totalVotes = currentSession.queue.reduce((a,s) => a + s.votes, 0);
  elements.totalVotes.textContent = totalVotes;
  elements.activeUsers.textContent = currentSession.participants.length;
  if (!currentSession.songsPlayed) currentSession.songsPlayed = 0;
  elements.songsPlayed.textContent = currentSession.songsPlayed;
}

function updateDJUI() {
  if (isDJ) {
    elements.playNextBtn.classList.remove('hidden');
    elements.pendingRequests.classList.remove('hidden');
  } else {
    elements.playNextBtn.classList.add('hidden');
    elements.pendingRequests.classList.add('hidden');
  }
}

// Expose global for inline button handlers
window.currentUser = currentUser;
window.playSongOnWebPlayer = playSongOnWebPlayer;