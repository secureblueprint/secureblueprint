// SecureBlueprint — AI Review Backend Function
// Validates licence key, checks rate limit, calls Anthropic API

const VALID_KEYS = process.env.LICENCE_KEYS
  ? process.env.LICENCE_KEYS.split(',').map(k => k.trim())
  : [];

const MONTHLY_LIMIT = 50;

// Simple in-memory store for rate limiting (resets on function cold start)
// For production, replace with Upstash Redis
const usageCounts = {};

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}`;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { licenceKey, prompt } = req.body;

  // 1. Validate licence key
  if (!licenceKey || !VALID_KEYS.includes(licenceKey.trim())) {
    return res.status(401).json({ error: 'Invalid licence key. Please check your key and try again.' });
  }

  // 2. Check rate limit
  const month = getCurrentMonth();
  const countKey = `${licenceKey.trim()}-${month}`;
  const currentCount = usageCounts[countKey] || 0;

  if (currentCount >= MONTHLY_LIMIT) {
    return res.status(429).json({ 
      error: `Monthly limit of ${MONTHLY_LIMIT} AI reviews reached. Resets on the 1st of next month.` 
    });
  }

  // 3. Validate prompt exists
  if (!prompt || prompt.length < 50) {
    return res.status(400).json({ error: 'Invalid request — no architecture data provided.' });
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

    if (!response.ok) {
      throw new Error(data.error?.message || 'Anthropic API error');
    }

    // 5. Increment usage count
    usageCounts[countKey] = currentCount + 1;

    // 6. Return result with usage info
    return res.status(200).json({
      content: data.content[0].text,
      usage: {
        used: currentCount + 1,
        limit: MONTHLY_LIMIT,
        remaining: MONTHLY_LIMIT - (currentCount + 1)
      }
    });

  } catch (err) {
    console.error('Anthropic API error:', err);
    return res.status(500).json({ error: 'AI review failed. Please try again.' });
  }
}
