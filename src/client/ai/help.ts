/** Tooltips for the trading AI assistant (the panel, the top bar and the "Ask AI" buttons on pages). */
import type { TooltipContent } from '../components/Tooltip';

export const AI = {
  button: {
    title: 'Trading AI',
    body: 'Your analyst: build a strategy from plain words, backtest it, find out what drove a result and whether it’s robust or curve-fitted. It works through the app’s own backtests, so every number comes from them.',
    note: 'It proposes — you decide: it never saves, deletes or trades. Runs on Groq; strategies and results you discuss are sent to Groq.',
  },
  usage: {
    title: 'AI allowance (Groq)',
    body: 'How much of your Groq key’s allowance is used: requests today and tokens this minute, with when they renew — and what this app used today.',
    note: 'Free plan: 1,000 requests a day and 8,000 tokens a minute. A backtest analysis takes 2–6 requests; when the minute’s tokens run out the AI waits (it says so) instead of failing.',
  },
  close: { title: 'Close', body: 'Hide the panel. The conversation keeps going and stays here.' },
  newChat: { title: 'New conversation', body: 'Start fresh — the AI forgets this conversation’s context (it stays in the list).' },
  list: { title: 'Conversations', body: 'Earlier conversations since the app started (kept in memory, not the database — a restart clears them).' },
  remove: { title: 'Delete conversation', body: 'Remove it from the list.' },
  send: { title: 'Ask', body: 'Send your question (Enter). Shift+Enter for a new line.' },
  stop: { title: 'Stop', body: 'Stop working on this answer (a backtest in progress is stopped too).' },
  context: {
    title: 'What’s on screen',
    body: 'Sent with your question, so “this backtest” or “this strategy” means the one you’re looking at.',
    note: 'Untick to ask without it.',
  },
  steps: { title: 'What the AI did', body: 'Each tool it used for this answer — strategies read, backtests run (with their figures). A failed step is usually the AI correcting itself.' },
  proposal: {
    title: 'Strategy written by the AI',
    body: 'Checked by the same rules as the builder. Open it in the builder to review, change, backtest and save it — the AI never saves.',
  },
  openBuilder: { title: 'Open in the builder', body: 'Opens this strategy in the Equity builder, unsaved — review it, then Save or Backtest without saving.' },
  openBacktest: { title: 'Open the backtest', body: 'Shows this backtest’s full result on the Backtest tab (it’s in your history, marked “by AI”).' },
  analyse: {
    title: 'Analyse with AI',
    body: 'The AI reads this backtest: what drove the result, each year against NIFTY 50, where the risk is — and can check whether it’s robust.',
  },
  describe: {
    title: 'Describe it to the AI',
    body: 'Say the strategy in your own words (“weekly close above 20 SMA and RSI above 55, exit below the 20 SMA”) — the AI writes it and opens it here for you to check.',
  },
} satisfies Record<string, TooltipContent>;
