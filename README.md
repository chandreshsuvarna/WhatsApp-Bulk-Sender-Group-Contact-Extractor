# WhatsApp Bulk Sender + Group Contact Extractor - Chrome Extension

**Developed by Chandresh Suvarna**
IT Manager | 19 Yrs @ Setco Group | M365 & GCP | Full-Stack & AI Automation

## What is this?

A single Chrome Extension that does two jobs on WhatsApp Web:

1. **Extracts contacts** (name and phone number) from any of your WhatsApp groups.
2. **Sends personalized bulk messages** to a list of contacts automatically, without typing each message manually.

Built to solve a real problem: sending personalized information to 200+ people every month.

## What it does

**Group Contact Extractor**
- Lists all your WhatsApp groups in a searchable dropdown
- Exports the members of a selected group to **CSV or Excel** (Name, Phone Number)
- One click to **send the extracted contacts straight into the Bulk Sender**
- Runs locally in your browser. Nothing is uploaded anywhere

**Bulk Sender**
- Paste numbers or upload a **CSV** list
- Personalizes each message with merge fields, e.g. `Hi {name}, your payment of Rs. X is due` (every CSV column can be used, such as `{name}`, `{city}`)
- Attach a **JPG, PNG or PDF** (your message is sent as the caption)
- Random delay between messages and a max-per-run limit to reduce the risk of a WhatsApp block
- Instant **STOP** button and resume support
- Downloadable **Success / Failed report** (CSV)
- Works directly on WhatsApp Web, with no API cost

## Tech Stack

- JavaScript
- Chrome Extension Manifest V3
- HTML / CSS

## How to Install

1. Download this repo (Code > Download ZIP) or clone it, and unzip if needed
2. Go to `chrome://extensions` in Chrome
3. Turn ON **Developer Mode** (top right)
4. Click **Load Unpacked** and select this folder (the one containing `manifest.json`)
5. The extension appears in the Chrome toolbar

> If you had the old sender or extractor extension installed, remove it first to avoid duplicates.

## How to Use

Open [web.whatsapp.com](https://web.whatsapp.com), log in and wait for your chats to load. Then click the extension icon. The app opens in a new tab with two sections.

### A. Extract contacts from a group
1. Open **Group Contact Extractor**
2. Click **Load my WhatsApp groups** and choose a group
3. Click **Get members of selected group**
4. Download as **CSV / Excel**, or click **Use these contacts in Bulk Sender**

### B. Send bulk messages
1. Open **Bulk Sender**
2. Paste numbers (one per line, e.g. `919876543210, Rahul`) or upload a CSV with a header row such as `name,phone,city`
3. Write your message using fields like `{name}`
4. (Optional) Attach a JPG / PNG / PDF
5. Set delays and max messages per run. Tip: set **Max per run = 1** and test on your own number first
6. Click **Start**. It sends one by one with a delay. Keep the WhatsApp Web tab open

## Notes and Limitations

- WhatsApp hides some members' numbers in groups. Those members are skipped and the count is shown
- Don't use the extractor while a sending campaign is running
- WhatsApp Web changes often, so a future update may need a fix. Please open an issue if something stops working

## Why I Built This

Manual sending to 200 members took 2 days. With this tool, the same work takes 20 minutes.

## Disclaimer

Use responsibly. This tool is for contacting your own customers / contacts **with their consent**. Do not use it for spam. Follow WhatsApp's Terms of Service and applicable privacy laws.

Developed by Chandresh Suvarna | Mumbai, India
