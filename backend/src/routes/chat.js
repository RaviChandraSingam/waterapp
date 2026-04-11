const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.post('/', authenticate, async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI assistant is not configured. Please add GEMINI_API_KEY.' });
  }

  try {
    // Fetch live context from DB to ground the AI responses
    const [pendingRes, recordsRes, configRes, blocksRes] = await Promise.all([
      db.query(`
        SELECT priority, status, COUNT(*) AS count
        FROM pending_items
        WHERE status NOT IN ('done', 'cancelled')
        GROUP BY priority, status
        ORDER BY
          CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          status
      `),
      db.query(`
        SELECT year, month, status, total_water_input, total_water_usage, cost_per_litre
        FROM monthly_records
        ORDER BY year DESC, month DESC
        LIMIT 3
      `),
      db.query(`SELECT config_key, config_value, description FROM billing_config ORDER BY config_key`),
      db.query(`SELECT COUNT(*) AS flat_count FROM flats WHERE is_active = true`),
    ]);

    const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const pendingLines = pendingRes.rows.length
      ? pendingRes.rows.map(r => `  - ${r.priority} priority / ${r.status}: ${r.count} item(s)`).join('\n')
      : '  - No active pending items';

    const recordLines = recordsRes.rows.length
      ? recordsRes.rows.map(r =>
          `  - ${MONTH_NAMES[r.month]} ${r.year} [${r.status}]: ` +
          `input=${r.total_water_input != null ? Number(r.total_water_input).toLocaleString() + ' L' : 'N/A'}, ` +
          `usage=${r.total_water_usage != null ? Number(r.total_water_usage).toLocaleString() + ' L' : 'N/A'}, ` +
          `cost=₹${r.cost_per_litre != null ? Number(r.cost_per_litre).toFixed(4) + '/L' : 'N/A'}`
        ).join('\n')
      : '  - No monthly records yet';

    const configLines = configRes.rows.length
      ? configRes.rows.map(r => `  - ${r.description || r.config_key}: ${r.config_value}`).join('\n')
      : '  - Not configured';

    const flatCount = blocksRes.rows[0]?.flat_count || '?';

    const systemPrompt = `You are an AI assistant for WaterApp — a residential housing society's water management application.

The app tracks water meter readings, billing, maintenance tasks (pending items), and monthly water usage reports.

Current live data:
Active flats: ${flatCount}

Active pending maintenance items (open/in_progress/on_hold):
${pendingLines}

Recent monthly records (latest first):
${recordLines}

Billing configuration:
${configLines}

Guidelines:
- Keep responses concise and factual.
- When quoting numbers, use the data above.
- If asked something outside water/billing/maintenance management, politely redirect.
- Use ₹ for currency and litres (L) for volume.
- You can help with: understanding bills, interpreting usage trends, pending items status, and general water management advice.`;

    // Build contents array for Gemini multi-turn
    const contents = [
      ...history
        .filter(h => h.role && h.text)
        .map(h => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: message.trim() }] },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 512, temperature: 0.4 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      return res.status(502).json({ error: 'AI service returned an error. Check your API key.' });
    }

    const data = await geminiRes.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      return res.status(502).json({ error: 'No response received from AI.' });
    }

    res.json({ reply });
  } catch (err) {
    console.error('Chat route error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
