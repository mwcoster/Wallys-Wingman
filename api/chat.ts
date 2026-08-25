import { SYSTEM_INSTRUCTION } from '../constants';

const MODEL = 'openai/gpt-5.4-nano';

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];

    if (!messages.length) {
      return response.status(400).json({ error: 'No conversation supplied' });
    }

    const token = process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY;
    if (!token) {
      return response.status(500).json({
        error: 'Gateway authentication unavailable',
        detail: 'VERCEL_OIDC_TOKEN is not available to this deployment.',
      });
    }

    const gatewayResponse = await fetch('https://ai-gateway.vercel.sh/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: SYSTEM_INSTRUCTION,
        input: messages.map((message: any) => ({
          type: 'message',
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
        max_output_tokens: 220,
      }),
    });

    const data: any = await gatewayResponse.json().catch(() => ({}));
    if (!gatewayResponse.ok) {
      const detail = data?.error?.message || data?.message || `Gateway HTTP ${gatewayResponse.status}`;
      return response.status(500).json({ error: 'Unable to reach Wingman', detail });
    }

    const text =
      String(data?.output_text || '').trim() ||
      String(
        data?.output
          ?.flatMap((item: any) => item?.content || [])
          ?.filter((item: any) => item?.type === 'output_text' || item?.type === 'text')
          ?.map((item: any) => item?.text || '')
          ?.join(' ') || '',
      ).trim();

    if (!text) {
      return response.status(500).json({
        error: 'Empty Wingman response',
        detail: JSON.stringify(data).slice(0, 500),
      });
    }

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({ text });
  } catch (error: any) {
    console.error('Wingman chat failed', error);
    return response.status(500).json({
      error: 'Unable to reach Wingman',
      detail: error?.message || 'Unknown AI Gateway error',
    });
  }
}
