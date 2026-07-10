/**
 * Intro Skipper - content script
 * Runs on youtube.com pages: checks the channel name of the video currently playing.
 * If it matches a rule the user configured, seeks to the configured second (default 15s).
 */

(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    defaultSkipSeconds: 14,
    channels: [], // [{ name: string, enabled: boolean }]
  };

  let cachedSettings = DEFAULT_SETTINGS;
  let settingsLoaded = false;
  let checkTimer = null;
  const DEBUG = true; // Enable logging to help debug via DevTools console (press F12 and check Console)

  function log(...args) {
    if (DEBUG) console.log("[IntroSkipper]", ...args);
  }

  function normalize(name) {
    return (name || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
  }

  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      cachedSettings = items;
      settingsLoaded = true;
    });
  }

  loadSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      loadSettings();
    }
  });

  function getVideoIdFromUrl() {
    try {
      const url = new URL(location.href);
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/")[2] || null;
      }
      return url.searchParams.get("v");
    } catch (e) {
      return null;
    }
  }

  // ytd-watch-flexy reflects the video-id of the video that is "actually rendered" right now.
  // Used to guard against the SPA navigating while the DOM (channel name) hasn't updated to match the new URL yet.
  function getRenderedVideoId() {
    const flexy = document.querySelector("ytd-watch-flexy");
    return flexy ? flexy.getAttribute("video-id") : null;
  }

  function getChannelName() {
    const selectors = [
      "ytd-watch-metadata ytd-channel-name a",
      "ytd-channel-name a.yt-formatted-string", // selector used by SponsorBlock as its main fallback
      "ytd-video-owner-renderer ytd-channel-name yt-formatted-string a",
      "#above-the-fold ytd-channel-name a",
      "#upload-info ytd-channel-name a",
      "#owner #channel-name a",
      "#channel-name yt-formatted-string a",
      "ytd-channel-name#channel-name a",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el && (el.innerText || el.textContent);
      const trimmed = text && text.trim();
      if (trimmed) return trimmed;
    }
    return null;
  }

  function findMatchingChannelRule(channelName) {
    if (!channelName) return null;
    const normalizedChannel = normalize(channelName);
    return (cachedSettings.channels || []).find(
      (c) => c.enabled !== false && normalize(c.name) === normalizedChannel
    );
  }

  // ---- Decision state per video ----
  // resolved=false means we don't yet know whether this channel's intro should be skipped.
  // Playback is left completely untouched until we positively confirm a matching channel.
  let decision = { videoId: null, resolved: false, skip: false };
  let resolvingVideoId = null;
  const gatedVideos = new WeakSet();
  // Videos we've paused ourselves while determining the channel (as opposed to the user pausing).
  // Tracked so we know whether/when to resume playback once a decision is made.
  const gatePausedVideos = new WeakSet();

  function resetDecisionIfNeeded(videoId) {
    if (decision.videoId !== videoId) {
      decision = { videoId, resolved: false, skip: false };
    }
  }

  function resumePlayback(video) {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }

  function performSeekAndResume(video, seconds, resumeAfter) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      video.removeEventListener("seeked", finish);
      if (resumeAfter) resumePlayback(video);
    };

    if (video.duration && seconds >= video.duration) {
      finish();
      return;
    }
    try {
      video.addEventListener("seeked", finish, { once: true });
      video.currentTime = seconds;
    } catch (e) {
      finish();
      return;
    }
    // Guard against the "seeked" event not firing (e.g. the new time equals the current time) by resuming after a timeout
    setTimeout(finish, 1500);
  }

  function releaseGate(video) {
    if (gatePausedVideos.has(video)) {
      gatePausedVideos.delete(video);
      resumePlayback(video);
    }
  }

  function giveUp(video, videoId) {
    if (decision.videoId === videoId) {
      decision.resolved = true;
      decision.skip = false;
    }
    if (resolvingVideoId === videoId) resolvingVideoId = null;
    releaseGate(video);
    log("Could not determine channel info in time, resuming playback untouched", { videoId });
  }

  // Repeatedly try to find the channel name every 50ms until found, or until the deadline is reached.
  // The video is paused as soon as we begin resolving (see beginResolving) so that no intro frame can
  // ever be shown, even briefly, while we determine the channel. Non-matching channels are resumed
  // immediately once determined; matching channels are seeked first, then resumed.
  function resolveDecision(video, videoId, deadline) {
    if (decision.videoId !== videoId || decision.resolved) {
      if (resolvingVideoId === videoId) resolvingVideoId = null;
      return;
    }
    if (getVideoIdFromUrl() !== videoId) {
      // The user already switched to a different video before we finished deciding; let the new video handle itself
      resolvingVideoId = null;
      return;
    }

    const timedOut = Date.now() > deadline;
    const renderedVideoId = getRenderedVideoId();
    const domSynced = !renderedVideoId || renderedVideoId === videoId;
    // Don't match against the channel list until settings have actually loaded from storage
    // (the script runs at document_start, so an early autoplay could otherwise be resolved
    // against the empty default channel list and wrongly released without skipping).
    const channelName = settingsLoaded && domSynced ? getChannelName() : null;

    if (!channelName) {
      if (timedOut) {
        giveUp(video, videoId);
        return;
      }
      setTimeout(() => resolveDecision(video, videoId, deadline), 50);
      return;
    }

    const rule = findMatchingChannelRule(channelName);
    decision.resolved = true;
    resolvingVideoId = null;

    if (!rule) {
      log("No rule for this channel, resuming playback untouched", { channelName });
      decision.skip = false;
      releaseGate(video);
      return;
    }

    // Matching channel confirmed: seek then resume (video is already paused by the gate in beginResolving).
    const seconds = cachedSettings.defaultSkipSeconds;
    decision.skip = true;
    log("Matching channel detected, skipping intro", { channelName, seconds, videoId });

    gatePausedVideos.delete(video);
    performSeekAndResume(video, seconds, true);
  }

  function beginResolving(video, videoId) {
    resetDecisionIfNeeded(videoId);
    if (decision.resolved) return;
    if (resolvingVideoId === videoId) return; // already resolving
    resolvingVideoId = videoId;

    // Pause immediately, before we know the channel, so no intro frame can ever be shown even briefly.
    // Channel detection is normally near-instant (the name is already in the DOM), so this is typically
    // imperceptible even for channels that turn out not to match.
    if (!video.paused && !video.ended) {
      video.pause();
      gatePausedVideos.add(video);
    }

    resolveDecision(video, videoId, Date.now() + 3000);
  }

  // Detect as soon as the video "starts playing" (autoplay or user pressed play). beginResolving() pauses
  // the video right away so no intro frame can leak through while we determine the channel.
  function onVideoActivity(event) {
    if (!cachedSettings.enabled) return;
    const video = event.target;
    const videoId = getVideoIdFromUrl();
    if (!videoId) return;

    resetDecisionIfNeeded(videoId);
    if (decision.resolved) return; // already decided for this video, let it play normally

    // Already resolving this video: YouTube's player may restart playback on its own mid-resolution
    // (it often calls play() again). Pause it right back so the intro can't leak through while we wait.
    if (resolvingVideoId === videoId) {
      if (!video.paused && !video.ended) {
        video.pause();
        gatePausedVideos.add(video);
      }
      return;
    }

    beginResolving(video, videoId);
  }

  function attachGate(video) {
    if (gatedVideos.has(video)) return;
    gatedVideos.add(video);
    video.addEventListener("play", onVideoActivity);
  }

  // Catch activity from ANY video element the moment it happens, even for elements created later or
  // before the per-element gate is attached. These media events don't bubble, but a capture-phase
  // listener on the document still sees them.
  // - "play"/"playing": autoplay or user pressing play, plus YouTube restarting playback mid-resolution
  // - "loadstart": a new video loading into the SAME element during gapless SPA navigation, where
  //   playback continues without a new "play" event ever firing
  for (const eventName of ["play", "playing", "loadstart"]) {
    document.addEventListener(
      eventName,
      (event) => {
        if (event.target && event.target.tagName === "VIDEO") {
          attachGate(event.target);
          onVideoActivity(event);
        }
      },
      true
    );
  }

  function ensureGateAttached() {
    const video = document.querySelector("video.html5-main-video") || document.querySelector("video");
    if (video) attachGate(video);
    return video;
  }

  // fallback: in case the 'play' event is missed (e.g. the script loads after the video already started playing)
  function checkAndSkip() {
    if (!cachedSettings.enabled) return;

    const videoId = getVideoIdFromUrl();
    if (!videoId) return;

    const video = ensureGateAttached();
    if (!video) return;

    resetDecisionIfNeeded(videoId);
    if (decision.resolved) return;
    if (resolvingVideoId === videoId) return;

    beginResolving(video, videoId);
  }

  // YouTube is an SPA, so we need to listen for navigation events plus a fallback interval
  document.addEventListener("yt-navigate-finish", () => {
    setTimeout(checkAndSkip, 100);
    setTimeout(checkAndSkip, 500);
    setTimeout(checkAndSkip, 1500);
  });

  checkTimer = setInterval(checkAndSkip, 500);

  // In case the popup wants to fetch the channel name of the video currently open (the "Use Current Channel" button)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "getChannelName") {
      sendResponse({ channelName: getChannelName() });
    }
    return true;
  });

  checkAndSkip();
})();
