import React, { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import logoImage from './assets/westly-strong.svg';
import { AuthGuard } from './components/AuthGuard';
import { UserHeader } from './components/UserHeader';
import { DjUserAuthProvider, useDjUserAuth } from './contexts/DjUserAuthContext';
import { AuthProvider } from './contexts/SpotifyAuthContext';
import { Song } from './models/Song';
import * as utils from './utils/utilities';

const AFTER_HOURS_STORAGE_KEY = 'djbot-after-hours-mode';

function getNextLocalMidnight() {
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight;
}

function readAfterHoursMode() {
  try {
    const storedMode = window.localStorage.getItem(AFTER_HOURS_STORAGE_KEY);
    if (!storedMode) {
      return false;
    }

    const parsedMode = JSON.parse(storedMode);
    if (!parsedMode.enabled || !parsedMode.expiresAt || new Date(parsedMode.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(AFTER_HOURS_STORAGE_KEY);
      return false;
    }

    return true;
  } catch (error) {
    window.localStorage.removeItem(AFTER_HOURS_STORAGE_KEY);
    return false;
  }
}

function readAfterHoursExpiration() {
  try {
    const storedMode = window.localStorage.getItem(AFTER_HOURS_STORAGE_KEY);
    if (!storedMode) {
      return null;
    }

    const parsedMode = JSON.parse(storedMode);
    if (!parsedMode.enabled || !parsedMode.expiresAt || new Date(parsedMode.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(AFTER_HOURS_STORAGE_KEY);
      return null;
    }

    return parsedMode.expiresAt;
  } catch (error) {
    window.localStorage.removeItem(AFTER_HOURS_STORAGE_KEY);
    return null;
  }
}

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isAfterHoursMode, setIsAfterHoursMode] = useState(readAfterHoursMode);
  const [searchResults, setSearchResults] = useState<Song[]>([]);

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [upcomingSongs, setUpcomingSongs] = useState<Song[]>([]);
  const [playbackProgress, setPlaybackProgress] = useState<number>(0);
  const { djUser } = useDjUserAuth();

  const API_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

  const handleSearch = async (e: any) => {
    e.preventDefault();

    if (searchQuery.trim()) {
      try {
        // Make API call to backend search route
        const response = await fetch(`${API_URL}/api/spotify/search?query=${encodeURIComponent(searchQuery)}&type=track&limit=10`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Transform the Spotify API response to match our Song model
        if (data && data.length > 0) {
          const transformedResults: Song[] = data.map((track: any) => ({
            songId: track.id,
            albumName: track.album || 'Unknown Album',
            songName: track.name || 'Unknown Song',
            artist: track.artist || 'Unknown Artist',
            duration: track.duration,
            albumArt: track.album_image || '',
            releaseDate: track.release_date.split("-")[0] || '',
            popularity: track.popularity || 0,
            userId: ""
          }));
          setSearchResults(transformedResults);
          setSearchQuery('');
        } else {
          setSearchResults([]);
          setSearchQuery('');
        }
      } catch (error) {
        console.error('Search failed:', error);
        setSearchResults([]);
        setSearchQuery('');
      }
    } else {
      setSearchResults([]);
      setSearchQuery('');
    }
  };

  const handleAutoplay = async () => {
    if (!isAutoPlaying) {
      //call server to update state
      setIsAutoPlaying(true);
      await updateStatus('autoplay', djUser?.username || 'local-user');
    }
  };

  const handleStop = async () => {
    try {

      //set playing and autoplaying to false
      //call puase and clear current song
      await updateStatus('stop', djUser?.username || 'local-user');
      await callPauseAPI();
      //clear queue locally and on server
      await fetch(`${API_URL}/api/queue`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      setIsPlaying(false);
      setCurrentSong(null);

      setUpcomingSongs([]);

      setIsAutoPlaying(false);
    } catch (error) {
      console.error('Failed to stop playback:', error);
      // Still update UI even if API call fails for better UX
      setIsPlaying(false);
      setIsAutoPlaying(false);
      setCurrentSong(null);
      setUpcomingSongs([]);
    }
  };

  const handleSkip = async () => {
    // Logic to move to next song
    if (currentSong) {

      if (upcomingSongs.length > 0) {

        const nextSong = upcomingSongs[0];

        try {
          await handleRemoveSongFromQueue(nextSong.songId);
          await callPlayAPI(nextSong);
          setCurrentSong(nextSong);
          setPlaybackProgress(0); // Reset progress for new song
        } catch (error) {
          console.error('Failed to skip song:', error);
          // Still update UI even if API call fails for better UX
          setCurrentSong(nextSong);
          setPlaybackProgress(0);
        }
      } else if (isAutoPlaying) {
        try {
          //just call pause if no songs in queue and server will handle next new random song
          await callPauseAPI();
        } catch (error) {
          console.error('Failed to pause for autoplay:', error);
        }
      } else {
        // No more songs in queue and not autoplaying, just treat it like stop
        await handleStop();
      }
    }
  };

  const handleBlame = async () => {
    if (currentSong) {
      try {

        const response = await fetch(`${API_URL}/api/analytics/blame/${currentSong.songId}`);
        if (response.ok) {
          const data = await response.json();
          alert(`You can blame ${data.addedBy} for adding this song!`);
        }
      } catch (error) {
        console.error('Failed to fetch blame for song:', error);
      }
    }

  };

  const handleTrash = async () => {
    if (currentSong) {
      // eslint-disable-next-line no-restricted-globals
      let b = confirm(`Are you sure you'd like to ban "${currentSong.songName}"`);
      if (b) {
        await fetch(`${API_URL}/api/analytics/ban/${currentSong.songId}`);
        handleSkip();
      }
    }
  };

  // Polling interval reference
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Function to fetch current playback state
  const fetchPlaybackState = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/queue`);
      if (response.ok) {
        const data = await response.json();
        //queue[], status text, spotify playback state

        if (data) {

          if (data.status === 'autoplay') {
            setIsAutoPlaying(true);
          }

          if (data.queue && Array.isArray(data.queue)) {
            const songs = data.queue.map((track: any) => ({
              songId: track.trackid, // Generate unique ID for frontend
              albumName: track.albumname || 'Unknown Album',
              songName: track.trackname || 'Unknown Song',
              artist: track.artistname || 'Unknown Artist',
              duration: track.durationms || 0,
              albumArt: track.albumart || '',
              userId: track.userid || '',
              skipHistory: track.skiphistory || track.skipHistory || false,
            }));

            setUpcomingSongs(songs)
          }

          // Update progress if song is playing
          if (data.spotify && data.spotify?.isPlaying && data.spotify?.progressMs !== null) {
            setCurrentSong({
              songId: data.spotify.item.id,
              albumName: data.spotify.item.album.name || 'Unknown Album',
              songName: data.spotify.item.name || 'Unknown Song',
              artist: data.spotify.item.artists[0].name || 'Unknown Artist',
              duration: data.spotify.item.duration_ms,
              albumArt: data.spotify.item.album.images[0].url || '',
              userId: '',
              releaseDate: data.spotify.item.album.release_date || '',
              popularity: data.spotify.item.popularity || 0,
            });
            setIsPlaying(true);
            setPlaybackProgress(data.spotify.progressMs);

            //set current song info
          }
          else if (data.status === 'stop' || (data.status === 'play' && data.queue.length === 0 && !data.spotify?.isPlaying)) {
            // No more songs in queue
            setCurrentSong(null);
            data.status === 'stop' ? setIsPlaying(false) : setIsPlaying(true);
          }


        }
      }
    } catch (error) {
      console.error('Failed to fetch playback state:', error);
    }
  }, [API_URL]);

  // Poll server every 5 seconds regardless of play state
  useEffect(() => {
    // Set up polling interval
    pollingIntervalRef.current = setInterval(fetchPlaybackState, 5000);

    // Kick off immediately
    fetchPlaybackState();

    // Cleanup
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [fetchPlaybackState]);

  useEffect(() => {
    if (!isAfterHoursMode) {
      return;
    }

    const expiresAt = readAfterHoursExpiration();
    if (!expiresAt) {
      setIsAfterHoursMode(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.localStorage.removeItem(AFTER_HOURS_STORAGE_KEY);
      setIsAfterHoursMode(false);
    }, Math.max(new Date(expiresAt).getTime() - Date.now(), 0));

    return () => window.clearTimeout(timeoutId);
  }, [isAfterHoursMode]);

  const handleAfterHoursToggle = () => {
    if (isAfterHoursMode) {
      window.localStorage.removeItem(AFTER_HOURS_STORAGE_KEY);
      setIsAfterHoursMode(false);
      return;
    }

    window.localStorage.setItem(AFTER_HOURS_STORAGE_KEY, JSON.stringify({
      enabled: true,
      expiresAt: getNextLocalMidnight().toISOString()
    }));
    setIsAfterHoursMode(true);
  };

  const handleAddSong = async (song: Song, skipHistory = false) => {
    try {
      const songToAdd = {
        ...song,
        userId: djUser?.username || 'local-user',
        skipHistory: skipHistory || isAfterHoursMode
      };

      if (isAutoPlaying) {
        //just add to queue
        const isDuplicate = upcomingSongs.some(existingSong => existingSong.songId === songToAdd.songId);
        if (!isDuplicate) {
          await addToQueue(songToAdd);
          setUpcomingSongs(prevSongs => [...prevSongs, songToAdd]);
        }

      }
      else if (isPlaying) {
        //check to add to queue first, then just play
        if (currentSong && currentSong.songId !== songToAdd.songId) {
          const isDuplicate = upcomingSongs.some(existingSong => existingSong.songId === songToAdd.songId);
          if (!isDuplicate) {
            await addToQueue(songToAdd);
            setUpcomingSongs(prevSongs => [...prevSongs, songToAdd]);
          }
        }
        else {
          await updateStatus('play', djUser?.username || 'local-user');
          await callPlayAPI(songToAdd, songToAdd.skipHistory);
          setCurrentSong(songToAdd);
          setIsPlaying(true);
        }
      }
      else { //stopped state
        //play song immediately
        await updateStatus('play', djUser?.username || 'local-user');
        await callPlayAPI(songToAdd, songToAdd.skipHistory);
        setCurrentSong(songToAdd);
        setIsPlaying(true);
      }
    }
    catch (error) {
      console.error('Error setting userId on song:', error);
    }
  };

  const handleRemoveSongFromQueue = async (songId: string) => {
    await fetch(`${API_URL}/api/queue/${songId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    setUpcomingSongs(prevSongs => prevSongs.filter(song => song.songId !== songId));
  };

  const callPlayAPI = async (song: Song, skipHistory = false) => {
    try {
      const trackUri = `spotify:track:${song.songId}`;
      const response = await fetch(`${API_URL}/api/spotify/play`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [trackUri]
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      else if (!skipHistory) {
        //log playback
        await fetch(`${API_URL}/api/analytics/logplayback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            track: {
              id: song.songId,
              trackName: song.songName,
              artistName: song.artist,
              albumName: song.albumName,
            },
            userId: djUser?.username || 'local-user'
          }),
        });
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to start playback:', error);
      throw error;
    }
  };

  const callPauseAPI = async () => {
    try {
      const response = await fetch(`${API_URL}/api/spotify/pause`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to pause playback:', error);
      throw error;
    }
  };

  /*const handlePlayNow = async (song: Song) => {
    try {
      await callPlayAPI(song);
      const currentIndex = upcomingSongs.findIndex(s => s.songId === song.songId);
      if (currentIndex !== -1) {
        // Remove current song from queue
        setUpcomingSongs(prevSongs => prevSongs.filter((_, index) => index !== currentIndex));
      }

      setCurrentSong(song);
      setPlaybackProgress(0); // Reset progress for new song
      setIsPlaying(true);
    } catch (error) {
      console.error('Failed to play song:', error);
      // Still update UI even if API call fails for better UX
      setCurrentSong(null);
      setPlaybackProgress(0);
      setIsPlaying(false);
    }
  };*/

  const updateStatus = async (status: string, userId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status, userId }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to update status:', error);
      throw error;
    }
  };

  const addToQueue = async (song: Song) => {
    try {
      const response = await fetch(`${API_URL}/api/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(song),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      return data;
    } catch (error) {
      console.error('Failed to update status:', error);
      throw error;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-800 to-gray-700 text-white">
      <div className="flex flex-col lg:flex-row h-screen">
        {/* Left Sidebar - Upcoming Songs */}
        <div className="w-full lg:w-[370px] bg-gray-800 border-b lg:border-b-0 lg:border-r border-gray-700 p-3 lg:p-6 overflow-y-auto">
          <UserHeader />
          <h2 className="text-2xl font-bold mb-6 text-blue-300">Upcoming Songs</h2>
          <div className="space-y-4">
            {upcomingSongs.map((song) => (
              <div key={song.songId} className="bg-gray-600 rounded-lg p-4 hover:bg-gray-500 transition-colors duration-200">
                <div className="flex items-start space-x-4">
                  {/* Album Cover */}
                  <div className="flex-shrink-0">
                    {song.albumArt ? (
                      <img
                        src={song.albumArt}
                        alt={`${song.songName} album cover`}
                        className="w-20 h-20 rounded-lg object-cover"
                      />
                    ) : (
                      <img
                        src={logoImage}
                        alt="Default album cover"
                        className="w-20 h-20 rounded-lg object-cover"
                      />
                    )}
                  </div>

                  {/* Song Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-white truncate">{song.songName}</h3>
                      <span className="text-sm text-gray-400 bg-gray-600 px-2 py-1 rounded ml-2">{utils.formatDuration(song.duration)}</span>
                    </div>
                    <p className="text-gray-300 text-sm mb-3">{song.artist}</p>
                    <div className="flex space-x-2">
                      {/* <button
                        onClick={() => handlePlayNow(song)}
                        className="text-xs bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded transition-colors duration-200"
                      >
                        Play Now
                      </button> */}
                      <button
                        onClick={() => handleRemoveSongFromQueue(song.songId)}
                        className="text-xs bg-gray-600 hover:bg-gray-500 px-3 py-1 rounded transition-colors duration-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content - Search and Controls at Top Left */}
        <div className="flex-1 flex flex-col">
          {/* Top Section with Search and Controls */}
          <div className="bg-gray-800 border-b border-gray-700 p-3 lg:p-6">
            <div className="max-w-4xl">
              <h1 className="text-xl lg:text-3xl font-bold mb-4 lg:mb-6 text-blue-300 flex flex-col lg:flex-row items-center space-y-2 lg:space-y-0 lg:space-x-3">
                <img src={logoImage} alt="DJ Bot Logo" className="w-16 h-16 lg:w-[100px] lg:h-[100px]" />
                <span>DJ Bot</span>
              </h1>

              {/* Current Song Display */}
              <div className="mb-4 lg:mb-6 p-3 lg:p-4 bg-gray-600 rounded-lg border border-gray-700">
                {isPlaying && currentSong ? (
                  // Show current song info
                  <div>
                    <div className="flex flex-col sm:flex-row items-start space-y-3 sm:space-y-0 sm:space-x-4">
                      {/* Album Cover */}
                      <div className="flex-shrink-0 mx-auto sm:mx-0">
                        {currentSong.albumArt ? (
                          <img
                            src={currentSong.albumArt}
                            alt={`${currentSong.albumName} album cover`}
                            className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover"
                          />
                        ) : (
                          <img
                            src={logoImage}
                            alt="Default album cover"
                            className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover"
                          />
                        )}
                      </div>

                      {/* Song Info */}
                      <div className="flex-1 min-w-0">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xl font-semibold text-white truncate">{currentSong.songName}</h3>
                            <button
                              type="button"
                              onClick={handleTrash}
                              className="ml-2 p-1 rounded hover:bg-gray-700 focus:outline-none"
                              aria-label="Trash"
                            >
                              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 3h4a1 1 0 011 1v2H9V4a1 1 0 011-1z" />
                              </svg>
                            </button>
                          </div>
                          <p className="text-gray-300">{currentSong.artist}</p>
                          <p className="text-gray-400 text-sm">{currentSong.albumName} {currentSong.releaseDate}</p>
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-4">
                      <div className="flex justify-between text-sm text-gray-400 mb-2">
                        <span>{utils.formatDuration(playbackProgress)}</span>
                        <span>{utils.formatDuration(currentSong.duration)}</span>
                      </div>
                      <div className="w-full bg-gray-600 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all duration-1000"
                          style={{
                            width: `${currentSong.duration > 0 ? (playbackProgress / currentSong.duration) * 100 : 0}%`
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Show "no song playing" message
                  <div>
                    <div className="flex flex-col sm:flex-row items-start space-y-3 sm:space-y-0 sm:space-x-4">
                      <div className="w-20 h-20 bg-gray-600 rounded-lg flex items-center justify-center mx-auto sm:mx-0">
                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="space-y-1">
                          <h3 className="text-xl font-semibold text-white truncate">No Song Playing</h3>
                          <p className="text-gray-300">Search for a song or click Autoplay to start your music</p>
                          <p className="text-gray-400 text-sm">Ready to play</p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-between text-sm text-gray-400 mb-2">
                        <span>--:--</span>
                        <span>--:--</span>
                      </div>
                      <div className="w-full bg-gray-600 rounded-full h-2">
                        <div className="bg-gray-500 h-2 rounded-full" style={{ width: '0%' }}></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Search Input */}
              <form onSubmit={handleSearch} className="mb-4 lg:mb-6">
                <div className="relative max-w-md">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for songs, artists, or albums..."
                    className="w-full px-4 lg:px-6 py-2 lg:py-3 text-base lg:text-lg bg-gray-600 border border-gray-500 rounded-full text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="submit"
                    className="absolute right-2 top-2 bg-blue-500 hover:bg-blue-600 text-white px-3 lg:px-4 py-1 rounded-full transition-colors duration-200 text-sm lg:text-base"
                  >
                    Search
                  </button>
                </div>
              </form>

              {/* Control Buttons */}
              <div className="flex flex-wrap gap-2 lg:gap-4">
                <button
                  disabled={isAutoPlaying}
                  onClick={handleAutoplay}
                  className={`bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-semibold transition-colors duration-200 flex items-center space-x-2
                            ${isAutoPlaying ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Autoplay</span>
                </button>

                <button
                  onClick={handleStop}
                  className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-semibold transition-colors duration-200 flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  <span>Stop</span>
                </button>

                <button
                  onClick={handleSkip}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold transition-colors duration-200 flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                  <span>Skip</span>
                </button>

                <button
                  onClick={handleBlame}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg font-semibold transition-colors duration-200 flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span>Blame</span>
                </button>

                <button
                  type="button"
                  onClick={handleAfterHoursToggle}
                  aria-pressed={isAfterHoursMode}
                  className={`text-white px-6 py-2 rounded-lg font-semibold transition-colors duration-200 flex items-center space-x-2
                            ${isAfterHoursMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-600 hover:bg-gray-500'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 118.646 3.646 7 7 0 0020.354 15.354z" />
                  </svg>
                  <span>After Hours</span>
                </button>
              </div>
            </div>
          </div>

          {/* Main Content Area - Search Results */}
          <div className="flex-1 p-3 lg:p-6 overflow-y-auto">
            {searchResults.length > 0 ? (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center space-y-3 sm:space-y-0 sm:space-x-4 mb-4 lg:mb-6">
                  <h2 className="text-xl lg:text-2xl font-semibold text-blue-300">Search Results</h2>
                  <button
                    onClick={() => setSearchResults([])}
                    className="bg-gray-600 hover:bg-gray-500 text-white px-3 lg:px-4 py-2 rounded-lg transition-colors duration-200 text-sm w-full sm:w-auto"
                  >
                    Clear Results
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {searchResults.map((song) => (
                    <div key={song.songId} className="bg-gray-600 rounded-lg p-3 hover:bg-gray-600 transition-colors duration-200">
                      <div className="flex flex-col sm:flex-row sm:items-stretch space-y-3 sm:space-y-0 sm:space-x-3">
                        {/* Album Cover */}
                        <div className="flex-shrink-0 flex justify-center sm:justify-start">
                          {song.albumArt ? (
                            <img
                              src={song.albumArt}
                              alt={`${song.albumName} album cover`}
                              className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover"
                            />
                          ) : (
                            <img
                              src={logoImage}
                              alt="Default album cover"
                              className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover"
                            />
                          )}
                        </div>

                        {/* Song Info and Controls */}
                        <div className="flex-1 min-w-0 text-center sm:text-left flex flex-col justify-between">
                          <div>
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-1 space-y-1 sm:space-y-0">
                              <h3 className="font-semibold text-white truncate text-sm">{song.songName}</h3>
                              <span className="text-xs text-gray-400 bg-gray-600 px-1 py-0.5 rounded">{utils.formatDuration(song.duration)}</span>
                            </div>
                            <p className="text-gray-300 text-xs mb-1">{song.artist}</p>
                            <p className="text-gray-400 text-xs mb-2">{song.albumName}</p>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                            <span className="text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded-full">
                              Popularity: {song.popularity}
                            </span>
                            <div className="flex justify-center sm:justify-end gap-2">
                              <button
                                onClick={() => handleAddSong(song, true)}
                                className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1.5 rounded text-xs transition-colors duration-200"
                              >
                                Add Once
                              </button>
                              <button
                                onClick={() => handleAddSong(song)}
                                className="bg-green-600 hover:bg-green-700 text-white px-2 py-1.5 rounded text-xs transition-colors duration-200"
                              >
                                Add Song
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400">
                <h2 className="text-xl lg:text-2xl font-semibold mb-4">Welcome to DJ Bot</h2>
                <p className="text-base lg:text-lg">Use the search bar above to find your favorite songs or select Autoplay to start your music.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const AppWithAuth: React.FC = () => {
  return (
    <AuthProvider>
      <AuthGuard>
        <DjUserAuthProvider>
          <App />
        </DjUserAuthProvider>
      </AuthGuard>
    </AuthProvider>
  );
};

export default AppWithAuth;
