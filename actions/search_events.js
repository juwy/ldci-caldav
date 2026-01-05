// Search Events Action - Mit Zeitraum und optionalem Text-Filter
// Durchsucht einen Kalender nach Events in einem bestimmten Zeitraum

const serverUrl = (data.auth.serverUrl || '').trim().replace(/\/$/, '');
const username = data.auth.username;
const password = data.auth.password;

// Input-Werte
const calendarId = (data.input.calendarId || '').trim().replace(/[\r\n\t]/g, '');
const startDate = (data.input.startDate || '').trim();
const endDate = (data.input.endDate || '').trim();
const searchText = (data.input.searchText || '').trim().toLowerCase();
const maxResults = parseInt(data.input.maxResults) || 50;
const cleanHtml = data.input.cleanHtml !== false; // Default: true

// Validierung
if (!calendarId) {
  return {
    success: false,
    error: 'Bitte gib eine Kalender-ID an. Nutze "List Calendars" um verfügbare Kalender zu sehen.'
  };
}

// Basic Auth Header
const authHeader = 'Basic ' + btoa(username + ':' + password);

// Hilfsfunktion: Datum zu iCal-Format (YYYYMMDDTHHMMSSZ)
function dateToICalFormat(dateStr) {
  // Input: YYYY-MM-DD
  // Output: YYYYMMDDT000000Z
  if (!dateStr) return null;
  
  const clean = dateStr.replace(/[-:]/g, '');
  return clean + 'T000000Z';
}

// Hilfsfunktion: Heutiges Datum (YYYY-MM-DD)
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Hilfsfunktion: Datum + X Tage
function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Hilfsfunktion: iCal DateTime parsen
function parseICalDateTime(icalDateLine) {
  if (!icalDateLine) return null;
  
  let cleanDate = icalDateLine.trim();
  
  // Entferne TZID-Parameter: "TZID=Europe/Berlin:20250214T140000" → "20250214T140000"
  if (cleanDate.includes('TZID=')) {
    const colonIndex = cleanDate.lastIndexOf(':');
    if (colonIndex > 0) {
      cleanDate = cleanDate.substring(colonIndex + 1);
    }
  }
  
  // Entferne VALUE-Parameter: "VALUE=DATE:20250214" → "20250214"
  if (cleanDate.includes('VALUE=')) {
    const colonIndex = cleanDate.lastIndexOf(':');
    if (colonIndex > 0) {
      cleanDate = cleanDate.substring(colonIndex + 1);
    }
  }
  
  cleanDate = cleanDate.trim();
  
  // Format: YYYYMMDDTHHMMSSZ oder YYYYMMDDTHHMMSS oder YYYYMMDD
  if (cleanDate.length === 8) {
    // Nur Datum (ganztägig): YYYYMMDD
    const year = cleanDate.substring(0, 4);
    const month = cleanDate.substring(4, 6);
    const day = cleanDate.substring(6, 8);
    return `${year}-${month}-${day}`;
  } else if (cleanDate.includes('T') && cleanDate.length >= 15) {
    // Datum + Zeit: YYYYMMDDTHHMMSS(Z)
    const year = cleanDate.substring(0, 4);
    const month = cleanDate.substring(4, 6);
    const day = cleanDate.substring(6, 8);
    const hour = cleanDate.substring(9, 11);
    const minute = cleanDate.substring(11, 13);
    const second = cleanDate.substring(13, 15);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }
  
  ld.log('Warning: Unexpected datetime format:', icalDateLine, '→', cleanDate);
  return cleanDate;
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

// Hilfsfunktion: HTML-Entities dekodieren
function decodeHtmlEntities(text) {
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '…',
    '&euro;': '€',
    '&pound;': '£',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™'
  };
  
  let decoded = text;
  
  // Ersetze bekannte Entities
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }
  
  // Ersetze numerische Entities (&#123; oder &#xAB;)
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(parseInt(dec, 10));
  });
  
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  
  return decoded;
}

