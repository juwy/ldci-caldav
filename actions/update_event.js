// Update Event Action - CalDAV Integration
// Aktualisiert ein bestehendes Event in einem Kalender

const serverUrl = (data.auth.serverUrl || '').trim().replace(/\/$/, '');
const username = data.auth.username;
const password = data.auth.password;

// Input-Werte
const eventUrl = serverUrl + (data.input.eventUrl || '').trim();
const title = (data.input.title || '').trim();
const startDatetime = (data.input.startDatetime || '').trim();
const endDatetime = (data.input.endDatetime || '').trim();
const location = (data.input.location || '').trim();
const description = (data.input.description || '').trim();
const attendees = (data.input.attendees || '').trim();
const reminders = (data.input.reminders || '').trim();
const status = (data.input.status || '').trim();

// Validierung: Pflichtfeld
if (!eventUrl) {
  return {
    success: false,
    error: 'Bitte gib eine Event-URL an. Nutze "Search Events" um Events zu finden.'
  };
}

// SECURITY: Validierung dass eventUrl zum konfigurierten Server gehört
if (!eventUrl.startsWith(serverUrl)) {
  return {
    success: false,
    error: `Sicherheitsfehler: Event-URL gehört nicht zum konfigurierten Server.\nServer: ${serverUrl}\nEvent-URL: ${eventUrl}`
  };
}

// Basic Auth Header
const authHeader = 'Basic ' + btoa(username + ':' + password);

// ============================================================================
// HILFSFUNKTIONEN
// ============================================================================

// Hilfsfunktion: Aktuelle Zeit in iCal-Format (UTC)
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

