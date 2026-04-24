export interface Song {
  songId: string;
  albumName: string;
  songName: string;
  albumArt: string;
  artist: string;
  duration: number;
  releaseDate: string;
  popularity: number;
  userId: string;
  skipHistory?: boolean;
}
