// OpenAI integration
import https from 'https';

export async function callOpenAIChat(OPENAI_API_KEY, model, messages, temperature = 0.7) {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  if (typeof fetch === 'function') {
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${OPENAI_API_KEY}` 
      },
      body: JSON.stringify({ model, messages, temperature }),
    });
  }
  
  const payload = JSON.stringify({ model, messages, temperature });
  const options = { 
    method: 'POST', 
    hostname: 'api.openai.com', 
    path: '/v1/chat/completions', 
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${OPENAI_API_KEY}`, 
      'Content-Length': Buffer.byteLength(payload) 
    } 
  };
  
  return new Promise((resolve) => {
    const req2 = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (ch) => (data += ch));
      resp.on('end', () => resolve({ 
        ok: resp.statusCode >= 200 && resp.statusCode < 300, 
        status: resp.statusCode, 
        async text() { return data; }, 
        async json() { return JSON.parse(data || '{}'); } 
      }));
    });
    req2.on('error', (err) => resolve({ 
      ok: false, 
      status: 500, 
      async text() { return String(err?.message || err); }, 
      async json() { return { error: 'network_error', detail: String(err?.message || err) }; } 
    }));
    req2.write(payload); 
    req2.end();
  });
}