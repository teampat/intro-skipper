const DEFAULT_SETTINGS = {
  enabled: true,
  defaultSkipSeconds: 14,
  channels: [], // [{ name, enabled }]
};

const enabledToggle = document.getElementById("enabledToggle");
const defaultSecondsInput = document.getElementById("defaultSeconds");
const newChannelNameInput = document.getElementById("newChannelName");
const addChannelBtn = document.getElementById("addChannelBtn");
const useCurrentChannelBtn = document.getElementById("useCurrentChannelBtn");
const channelListEl = document.getElementById("channelList");
const emptyStateEl = document.getElementById("emptyState");
const statusMsg = document.getElementById("statusMsg");

let settings = structuredClone(DEFAULT_SETTINGS);

function checkActiveTabForYouTube() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const onYouTubeWatch = !!tab && !!tab.url && tab.url.includes("youtube.com/watch");
    useCurrentChannelBtn.disabled = !onYouTubeWatch;
    useCurrentChannelBtn.title = onYouTubeWatch
      ? "Use the channel name from the current YouTube tab"
      : "Open a YouTube video page to use this button";
  });
}

function showStatus(text) {
  statusMsg.textContent = text;
  setTimeout(() => {
    if (statusMsg.textContent === text) statusMsg.textContent = "";
  }, 1500);
}

function saveSettings() {
  chrome.storage.sync.set(settings, () => showStatus("Saved"));
}

function render() {
  enabledToggle.checked = !!settings.enabled;
  defaultSecondsInput.value = settings.defaultSkipSeconds;

  channelListEl.innerHTML = "";
  const channels = settings.channels || [];
  emptyStateEl.style.display = channels.length ? "none" : "block";

  channels.forEach((ch, index) => {
    const li = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = ch.enabled !== false;
    checkbox.title = "Enable/disable for this channel";
    checkbox.addEventListener("change", () => {
      settings.channels[index].enabled = checkbox.checked;
      saveSettings();
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "ch-name";
    nameSpan.textContent = ch.name;
    nameSpan.title = ch.name;

    const secondsSpan = document.createElement("span");
    secondsSpan.className = "ch-seconds";
    secondsSpan.textContent = `${settings.defaultSkipSeconds}s`;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      settings.channels.splice(index, 1);
      saveSettings();
      render();
    });

    li.appendChild(checkbox);
    li.appendChild(nameSpan);
    li.appendChild(secondsSpan);
    li.appendChild(removeBtn);
    channelListEl.appendChild(li);
  });
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    settings = items;
    render();
  });
}

enabledToggle.addEventListener("change", () => {
  settings.enabled = enabledToggle.checked;
  saveSettings();
});

defaultSecondsInput.addEventListener("change", () => {
  const val = parseInt(defaultSecondsInput.value, 10);
  settings.defaultSkipSeconds = Number.isFinite(val) && val >= 0 ? val : 14;
  saveSettings();
  render();
});

addChannelBtn.addEventListener("click", () => {
  const name = newChannelNameInput.value.trim();
  if (!name) {
    showStatus("Please enter a channel name");
    return;
  }

  settings.channels = settings.channels || [];
  const exists = settings.channels.some(
    (c) => c.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (exists) {
    showStatus("This channel already exists");
    return;
  }

  settings.channels.push({
    name,
    enabled: true,
  });
  newChannelNameInput.value = "";
  saveSettings();
  render();
});

useCurrentChannelBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
      showStatus("Open a YouTube video page first");
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: "getChannelName" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.channelName) {
        showStatus("Channel name not found. Try refreshing the page");
        return;
      }
      newChannelNameInput.value = response.channelName;
    });
  });
});

loadSettings();
checkActiveTabForYouTube();
