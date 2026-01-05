// Create Event Action - Mit Zeitzonen-Support und mehreren Remindern
// Erstellt einen neuen Termin in einem Kalender

const serverUrl = (data.auth.serverUrl || '').trim().replace(/\/$/, '');
const username = data.auth.username;
const password = data.auth.password;

// Input-Werte (alle mit const, Bereinigung direkt inline)
const calendarId = (data.input.calendarId || '').trim().replace(/[\r\n\t\s]/g, '');
const title = (data.input.title || '').trim();
const startDatetime = (data.input.startDatetime || '').trim();
const endDatetime = (data.input.endDatetime || '').trim();
const description = (data.input.description || '').trim();
const location = (data.input.location || '').trim();
const attendees = (data.input.attendees || '').trim();
const reminders = (data.input.reminders || '').trim();
const allDay = data.input.allDay === true;
const timezoneMode = data.input.timezoneMode || 'utc';
const timezone = (data.input.timezone || 'Europe/Berlin').trim();

// Validierung
if (!calendarId) {
  return {
    success: false,
    error: 'Bitte gib eine Kalender-ID an. Nutze "List Calendars" um verfügbare Kalender zu sehen.'
  };
}

if (!title) {
  return {
    success: false,
    error: 'Bitte gib einen Titel für den Termin an.'
  };
}

if (!startDatetime) {
  return {
    success: false,
    error: 'Bitte gib ein Start-Datum an (Format: YYYY-MM-DDTHH:MM:SS)'
  };
}

if (!endDatetime) {
  return {
    success: false,
    error: 'Bitte gib ein End-Datum an (Format: YYYY-MM-DDTHH:MM:SS)'
  };
}

// Basic Auth Header
const authHeader = 'Basic ' + btoa(username + ':' + password);

// Hilfsfunktion: Datetime zu iCal-Format konvertieren
function toICalDateTime(datetime, isAllDay, tzMode, tz) {
  // Entferne alle Trennzeichen
  const clean = datetime.replace(/[-:]/g, '');
  
  if (isAllDay) {
    // Ganztägig: Nur Datum (YYYYMMDD)
    return {
      value: clean.substring(0, 8),
      format: 'VALUE=DATE'
    };
  }
  
  if (tzMode === 'utc') {
    // UTC: YYYYMMDDTHHMMSSZ
    return {
      value: clean + 'Z',
      format: ''
    };
  } else if (tzMode === 'floating') {
    // Floating: YYYYMMDDTHHMMSS (kein Z, kein TZID)
    return {
      value: clean,
      format: ''
    };
  } else {
    // Specific Timezone: YYYYMMDDTHHMMSS mit TZID
    return {
      value: clean,
      format: `TZID=${tz}`
    };
  }
}

// Hilfsfunktion: Aktuelle Zeit in iCal-Format
function nowICalFormat() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

// Hilfsfunktion: Eindeutige UID generieren
function generateUID() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}@langdock-caldav`;
}

// Hilfsfunktion: ISO 8601 Duration validieren und normalisieren
function parseIsoDuration(duration) {
  // Beispiele: PT15M, PT1H, P1D, P1DT2H30M, P1W
  const pattern = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
  
  if (!duration) return null;
  
  const cleaned = duration.trim().toUpperCase();
  
  // Validierung
  if (!pattern.test(cleaned)) {
    return null; // Ungültiges Format
  }
  
  return cleaned;
}

// Hilfsfunktion: ISO Duration zu lesbarem Text
function durationToText(duration) {
  const weeks = duration.match(/(\d+)W/);
  const days = duration.match(/(\d+)D/);
  const hours = duration.match(/T(\d+)H/);
  const minutes = duration.match(/T(?:\d+H)?(\d+)M/);
  
  const parts = [];
  if (weeks) parts.push(`${weeks[1]} Woche${weeks[1] > 1 ? 'n' : ''}`);
  if (days) parts.push(`${days[1]} Tag${days[1] > 1 ? 'e' : ''}`);
  if (hours) parts.push(`${hours[1]} Std`);
  if (minutes) parts.push(`${minutes[1]} Min`);
  
  return parts.join(' ') || duration;
}

// Hilfsfunktion: VTIMEZONE-Block generieren (vereinfacht)
function generateVTimezone(tzid) {
  // Vereinfachte VTIMEZONE-Definition
  // In Produktion sollte man eine vollständige Timezone-Datenbank verwenden
  
  const timezones = {
    'Europe/Berlin': `BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`,
    'Europe/London': `BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`,
    'America/New_York': `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`,
    'America/Los_Angeles': `BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`,
    'Asia/Tokyo': `BEGIN:VTIMEZONE
