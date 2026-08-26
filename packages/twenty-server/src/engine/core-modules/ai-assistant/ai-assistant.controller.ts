import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';

import { type Response } from 'express';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

// LOCAL-PATCH: AI contact-summary panel (board card 2026-08-25 — "the Claude
// right panel I have in Chrome, so AI can summarize the contact I have open").
// The CRM frontend assembles the visible context of the open record (person
// fields + timeline) and POSTs it here; this endpoint streams a summary from
// the box's own Ollama so nothing leaves the server. PublicEndpoint for the
// same reason /telnyx endpoints are: the SPA calls it with its normal session,
// which the GraphQL guards would reject on a non-GraphQL route. Abuse is
// contained by the input cap + per-IP rate limit below (this box also sits
// behind nginx with the CRM's own access story).
//
// Models are a fixed whitelist of what's actually pulled on the OVH box — the
// browser can pick a flavor, not an arbitrary model name.

const OLLAMA_URL = process.env['AI_OLLAMA_URL'] || 'http://172.17.0.1:11434';

const MODEL_FLAVORS: Record<string, string> = {
  fast: 'llama3.2:3b',
  balanced: 'mistral-nemo:latest',
  deep: 'phi4:latest',
};

const DEFAULT_FLAVOR = 'fast';

// The context is the open record's data — it can't be huge, but a hard cap
// keeps this endpoint from being usable as a general-purpose LLM proxy.
const MAX_CONTEXT_CHARS = 24_000;

// Token budget for the answer: a contact summary doesn't need an essay, and
// the box generates ~3-8 tok/s on CPU, so a tight cap is also what keeps the
// panel responsive.
const MAX_ANSWER_TOKENS = 350;

// Per-IP rate limit (sliding window, in-memory): the panel is one person's
// tool, not a free inference API.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 6;
const rateWindowByIp = new Map<string, number[]>();

const rateLimited = (ip: string): boolean => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateWindowByIp.get(ip) ?? []).filter((t) => t > windowStart);

  if (hits.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateWindowByIp.set(ip, hits);

    return true;
  }

  hits.push(now);
  rateWindowByIp.set(ip, hits);

  return false;
};

const SYSTEM_PROMPT = [
  'You are the assistant inside a photography studio\'s CRM.',
  'You are given the CRM record of one contact (fields plus a recent',
  'activity timeline) and must brief the owner before he talks to them.',
  'Write a short briefing in plain text with these sections:',
  'WHO THEY ARE (1-2 sentences), WHAT THEY WANT (their niche/project and',
  'history with us), WHERE IT STANDS (latest status: waiting on us, waiting',
  'on them, went quiet, active client...), and NEXT MOVE (one concrete',
  'suggested action). Use only the provided information — never invent',
  'prices, dates or commitments. Max ~200 words.',
].join(' ');

@Controller('ai')
export class AiAssistantController {
  protected readonly logger = new Logger(AiAssistantController.name);

  @Post('contact-summary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async contactSummary(
    @Body()
    body: {
      context?: string;
      recordLabel?: string;
      flavor?: 'fast' | 'balanced' | 'deep';
    },
    @Res() res: Response,
  ): Promise<void> {
    // nginx proxies the CRM with X-Real-IP set; without it (direct hits) fall
    // back to the socket address.
    const headerIp = res.req?.headers?.['x-real-ip'];
    const ip =
      typeof headerIp === 'string' && headerIp
        ? headerIp
        : (res.req?.socket?.remoteAddress ?? 'unknown');

    if (rateLimited(String(ip))) {
      res.status(429).json({ error: 'Too many summaries — try again shortly' });

      return;
    }

    const context = (body?.context ?? '').slice(0, MAX_CONTEXT_CHARS).trim();

    if (!context) {
      res.status(400).json({ error: 'context is required' });

      return;
    }

    const flavor = body?.flavor && body.flavor in MODEL_FLAVORS
      ? body.flavor
      : DEFAULT_FLAVOR;
    const model = MODEL_FLAVORS[flavor]!;

    try {
      const ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: `${SYSTEM_PROMPT}\n\n--- CONTACT RECORD ---\n${context}`,
          stream: true,
          options: {
            num_predict: MAX_ANSWER_TOKENS,
            temperature: 0.4,
          },
        }),
      });

      if (!ollamaResponse.ok || !ollamaResponse.body) {
        const errorText = await ollamaResponse.text().catch(() => '');

        this.logger.error(
          `Ollama ${model} returned ${ollamaResponse.status}: ${errorText.slice(0, 200)}`,
        );
        res
          .status(502)
          .json({ error: `The AI backend (${model}) is unavailable` });

        return;
      }

      // Stream plain text as it generates — the panel shows words as they
      // arrive instead of a 30-60s spinner on this CPU-only box.
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Ai-Model', model);

      const reader = ollamaResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sentAny = false;

      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Ollama streams newline-delimited JSON chunks; each has either
        // .response (text) or .done=true on the last one.
        for (;;) {
          const newlineIndex = buffer.indexOf('\n');

          if (newlineIndex === -1) break;

          const line = buffer.slice(0, newlineIndex).trim();

          buffer = buffer.slice(newlineIndex + 1);

          if (!line) continue;

          try {
            const chunk = JSON.parse(line) as {
              response?: string;
              error?: string;
            };

            if (chunk.error) {
              this.logger.error(`Ollama ${model} stream error: ${chunk.error}`);
            }

            if (chunk.response) {
              sentAny = true;
              res.write(chunk.response);
            }
          } catch {
            // Partial JSON — wait for more bytes.
          }
        }
      }

      if (!sentAny && !res.writableEnded) {
        res.write('');
      }

      res.end();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`contact-summary failed: ${errorMessage}`);
      res.status(500).json({ error: errorMessage });
    }
  }
}
