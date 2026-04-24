const { Pool } = require('pg');
const logger = require('../utils/logger');
const { getArizonaDateString } = require('../utils/arizonaTime');

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Create connection pool
      this.pool = new Pool({
        //connectionString: process.env.DATABASE_URL,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        max: 20, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
      });



      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isInitialized = true;
      logger.info('Database connection pool initialized successfully');

      // Create tables if they don't exist
      await this.createTables();
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async createTables() {
    try {
      const client = await this.pool.connect();

      // Create playback_history table
      await client.query(`
        CREATE TABLE IF NOT EXISTS track_history (
          id SERIAL PRIMARY KEY,
          track_id VARCHAR(50) NOT NULL,
          track_name VARCHAR(100),
          artist_name VARCHAR(100),
          album_name VARCHAR(100),
          user_id text NOT NULL,
          added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          times_played INTEGER NOT NULL DEFAULT 1,
          banned BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);

      await client.query(`
        ALTER TABLE track_history
          ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ALTER COLUMN last_played_at SET DEFAULT CURRENT_TIMESTAMP;
      `);

      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_playback_history_user_id ON track_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_playback_history_track_id ON track_history(track_id);
        CREATE INDEX IF NOT EXISTS idx_track_history_autoplay_daily ON track_history(banned, last_played_at);
      `);

      // Create playback_queue && playback_status table, set default status of stop, clear queue
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.playback_queue
        (
            track_id character varying(50) COLLATE pg_catalog."default" NOT NULL,
            track_name character varying(100) COLLATE pg_catalog."default",
            artist_name character varying(100) COLLATE pg_catalog."default",
            album_name character varying(100) COLLATE pg_catalog."default",
            album_art text COLLATE pg_catalog."default",
            duration integer,
            user_id text COLLATE pg_catalog."default" NOT NULL,
            added_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
            play_order integer NOT NULL DEFAULT 1
        )

        TABLESPACE pg_default;

        CREATE TABLE IF NOT EXISTS public.playback_status
        (
            status text NOT NULL DEFAULT 'stop',
            user_id text COLLATE pg_catalog."default",
            date_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
        )

        TABLESPACE pg_default;

        CREATE TABLE IF NOT EXISTS public.dj_users
        (
            user_id text NOT NULL,
            user_name text NOT NULL COLLATE pg_catalog."default",
            user_code text NOT NULL
        )

        TABLESPACE pg_default;
      `);

      await client.query(`
        TRUNCATE public.playback_queue;
        TRUNCATE public.playback_status;
        INSERT INTO public.playback_status (status, user_id, date_updated) VALUES ('stop', 'system', now());
      `);

      client.release();
      logger.info('Database tables created successfully');
    } catch (error) {
      logger.error('Failed to create database tables:', error);
      throw error;
    }
  }


  // Log playback event
  async logPlaybackEvent(playbackData) {
    try {
      const {
        trackId,
        trackName,
        artistName,
        albumName,
        userId
      } = playbackData;
      const checkQuery = `
        SELECT id FROM track_history
        WHERE track_id = $1
      `;

      const existingCheck = await this.pool.query(checkQuery, [trackId]);

      if (existingCheck.rows.length > 0) {
        // If entry exists, update the times_played count
        const updateQuery = `
          UPDATE track_history
          SET times_played = times_played + 1,
              last_played_at = now()
          WHERE id = $1
          RETURNING id
        `;
        const result = await this.pool.query(updateQuery, [existingCheck.rows[0].id]);
        logger.info(`Playback event updated: ${trackName} by ${artistName}`);
        return result.rows[0];
      }
      else {
        const query = `
          INSERT INTO track_history
          (track_id, track_name, artist_name, album_name, user_id, last_played_at) 
          VALUES ($1, $2, $3, $4, $5, now())
          RETURNING id
        `;

        const values = [
          trackId,
          trackName,
          artistName,
          albumName,
          userId
        ];

        const result = await this.pool.query(query, values);

        logger.info(`Playback event logged: ${trackName} by ${artistName}`);
        return result.rows[0];
      }

    } catch (error) {
      logger.error('Failed to log playback event:', error);
      throw error;
    }
  }


  // Get popular tracks
  async getPopularTracks(limit = 1) {
    try {
      const query = `
        SELECT 
          ph.track_id,
          ph.track_name,
          ph.artist_name,
          ph.album_name,
          COUNT(*) as play_count
        FROM track_history ph
        WHERE ph.played_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
        GROUP BY ph.track_id, ph.track_name, ph.artist_name, ph.album_name
        ORDER BY play_count DESC
        LIMIT $1
      `;

      const result = await this.pool.query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get popular tracks:', error);
      throw error;
    }
  }

  // Get popular artists
  async getPopularArtists(limit = 10, days = 30) {
    try {
      const query = `
        SELECT 
          ph.artist_name,
          COUNT(*) as play_count,
          COUNT(DISTINCT ph.track_id) as unique_tracks
        FROM track_history ph
        WHERE ph.played_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
        GROUP BY ph.artist_name
        ORDER BY play_count DESC
        LIMIT $1
      `;

      const result = await this.pool.query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get popular artists:', error);
      throw error;
    }
  }

  // Close database connection
  async close() {
    if (this.pool) {
      await this.pool.end();
      logger.info('Database connection pool closed');
    }
  }

  // Health check
  async healthCheck() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
    }
  }

  async getRandomTracks(limit = 1) {
    try {
      const query = `
        SELECT 
          ph.track_id as trackId,
          ph.track_name as trackName,
          ph.artist_name as artistName,
          ph.album_name as albumName,
          ph.user_id as userId
        FROM track_history ph
        WHERE banned = false
        ORDER BY RANDOM()
        LIMIT $1
      `;
      const result = await this.pool.query(query, [limit]);
      console.log(result.rows);
      return result.rows;
    }
    catch (error) {
      logger.error('Failed to get random tracks:', error);
      throw error;
    }
  }

  async getAutoplayTracks(limit = 1, playedOnArizonaDate = getArizonaDateString()) {
    try {
      const unplayedTodayQuery = `
        SELECT
          ph.track_id as trackId,
          ph.track_name as trackName,
          ph.artist_name as artistName,
          ph.album_name as albumName,
          ph.user_id as userId
        FROM track_history ph
        WHERE banned = false
          AND (last_played_at IS NULL OR last_played_at::date < $2::date)
        ORDER BY RANDOM()
        LIMIT $1
      `;
      const unplayedTodayResult = await this.pool.query(unplayedTodayQuery, [limit, playedOnArizonaDate]);
      if (unplayedTodayResult.rows.length > 0) {
        return unplayedTodayResult.rows;
      }

      const fallbackQuery = `
        SELECT
          ph.track_id as trackId,
          ph.track_name as trackName,
          ph.artist_name as artistName,
          ph.album_name as albumName,
          ph.user_id as userId
        FROM track_history ph
        WHERE banned = false
        ORDER BY RANDOM()
        LIMIT $1
      `;
      const fallbackResult = await this.pool.query(fallbackQuery, [limit]);
      return fallbackResult.rows;
    }
    catch (error) {
      logger.error('Failed to get autoplay tracks:', error);
      throw error;
    }
  }

  async getUserForTrack(trackId) {
    try {
      const query = `
        SELECT user_id
        FROM track_history
        WHERE track_id = $1
        LIMIT 1
      `;
      const result = await this.pool.query(query, [trackId]);
      if (result.rows.length === 0) {
        throw new Error('Track not found');
      }
      return result.rows[0].user_id;
    }
    catch (error) {
      logger.error('Failed to get user for track:', error);
      throw error;
    }
  }

  async removeTrackFromHistory(trackId) {
    try {
      const deleteQuery = `
        UPDATE track_history
        SET banned = true
        WHERE track_id = $1
      `;
      await this.pool.query(deleteQuery, [trackId]);
      logger.info(`Track removed from history: ${trackId}`);
    }
    catch (error) {
      logger.error('Failed to remove track from history:', error);
      throw error;
    }
  }

  // Get current playback queue
  async getCurrentPlaybackQueue() {
    try {
      const query = `
        SELECT track_id as trackId, track_name as trackName, artist_name as artistName, 
          album_name as albumName, album_art as albumArt, duration,
          user_id as userId, added_at as dateAdded, play_order as order
        FROM public.playback_queue
        ORDER BY play_order ASC
      `;
      const result = await this.pool.query(query);

      return result.rows;
    }
    catch (error) {
      logger.error('Failed to getCurrentPlaybackQueue', error);
      throw error;
    }
  }

  async addToPlaybackQueue(trackId, trackName, artistName, albumName, albumArt, duration, userId) {
    try {
      const orderQuery = `
        SELECT COALESCE(MAX(play_order), 0) + 1 AS next_order
        FROM public.playback_queue
      `;
      const orderResult = await this.pool.query(orderQuery);
      const nextOrder = orderResult.rows[0].next_order;
      const insertQuery = `
        INSERT INTO public.playback_queue 
        (track_id, track_name, artist_name, album_name, album_art, duration, user_id, play_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      const values = [trackId, trackName, artistName, albumName, albumArt, duration, userId, nextOrder];
      await this.pool.query(insertQuery, values);
      logger.info(`Track added to playback queue: ${trackName} by ${artistName}`);
    }
    catch (error) {
      logger.error('Failed to addToPlaybackQueue', error);
      throw error;
    }
  }

  async removeFromPlaybackQueue(trackId) {
    try {
      const deleteQuery = `
        DELETE FROM public.playback_queue
        WHERE track_id = $1
      `;
      await this.pool.query(deleteQuery, [trackId]);
      logger.info(`Track removed from playback queue: ${trackId}`);
    }
    catch (error) {
      logger.error('Failed to removeFromPlaybackQueue', error);
      throw error;
    }
  }

  async clearPlaybackQueue() {
    try {
      const deleteQuery = `
        TRUNCATE public.playback_queue
      `;
      await this.pool.query(deleteQuery);
      logger.info(`Cleared playback queue`);
    }
    catch (error) {
      logger.error('Failed to clear playback queue', error);
      throw error;
    }
  }

  async getPlaybackStatus() {
    try {
      const query = ` 
        SELECT status
        FROM public.playback_status
        LIMIT 1
      `;
      const result = await this.pool.query(query);
      return result.rows[0].status;
    }
    catch (error) {
      logger.error('Failed to getPlaybackStatus', error);
      throw error;
    }
  }

  async getPlaybackStatusRecord() {
    try {
      const query = `
        SELECT status, user_id, date_updated
        FROM public.playback_status
        LIMIT 1
      `;
      const result = await this.pool.query(query);
      return result.rows[0];
    }
    catch (error) {
      logger.error('Failed to getPlaybackStatusRecord', error);
      throw error;
    }
  }

  async updatePlaybackStatus(status, userId) {
    try {
      const updateQuery = `
        UPDATE public.playback_status
        SET status = $1, user_id = $2, date_updated = now()
      `;
      await this.pool.query(updateQuery, [status, userId]);
      logger.info(`Playback status updated to: ${status}`);
    }
    catch (error) {
      logger.error('Failed to updatePlaybackStatus', error);
      throw error;
    }
  }

  async getDjUserByCode(code) {
    try {
      const query = `
        SELECT user_name, user_id
        FROM dj_users
        WHERE user_code = $1
        LIMIT 1
      `;
      const result = await this.pool.query(query, [code]);
      if (result.rows.length === 0) {
        throw new Error('Invalid verification code');
      }
      return { id: result.rows[0].user_id, username: result.rows[0].user_name };
    }
    catch (error) {
      logger.error('Failed to get DJ user by code:', error);
      throw error;
    }
  }

}

module.exports = new DatabaseService();
