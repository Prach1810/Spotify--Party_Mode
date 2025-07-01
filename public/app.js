// Global state
let currentUser = null;
let currentSession = null;
let socket = null;
let accessToken = null;

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
    usernameInput: document.getElementById('username'),
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
    activeUsers: document.getElementById('activeUsers')
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkAuthStatus();
});

function setupEventListeners() {
    // Authentication
    elements.loginBtn.addEventListener('click', handleSpotifyLogin);
    elements.logoutBtn.addEventListener('click', handleLogout);
    
    // Session management
    elements.createSessionBtn.addEventListener('click', () => showModal('createModal'));
    elements.joinSessionBtn.addEventListener('click', () => showModal('joinModal'));
    elements.createCancelBtn.addEventListener('click', () => hideModal('createModal'));
    elements.joinCancelBtn.addEventListener('click', () => hideModal('joinModal'));
    elements.createConfirmBtn.addEventListener('click', handleCreateSession);
    elements.joinConfirmBtn.addEventListener('click', handleJoinSession);
    
    // Session interface
    elements.playNextBtn.addEventListener('click', handlePlayNext);
    elements.searchBtn.addEventListener('click', handleSearch);
    elements.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
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
    } else {
        elements.loginBtn.classList.remove('hidden');
        elements.userInfo.classList.add('hidden');
    }
}

function showModal(modalId) {
    if (!accessToken) {
        alert('Please connect your Spotify account first!');
        return;
    }
    document.getElementById(modalId).classList.remove('hidden');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

async function handleCreateSession() {
    const sessionName = elements.sessionName.value.trim();
    const playlistId = elements.playlistId.value.trim();
    
    if (!sessionName) {
        alert('Please enter a session name');
        return;
    }
    
    try {
        const response = await fetch('/api/session/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken,
                sessionName,
                playlistId: playlistId || null
            })
        });
        
        const data = await response.json();
        
        if (data.sessionId) {
            currentSession = data.session;
            hideModal('createModal');
            showSessionInterface();
            connectToSession(data.sessionId);
        } else {
            alert('Failed to create session');
        }
    } catch (error) {
        console.error('Error creating session:', error);
        alert('Failed to create session');
    }
}

async function handleJoinSession() {
    const sessionId = elements.sessionCode.value.trim();
    const username = elements.usernameInput.value.trim();
    
    if (!sessionId || !username) {
        alert('Please enter both session code and username');
        return;
    }
    
    try {
        const response = await fetch('/api/session/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, username })
        });
        
        const data = await response.json();
        
        if (data.session) {
            currentSession = data.session;
            hideModal('joinModal');
            showSessionInterface();
            connectToSession(sessionId);
        } else {
            alert('Failed to join session');
        }
    } catch (error) {
        console.error('Error joining session:', error);
        alert('Failed to join session');
    }
}

function showSessionInterface() {
    elements.welcomeSection.classList.add('hidden');
    elements.sessionInterface.classList.remove('hidden');
    elements.statsSection.classList.remove('hidden');
    
    updateSessionUI();
}

function showWelcomeSection() {
    elements.welcomeSection.classList.remove('hidden');
    elements.sessionInterface.classList.add('hidden');
    elements.statsSection.classList.add('hidden');
}

function updateSessionUI() {
    if (!currentSession) return;
    
    elements.sessionTitle.textContent = currentSession.name;
    elements.sessionCodeText.textContent = currentSession.id;
    elements.participantCount.textContent = `${currentSession.participants.length} participants`;
    
    if (currentSession.currentSong) {
        showCurrentSong(currentSession.currentSong);
    }
    
    updateQueueDisplay();
    updateStats();
}

function connectToSession(sessionId) {
    socket = io();
    
    socket.emit('joinSession', sessionId);
    
    socket.on('voteUpdate', (data) => {
        updateSongVotes(data.songId, data.votes);
    });
    
    socket.on('queueUpdate', (data) => {
        currentSession.queue = data.queue;
        updateQueueDisplay();
    });
    
    socket.on('songPlayed', (data) => {
        currentSession.currentSong = data.currentSong;
        currentSession.queue = data.queue;
        showCurrentSong(data.currentSong);
        updateQueueDisplay();
        updateStats();
    });
}

function showCurrentSong(song) {
    elements.currentSongSection.classList.remove('hidden');
    elements.currentSongName.textContent = song.name;
    elements.currentSongArtist.textContent = song.artist;
    // Note: Album art would need to be fetched separately or included in song data
}

