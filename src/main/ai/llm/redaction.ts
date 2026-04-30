import type { AiProvider } from '../ai-credentials-repo';

export function providerLabel(provider: AiProvider): string {
  return provider === 'openai' ? 'OpenAI' : 'Claude';
}

export function redactKey(msg: string, plainKey: string): string {
  if (!msg || !plainKey) return msg;
  let out = msg.split(plainKey).join('[REDACTED]');
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  return out;
}
