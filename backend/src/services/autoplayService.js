const logger = require('../utils/logger');
const {
  getArizonaDateString,
  isArizonaQuietHours,
  wasUpdatedBeforeTodayEveningCutoff
} = require('../utils/arizonaTime');

function getTrackValue(track, camelName, lowerName) {
  return track[camelName] || track[lowerName];
}

async function logAndPlayTrack(track, playTrack, databaseService, messagePrefix) {
  await playTrack(getTrackValue(track, 'trackId', 'trackid'));
  await databaseService.logPlaybackEvent({
    trackId: getTrackValue(track, 'trackId', 'trackid'),
    trackName: getTrackValue(track, 'trackName', 'trackname'),
    artistName: getTrackValue(track, 'artistName', 'artistname'),
    albumName: getTrackValue(track, 'albumName', 'albumname'),
    userId: getTrackValue(track, 'userId', 'userid')
  });
  logger.info(`${messagePrefix}: ${getTrackValue(track, 'trackName', 'trackname')} by ${getTrackValue(track, 'artistName', 'artistname')}`);
}

function shouldStopAutoplayForSchedule(playbackStatus, now = new Date()) {
  if (playbackStatus.status !== 'autoplay') {
    return false;
  }

  return (
    isArizonaQuietHours(now) ||
    wasUpdatedBeforeTodayEveningCutoff(playbackStatus.dateUpdated || playbackStatus.date_updated, now)
  );
}

async function enforceAutoplaySchedule(databaseService, now = new Date()) {
  const playbackStatus = await databaseService.getPlaybackStatusRecord();

  if (shouldStopAutoplayForSchedule(playbackStatus, now)) {
    await databaseService.updatePlaybackStatus('stop', 'system');
    return 'stop';
  }

  return playbackStatus.status;
}

async function runAutoplayTick({ databaseService, spotifyService, playTrack, now = new Date() }) {
  const trackQueue = await databaseService.getCurrentPlaybackQueue();
  const playbackStatus = await databaseService.getPlaybackStatusRecord();
  let queueStatus = playbackStatus.status;
  const spotifyPlayback = await spotifyService.getCurrentPlayback();

  const spotifyStatus = {
    isPlaying: spotifyPlayback.is_playing || false,
    item: spotifyPlayback.item || null,
    progressMs: spotifyPlayback.progress_ms || 0
  };

  if (queueStatus === 'autoplay') {
    if (shouldStopAutoplayForSchedule(playbackStatus, now)) {
      await databaseService.updatePlaybackStatus('stop', 'system');
      return {
        activeQueue: trackQueue,
        queueStatus: 'stop',
        spotifyStatus
      };
    }
  }

  if (queueStatus === 'autoplay' && trackQueue.length === 0 && !spotifyStatus.isPlaying) {
    const autoplayTracks = await databaseService.getAutoplayTracks(1, getArizonaDateString(now));
    if (autoplayTracks.length > 0) {
      await logAndPlayTrack(autoplayTracks[0], playTrack, databaseService, 'Added random track to queue');
    }
  }

  if ((queueStatus === 'autoplay' || queueStatus === 'play') && trackQueue.length > 0 && !spotifyStatus.isPlaying) {
    const nextTrack = trackQueue[0];
    await logAndPlayTrack(nextTrack, playTrack, databaseService, 'Now playing');
    await databaseService.removeFromPlaybackQueue(getTrackValue(nextTrack, 'trackId', 'trackid'));
    return {
      activeQueue: await databaseService.getCurrentPlaybackQueue(),
      queueStatus,
      spotifyStatus
    };
  }

  return {
    activeQueue: trackQueue,
    queueStatus,
    spotifyStatus
  };
}

module.exports = {
  enforceAutoplaySchedule,
  runAutoplayTick
};
