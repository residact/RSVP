chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "rsvp",
    title: "Lire en RSVP",
    contexts: ["selection"],
  });
});

function send(tabId, text) {
  chrome.tabs.sendMessage(tabId, { type: "rsvp-start", text });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "rsvp" && tab) send(tab.id, info.selectionText);
});

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === "start-rsvp" && tab) send(tab.id, null);
});
