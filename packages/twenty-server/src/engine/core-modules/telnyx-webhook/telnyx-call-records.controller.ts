import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';

import * as path from 'path';
import { type Response } from 'express';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

import {
  contentTypeForExtension,
  TelnyxWebhookService,
} from './telnyx-webhook.service';

@Controller('telnyx/call-records')
export class TelnyxCallRecordsController {
  protected readonly logger = new Logger(TelnyxCallRecordsController.name);

  constructor(private readonly telnyxWebhookService: TelnyxWebhookService) {}

  @Get()
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getCallRecords() {
    return {
      data: this.telnyxWebhookService.getCallRecords(),
    };
  }

  @Get(':sessionId')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getCallRecord(@Param('sessionId') sessionId: string) {
    const record = this.telnyxWebhookService.getCallRecord(sessionId);

    if (!record) {
      return { data: null, error: 'Call record not found' };
    }

    return { data: record };
  }

  // The in-CRM dialer's live (mic-side) transcript, posted when the call
  // ends so it can be saved onto the person's timeline note. peerPhone is the
  // number the dialer called — used to match the call record when the WebRTC
  // session id doesn't equal the voice-webhook's session key.
  @Post('transcript')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async saveLiveTranscript(
    @Body()
    body: {
      sessionId?: string;
      transcript?: string;
      peerPhone?: string;
    },
  ) {
    if (!body?.sessionId) {
      return { data: null, error: 'sessionId is required' };
    }

    await this.telnyxWebhookService.saveLiveTranscript(
      body.sessionId,
      body.transcript ?? null,
      body.peerPhone ?? null,
    );

    return { data: 'ok' };
  }
}

@Controller('telnyx/sms-records')
export class TelnyxSmsRecordsController {
  protected readonly logger = new Logger(TelnyxSmsRecordsController.name);

  constructor(private readonly telnyxWebhookService: TelnyxWebhookService) {}

  @Get()
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getSmsRecords(@Query('contact') contact?: string) {
    return {
      data: this.telnyxWebhookService.getSmsRecords(contact),
    };
  }
}

// Serves MMS attachments persisted by the SMS webhook. The filename is the
// webhook event id + index + extension — unguessable in practice, which is
// the same auth posture as the sms-records list itself.
@Controller('telnyx/sms-media')
export class TelnyxSmsMediaController {
  protected readonly logger = new Logger(TelnyxSmsMediaController.name);

  constructor(private readonly telnyxWebhookService: TelnyxWebhookService) {}

  @Get(':filename')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  getMedia(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = this.telnyxWebhookService.getMediaFilePath(filename);

    if (!filePath) {
      res.status(404).json({ error: 'Media not found' });

      return;
    }

    const contentType = contentTypeForExtension(path.extname(filePath));

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.setHeader('Cache-Control', 'private, max-age=86400');

    // dotfiles:'allow' is REQUIRED: the files live under .local-storage (a
    // dot-directory), and express's send default ("ignore") 404s any path
    // with a dotfile segment. The error callback keeps a failure visible —
    // without it the UnhandledExceptionFilter swallows stream errors.
    res.sendFile(filePath, { dotfiles: 'allow' }, (error) => {
      if (error) {
        this.logger.error(`Failed to stream MMS media ${filePath}: ${error}`);

        if (!res.headersSent) {
          res.status(500);
        }

        res.end();
      }
    });
  }
}