TZID:Asia/Tokyo
BEGIN:STANDARD
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
TZNAME:JST
DTSTART:19700101T000000
END:STANDARD
END:VTIMEZONE`,
    'Asia/Shanghai': `BEGIN:VTIMEZONE
TZID:Asia/Shanghai
BEGIN:STANDARD
TZOFFSETFROM:+0800
TZOFFSETTO:+0800
TZNAME:CST
DTSTART:19700101T000000
END:STANDARD
END:VTIMEZONE`,
    'UTC': '' // UTC braucht keine VTIMEZONE
  };
  
  return timezones[tzid] || '';
}

try {
  ld.log('Creating event in calendar:', calendarId);
  ld.log('Title:', title);
  ld.log('Start:', startDatetime, 'End:', endDatetime);
  ld.log('All Day:', allDay);
  ld.log('Timezone Mode:', timezoneMode);
  if (timezoneMode === 'specific') {
    ld.log('Timezone:', timezone);
  }
  
  // Datetime konvertieren
  const dtStart = toICalDateTime(startDatetime, allDay, timezoneMode, timezone);
  const dtEnd = toICalDateTime(endDatetime, allDay, timezoneMode, timezone);
  const dtStamp = nowICalFormat();
  const uid = generateUID();
  
  ld.log('iCal DTSTART format:', dtStart.format, 'value:', dtStart.value);
  ld.log('iCal DTEND format:', dtEnd.format, 'value:', dtEnd.value);
  ld.log('UID:', uid);
  
  // Reminders parsen (eine Duration pro Zeile)
  const validReminders = [];
  
  if (reminders) {
    const reminderLines = reminders.split('\n').map(r => r.trim()).filter(r => r);
    
    ld.log('Processing reminders:', reminderLines.length);
    
    for (const line of reminderLines) {
      const duration = parseIsoDuration(line);
      
      if (duration) {
        validReminders.push(duration);
        ld.log('Reminder added:', duration, '(' + durationToText(duration) + ')');
      } else {
        ld.log('Warning: Invalid reminder duration format:', line);
      }
    }
  }
  
  // VTIMEZONE-Block (nur bei specific timezone)
  let vtimezoneBlock = '';
  if (timezoneMode === 'specific' && !allDay) {
    vtimezoneBlock = generateVTimezone(timezone);
    if (!vtimezoneBlock) {
      ld.log('Warning: No VTIMEZONE definition for', timezone);
    }
  }
  
  // iCalendar-Datei erstellen
  const icalLines = [];
  
  icalLines.push('BEGIN:VCALENDAR');
  icalLines.push('VERSION:2.0');
  icalLines.push('PRODID:-//Langdock//CalDAV Integration//EN');
  icalLines.push('CALSCALE:GREGORIAN');
  
  // VTIMEZONE (falls vorhanden)
  if (vtimezoneBlock) {
    icalLines.push(vtimezoneBlock.trim());
  }
  
  icalLines.push('BEGIN:VEVENT');
  icalLines.push(`UID:${uid}`);
  icalLines.push(`DTSTAMP:${dtStamp}`);
  
  // DTSTART mit korrektem Format
  if (dtStart.format) {
    icalLines.push(`DTSTART;${dtStart.format}:${dtStart.value}`);
  } else {
    icalLines.push(`DTSTART:${dtStart.value}`);
  }
  
  // DTEND mit korrektem Format
  if (dtEnd.format) {
    icalLines.push(`DTEND;${dtEnd.format}:${dtEnd.value}`);
  } else {
    icalLines.push(`DTEND:${dtEnd.value}`);
  }
  
  icalLines.push(`SUMMARY:${title}`);
  
  if (description) {
    icalLines.push(`DESCRIPTION:${description.replace(/\r?\n/g, '\\n')}`);
  }
  
  if (location) {
    icalLines.push(`LOCATION:${location}`);
  }
  
  // Attendees
  if (attendees) {
    const emails = attendees.split('\n').map(e => e.trim()).filter(e => e);
    for (const email of emails) {
      icalLines.push(`ATTENDEE;CN=${email};RSVP=TRUE:mailto:${email}`);
    }
    ld.log('Attendees:', emails.length);
  }
  
  icalLines.push('STATUS:CONFIRMED');
  icalLines.push('SEQUENCE:0');
  
  // Alarms
  if (validReminders.length > 0) {
    for (const rem of validReminders) {
      icalLines.push('BEGIN:VALARM');
      icalLines.push('ACTION:DISPLAY');
      icalLines.push(`DESCRIPTION:${title}`);
      icalLines.push(`TRIGGER:-${rem}`);
      icalLines.push('END:VALARM');
    }
  }
  
  icalLines.push('END:VEVENT');
  icalLines.push('END:VCALENDAR');
  
  // Kombiniere mit \r\n
  const icalContent = icalLines.join('\r\n');
  
  ld.log('iCal Content created, length:', icalContent.length);
  ld.log('=== FULL ICAL CONTENT ===');
  ld.log(icalContent);
  ld.log('=== END ICAL CONTENT ===');
  
  // Event-URL erstellen
  // Stelle sicher, dass calendarId mit / endet
  let cleanCalendarId = calendarId;
  if (!cleanCalendarId.endsWith('/')) {
    cleanCalendarId = cleanCalendarId + '/';
  }
  
  const eventUrl = serverUrl + cleanCalendarId + uid + '.ics';
  
  ld.log('Event URL:', eventUrl);
  
  // Event erstellen via PUT
  const response = await ld.request({
    method: 'PUT',
    url: eventUrl,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*' // Nur erstellen wenn noch nicht existiert
    },
    body: icalContent
  });
  
  ld.log('Response Status:', response.status);
  ld.log('Response Headers:', JSON.stringify(response.headers));
  
  if (response.status === 201 || response.status === 204) {
    // Erfolg!
    let successMessage = `✅ **Termin erfolgreich erstellt!**\n\n`;
    successMessage += `📅 **${title}**\n`;
    successMessage += `🕐 Start: ${startDatetime}\n`;
    successMessage += `🕐 Ende: ${endDatetime}\n`;
    
    if (allDay) {
      successMessage += `📆 Ganztägig: Ja\n`;
    } else {
      if (timezoneMode === 'utc') {
        successMessage += `🌍 Zeitzone: UTC\n`;
      } else if (timezoneMode === 'floating') {
        successMessage += `🌍 Zeitzone: Floating (lokale Zeit)\n`;
      } else {
        successMessage += `🌍 Zeitzone: ${timezone}\n`;
      }
    }
    
    if (location) {
      successMessage += `📍 Ort: ${location}\n`;
    }
    
    if (description) {
      successMessage += `📝 Beschreibung: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}\n`;
    }
    
    if (attendees) {
      const emailCount = attendees.split('\n').filter(e => e.trim()).length;
      successMessage += `👥 Teilnehmer: ${emailCount}\n`;
    }
    
    if (validReminders.length > 0) {
      successMessage += `⏰ Erinnerungen (${validReminders.length}):\n`;
      for (const rem of validReminders) {
        successMessage += `   • ${durationToText(rem)} vorher\n`;
      }
    }
    
    successMessage += `\n🆔 Event-ID: \`${uid}\``;
    
    return {
      success: true,
      message: successMessage,
      eventId: uid,
      eventUrl: eventUrl,
      calendarId: calendarId,
      timezoneMode: timezoneMode,
      timezone: timezoneMode === 'specific' ? timezone : null,
      remindersCount: validReminders.length
    };
    
  } else if (response.status === 412) {
    return {
      success: false,
      error: 'Event existiert bereits (Precondition Failed). Möglicherweise wurde die UID bereits verwendet.'
    };
    
  } else if (response.status === 401) {
    return {
      success: false,
      error: 'Authentifizierung fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.'
    };
    
  } else if (response.status === 403) {
    return {
      success: false,
      error: 'Zugriff verweigert. Du hast keine Berechtigung, Termine in diesem Kalender zu erstellen.'
    };
    
  } else if (response.status === 404) {
    return {
      success: false,
      error: 'Kalender nicht gefunden. Bitte überprüfe die Kalender-ID.'
    };
    
  } else {
    return {
      success: false,
      error: `Unerwarteter Fehler: HTTP ${response.status} - ${response.text || 'Keine Details'}`
    };
  }
  
} catch (error) {
  ld.log('Error:', error.message);
  ld.log('Error stack:', error.stack);
  
  return {
    success: false,
    error: 'Fehler beim Erstellen des Termins: ' + error.message
  };
}
