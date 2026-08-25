import { gateway } from '@ai-sdk/gateway';

const MODEL = 'openai/gpt-realtime-mini';

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, url } = await gateway.experimental_realtime.getToken({
      model: MODEL,
    });

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({ token, url, tools: [] });
  } catch (error: any) {
    console.error('Failed to create Wingman realtime token', error);
    return response.status(500).json({
      error: 'Unable to create realtime session',
      detail: error?.message || 'Unknown gateway error',
    });
  }
}
