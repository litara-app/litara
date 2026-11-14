---
sidebar_position: 6
---

# Podcasts

Litara includes a built-in podcast manager. You can subscribe to any podcast via its RSS feed URL, download episodes to your server, and play them from the web or mobile app — with progress synced across devices.

Litara is mainly meant to archive podcasts that may disappear in the future, or to keep an archive of your favorite podcasts/episodes. For just listening to podcasts, Litara will not have the advanced podcast features you may be familiar with.

:::note
Podcasts must be enabled by an administrator before they appear in the UI. See [Admin Settings](#enabling-podcasts) below.
:::

## Enabling podcasts

An admin must enable the feature under **Admin → General → Podcasts**. Once enabled, a **Podcasts** entry appears in the sidebar for all users.

Optionally, set `PODCAST_STORAGE_PATH` in your environment (or `docker-compose.yml`) to control where downloaded episode files are stored. If unset, files are saved to `<data>/podcasts/` inside the container.

## Subscribing to a podcast

1. Navigate to **Podcasts** in the sidebar.
2. Click **Subscribe** and paste the RSS feed URL.
3. Litara fetches the feed, creates the podcast record, and imports the episode list.

## Downloading episodes

Episodes are not downloaded automatically unless you configure a download policy. To download an episode manually:

- On the **Podcast detail** page, click the download icon next to any episode.

Download status is shown as a badge on each episode row:

| Status         | Meaning                                           |
| -------------- | ------------------------------------------------- |
| Not downloaded | File has not been fetched                         |
| Pending        | Queued for download                               |
| Downloading    | Currently being fetched                           |
| Downloaded     | File is on the server and ready to play           |
| Failed         | Download attempt failed — click the icon to retry |

### Automatic download policies

On the podcast detail page you can configure a per-podcast download policy:

| Policy   | Behaviour                                                   |
| -------- | ----------------------------------------------------------- |
| Manual   | No automatic downloads (default)                            |
| All      | Download every new episode as soon as the feed is refreshed |
| Latest N | Keep only the N most recent episodes downloaded             |

## Playing an episode

Only downloaded episodes can be played. Click the **play** button on any downloaded episode row to start playback. The mini-player bar appears at the bottom of the screen.

### Web player

The web player floats at the bottom of every page while an episode is playing.

| Control           | Description                       |
| ----------------- | --------------------------------- |
| Play / Pause      | Toggle playback                   |
| Skip back 30 s    | Jump back 30 seconds              |
| Skip forward 30 s | Jump forward 30 seconds           |
| Progress slider   | Seek anywhere in the episode      |
| Playback speed    | 0.5× – 2× (saved across sessions) |

### Mobile player

Tap the mini-player bar at the bottom to open the full-screen episode player. It provides the same controls as the web player.

## Progress tracking

Playback position is saved to the server every 10 seconds. When you return to an episode, playback resumes from where you left off. Progress is shown as a small bar and a timestamp on each downloaded episode row.

An episode is automatically marked as listened when playback reaches 95% of its duration.

## Feed refresh

Litara refreshes subscribed podcast feeds on a schedule (configurable per podcast, minimum 15 minutes). You can also trigger an immediate refresh from the podcast detail page using the **Refresh Feed** button.

## Unsubscribing

Click **Unsubscribe** on the podcast detail page. You will be prompted whether to keep or delete downloaded episode files.