// Hilfsfunktion: HTML/CSS aus Text entfernen und zu Markdown konvertieren (optional)
function cleanDescription(text, shouldClean) {
  if (!text) return null;
  
  // Basis-Bereinigung
  let clean = text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\/g, '')
    .trim();
  
  clean = decodeHtmlEntities(clean);
  
  if (!shouldClean) return clean;
  if (!clean.includes('<')) return clean;
  
  ld.log('cleanDescription - Converting HTML to Markdown...');
  
  // PHASE 1: Entferne Style/Script
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/\s+style=["'][^"']*["']/gi, '');
  clean = clean.replace(/\s+(?:class|id)=["'][^"']*["']/gi, '');
  
  // PHASE 2: HTML → Markdown
  clean = clean.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (m, level, text) => {
    return '\n\n' + '#'.repeat(parseInt(level)) + ' ' + text + '\n\n';
  });
  clean = clean.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  clean = clean.replace(/<(?:strong|b)(?:\s[^>]*)?>(.*?)<\/(?:strong|b)>/gi, '**$1**');
  clean = clean.replace(/<(?:em|i)(?:\s[^>]*)?>(.*?)<\/(?:em|i)>/gi, '*$1*');
  clean = clean.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  clean = clean.replace(/<\/(?:p|div|ul|ol)>/gi, '\n\n');
  clean = clean.replace(/<(?:p|div|ul|ol)[^>]*>/gi, '');
  clean = clean.replace(/<br\s*\/?>/gi, '\n');
  clean = clean.replace(/<[^>]*>/g, '');
  
  clean = decodeHtmlEntities(clean);
  
  // PHASE 3: Text-Bereinigung
  const lines = clean.split('\n').map(l => l.trim()).filter(l => {
    if (l.length === 0) return true;
    if (l.match(/^#{1,6}\s/)) return true;
    if (l.match(/^[-*]\s/)) return true;
    if (l.match(/\[.*\]\(.*\)/)) return true;
    if (l.length < 3) return false;
    if (/^[,;.\s\-:)(\]}\[{*\/]+$/.test(l)) return false;
    return true;
  });
  
  clean = lines.join('\n').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  
  // PHASE 4: Längen-Begrenzung
  if (clean.length > 800) {
    const cutPoint = Math.max(
      clean.lastIndexOf('\n\n', 800),
      clean.lastIndexOf('. ', 800)
    );
    clean = cutPoint > 400 ? clean.substring(0, cutPoint) : clean.substring(0, 800);
  }
  
  return clean.trim() || null;
}


// Hilfsfunktion: iCalendar Event parsen
function parseICalEvent(icalData, eventUrl, shouldCleanHtml) {
  try {
    // WICHTIG: Erst VEVENT-Block extrahieren (nicht VTIMEZONE!)
    const veventMatch = icalData.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/);
    
    if (!veventMatch) {
      ld.log('No VEVENT found in calendar data');
      return null;
    }
    
    const veventData = veventMatch[1];
    
    // Extrahiere Properties mit Unfolding-Support
    const uid = extractICalProperty(veventData, 'UID');
    const summary = extractICalProperty(veventData, 'SUMMARY');
    const dtStart = extractICalProperty(veventData, 'DTSTART');
    const dtEnd = extractICalProperty(veventData, 'DTEND');
    const location = extractICalProperty(veventData, 'LOCATION');
    const description = extractICalProperty(veventData, 'DESCRIPTION');
    const status = extractICalProperty(veventData, 'STATUS');
    const rrule = extractICalProperty(veventData, 'RRULE');
    
    const event = {
      uid: uid || null,
      title: summary || '(Kein Titel)',
      start: dtStart ? parseICalDateTime(dtStart) : null,
      end: dtEnd ? parseICalDateTime(dtEnd) : null,
      location: location || null,
      description: description ? cleanDescription(description, shouldCleanHtml) : null,
      status: status || 'CONFIRMED',
      isRecurring: !!rrule,
      url: eventUrl
    };
    
    // Prüfe ob ganztägig (kein T in DTSTART)
    if (dtStart && !dtStart.includes('T')) {
      event.allDay = true;
    } else {
      event.allDay = false;
    }
    
    return event;
    
  } catch (error) {
    ld.log('Error parsing iCal event:', error.message);
    return null;
  }
}

