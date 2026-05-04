-- Squashed: add_podcast_support + podcast_download_policy_default_manual + add_podcast_subscribed + add_podcast_episode_progress

-- Enums
CREATE TYPE "DownloadPolicy" AS ENUM ('ALL', 'LATEST_N', 'MANUAL');
CREATE TYPE "RetentionPolicy" AS ENUM ('KEEP_ALL', 'DELETE_AFTER_LISTENED', 'KEEP_LATEST_N');
CREATE TYPE "EpisodeDownloadStatus" AS ENUM ('NOT_DOWNLOADED', 'PENDING', 'DOWNLOADING', 'DOWNLOADED', 'FAILED');

-- Podcast
CREATE TABLE "Podcast" (
    "id" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "artworkUrl" TEXT,
    "author" TEXT,
    "websiteUrl" TEXT,
    "lastRefreshedAt" TIMESTAMP(3),
    "nextRefreshAt" TIMESTAMP(3),
    "refreshIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "downloadPolicy" "DownloadPolicy" NOT NULL DEFAULT 'MANUAL',
    "keepLatestN" INTEGER,
    "retentionPolicy" "RetentionPolicy" NOT NULL DEFAULT 'KEEP_ALL',
    "subscribed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Podcast_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Podcast_feedUrl_key" ON "Podcast"("feedUrl");

-- PodcastEpisode
CREATE TABLE "PodcastEpisode" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publishedAt" TIMESTAMP(3),
    "duration" DOUBLE PRECISION,
    "audioUrl" TEXT NOT NULL,
    "downloadStatus" "EpisodeDownloadStatus" NOT NULL DEFAULT 'NOT_DOWNLOADED',
    "downloadPath" TEXT,
    "fileSize" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PodcastEpisode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PodcastEpisode_podcastId_guid_key" ON "PodcastEpisode"("podcastId", "guid");

ALTER TABLE "PodcastEpisode" ADD CONSTRAINT "PodcastEpisode_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PodcastEpisodeProgress
CREATE TABLE "PodcastEpisodeProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "currentTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PodcastEpisodeProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PodcastEpisodeProgress_userId_episodeId_key" ON "PodcastEpisodeProgress"("userId", "episodeId");

ALTER TABLE "PodcastEpisodeProgress" ADD CONSTRAINT "PodcastEpisodeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PodcastEpisodeProgress" ADD CONSTRAINT "PodcastEpisodeProgress_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "PodcastEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
