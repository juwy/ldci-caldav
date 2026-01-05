// CalDAV Authentication Test 

// Sichere Zugriffe auf Auth-Daten
const serverUrl = (data.auth.serverUrl || '').trim().replace(/\/$/, '');
const username = (data.auth.username || '').trim();
const password = (data.auth.password || '').trim();
const port = data.auth.port;


// Validierung der Eingaben
if (!serverUrl) {
  return {
    success: false,
    error: 'Bitte gib eine Server-URL ein (z.B. https://dav.mailbox.org)'
  };
}

if (!username) {
  return {
    success: false,
    error: 'Bitte gib einen Benutzernamen ein'
  };
}

if (!password) {
  return {
    success: false,
    error: 'Bitte gib ein Passwort ein'
  };
}

// URL-Validierung
if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
  return {
    success: false,
    error: 'Server-URL muss mit http:// oder https:// beginnen'
  };
}

// Basic Auth Header erstellen
const credentials = username + ':' + password;
const base64Credentials = btoa(credentials);
const authHeader = 'Basic ' + base64Credentials;

// Test-Request: Current User Principal abfragen
const options = {
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
    <d:displayname />
  </d:prop>
</d:propfind>`
};

try {
  ld.log('Testing connection to:', serverUrl);
  ld.log('Username:', username);
  
  const response = await ld.request(options);
  
  ld.log('Response Status:', response.status);
  ld.log('Response Headers:', JSON.stringify(response.headers));
  ld.log('Response Body:', response.text);
  
  if (response.status === 200 || response.status === 207) {
    // Erfolgreiche Authentifizierung
    
    // Versuche Displayname aus Response zu extrahieren
    let displayName = username;
    const responseText = response.text || '';
    
    if (responseText.includes('<d:displayname>')) {
      const match = responseText.match(/<d:displayname>([^<]+)<\/d:displayname>/);
      if (match && match[1]) {
        displayName = match[1];
      }
    }
    
    return {
      success: true,
      message: 'Erfolgreich verbunden als ' + displayName,
      displayname: displayName,
      useremail: username,
      server: serverUrl
    };
    
  } else if (response.status === 401) {
    return {
      success: false,
      error: 'Authentifizierung fehlgeschlagen. Bitte überprüfe Username und Passwort. Bei aktivierter 2FA benötigst du ein App-Passwort.'
    };
    
  } else if (response.status === 404) {
    return {
      success: false,
      error: 'CalDAV-Endpoint nicht gefunden. Bitte überprüfe die Server-URL. Beispiele: https://dav.mailbox.org oder https://your-nextcloud.com/remote.php/dav'
    };
    
  } else if (response.status === 403) {
    return {
      success: false,
      error: 'Zugriff verweigert. Überprüfe deine Berechtigungen.'
    };
    
  } else {
    return {
      success: false,
      error: 'Unerwarteter Fehler: HTTP ' + response.status + ' - ' + (response.text || 'Keine Details')
    };
  }
  
} catch (error) {
  ld.log('Connection Error:', error);
  ld.log('Error Message:', error.message);
  
  const errorMsg = error.message || String(error);
  
  // Bessere Fehlermeldungen
  if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('getaddrinfo')) {
    return {
      success: false,
      error: 'Server nicht gefunden. Bitte überprüfe die URL: ' + serverUrl
    };
  } else if (errorMsg.includes('ECONNREFUSED')) {
    return {
      success: false,
      error: 'Verbindung abgelehnt. Server ist nicht erreichbar oder Port ist falsch.'
    };
  } else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
    return {
      success: false,
      error: 'Verbindungs-Timeout. Server antwortet nicht innerhalb der Zeit.'
    };
  } else if (errorMsg.includes('certificate') || errorMsg.includes('SSL')) {
    return {
      success: false,
      error: 'SSL-Zertifikat-Fehler. Stelle sicher, dass die HTTPS-Verbindung vertrauenswürdig ist.'
    };
  } else if (errorMsg.includes('ECONNRESET')) {
    return {
      success: false,
      error: 'Verbindung wurde zurückgesetzt. Möglicherweise blockiert eine Firewall die Verbindung.'
    };
  } else {
    return {
      success: false,
      error: 'Verbindungsfehler: ' + errorMsg
    };
  }
}
