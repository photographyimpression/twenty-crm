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
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createTransport } from 'nodemailer';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

// Owner phone number to forward inbound calls to
const OWNER_PHONE_NUMBER = '+15148947978';

// Email recipient for inbound SMS forwarding
const SMS_FORWARD_EMAIL = 'moshe@impressionphotography.ca';

@Controller('telnyx')
export class TelnyxWebhookController {
  protected readonly logger = new Logger(TelnyxWebhookController.name);

  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  // Telnyx TeXML webhook for inbound voice calls.
  // Plays a brief greeting, then forwards the call to the owner's mobile number.
  @Post('voice')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  handleVoiceWebhook(@Res() res: Response): void {
    const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling Impression Photography. Please hold while we connect you.</Say>
  <Dial callerId="${OWNER_PHONE_NUMBER}">
    <Number>${OWNER_PHONE_NUMBER}</Number>
  </Dial>
  <Say voice="alice">We are sorry, no one is available to take your call. Please try again later.</Say>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(texml);
  }

  // Telnyx webhook for inbound SMS messages.
  // Forwards the message to the owner email and sends an AI auto-reply.
  @Post('sms')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async handleSmsWebhook(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const data = (body?.data as Record<string, unknown>) ?? body;
    const payload = (data?.payload as Record<string, unknown>) ?? data;

    const from = (payload?.from as string) ?? 'unknown';
    const messageText = (payload?.text as string) ?? '';

    this.logger.log(`Inbound SMS from ${from}: ${messageText}`);

    // Forward inbound SMS via email
    await this.forwardSmsToEmail(from, messageText);

    // Generate and send AI auto-reply via Telnyx REST API
    await this.sendAiAutoReply(from, messageText);

    res.json({ received: true });
  }

  // Outbound SMS send endpoint — called from the CRM frontend SMS composer.
  @Post('sms/send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async sendOutboundSms(
    @Body() body: { to: string; text: string },
    @Res() res: Response,
  ): Promise<void> {
    const { to, text } = body;

    if (!to || !text) {
      res.status(400).json({ error: 'to and text are required' });

      return;
    }

    const telnyxApiKey = process.env['TELNYX_API_KEY'];
    const telnyxFromNumber = process.env['TELNYX_FROM_NUMBER'];
    const messagingProfileId = process.env['TELNYX_MESSAGING_PROFILE_ID'];

    if (!telnyxApiKey || !telnyxFromNumber) {
      res
        .status(503)
        .json({ error: 'Telnyx credentials not configured on server' });

      return;
    }

    const messageBody: Record<string, string> = {
      from: telnyxFromNumber,
      to,
      text,
    };

    if (messagingProfileId) {
      messageBody['messaging_profile_id'] = messagingProfileId;
    }

    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();

      this.logger.error(`Telnyx outbound SMS failed: ${response.status} ${errorBody}`);
      res.status(502).json({ error: `Telnyx error: ${errorBody}` });

      return;
    }

    this.logger.log(`Outbound SMS sent to ${to}`);
    res.json({ sent: true });
  }

  private async forwardSmsToEmail(
    from: string,
    messageText: string,
  ): Promise<void> {
    const smtpHost = this.twentyConfigService.get('EMAIL_SMTP_HOST');
    const smtpPort = this.twentyConfigService.get('EMAIL_SMTP_PORT');
    const smtpUser = this.twentyConfigService.get('EMAIL_SMTP_USER');
    const smtpPassword = this.twentyConfigService.get('EMAIL_SMTP_PASSWORD');
    const emailFromAddress = this.twentyConfigService.get('EMAIL_FROM_ADDRESS');

    if (!smtpHost || !smtpUser || !smtpPassword) {
      this.logger.warn(
        'SMTP not configured — skipping email forward for inbound SMS',
      );

      return;
    }

    const transporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false,
      auth: { user: smtpUser, pass: smtpPassword },
    });

    await transporter.sendMail({
      from: emailFromAddress,
      to: SMS_FORWARD_EMAIL,
      subject: `New SMS from ${from}`,
      text: `From: ${from}\n\n${messageText}`,
    });

    this.logger.log(`SMS forwarded to ${SMS_FORWARD_EMAIL}`);
  }

  private async sendAiAutoReply(
    toNumber: string,
    incomingMessage: string,
  ): Promise<void> {
    const anthropicApiKey =
      this.twentyConfigService.get('ANTHROPIC_API_KEY');
    const telnyxApiKey = process.env['TELNYX_API_KEY'];
    const telnyxFromNumber = process.env['TELNYX_FROM_NUMBER'];
    const messagingProfileId = process.env['TELNYX_MESSAGING_PROFILE_ID'];

    if (!anthropicApiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not configured — skipping AI auto-reply',
      );

      return;
    }

    if (!telnyxApiKey || !telnyxFromNumber) {
      this.logger.warn(
        'TELNYX_API_KEY or TELNYX_FROM_NUMBER not set — skipping AI auto-reply',
      );

      return;
    }

    let replyText: string;

    try {
      const result = await generateText({
        model: anthropic('claude-haiku-4-5'),
        messages: [
          {
            role: 'user',
            content: `You are a helpful assistant for Impression Photography, a professional photography studio.
Reply briefly and professionally to the following SMS message from a customer.
Keep the reply under 160 characters.

Customer message: ${incomingMessage}`,
          },
        ],
      });

      replyText = result.text.trim();
    } catch (err) {
      this.logger.error('AI auto-reply generation failed', err);

      return;
    }

    // Send reply via Telnyx Messages API
    const messageBody: Record<string, string> = {
      from: telnyxFromNumber,
      to: toNumber,
      text: replyText,
    };

    if (messagingProfileId) {
      messageBody['messaging_profile_id'] = messagingProfileId;
    }

    try {
      const response = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();

        this.logger.error(
          `Telnyx SMS send failed: ${response.status} ${errorBody}`,
        );
      } else {
        this.logger.log(`AI auto-reply sent to ${toNumber}: ${replyText}`);
      }
    } catch (err) {
      this.logger.error('Failed to send AI auto-reply via Telnyx API', err);
    }
  }
}
