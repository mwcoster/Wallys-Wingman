import { generateText } from 'ai';
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

    const { text } = await generateText({
      model: MODEL,
      system: SYSTEM_INSTRUCTION,
      messages,
      maxOutputTokens: 220,
    });

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
