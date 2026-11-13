import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './src/services/playback/service';

TrackPlayer.registerPlaybackService(() => PlaybackService);

require('expo-router/entry');