async function handleSearch() {
    const query = elements.searchInput.value.trim();
    if (!query) return;
    
    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&accessToken=${accessToken}`);
        const data = await response.json();
        
        displaySearchResults(data.tracks);
    } catch (error) {
        console.error('Error searching:', error);
    }
}

function displaySearchResults(tracks) {
    elements.searchResults.innerHTML = '';
    
    tracks.forEach(track => {
        const trackElement = document.createElement('div');
        trackElement.className = 'song-card rounded-lg p-4 flex items-center justify-between';
        trackElement.innerHTML = `
            <div class="flex items-center space-x-3">
                <img src="${track.albumArt || 'https://via.placeholder.com/40'}" alt="Album Art" class="w-10 h-10 rounded">
                <div>
                    <h4 class="text-white font-semibold">${track.name}</h4>
                    <p class="text-gray-300 text-sm">${track.artist}</p>
                </div>
            </div>
            <button onclick="addSongToQueue('${track.id}', '${track.name}', '${track.artist}', '${track.uri}')" 
                    class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg">
                <i class="fas fa-plus"></i>
            </button>
        `;
        elements.searchResults.appendChild(trackElement);
    });
}

async function addSongToQueue(songId, name, artist, uri) {
    if (!currentSession) return;
    
    try {
        const response = await fetch(`/api/session/${currentSession.id}/add-song`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                song: { id: songId, name, artist, uri, votes: 0 }
            })
        });
        
        const data = await response.json();
        if (data.success) {
            elements.searchInput.value = '';
            elements.searchResults.innerHTML = '';
        }
    } catch (error) {
        console.error('Error adding song:', error);
    }
}

function updateQueueDisplay() {
    if (!currentSession || !currentSession.queue.length) {
        elements.queueList.innerHTML = '<p class="text-gray-300 text-center py-8">No songs in queue. Search and add some songs to get started!</p>';
        return;
    }
    
    // Sort by votes (highest first)
    const sortedQueue = [...currentSession.queue].sort((a, b) => b.votes - a.votes);
    
    elements.queueList.innerHTML = sortedQueue.map((song, index) => `
        <div class="song-card rounded-lg p-4 flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <div class="text-center">
                    <div class="text-2xl font-bold text-white">${index + 1}</div>
                    <div class="text-sm text-gray-300">${song.votes} votes</div>
                </div>
                <div>
                    <h4 class="text-white font-semibold">${song.name}</h4>
                    <p class="text-gray-300">${song.artist}</p>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="voteSong('${song.id}', 'up')" 
                        class="vote-animation bg-green-500 hover:bg-green-600 text-white p-2 rounded-full">
                    <i class="fas fa-thumbs-up"></i>
                </button>
                <button onclick="voteSong('${song.id}', 'down')" 
                        class="vote-animation bg-red-500 hover:bg-red-600 text-white p-2 rounded-full">
                    <i class="fas fa-thumbs-down"></i>
                </button>
            </div>
        </div>
    `).join('');
}

async function voteSong(songId, voteType) {
    if (!currentSession || !currentUser) return;
    
    try {
        const response = await fetch(`/api/session/${currentSession.id}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                songId,
                username: currentUser.display_name || 'Anonymous',
                voteType
            })
        });
        
        const data = await response.json();
        if (data.success) {
            // Update will come through socket
        }
    } catch (error) {
        console.error('Error voting:', error);
    }
}

function updateSongVotes(songId, votes) {
    if (currentSession) {
        const song = currentSession.queue.find(s => s.id === songId);
        if (song) {
            song.votes = votes;
            updateQueueDisplay();
        }
    }
}

async function handlePlayNext() {
    if (!currentSession) return;
    
    try {
        const response = await fetch(`/api/session/${currentSession.id}/play-next`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken })
        });
        
        const data = await response.json();
        if (!data.success) {
            alert('No songs in queue or failed to play');
        }
    } catch (error) {
        console.error('Error playing next song:', error);
        alert('Failed to play next song');
    }
}

function updateStats() {
    if (!currentSession) return;
    
    const totalVotes = currentSession.queue.reduce((sum, song) => sum + song.votes, 0);
    elements.totalVotes.textContent = totalVotes;
    elements.activeUsers.textContent = currentSession.participants.length;
    
    // Songs played would need to be tracked separately
    elements.songsPlayed.textContent = '0';
}

// Handle Spotify callback
if (window.location.hash.includes('accessToken=')) {
    handleSpotifyCallback();
}

async function handleSpotifyCallback() {
    // Parse fragment
    const hash = window.location.hash.substring(1); // Remove '#'
    const params = new URLSearchParams(hash.replace(/&/g, '&'));
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const userBase64 = params.get('user');
    let user = null;
    if (userBase64) {
        try {
            user = JSON.parse(atob(userBase64));
        } catch (e) {
            user = null;
        }
    }
    if (accessToken && user) {
        localStorage.setItem('spotify_access_token', accessToken);
        localStorage.setItem('spotify_user', JSON.stringify(user));
        window.accessToken = accessToken;
        window.currentUser = user;
        updateAuthUI(true);
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
} 