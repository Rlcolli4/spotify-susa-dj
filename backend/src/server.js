const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
//const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const spotifyService = require('./services/spotifyService');
const databaseService = require('./services/databaseService');
const { enforceAutoplaySchedule, runAutoplayTick } = require('./services/autoplayService');
const { isArizonaQuietHours } = require('./utils/arizonaTime');

// Import routes
const authRoutes = require('./routes/auth');
const spotifyRoutes = require('./routes/spotify');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3001;

let activeQueue = null;
let queueStatus = 'stop';
let spotifyStatus = null;

// Security middleware
app.use(helmet());

// CORS configuration
console.log('CORS_ALLOWED_ORIGINS:', process.env.CORS_ALLOWED_ORIGINS);
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Rate limiting
/*const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);*/

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/analytics', analyticsRoutes);

//QUEUE ROUTES//
app.get('/api/queue', async (req, res) => {
  try {
    res.json({
      queue: activeQueue,
      status: queueStatus,
      spotify: spotifyStatus
    }

    );
  } catch (error) {
    logger.error('Failed to get active queue:', error);
    res.status(500).json({ error: 'Failed to get active queue', details: error.message });
  }
});
app.post('/api/queue', async (req, res) => {
  try {
    console.log(req.body);
    const songToAdd = req.body;
    await databaseService.addToPlaybackQueue(
      songToAdd.songId,
      songToAdd.songName,
      songToAdd.artist,
      songToAdd.albumName,
      songToAdd.albumArt,
      songToAdd.duration,
      songToAdd.userId || ''
    );
    const trackQueue = await databaseService.getCurrentPlaybackQueue();
    queue = trackQueue;
    res.json(trackQueue);
  } catch (error) {
    logger.error('Failed to add to song queue:', error);
    res.status(500).json({ error: 'Failed to add to song queue', details: error.message });
  }
});
//clear queue
app.delete('/api/queue', async (req, res) => {
  try {

    await databaseService.clearPlaybackQueue();

    res.json([]);
  } catch (error) {
    logger.error('Failed to clear active queue:', error);
    res.status(500).json({ error: 'Failed to clear active queue', details: error.message });
  }
});
//remove specific track from queue
app.delete('/api/queue/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    await databaseService.removeFromPlaybackQueue(trackId);
    const trackQueue = await databaseService.getCurrentPlaybackQueue();
    activeQueue = trackQueue;
    res.json(trackQueue);
  } catch (error) {
    logger.error('Failed to remove track from queue:', error);
    res.status(500).json({ error: 'Failed to remove track from queue', details: error.message });
  }
});

/////////////////
//STATUS ROUTES//
app.post('/api/status', async (req, res) => {
  try {
    const { status, userId } = req.body;
    if (!['play', 'autoplay', 'stop'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    if (status === 'autoplay' && isArizonaQuietHours()) {
      return res.status(400).json({ error: 'Autoplay is unavailable from midnight to 7:00 AM Arizona time' });
    }

    await databaseService.updatePlaybackStatus(status, userId || 'system');
    queueStatus = status;
    res.json({ status: queueStatus });
  } catch (error) {
    logger.error('Failed to update playback status:', error);
    res.status(500).json({ error: 'Failed to update playback status', details: error.message });
  }
});
/////////////////


// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize services and start server
async function startServer() {
  try {
    // Initialize Spotify service
    //await spotifyService.initialize();

    // Initialize database connection
    await databaseService.initialize();

    // Start the server
    app.listen(PORT, () => {
      logger.info(`🚀 Spotify DJ Bot backend running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV}`);


      setInterval(async () => {
        try {
          if (!spotifyService.isTokenValid()) {
            queueStatus = await enforceAutoplaySchedule(databaseService);
            return;
          }

          const tickState = await runAutoplayTick({ databaseService, spotifyService, playTrack });
          activeQueue = tickState.activeQueue;
          queueStatus = tickState.queueStatus;
          spotifyStatus = tickState.spotifyStatus;
        } catch (error) {
          logger.error('Failed to get current playback:', error);
        }
      }, 10000);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function playTrack(trackId) {
  try {
    const trackUri = `spotify:track:${trackId}`;
    await spotifyService.play([trackUri]);
  } catch (error) {
    logger.error('Failed to play track:', error);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await databaseService.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await databaseService.close();
  process.exit(0);
});

startServer();