try {
  // Standard-Werte für Datumsbereiche
  const searchStart = startDate || getTodayDate();
  const searchEndInput = endDate || addDays(searchStart, 30);
  
  // CalDAV time-range ist exklusiv am Ende, also +1 Tag für inklusives Verhalten
  const searchEnd = addDays(searchEndInput, 1);
  
  ld.log('Searching events in calendar:', calendarId);
  ld.log('Date range (inclusive):', searchStart, 'to', searchEndInput);
  ld.log('CalDAV query range (exclusive end):', searchStart, 'to', searchEnd);
  if (searchText) {
    ld.log('Text filter:', searchText);
  }
  ld.log('Max results:', maxResults);
  ld.log('Clean HTML:', cleanHtml);
  
  // Konvertiere zu iCal-Format
  const icalStart = dateToICalFormat(searchStart);
  const icalEnd = dateToICalFormat(searchEnd);
  
  ld.log('iCal date range:', icalStart, 'to', icalEnd);
  
  // CalDAV REPORT Query (XML)
  const reportQuery = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${icalStart}" end="${icalEnd}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
  
  ld.log('CalDAV Query prepared');
  
  // Stelle sicher, dass calendarId mit / endet
  let cleanCalendarId = calendarId;
  if (!cleanCalendarId.endsWith('/')) {
    cleanCalendarId = cleanCalendarId + '/';
  }
  
  const calendarUrl = serverUrl + cleanCalendarId;
  
  ld.log('Calendar URL:', calendarUrl);
  
  // REPORT Request senden
  const response = await ld.request({
    method: 'REPORT',
    url: calendarUrl,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '1'
    },
    body: reportQuery
  });
  
  ld.log('Response Status:', response.status);
  
  if (response.status === 207) {
    // Multi-Status Response (erfolgreich)
    const responseText = response.text;
    
    ld.log('Response length:', responseText.length);
    
    // Parse XML Response mit Regex (case-insensitive wegen D: vs d:)
    // Extrahiere alle <d:response> oder <D:response> Blöcke
    const responseBlockRegex = /<[dD]:response>([\s\S]*?)<\/[dD]:response>/gi;
    const responseBlocks = [...responseText.matchAll(responseBlockRegex)];
    
    ld.log('Found response blocks:', responseBlocks.length);
    
    const events = [];
    
    for (const block of responseBlocks) {
      const blockContent = block[1];
      
      // Extrahiere href (case-insensitive)
      const hrefMatch = blockContent.match(/<[dD]:href>(.*?)<\/[dD]:href>/i);
      const eventUrl = hrefMatch ? hrefMatch[1].trim() : null;
      
      // Extrahiere calendar-data (case-insensitive, mit und ohne Namespace-Präfix)
      // Manche Server nutzen <calendar-data>, andere <c:calendar-data> oder <CAL:calendar-data>
      const calendarDataMatch = blockContent.match(/<(?:[a-zA-Z]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?calendar-data>/i);
      
      if (calendarDataMatch) {
        const icalData = calendarDataMatch[1];
        
        ld.log('Parsing event from URL:', eventUrl);
        
        // Parse Event (mit cleanHtml-Parameter!)
        const event = parseICalEvent(icalData, eventUrl, cleanHtml);
        
        if (event && event.uid) {
          // Text-Filter anwenden (clientseitig)
          if (searchText) {
            const titleMatch = event.title.toLowerCase().includes(searchText);
            const descMatch = event.description && event.description.toLowerCase().includes(searchText);
            const locMatch = event.location && event.location.toLowerCase().includes(searchText);
            
            if (titleMatch || descMatch || locMatch) {
              events.push(event);
              ld.log('Event matched filter:', event.title);
            } else {
              ld.log('Event filtered out:', event.title);
            }
          } else {
            events.push(event);
            ld.log('Event added:', event.title);
          }
          
          // Max Results Limit
          if (events.length >= maxResults) {
            ld.log('Max results limit reached');
            break;
          }
        } else {
          ld.log('Failed to parse event or no UID found');
        }
      } else {
        ld.log('No calendar-data found in response block');
      }
    }
    
    ld.log('Parsed events:', events.length);
    
    // Sortiere nach Start-Datum
    events.sort((a, b) => {
      if (!a.start) return 1;
      if (!b.start) return -1;
      return a.start.localeCompare(b.start);
    });
    
    // Erstelle lesbare Ausgabe
    let message = `📅 **${events.length} Event${events.length !== 1 ? 's' : ''} gefunden**\n\n`;
    message += `📆 Zeitraum: ${searchStart} bis ${searchEndInput}\n`;
    if (searchText) {
      message += `🔍 Filter: "${searchText}"\n`;
    }
    message += `\n---\n\n`;
    
    for (let i = 0; i < Math.min(events.length, 20); i++) {
      const event = events[i];
      message += `**${event.title}**\n`;
      
      if (event.allDay) {
        message += `📅 ${event.start} (Ganztägig)\n`;
      } else {
        message += `🕐 ${event.start}`;
        if (event.end) {
          message += ` → ${event.end}`;
        }
        message += `\n`;
      }
      
      if (event.location) {
        message += `📍 ${event.location}\n`;
      }
      
      if (event.description) {
        const shortDesc = event.description.length > 200 
          ? event.description.substring(0, 200) + '...' 
          : event.description;
        message += `📝 ${shortDesc}\n`;
      }
      
      if (event.isRecurring) {
        message += `🔁 Wiederkehrender Termin\n`;
      }
      
      message += `🆔 \`${event.uid}\`\n`;
      message += `\n`;
    }
    
    if (events.length > 20) {
      message += `\n_... und ${events.length - 20} weitere Events_\n`;
    }
    
    return {
      success: true,
      message: message,
      events: events,
      count: events.length,
      dateRange: {
        start: searchStart,
        end: searchEndInput
      },
      searchText: searchText || null,
      cleanedHtml: cleanHtml
    };
    
  } else if (response.status === 401) {
    return {
      success: false,
      error: 'Authentifizierung fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.'
    };
    
  } else if (response.status === 403) {
    return {
      success: false,
      error: 'Zugriff verweigert. Du hast keine Berechtigung, diesen Kalender zu lesen.'
    };
    
  } else if (response.status === 404) {
    return {
      success: false,
      error: 'Kalender nicht gefunden. Bitte überprüfe die Kalender-ID.'
    };
    
  } else {
    ld.log('Response body:', response.text);
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
    error: 'Fehler beim Suchen der Events: ' + error.message
  };
}
