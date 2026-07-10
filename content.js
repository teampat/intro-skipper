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

  function giveUp(videoId) {
    if (decision.videoId === videoId) {
      decision.resolved = true;
      decision.skip = false;
    }
    if (resolvingVideoId === videoId) resolvingVideoId = null;
    log("Could not determine channel info in time, leaving playback untouched", { videoId });
  }

  // Repeatedly try to find the channel name every 50ms until found, or until the deadline is reached.
  // Autoplay is NOT paused during this detection phase — only once a configured channel is confirmed
  // do we pause, seek, and resume. Non-matching channels are never touched at all.
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
    const channelName = domSynced ? getChannelName() : null;

    if (!channelName) {
      if (timedOut) {
        giveUp(videoId);
        return;
      }
      setTimeout(() => resolveDecision(video, videoId, deadline), 50);
      return;
    }

    const rule = findMatchingChannelRule(channelName);
    decision.resolved = true;
    resolvingVideoId = null;

    if (!rule) {
      log("No rule for this channel, leaving autoplay untouched", { channelName });
      decision.skip = false;
      return;
    }

    // Matching channel confirmed: only now do we pause (if currently playing), seek, then resume.
    const seconds = cachedSettings.defaultSkipSeconds;
    decision.skip = true;
    log("Matching channel detected, skipping intro", { channelName, seconds, videoId });

    const wasPlaying = !video.paused && !video.ended;
    if (wasPlaying) video.pause();
    performSeekAndResume(video, seconds, wasPlaying);
  }

  function beginResolving(video, videoId) {
    resetDecisionIfNeeded(videoId);
    if (decision.resolved) return;
    if (resolvingVideoId === videoId) return; // already resolving
    resolvingVideoId = videoId;
    resolveDecision(video, videoId, Date.now() + 3000);
  }

  // Detect as soon as the video "starts playing" (autoplay or user pressed play). Detection itself never
  // pauses the video — only a confirmed matching channel triggers a pause+seek+resume (see resolveDecision).
  function onVideoPlay(event) {
    if (!cachedSettings.enabled) return;
    const video = event.target;
    const videoId = getVideoIdFromUrl();
    if (!videoId) return;

    resetDecisionIfNeeded(videoId);
    if (decision.resolved) return; // already decided for this video, let it play normally

    beginResolving(video, videoId);
  }

  function attachGate(video) {
    if (gatedVideos.has(video)) return;
    gatedVideos.add(video);
    video.addEventListener("play", onVideoPlay);
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
