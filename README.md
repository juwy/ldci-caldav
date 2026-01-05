# JUWYs CalDAV Integration for Langdock

Connect your CalDAV-compatible calendar to Langdock and manage events directly from your AI assistant.

## ⚠️ Disclaimer

This is a **hobby project** without extensive testing -my first one on GitHub 🙂. Use at your own risk.

- ✅ **Tested with:** mailbox.org
- 🌍 **Language:** Code comments and messages are partially in German (may be translated later)
- 🚧 **Future plans:** Add support for CalDAV tasks/todos

## Features

- 🔐 **Auth Test** - Setup and verify your CalDAV connection
- 📅 **List Calendars** - View all available calendars
- 🔍 **Search Events** - Find events by title, date range, or calendar
- ➕ **Create Event** - Create new events with attendees and reminders
- ✏️ **Update Event** - Modify existing events

## Supported CalDAV Servers

Should work with any RFC 4791 compliant CalDAV server:

- Mailbox.org (tested ✅)
- Nextcloud
- ownCloud
- Radicale
- Baikal
- iCloud
- Google Calendar (via CalDAV)

## Installation

1. **Download this integration:**
   - Click the green **"Code"** button above
   - Select **"Download ZIP"**

2. **Import in Langdock:**
   - Go to [Langdock Integrations](https://app.langdock.com/integrations)
   - Click **"Integration hinzufügen"** → **"Integration importieren"**
   - Upload the downloaded ZIP file

3. **Configure authentication:**
   - **Server URL:** Your CalDAV server URL (e.g., `https://dav.mailbox.org`)
   - **Username:** Your CalDAV username
   - **Password:** Your CalDAV password

## Usage 
**Important:** Before creating or searching events, you need to get your calendar ID with the action "List Calendars"


