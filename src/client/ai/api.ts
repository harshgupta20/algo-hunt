/** Typed client for the trading AI assistant (/api/ai/*). */
import type { AiConversation, AiConversationLine, AiSendRequest, AiStatus } from '@/shared/ai/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ai${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const aiApi = {
  status: () => request<AiStatus>('/status'),
  conversations: () => request<AiConversationLine[]>('/conversations'),
  conversation: (id: string) => request<AiConversation>(`/conversations/${id}`),
  send: (body: AiSendRequest) => request<AiConversation>('/conversations', { method: 'POST', body: JSON.stringify(body) }),
  stop: (id: string) => request<AiConversation>(`/conversations/${id}/stop`, { method: 'POST' }),
  remove: (id: string) => request<void>(`/conversations/${id}`, { method: 'DELETE' }),
};