// Hilfsfunktion: iCal Property mit Unfolding lesen
function extractICalProperty(icalText, propertyName) {
  // Regex: Finde Property und alle Folgezeilen (die mit Leerzeichen/Tab beginnen)
  const regex = new RegExp(`\\n${propertyName}[;:]([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, 'i');
  const match = icalText.match(regex);
  
  if (!match) return null;
  
  // Entferne Line-Folding (Zeilen die mit Leerzeichen beginnen)
  let value = match[1];
  value = value.replace(/\r?\n[ \t]/g, ''); // Entferne \n + Leerzeichen/Tab
  
  return value.trim();
}

// Hilfsfunktion: iCal Property ersetzen (mit Line-Folding Support)
function replaceICalProperty(icalText, propertyName, newValue) {
  // Regex: Findet Property + alle Folgezeilen (die mit Leerzeichen beginnen)
  const regex = new RegExp(
    `\\n${propertyName}[;:]([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`,
    'i'
  );
  
  const match = icalText.match(regex);
  
  if (match) {
    // Property existiert → ersetzen
    // Behalte das Format bei (mit oder ohne Parameter)
    const oldLine = match[0];
    
    // Prüfe ob alte Zeile Parameter hatte (z.B. DTSTART;TZID=...)
    if (oldLine.includes(';')) {
      const paramMatch = oldLine.match(new RegExp(`\\n${propertyName};([^:]+):`, 'i'));
      if (paramMatch) {
        const params = paramMatch[1];
        return icalText.replace(regex, `\n${propertyName};${params}:${newValue}`);
      }
    }
    
    // Keine Parameter → einfach ersetzen
    return icalText.replace(regex, `\n${propertyName}:${newValue}`);
  } else {
    // Property existiert nicht → hinzufügen (vor END:VEVENT)
    return icalText.replace(/\nEND:VEVENT/i, `\n${propertyName}:${newValue}\nEND:VEVENT`);
  }
}

// Hilfsfunktion: Alle Properties eines Typs entfernen (z.B. alle ATTENDEE)
function removeAllICalProperties(icalText, propertyName) {
  const regex = new RegExp(
    `\\r?\\n${propertyName}[;:]([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`,
    'gi'  // global + case-insensitive
  );
  return icalText.replace(regex, '');
}

// Hilfsfunktion: Alle Blöcke entfernen (z.B. alle VALARM)
function removeAllICalBlocks(icalText, blockName) {
  const regex = new RegExp(
    `\\r?\\nBEGIN:${blockName}[\\s\\S]*?END:${blockName}`,
    'gi'
  );
  return icalText.replace(regex, '');
}

// Hilfsfunktion: Properties vor END:VEVENT hinzufügen
function addICalPropertiesBeforeEnd(icalText, lines) {
  const content = lines.join('\r\n');
  return icalText.replace(/\nEND:VEVENT/i, `\n${content}\nEND:VEVENT`);
}

// Hilfsfunktion: iCal-Text escapen (Kommas, Semikolons, Newlines)
function escapeICalText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// Hilfsfunktion: Datetime validieren
function validateDatetime(dt) {
  if (!dt) return false;
  
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  if (!pattern.test(dt)) {
    return false;
  }
  
  // Zusätzlich: Gültiges Datum prüfen
  const date = new Date(dt);
  return !isNaN(date.getTime());
}

// Hilfsfunktion: iCal DateTime zu JavaScript Date konvertieren
function icalDateTimeToDate(icalValue) {
  if (!icalValue) return null;
  
  let cleanValue = icalValue;
  
  // Entferne TZID-Parameter: "TZID=Europe/Berlin:20250214T140000" → "20250214T140000"
  if (cleanValue.includes(':')) {
    const parts = cleanValue.split(':');
    cleanValue = parts[parts.length - 1];
  }
  
  cleanValue = cleanValue.trim();
  
  // Format: YYYYMMDDTHHMMSSZ oder YYYYMMDDTHHMMSS oder YYYYMMDD
  if (cleanValue.length === 8) {
    // Nur Datum: YYYYMMDD
    const year = cleanValue.substring(0, 4);
    const month = cleanValue.substring(4, 6);
    const day = cleanValue.substring(6, 8);
    return new Date(`${year}-${month}-${day}T00:00:00`);
  } else if (cleanValue.includes('T')) {
    // Datum + Zeit
    const year = cleanValue.substring(0, 4);
    const month = cleanValue.substring(4, 6);
    const day = cleanValue.substring(6, 8);
    const hour = cleanValue.substring(9, 11);
    const minute = cleanValue.substring(11, 13);
    const second = cleanValue.substring(13, 15);
    
    if (cleanValue.endsWith('Z')) {
      // UTC
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    } else {
      // Local/Floating
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    }
  }
  
  return null;
}

// Hilfsfunktion: JavaScript Date zu iCal DateTime (Format vom Original übernehmen)
function dateToICalDateTime(date, originalICalValue) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  const icalDate = `${year}${month}${day}T${hours}${minutes}${seconds}`;
  
  // Prüfe ob Original UTC war (endet mit Z)
  if (originalICalValue && originalICalValue.includes('Z')) {
    return icalDate + 'Z';
  }
  
  return icalDate;
}

// Hilfsfunktion: User-Datetime (YYYY-MM-DDTHH:MM:SS) zu iCal konvertieren
function userDateTimeToICalDateTime(userDateTime, originalICalValue) {
  // Entferne Trennzeichen
  const clean = userDateTime.replace(/[-:]/g, '');
  
  // Prüfe ob Original UTC war
  if (originalICalValue && originalICalValue.includes('Z')) {
    return clean + 'Z';
  }
  
  return clean;
}

// Hilfsfunktion: ISO 8601 Duration validieren
function parseIsoDuration(duration) {
  const pattern = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
  
  if (!duration) return null;
  
  const cleaned = duration.trim().toUpperCase();
  
  if (!pattern.test(cleaned)) {
    return null;
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

// ============================================================================
// HAUPTLOGIK
// ============================================================================

try {
  ld.log('Updating event:', eventUrl);
  
  // Schritt 1: Event abrufen (GET)
  ld.log('Step 1: Fetching existing event...');
  
  const getResponse = await ld.request({
    method: 'GET',
    url: eventUrl,
    headers: {
      'Authorization': authHeader
    }
  });
  
  ld.log('GET Response Status:', getResponse.status);
  
  if (getResponse.status !== 200) {
    if (getResponse.status === 404) {
      return {
        success: false,
        error: 'Event nicht gefunden. Bitte überprüfe die Event-URL.'
      };
    } else if (getResponse.status === 401) {
      return {
        success: false,
        error: 'Authentifizierung fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.'
      };
    } else if (getResponse.status === 403) {
      return {
        success: false,
        error: 'Zugriff verweigert. Du hast keine Berechtigung, dieses Event zu lesen.'
      };
    } else {
      return {
        success: false,
        error: `Fehler beim Abrufen des Events: HTTP ${getResponse.status}`
      };
    }
  }
  
  // Schritt 2: ETag extrahieren
  const etag = getResponse.headers['etag'] || getResponse.headers['ETag'];
  ld.log('ETag:', etag || 'not found');
  
  // Schritt 3: Original iCal
  const originalIcal = getResponse.text;
  ld.log('Original iCal length:', originalIcal.length);
  
  // Schritt 4: VEVENT-Block extrahieren
  const veventMatch = originalIcal.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/);
  
  if (!veventMatch) {
    return {
      success: false,
      error: 'Kein VEVENT-Block im Event gefunden. Möglicherweise ist die Datei beschädigt.'
    };
  }
  
  const veventBlock = veventMatch[1];
  
  // Schritt 5: Alte Werte auslesen
  const oldTitle = extractICalProperty(veventBlock, 'SUMMARY');
  const oldStart = extractICalProperty(veventBlock, 'DTSTART');
  const oldEnd = extractICalProperty(veventBlock, 'DTEND');
  const oldSequence = parseInt(extractICalProperty(veventBlock, 'SEQUENCE')) || 0;
  
  ld.log('Old values - Title:', oldTitle, 'Start:', oldStart, 'End:', oldEnd, 'Sequence:', oldSequence);
  
  // Schritt 6: Validierung der neuen Werte
  if (startDatetime && !validateDatetime(startDatetime)) {
    return {
      success: false,
      error: `Ungültiges Start-Datum Format: "${startDatetime}". Erwartet: YYYY-MM-DDTHH:MM:SS (z.B. 2025-12-30T14:00:00)`
    };
  }
  
  if (endDatetime && !validateDatetime(endDatetime)) {
    return {
      success: false,
      error: `Ungültiges End-Datum Format: "${endDatetime}". Erwartet: YYYY-MM-DDTHH:MM:SS (z.B. 2025-12-30T15:00:00)`
    };
  }
  
  // Schritt 7: Neue End-Zeit berechnen wenn nur Start geändert wird
  let finalEndDatetime = endDatetime;
  
  if (startDatetime && !endDatetime && oldStart && oldEnd) {
    ld.log('Only start changed - calculating new end to preserve duration...');
    
    const oldStartDate = icalDateTimeToDate(oldStart);
    const oldEndDate = icalDateTimeToDate(oldEnd);
    
    if (oldStartDate && oldEndDate) {
      const durationMs = oldEndDate.getTime() - oldStartDate.getTime();
      ld.log('Old duration (ms):', durationMs);
      
      const newStartDate = new Date(startDatetime);
      const newEndDate = new Date(newStartDate.getTime() + durationMs);
      
      // Formatiere zurück zu YYYY-MM-DDTHH:MM:SS
      const year = newEndDate.getFullYear();
      const month = String(newEndDate.getMonth() + 1).padStart(2, '0');
      const day = String(newEndDate.getDate()).padStart(2, '0');
      const hours = String(newEndDate.getHours()).padStart(2, '0');
      const minutes = String(newEndDate.getMinutes()).padStart(2, '0');
      const seconds = String(newEndDate.getSeconds()).padStart(2, '0');
      
      finalEndDatetime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
      ld.log('Calculated new end:', finalEndDatetime);
    }
  }
  
  // Schritt 8: Validierung Start < End
  if (startDatetime && finalEndDatetime) {
    const startDate = new Date(startDatetime);
    const endDate = new Date(finalEndDatetime);
    
    if (startDate >= endDate) {
      return {
        success: false,
        error: `Start-Zeitpunkt (${startDatetime}) muss vor End-Zeitpunkt (${finalEndDatetime}) liegen.`
      };
    }
  }
  
  // Schritt 9: Reminders validieren
  if (reminders) {
    const reminderLines = reminders.split('\n').map(r => r.trim()).filter(r => r);
    
    for (const line of reminderLines) {
      const duration = parseIsoDuration(line);
      if (!duration) {
        return {
          success: false,
          error: `Ungültiges Reminder-Format: "${line}". Beispiele: PT15M (15 Min), PT1H (1 Std), P1D (1 Tag), P1W (1 Woche)`
        };
      }
    }
  }
  
  // Schritt 10: Attendees validieren
  if (attendees) {
    const emails = attendees.split('\n').map(e => e.trim()).filter(e => e);
    
    for (const email of emails) {
      if (!email.includes('@')) {
        return {
          success: false,
          error: `Ungültige E-Mail-Adresse: "${email}"`
        };
      }
    }
  }
  
  // Schritt 11: Status validieren
  if (status && status !== '<NO CHANGE>') {
    const validStatuses = ['CONFIRMED', 'TENTATIVE', 'CANCELLED'];
    if (!validStatuses.includes(status.toUpperCase())) {
      return {
        success: false,
        error: `Ungültiger Status: "${status}". Erlaubt: CONFIRMED, TENTATIVE, CANCELLED`
      };
    }
  }
  
  // Schritt 12: String-Manipulation - Properties ersetzen
  ld.log('Step 2: Applying changes...');
  
  let updatedIcal = originalIcal;
  const changes = [];
  
  // Title
  if (title) {
    updatedIcal = replaceICalProperty(updatedIcal, 'SUMMARY', escapeICalText(title));
    changes.push(`Titel: "${title}"`);
    ld.log('Updated: SUMMARY');
  }
  
  // Start DateTime
  if (startDatetime) {
    const icalStart = userDateTimeToICalDateTime(startDatetime, oldStart);
    updatedIcal = replaceICalProperty(updatedIcal, 'DTSTART', icalStart);
    changes.push(`Start: ${startDatetime}`);
    ld.log('Updated: DTSTART to', icalStart);
  }
  
  // End DateTime
  if (finalEndDatetime) {
    const icalEnd = userDateTimeToICalDateTime(finalEndDatetime, oldEnd);
    updatedIcal = replaceICalProperty(updatedIcal, 'DTEND', icalEnd);
    changes.push(`Ende: ${finalEndDatetime}`);
    ld.log('Updated: DTEND to', icalEnd);
  }
  
  // Location
  if (location) {
    updatedIcal = replaceICalProperty(updatedIcal, 'LOCATION', escapeICalText(location));
    changes.push(`Ort: "${location}"`);
    ld.log('Updated: LOCATION');
  }
  
  // Description
  if (description) {
    updatedIcal = replaceICalProperty(updatedIcal, 'DESCRIPTION', escapeICalText(description));
    const shortDesc = description.length > 50 ? description.substring(0, 50) + '...' : description;
    changes.push(`Beschreibung: "${shortDesc}"`);
    ld.log('Updated: DESCRIPTION');
  }
  
  // Status
  if (status && status !== '<NO CHANGE>') {
    updatedIcal = replaceICalProperty(updatedIcal, 'STATUS', status.toUpperCase());
    changes.push(`Status: ${status.toUpperCase()}`);
    ld.log('Updated: STATUS');
  }
  
  // Attendees (komplett ersetzen)
  if (attendees) {
    updatedIcal = removeAllICalProperties(updatedIcal, 'ATTENDEE');
    
    const emails = attendees.split('\n').map(e => e.trim()).filter(e => e);
    
    if (emails.length > 0) {
      const attendeeLines = emails.map(email => 
        `ATTENDEE;CN=${email};RSVP=TRUE:mailto:${email}`
      );
      updatedIcal = addICalPropertiesBeforeEnd(updatedIcal, attendeeLines);
      changes.push(`Teilnehmer: ${emails.length} Person(en)`);
      ld.log('Updated: ATTENDEE (', emails.length, 'attendees)');
    } else {
      changes.push('Teilnehmer: entfernt');
      ld.log('Removed: All ATTENDEE');
    }
  }
  
  // Reminders (komplett ersetzen)
  if (reminders) {
    updatedIcal = removeAllICalBlocks(updatedIcal, 'VALARM');
    
    const reminderLines = reminders.split('\n').map(r => r.trim()).filter(r => r);
    const validReminders = [];
    
    for (const line of reminderLines) {
      const duration = parseIsoDuration(line);
      if (duration) {
        validReminders.push(duration);
      }
    }
    
    if (validReminders.length > 0) {
      const eventTitle = title || oldTitle || 'Erinnerung';
      const alarmBlocks = [];
      
      for (const duration of validReminders) {
        const alarmBlock = `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${escapeICalText(eventTitle)}\r\nTRIGGER:-${duration}\r\nEND:VALARM`;
        alarmBlocks.push(alarmBlock);
      }
      
      updatedIcal = addICalPropertiesBeforeEnd(updatedIcal, alarmBlocks);
      changes.push(`Erinnerungen: ${validReminders.length} (${validReminders.map(durationToText).join(', ')})`);
      ld.log('Updated: VALARM (', validReminders.length, 'reminders)');
    } else {
      changes.push('Erinnerungen: entfernt');
      ld.log('Removed: All VALARM');
    }
  }
  
  // Immer aktualisieren: SEQUENCE, LAST-MODIFIED, DTSTAMP
  const newSequence = oldSequence + 1;
  updatedIcal = replaceICalProperty(updatedIcal, 'SEQUENCE', String(newSequence));
  updatedIcal = replaceICalProperty(updatedIcal, 'LAST-MODIFIED', nowICalFormat());
  updatedIcal = replaceICalProperty(updatedIcal, 'DTSTAMP', nowICalFormat());
  
  ld.log('Updated: SEQUENCE to', newSequence);
  ld.log('Updated: LAST-MODIFIED and DTSTAMP');
  
  // Prüfe ob überhaupt Änderungen vorgenommen wurden
  if (changes.length === 0) {
    return {
      success: false,
      error: 'Keine Änderungen angegeben. Bitte gib mindestens ein Feld an, das geändert werden soll.'
    };
  }
  
  ld.log('Total changes:', changes.length);
  ld.log('Updated iCal length:', updatedIcal.length);
  
  // Schritt 13: PUT - Event aktualisieren
  ld.log('Step 3: Saving updated event...');
  
  const putHeaders = {
    'Authorization': authHeader,
    'Content-Type': 'text/calendar; charset=utf-8'
  };
  
  // ETag für Concurrency Control (falls vorhanden)
  if (etag) {
    putHeaders['If-Match'] = etag;
  }
  
  const putResponse = await ld.request({
    method: 'PUT',
    url: eventUrl,
    headers: putHeaders,
    body: updatedIcal
  });
  
  ld.log('PUT Response Status:', putResponse.status);
  
  // Schritt 14: Response prüfen
  if (putResponse.status === 204 || putResponse.status === 200 || putResponse.status === 201) {
    // Erfolg!
    let successMessage = `✅ **Event erfolgreich aktualisiert!**\n\n`;
    successMessage += `📅 **${title || oldTitle}**\n\n`;
    successMessage += `**Geänderte Felder:**\n`;
    
    for (const change of changes) {
      successMessage += `• ${change}\n`;
    }
    
    successMessage += `\n🔄 Sequence: ${oldSequence} → ${newSequence}`;
    
    return {
      success: true,
      message: successMessage,
      eventUrl: eventUrl,
      changesCount: changes.length,
      newSequence: newSequence
    };
    
  } else if (putResponse.status === 412) {
    return {
      success: false,
      error: 'Conflict: Das Event wurde zwischenzeitlich von jemand anderem geändert. Bitte lade das Event erneut und versuche es nochmal.'
    };
    
  } else if (putResponse.status === 401) {
    return {
      success: false,
      error: 'Authentifizierung fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.'
    };
    
  } else if (putResponse.status === 403) {
    return {
      success: false,
      error: 'Zugriff verweigert. Du hast keine Berechtigung, dieses Event zu ändern.'
    };
    
  } else if (putResponse.status === 404) {
    return {
      success: false,
      error: 'Event nicht gefunden. Möglicherweise wurde es bereits gelöscht.'
    };
    
  } else {
    ld.log('PUT Response Body:', putResponse.text);
    return {
      success: false,
      error: `Unerwarteter Fehler beim Speichern: HTTP ${putResponse.status} - ${putResponse.text || 'Keine Details'}`
    };
  }
  
} catch (error) {
  ld.log('Error:', error.message);
  ld.log('Error stack:', error.stack);
  
  return {
    success: false,
    error: 'Fehler beim Aktualisieren des Events: ' + error.message
  };
}
