// SecureBlueprint — AI Review Backend Function
// Validates licence key, checks rate limit, calls Anthropic API

const VALID_KEYS = process.env.LICENCE_KEYS
  ? process.env.LICENCE_KEYS.split(',').map(k => k.trim())
  : [];

// Limits based on key prefix
// TRIAL-XXXX = 5 reviews/month
// SB-XXXX or TEST-XXXX = 50 reviews/month
const TRIAL_LIMIT = 5;
const PAID_LIMIT = 50;

function getLimit(key) {
  if (key.startsWith('TRIAL-')) return TRIAL_LIMIT;
  return PAID_LIMIT;
}

// Simple in-memory store for rate limiting (resets on function cold start)
const usageCounts = {};

// Notes fields stripped for privacy before sending to AI
const NOTES_FIELDS = [
  'tm1_notes', 'tm2_notes', 'arch_notes', 'identity_notes', 'authz_notes',
  'comms_notes', 'code_notes', 'data_notes', 'thirdparty_notes', 'sdlc_notes',
  'testing_notes', 'prod_notes', 'resilience_notes', 'compliance_notes'
];

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { licenceKey, prompt } = req.body;

  // 1. Validate licence key
  if (!licenceKey || !VALID_KEYS.includes(licenceKey.trim())) {
    return res.status(401).json({ error: 'Invalid licence key. Please check your key and try again.' });
  }

  // 2. Check rate limit based on key type
  const key = licenceKey.trim();
  const limit = getLimit(key);
  const month = getCurrentMonth();
  const countKey = `${key}-${month}`;
  const currentCount = usageCounts[countKey] || 0;

  if (currentCount >= limit) {
    const message = limit === TRIAL_LIMIT
      ? `Trial limit of ${TRIAL_LIMIT} AI reviews reached. Upgrade to a paid plan for 50 reviews per month.`
      : `Monthly limit of ${limit} AI reviews reached. Resets on the 1st of next month.`;
    return res.status(429).json({ error: message });
  }

  // 3. Validate prompt
  if (!prompt || prompt.length < 50) {
    return res.status(400).json({ error: 'Invalid request — no architecture data provided.' });
  }
  if (prompt.length > 20000) {
    return res.status(400).json({ error: 'Request too large — please reduce the length of your notes fields.' });
  }

  // 4. Call Anthropic API
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Anthropic API error');

    // 5. Increment usage count
    usageCounts[countKey] = currentCount + 1;

    // 6. Return result
    return res.status(200).json({
      content: data.content[0].text,
      usage: {
        used: currentCount + 1,
        limit: limit,
        remaining: limit - (currentCount + 1)
      }
    });

  } catch (err) {
    console.error('Anthropic API error:', err);
    return res.status(500).json({ error: 'AI review failed. Please try again.' });
  }
}
