// List Calendars Action 
// Ruft alle verfügbaren Kalender des Benutzers ab

const serverUrl = (data.auth.serverUrl || '').trim().replace(/\/$/, '');
const username = data.auth.username;
const password = data.auth.password;

// Checkbox-Werte
const includeTasks = data.input.includeTasks === true;
const includeShared = data.input.includeShared === true;
const showDetails = data.input.showDetails === true;

ld.log('Options - includeTasks:', includeTasks, 'includeShared:', includeShared, 'showDetails:', showDetails);

// Basic Auth Header
const authHeader = 'Basic ' + btoa(username + ':' + password);

// Hilfsfunktion: XML parsen (robuster)
function extractXmlValue(xml, tagName) {
  // Unterstützt verschiedene Namespace-Präfixe
  const patterns = [
    new RegExp(`<${tagName}[^>]*>([^<]+)<\/${tagName}>`, 'i'),
    new RegExp(`<[a-z]+:${tagName}[^>]*>([^<]+)<\/[a-z]+:${tagName}>`, 'i')
  ];
  
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

try {
  ld.log('Step 1: Finding principal URL...');
  
  // Schritt 1: Principal URL finden
  const principalResponse = await ld.request({
    method: 'PROPFIND',
    url: serverUrl + '/.well-known/caldav',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '0'
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`
  });
  
  if (principalResponse.status !== 200 && principalResponse.status !== 207) {
    return {
      success: false,
      error: 'Fehler beim Abrufen der Principal-URL: HTTP ' + principalResponse.status
    };
  }
  
  // Principal URL extrahieren
  const principalUrl = extractXmlValue(principalResponse.text, 'href');
  
  if (!principalUrl) {
    return {
      success: false,
      error: 'Principal-URL konnte nicht gefunden werden'
    };
  }
  
  ld.log('Principal URL:', principalUrl);
  
  // Schritt 2: Calendar-Home-Set finden
  ld.log('Step 2: Finding calendar-home-set...');
  
  const homeSetResponse = await ld.request({
    method: 'PROPFIND',
    url: serverUrl + principalUrl,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '0'
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`
  });
  
  if (homeSetResponse.status !== 200 && homeSetResponse.status !== 207) {
    return {
      success: false,
      error: 'Fehler beim Abrufen der Calendar-Home-Set: HTTP ' + homeSetResponse.status
    };
  }
  
  // Calendar-Home-Set URL extrahieren
  const calendarHomeSet = extractXmlValue(homeSetResponse.text, 'href');
  
  if (!calendarHomeSet) {
    return {
      success: false,
      error: 'Calendar-Home-Set konnte nicht gefunden werden'
    };
  }
  
  ld.log('Calendar Home Set:', calendarHomeSet);
  
  // Schritt 3: Alle Kalender auflisten
  ld.log('Step 3: Listing calendars...');
  
  const calendarsResponse = await ld.request({
    method: 'PROPFIND',
    url: serverUrl + calendarHomeSet,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '1'
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:apple="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype />
    <d:displayname />
    <c:calendar-description />
    <cs:getctag />
    <c:supported-calendar-component-set />
    <apple:calendar-color />
    <d:owner />
  </d:prop>
</d:propfind>`
  });
  
  if (calendarsResponse.status !== 200 && calendarsResponse.status !== 207) {
    return {
      success: false,
      error: 'Fehler beim Abrufen der Kalender: HTTP ' + calendarsResponse.status
    };
  }
  
  ld.log('Calendars Response received');
  
  // Schritt 4: Kalender parsen (ROBUSTER)
  const responseText = calendarsResponse.text;
  
  // Alle <D:response> Blöcke finden
  const responseBlocks = responseText.split(/<D:response>/i).slice(1);
  
  const calendars = [];
  
  for (let i = 0; i < responseBlocks.length; i++) {
    const block = responseBlocks[i];
    
    // Prüfen ob es ein Kalender ist (mit oder ohne Leerzeichen!)
    const isCalendar = block.match(/<CAL:calendar\s*\/>/i) || 
                       block.match(/<c:calendar\s*\/>/i) ||
                       block.match(/<calendar\s*\/>/i);
    
    if (!isCalendar) {
      ld.log('Block', i, '- Not a calendar, skipping');
      continue;
    }
    
    ld.log('Block', i, '- Is a calendar!');
    
    // Kalender-Daten extrahieren
    const hrefMatch = block.match(/<D:href>([^<]+)<\/D:href>/i);
    const href = hrefMatch ? hrefMatch[1].trim() : null;
    
    if (!href || href === calendarHomeSet) {
      ld.log('Skipping - no href or is home set');
      continue; // Überspringe den Container selbst
    }
    
    const displayNameMatch = block.match(/<D:displayname>([^<]+)<\/D:displayname>/i);
    const displayName = displayNameMatch ? displayNameMatch[1].trim() : 'Unbenannter Kalender';
    
    const descMatch = block.match(/<calendar-description[^>]*>([^<]*)<\/calendar-description>/i);
    const description = descMatch ? descMatch[1].trim() : '';
    
    const ctagMatch = block.match(/<getctag[^>]*>([^<]+)<\/getctag>/i);
    const ctag = ctagMatch ? ctagMatch[1].trim() : '';
    
    const colorMatch = block.match(/<calendar-color[^>]*>([^<]+)<\/calendar-color>/i);
    const color = colorMatch ? colorMatch[1].trim() : '';
    
    // Unterstützte Komponenten (VEVENT, VTODO, etc.)
    const supportedComponents = [];
    const compMatches = block.matchAll(/<CAL:comp\s+name="([^"]+)"/gi);
    for (const match of compMatches) {
      supportedComponents.push(match[1]);
    }
    
    ld.log('Calendar found:', displayName, '- Components:', supportedComponents.join(', '));
    
    // Filtern nach Typ
    const hasEvents = supportedComponents.includes('VEVENT') || supportedComponents.length === 0;
    const hasTasks = supportedComponents.includes('VTODO');
    
    if (!includeTasks && hasTasks && !hasEvents) {
      ld.log('Skipping task-only calendar:', displayName);
      continue; // Task-Liste überspringen
    }
    
    // Kalender-Objekt erstellen
    const calendar = {
      id: href,
      name: displayName,
      url: serverUrl + href
    };
    
    // Typ bestimmen
    if (hasEvents && hasTasks) {
      calendar.type = 'Mixed (Events & Tasks)';
    } else if (hasTasks) {
      calendar.type = 'Tasks';
    } else {
      calendar.type = 'Events';
    }
    
    // Details hinzufügen wenn gewünscht
    if (showDetails) {
      if (description) calendar.description = description;
      if (color) calendar.color = color;
      if (ctag) calendar.ctag = ctag;
      if (supportedComponents.length > 0) {
        calendar.supportedComponents = supportedComponents.join(', ');
      }
    }
    
    calendars.push(calendar);
  }
  
  ld.log('Total calendars found:', calendars.length);
  
  if (calendars.length === 0) {
    return {
      success: true,
      message: 'Keine Kalender gefunden. Möglicherweise sind keine Kalender vorhanden oder du hast keine Berechtigung.',
      calendars: []
    };
  }
  
  // Formatierte Ausgabe erstellen
  let output = `📅 **${calendars.length} Kalender gefunden:**\n\n`;
  
  for (let i = 0; i < calendars.length; i++) {
    const cal = calendars[i];
    output += `**${i + 1}. ${cal.name}**\n`;
    output += `   • Typ: ${cal.type}\n`;
    output += `   • ID: \`${cal.id}\`\n`;
    
    if (showDetails) {
      if (cal.description) output += `   • Beschreibung: ${cal.description}\n`;
      if (cal.color) output += `   • Farbe: ${cal.color}\n`;
      if (cal.supportedComponents) output += `   • Komponenten: ${cal.supportedComponents}\n`;
      if (cal.ctag) output += `   • CTag: ${cal.ctag}\n`;
    }
    
    output += '\n';
  }
  
  return {
    success: true,
    message: output,
    calendars: calendars,
    count: calendars.length
  };
  
} catch (error) {
  ld.log('Error:', error.message);
  ld.log('Error stack:', error.stack);
  
  return {
    success: false,
    error: 'Fehler beim Abrufen der Kalender: ' + error.message
  };
}
