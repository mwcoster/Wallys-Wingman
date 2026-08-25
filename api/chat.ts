import { SYSTEM_INSTRUCTION } from '../constants';

const MODEL = 'openai/gpt-5.4-nano';
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) {
    return response.status(500).json({
      error: 'Gateway authentication unavailable',
      detail: 'Vercel did not provide an AI Gateway credential to this deployment.',
    });
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];

    if (!messages.length) {
      return response.status(400).json({ error: 'No conversation supplied' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    let gatewayResponse: Response;
    try {
      gatewayResponse = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            ...messages,
          ],
          max_tokens: 220,
          temperature: 0.4,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const raw = await gatewayResponse.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch {}

    if (!gatewayResponse.ok) {
      const detail =
        data?.error?.message ||
        data?.message ||
        raw ||
        `AI Gateway returned HTTP ${gatewayResponse.status}`;
      return response.status(gatewayResponse.status).json({
        error: 'Unable to reach Wingman',
        detail,
      });
    }

    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      return response.status(502).json({
        error: 'Wingman returned no answer',
        detail: 'The AI Gateway response did not contain message text.',
      });
    }

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({ text });
  } catch (error: any) {
    const detail = error?.name === 'AbortError'
      ? 'AI Gateway timed out after 15 seconds.'
      : error?.message || 'Unknown AI Gateway error';

    console.error('Wingman chat failed', error);
    return response.status(500).json({
      error: 'Unable to reach Wingman',
      detail,
    });
  }
}
