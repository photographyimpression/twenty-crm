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
// fields + timeline) and POSTs it here; this endpoint streams a summary back.
// PublicEndpoint for the same reason /telnyx endpoints are: the SPA calls it
// with its normal session, which the GraphQL guards would reject on a
// non-GraphQL route. Abuse is contained by the input cap + per-IP rate limit
// below (this box also sits behind nginx with the CRM's own access story).
//
// LOCAL-PATCH (board card 2026-09-01): Gemini FIRST. The box's Ollama generates
// ~3-8 tok/s on CPU, which made the panel feel broken ("the free Gemini on
// Chrome works perfect — can I have the same?"). When GEMINI_API_KEY is set
// (it is, in /opt/twenty/.env) summaries stream from Gemini's free tier in
// ~1-2s; Ollama stays as the automatic fallback so the panel still works with
// no key or if Google is unreachable. Nothing else about the contract changes:
// plain-text streaming in, same flavors out.

const OLLAMA_URL = process.env['AI_OLLAMA_URL'] || 'http://172.17.0.1:11434';

const OLLAMA_MODEL_FLAVORS: Record<string, string> = {
  fast: 'llama3.2:3b',
  balanced: 'mistral-nemo:latest',
  deep: 'phi4:latest',
};

const GEMINI_MODEL_FLAVORS: Record<string, string> = {
  fast: 'gemini-2.5-flash',
  balanced: 'gemini-2.5-flash',
  deep: 'gemini-2.5-pro',
};

const GEMINI_API_KEY =
  process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY'] || '';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_FLAVOR = 'fast';

// The context is the open record's data — it can't be huge, but a hard cap
// keeps this endpoint from being usable as a general-purpose LLM proxy.
const MAX_CONTEXT_CHARS = 24_000;

// Token budget for the answer: a contact summary doesn't need an essay.
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
  "You are the assistant inside a photography studio's CRM.",
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

  // Stream the answer as plain text chunks, whatever the backend. `res` must
  // already have the streaming headers set by the caller.
  private async streamGemini(
    model: string,
    prompt: string,
    res: Response,
  ): Promise<boolean> {
    const response = await fetch(
      `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: MAX_ANSWER_TOKENS,
            temperature: 0.4,
          },
        }),
      },
    );

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');

      this.logger.error(
        `Gemini ${model} returned ${response.status}: ${errorText.slice(0, 200)}`,
      );

      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sentAny = false;

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE: `data: {json}` lines. Each carries candidates[0].content.parts
      // with the incremental text.
      for (;;) {
        const newlineIndex = buffer.indexOf('\n');

        if (newlineIndex === -1) break;

        const line = buffer.slice(0, newlineIndex).trim();

        buffer = buffer.slice(newlineIndex + 1);

        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();

        if (!payload || payload === '[DONE]') continue;

        try {
          const chunk = JSON.parse(payload) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };

          const text = (chunk.candidates?.[0]?.content?.parts ?? [])
            .map((part) => part.text ?? '')
            .join('');

          if (text) {
            sentAny = true;
            res.write(text);
          }
        } catch {
          // Partial JSON — wait for more bytes.
        }
      }
    }

    return sentAny;
  }

  // Ollama NDJSON streaming (the original path, now the fallback).
  private async streamOllama(
    model: string,
    prompt: string,
    res: Response,
  ): Promise<boolean> {
    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
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

      return false;
    }

    const reader = ollamaResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sentAny = false;

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

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

    return sentAny;
  }

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

    const flavor =
      body?.flavor && body.flavor in GEMINI_MODEL_FLAVORS
        ? body.flavor
        : DEFAULT_FLAVOR;
    const prompt = `${SYSTEM_PROMPT}\n\n--- CONTACT RECORD ---\n${context}`;

    try {
      // Stream plain text as it generates — the panel shows words as they
      // arrive instead of a spinner.
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');

      let sentAny = false;

      if (GEMINI_API_KEY) {
        const geminiModel = GEMINI_MODEL_FLAVORS[flavor]!;

        res.setHeader('X-Ai-Model', geminiModel);

        try {
          sentAny = await this.streamGemini(geminiModel, prompt, res);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          this.logger.error(`Gemini stream failed: ${errorMessage}`);
          sentAny = false;
        }
      }

      if (!sentAny) {
        // No key, or Gemini failed before producing anything — Ollama takes
        // over on the SAME response (headers already sent, nothing lost).
        const ollamaModel =
          OLLAMA_MODEL_FLAVORS[flavor] ?? OLLAMA_MODEL_FLAVORS['fast']!;

        res.setHeader('X-Ai-Model', ollamaModel);

        try {
          sentAny = await this.streamOllama(ollamaModel, prompt, res);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          this.logger.error(`Ollama stream failed: ${errorMessage}`);
        }
      }

      if (!sentAny) {
        if (!res.headersSent) {
          res.status(502).json({ error: 'The AI backend is unavailable' });

          return;
        }

        res.write(
          '(The AI backend is unavailable right now — try again in a minute.)',
        );
      }

      res.end();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`contact-summary failed: ${errorMessage}`);

      if (!res.headersSent) {
        res.status(500).json({ error: errorMessage });
      } else {
        res.end();
      }
    }
  }

  // LOCAL-PATCH (board card 2026-09-02): name untitled notes automatically —
  // "Untitled doesn't help me much". The note composer calls this once per
  // note when it closes with body text but no title. Gemini flash when the
  // key is set (a title is 5 words — instant), otherwise a local heuristic so
  // the feature never depends on the network.
  @Post('note-title')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async noteTitle(
    @Body() body: { noteId?: string; body?: string },
    @Res() res: Response,
  ): Promise<void> {
    const headerIp = res.req?.headers?.['x-real-ip'];
    const ip =
      typeof headerIp === 'string' && headerIp
        ? headerIp
        : (res.req?.socket?.remoteAddress ?? 'unknown');

    if (rateLimited(String(ip))) {
      res.status(429).json({ error: 'Too many requests — try again shortly' });

      return;
    }

    const noteBody = (body?.body ?? '')
      .slice(0, 4_000)
      .replace(/\s+/g, ' ')
      .trim();

    if (!noteBody) {
      res.status(400).json({ error: 'body is required' });

      return;
    }

    const heuristicTitle = () => {
      const words = noteBody.split(' ').slice(0, 6).join(' ');

      return words.length > 60 ? `${words.slice(0, 57)}…` : words;
    };

    if (!GEMINI_API_KEY) {
      res.json({ title: heuristicTitle(), model: 'heuristic' });

      return;
    }

    try {
      const response = await fetch(
        `${GEMINI_BASE}/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: [
                      'Write a 2-5 word title for this CRM note.',
                      'Plain title case, no quotes, no punctuation at the end,',
                      'no prefix like "Note:". Output ONLY the title.',
                      '',
                      '--- NOTE ---',
                      noteBody,
                    ].join('\n'),
                  },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: 300,
              temperature: 0.2,
            },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');

        this.logger.error(
          `Gemini note-title returned ${response.status}: ${errorText.slice(0, 200)}`,
        );
        res.json({ title: heuristicTitle(), model: 'heuristic' });

        return;
      }

      const json = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const title = (json.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .replace(/^["'\s]+|["'\s.]+$/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 60)
        .trim();

      res.json({
        title: title || heuristicTitle(),
        model: title ? 'gemini-2.5-flash' : 'heuristic',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`note-title failed: ${errorMessage}`);
      res.json({ title: heuristicTitle(), model: 'heuristic' });
    }
  }
}
