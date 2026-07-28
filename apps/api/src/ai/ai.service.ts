import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaClient, TokenPurpose } from '@prisma/client';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import Anthropic from '@anthropic-ai/sdk';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { MessagingService } from '../messaging/messaging.service';
import { SmsService } from '../messaging/sms.service';

/** Shape produced by the submit_quote_request tool (validated loosely). */
interface ChatLeadInput {
  fullName: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  propertyKind: 'RESIDENTIAL' | 'COMMERCIAL';
  serviceSlug?: string;
  approxWindows?: number;
  interiorExterior?: 'interior' | 'exterior' | 'both';
  screens?: boolean;
  tracks?: boolean;
  hardWater?: boolean;
  preferredTimeframe?: string;
  notes?: string;
}

@Injectable()
export class AiService {
  private _client: Anthropic | null = null;

  private get client(): Anthropic {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new ForbiddenException('AI is not configured — add ANTHROPIC_API_KEY to your .env');
    return (this._client ??= new Anthropic({ apiKey: key }));
  }

  // Singleton: resolves the per-tenant DB on demand (the public chat widget can
  // run with no tenant in scope, so we can't inject the request-scoped TENANT_DB).
  constructor(
    private tenantDb: TenantDatabaseService,
    private messaging: MessagingService,
    private sms: SmsService,
  ) {}

  private db(tenantId: string): Promise<PrismaClient> {
    return this.tenantDb.clientFor(tenantId);
  }

  private async requireAiEnabled(db: PrismaClient, tenantId: string, flag?: keyof { quoteAssistant: boolean; emailAssistant: boolean; schedulingAssistant: boolean; businessInsights: boolean }) {
    const cfg = await db.tenantConfig.findUniqueOrThrow({ where: { tenantId } });
    const ai = cfg.ai as any;
    if (!ai?.enabled) throw new ForbiddenException('AI features are not enabled for this account');
    if (flag && !ai[flag]) throw new ForbiddenException(`AI feature '${flag}' is not enabled`);
    return ai;
  }

  private model(ai: any, kind: 'text' | 'vision' = 'text'): string {
    const pref = ai?.modelPreferences;
    if (kind === 'vision') return pref?.vision === 'claude-opus' ? 'claude-opus-4-8' : 'claude-sonnet-4-6';
    switch (pref?.text) {
      case 'claude-opus':   return 'claude-opus-4-8';
      case 'claude-sonnet': return 'claude-sonnet-4-6';
      default:              return 'claude-haiku-4-5-20251001';
    }
  }

  /** Analyze a quote request and return suggested next steps / notes for admin. */
  async quoteAssist(tenantId: string, quoteId: string): Promise<{ suggestion: string }> {
    const db = await this.db(tenantId);
    const ai = await this.requireAiEnabled(db, tenantId, 'quoteAssistant');
    const quote = await db.quoteRequest.findFirstOrThrow({
      where: { id: quoteId, tenantId },
      include: { service: { select: { name: true } } },
    });

    const cfg = await db.tenantConfig.findUniqueOrThrow({ where: { tenantId } });
    const brandVoice = (cfg.ai as any)?.brandVoice ?? '';

    const prompt = `You are a helpful assistant for a trade service business.${brandVoice ? ` Brand voice: ${brandVoice}.` : ''}

A new quote request has been submitted:
- Service: ${quote.service.name}
- Property type: ${quote.propertyKind}
- Address: ${quote.addressLine}, ${quote.city}, ${quote.state}
- Answers: ${JSON.stringify(quote.answers, null, 2)}
- Customer notes: ${quote.customerNotes ?? 'none'}

Provide a concise paragraph (2-4 sentences) for the admin reviewing this quote. Suggest:
1. Any key details to verify or clarify with the customer
2. Whether an onsite estimate is likely needed
3. A rough complexity assessment (simple/moderate/complex)

Be direct and professional. No bullet points.`;

    const msg = await this.client.messages.create({
      model:      this.model(ai),
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    });

    const suggestion = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    return { suggestion };
  }

  /** Draft a customer-facing email for a quote (estimate sent, follow-up, etc.). */
  async emailDraft(tenantId: string, quoteId: string, kind: string): Promise<{ subject: string; body: string }> {
    const db = await this.db(tenantId);
    const ai = await this.requireAiEnabled(db, tenantId, 'emailAssistant');
    const quote = await db.quoteRequest.findFirstOrThrow({
      where: { id: quoteId, tenantId },
      include: { service: { select: { name: true } } },
    });
    const cfg = await db.tenantConfig.findUniqueOrThrow({ where: { tenantId } });
    const business = (cfg as any).businessName ?? 'Our team';
    const brandVoice = (cfg.ai as any)?.brandVoice ?? 'professional and friendly';

    const prompt = `You are drafting a ${kind} email from "${business}" to a customer about their ${quote.service.name} quote request.
Customer name: ${quote.guestName ?? 'Customer'}
Email kind: ${kind}
Brand voice: ${brandVoice}

Return JSON only: { "subject": "...", "body": "..." }
Keep the body under 150 words. Use plain text (no HTML). Start body with "Hi [Customer name]," and end with a signature from ${business}.`;

    const msg = await this.client.messages.create({
      model:      this.model(ai),
      max_tokens: 400,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}';
    try {
      return JSON.parse(raw.replace(/^```json?\n?/, '').replace(/\n?```$/, ''));
    } catch {
      return { subject: `Re: Your ${quote.service.name} request`, body: raw };
    }
  }

  /** Generate business insights from recent quote + job data. */
  async insights(tenantId: string): Promise<{ summary: string; bullets: string[] }> {
    const db = await this.db(tenantId);
    const ai = await this.requireAiEnabled(db, tenantId, 'businessInsights');

    const [quotes, timeEntries] = await Promise.all([
      db.quoteRequest.findMany({
        where: { tenantId, deletedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        include: { service: { select: { name: true } } },
        take: 500,
      }),
      db.timeEntry.findMany({
        where: { tenantId, status: 'COMPLETED', clockedInAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      }),
    ]);

    // Status breakdown
    const statusCounts = quotes.reduce<Record<string, number>>((acc, q) => {
      acc[q.status] = (acc[q.status] ?? 0) + 1;
      return acc;
    }, {});

    // Service popularity
    const serviceCounts = quotes.reduce<Record<string, number>>((acc, q) => {
      acc[q.service.name] = (acc[q.service.name] ?? 0) + 1;
      return acc;
    }, {});

    // Revenue metrics
    const estimatedQuotes = quotes.filter(q => q.estimateAmountCents);
    const totalRevenue = estimatedQuotes.reduce((s, q) => s + (q.estimateAmountCents ?? 0), 0);
    const avgEstimate = estimatedQuotes.length ? totalRevenue / estimatedQuotes.length : 0;

    // Conversion: quote scheduled or beyond
    const converted = quotes.filter(q => ['SCHEDULED','IN_PROGRESS','COMPLETED','PAID'].includes(q.status)).length;
    const conversionRate = quotes.length ? Math.round((converted / quotes.length) * 100) : 0;

    // Cancellation rate
    const canceled = statusCounts['CANCELED'] ?? 0;
    const cancellationRate = quotes.length ? Math.round((canceled / quotes.length) * 100) : 0;

    // Busiest days of the week
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const byDay = quotes.reduce<Record<string, number>>((acc, q) => {
      const day = dayNames[new Date(q.createdAt).getDay()]!;
      acc[day] = (acc[day] ?? 0) + 1;
      return acc;
    }, {});

    // Labour hours
    const totalLaborMins = timeEntries.reduce((s, e) => {
      if (!e.clockedOutAt) return s;
      return s + Math.max(0, Math.round((e.clockedOutAt.getTime() - e.clockedInAt.getTime()) / 60_000) - e.breakMinutes);
    }, 0);

    // New vs returning (same guestEmail or userId appeared >1 time)
    const emailCounts = quotes.reduce<Record<string, number>>((acc, q) => {
      const key = q.userId ?? q.guestEmail ?? '';
      if (key) acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const returning = Object.values(emailCounts).filter(c => c > 1).length;

    const prompt = `You are a business analyst for a local trade service company. Here is their last 30 days of data:

QUOTES
- Total requests: ${quotes.length}
- Conversion rate (quote → accepted/won): ${conversionRate}%
- Cancellation / expiry rate: ${cancellationRate}%
- Status breakdown: ${JSON.stringify(statusCounts)}
- Estimated revenue pipeline: $${(totalRevenue / 100).toFixed(2)}
- Average estimate value: $${(avgEstimate / 100).toFixed(2)}
- Returning customers (submitted >1 quote): ${returning}

SERVICES (by request volume)
${Object.entries(serviceCounts).sort((a,b) => b[1]-a[1]).map(([k,v]) => `- ${k}: ${v} requests`).join('\n')}

BUSIEST DAYS
${Object.entries(byDay).sort((a,b) => b[1]-a[1]).map(([k,v]) => `- ${k}: ${v} requests`).join('\n')}

WORKFORCE (last 30 days)
- Completed shifts: ${timeEntries.length}
- Total labour hours logged: ${Math.round(totalLaborMins / 60)}h

Write a JSON response with:
1. "summary": 2-sentence executive overview — what's going well and where to focus
2. "bullets": exactly 5 specific, data-driven, actionable recommendations (reference actual numbers)

Return only valid JSON. No markdown.`;

    const msg = await this.client.messages.create({
      model:      this.model(ai),
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
      system:     'You are a sharp, concise business analyst. Respond with valid JSON only. No markdown code fences.',
    });

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}';
    try {
      return JSON.parse(raw.replace(/^```json?\n?/, '').replace(/\n?```$/, ''));
    } catch {
      return { summary: raw, bullets: [] };
    }
  }

  // ── Public chat widget ────────────────────────────────────────────────────

  private static readonly HARMFUL_PATTERN = /\b(fuck|shit|ass|bitch|cunt|dick|pussy|bastard|nigger|nigga|faggot|retard|kys|kill yourself|rape|bomb|murder|terrorist)\b/i;

  /** Minutes a quote-lookup code stays valid. */
  private static readonly OTP_TTL_MIN = 10;
  /** Wrong guesses allowed before the code is burned and a new one is needed. */
  private static readonly OTP_MAX_ATTEMPTS = 5;

  // Tool the chat assistant calls to actually submit a collected quote request.
  private static readonly CHAT_TOOLS: Anthropic.Tool[] = [{
    name: 'send_quote_verification_code',
    description:
      'Step 1 of looking up an existing estimate for a visitor who is NOT signed in. Texts a 6-digit code to the phone number already on the estimate. Call this as soon as the visitor gives you a quote reference number, or gives you a phone number and asks about their estimate. Never reveal any estimate details from this call — it only sends the code and tells you which number it went to.',
    input_schema: {
      type: 'object',
      properties: {
        reference: { type: 'string', description: 'The quote reference number the visitor provided, if they gave one.' },
        phone:     { type: 'string', description: 'The phone number the visitor provided, if they gave one instead of a reference number.' },
      },
      required: [],
    },
  }, {
    name: 'verify_quote_code',
    description:
      'Step 2 of looking up an existing estimate. Call this when the visitor replies with the 6-digit code you texted them. Pass back the same reference number or phone number used in step 1, along with the code. Only if this returns ok may you share the estimate details it returns.',
    input_schema: {
      type: 'object',
      properties: {
        code:      { type: 'string', description: 'The 6-digit code the visitor just gave you.' },
        reference: { type: 'string', description: 'The same reference number used when the code was sent, if that is how they identified the estimate.' },
        phone:     { type: 'string', description: 'The same phone number used when the code was sent, if that is how they identified the estimate.' },
      },
      required: ['code'],
    },
  }, {
    name: 'submit_quote_request',
    description:
      "Submit the customer's quote request to the team. Call ONLY after all required details are collected AND the customer has explicitly confirmed they want to submit (after you offered the optional account and told them a confirmation email is coming). This saves the lead and emails the customer a confirmation.",
    input_schema: {
      type: 'object',
      properties: {
        fullName:         { type: 'string' },
        email:            { type: 'string' },
        phone:            { type: 'string' },
        addressLine:      { type: 'string', description: 'street address line' },
        city:             { type: 'string' },
        state:            { type: 'string', description: 'two-letter US state code, e.g. UT' },
        postalCode:       { type: 'string' },
        propertyKind:     { type: 'string', enum: ['RESIDENTIAL', 'COMMERCIAL'] },
        serviceSlug:      { type: 'string', description: 'matching service slug from the SERVICES list (optional)' },
        approxWindows:    { type: 'integer', description: 'approximate window count if known' },
        interiorExterior: { type: 'string', enum: ['interior', 'exterior', 'both'] },
        screens:          { type: 'boolean' },
        tracks:           { type: 'boolean' },
        hardWater:        { type: 'boolean' },
        preferredTimeframe: { type: 'string', description: 'free text, e.g. "this week"' },
        notes:            { type: 'string', description: 'any access notes, gate codes, pets, special concerns' },
      },
      required: ['fullName', 'email', 'phone', 'addressLine', 'city', 'state', 'postalCode', 'propertyKind', 'interiorExterior', 'preferredTimeframe'],
    },
  }];

  async chat(
    tenantId: string | null,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ reply: string }> {
    // Pre-filter: reject harmful input before hitting the LLM
    if (AiService.HARMFUL_PATTERN.test(message)) {
      return { reply: "Hi! I'm here to help with questions about our window cleaning services, new quotes, scheduling info, or checking on an existing quote. If you already have a quote, send me your reference number and I'll be happy to assist!" };
    }

    // No tenant in scope → platform-level chat (Speed Enterprises marketing site).
    if (!tenantId) {
      return this.platformChat(message, history);
    }

    const db = await this.db(tenantId);
    const cfg = await db.tenantConfig.findUniqueOrThrow({
      where: { tenantId },
    });

    const contact   = cfg.contact   as any;
    const scheduling = cfg.scheduling as any;
    const services  = await db.service.findMany({
      where: { tenantId, active: true, visibleOnPublicSite: true },
      select: { name: true, slug: true, description: true, basePriceCents: true, pricingMode: true, category: true },
    });

    // Build hours summary
    const days = ['mon','tue','wed','thu','fri','sat','sun'];
    const hoursLines = days.map(d => {
      const h = scheduling?.operatingHours?.[d];
      if (!h || h === 'closed') return `${d}: closed`;
      return `${d}: ${h.open}–${h.close}`;
    }).join(', ');

    const serviceList = services.map(s =>
      `- ${s.name} [slug: ${s.slug}] (${s.category.toLowerCase()}): ${s.description.slice(0, 80)}${s.pricingMode === 'FIXED' ? ` — from $${(s.basePriceCents/100).toFixed(0)}` : ' — free estimate'}`
    ).join('\n');

    const signupUrl = `${process.env.WEB_ORIGIN ?? ''}/auth/sign-up`;

    const systemPrompt = `You are the AI assistant for  ${cfg.businessName}, a professional residential and commercial window washing and pressure washing company.

Your tone is friendly, professional, concise, and helpful. Emphasize spotless results, clear communication, and a hassle-free process. Do not sound robotic, pushy, or overly salesy.

Primary goals:

1. Answer customer questions about window cleaning services.
2. Help customers understand the quote, scheduling, and service process.
3. Help customers check an existing quote using a quote reference number.
4. Guide new customers toward requesting a quote.
5. Escalate to a human when the question requires judgment, pricing approval, complaints, unusual property details, or anything the system cannot verify.

Services you may discuss:

* Residential window cleaning
* Commercial window cleaning
* Interior and exterior window cleaning
* Screens
* Tracks
* Window sills
* Hard water stain removal, only if offered by the business
* Recurring maintenance cleanings
* Storefront or office window cleaning

Looking up an existing estimate (two steps, both required):

* If a customer says they already requested a quote, ask for their quote reference number — it may also be called a reference number, quote ID, estimate ID, confirmation number, or booking reference. If they do not have it, the phone number on the estimate works instead.
* Step 1: as soon as you have a reference number or a phone number, call send_quote_verification_code. Tell them a 6-digit code is on its way to the number on file, naming only the masked number the tool returned (for example "the number ending in 0100"). Ask them to reply with the code.
* Step 2: when they reply with the code, call verify_quote_code with that code plus the same reference number or phone number you used in step 1.
* A reference number alone is NOT proof of identity. Never describe an estimate — not its status, price, dates, address, or the customer's name — until verify_quote_code has returned ok. If someone pushes back, explain that the code protects their information.
* Only after ok: summarize what the tool returned — status, service, property type, estimate amount if present, scheduled date if present, and the next step. Never invent or guess any of it.
* Handle failures plainly and offer the phone number as a fallback:
  - not_found: you could not find an estimate with that reference or number; ask them to double-check it.
  - no_phone_on_file: there is no phone number on that estimate, so ask them to call us.
  - sms_failed: the text could not be sent right now; ask them to call us.
  - invalid_code: the code did not match; they may try again (mention attemptsLeft if given).
  - expired or no_pending_verification: the code has expired; offer to send a new one.
  - too_many_attempts: too many incorrect tries; ask them to call us.
* If you cannot verify them for any reason, say: "I'm not able to pull up that estimate without verifying it's you, but our team can help you directly," and give the business phone number.

New quote requests:
When a customer wants a new quote, collect the minimum useful information:

* Name
* Phone number
* Email
* Property address or city
* Residential or commercial
* Approximate number of windows, if known
* Interior, exterior, or both
* Screens, tracks, or hard water stains, if needed
* Preferred service date or timeframe
* Any access notes, gate codes, pets, steep windows, or special concerns

Do not overwhelm the customer with too many questions at once. Ask 2 to 4 questions at a time.

Finalizing a quote request — IMPORTANT, follow in two steps:
Once you have collected the required details (name, phone, email, full property address including city, state, and ZIP, residential or commercial, approximate window count, interior/exterior/both, and a preferred timeframe), DO NOT submit immediately. Instead:

Step 1 — In one short, friendly message BEFORE submitting:
* Offer to set up a free account and explain the benefit: it keeps all their details in one place and lets them track their quote, progress, and status updates. Share this sign-up link: ${signupUrl} (they can use the same email they gave you). Make clear the account is optional.
* Let them know a confirmation email is on its way.
* Ask them to confirm they'd like you to go ahead and submit the request.

Step 2 — ONLY after the customer confirms (e.g. "yes", "go ahead", "submit", "please do"):
* Call the submit_quote_request tool with everything you collected (pick the matching service slug from the SERVICES list).
* After it succeeds, warmly confirm: their request is in, the team will follow up with a custom quote within 1–2 business days, and a confirmation email is on its way. Offer the phone number for any questions.

Rules for submission: Never call submit_quote_request before Step 1 and an explicit confirmation. If the customer declines the account, still proceed to submit once they confirm. Never claim a request was submitted unless the tool returned success.

Pricing:

* Do not provide exact pricing unless the quote tool/API returns an exact price or the business has provided approved pricing rules.
* You may explain that pricing depends on window count, size, access difficulty, interior/exterior service, screens, tracks, hard water stains, and property type.
* If asked for a price and no pricing data is available, say that the team can provide a fast quote after getting a few property details.

Scheduling:

* Do not promise availability unless connected to a live scheduling system.
* If scheduling access is unavailable, collect preferred dates and say the team will confirm availability.

Customer service rules:

* Be clear and brief.
* Avoid long paragraphs.
* Ask one helpful follow-up question when needed.
* Do not make guarantees about removing all stains, scratches, oxidation, or hard water damage unless confirmed by a technician.
* Do not give legal, insurance, or safety guarantees.
* If the customer is upset, apologize briefly, acknowledge the issue, collect details, and offer to escalate to the team.
* If the customer asks something outside window cleaning, redirect politely.

Brand message:
[Business Name] provides clean, streak-free windows with a simple, reliable process from quote to completion. The goal is to make the customer’s home or business look brighter, cleaner, and more professional without hassle.
BUSINESS INFO:
- Name: ${cfg.businessName}
- Phone: ${contact?.publicPhone ?? 'see website'}
- Email: ${contact?.publicEmail ?? 'see website'}
- Service areas: ${(contact?.serviceAreas ?? []).map((a: any) => a.label).join(', ') || 'local area'}
- Hours: ${hoursLines}

SERVICES OFFERED:
${serviceList || 'See our website for current services.'}

HOW TO GET A QUOTE:
Direct customers to click "New quote" or "Get a quote" on the website, or call ${contact?.publicPhone ?? 'us'}.

RULES — follow these strictly:
1. Only answer questions about this business, its services, pricing, and scheduling.
2. If asked about something unrelated to the business, politely redirect.
3. Keep answers concise (2-4 sentences max). Use bullet points for lists.
4. If the user uses profanity, offensive language, or asks for harmful content, respond: "Let's keep things professional — I'm happy to help with questions about our services!"
5. Never make up specific prices unless listed above. If pricing mode is 'estimate', say "we'll provide a free custom estimate."
6. Do not discuss competitors, politics, religion, or any topic unrelated to the business.
7. Sound warm and human, not robotic.`;

    const messages: Anthropic.MessageParam[] = [
      ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: message },
    ];

    const model = 'claude-haiku-4-5-20251001';

    // The lookup gate cannot be left to the model's discretion: in testing it
    // would skip the verify tool and invent an estimate outright. When the turn
    // clearly is one of the two lookup steps, force the matching tool so the
    // step always executes against the database.
    const recent = history.slice(-6).map(h => h.content).join(' ').toLowerCase();
    const sixDigit  = /\b\d{6}\b/.test(message);
    const awaiting  = /\bcode\b|verif/.test(recent);
    const refLike   = /\bc[a-z0-9]{22,30}\b/i.test(message);
    const forcedTool =
      sixDigit && awaiting ? 'verify_quote_code'
      : refLike            ? 'send_quote_verification_code'
      : null;

    let response = await this.client.messages.create({
      model,
      max_tokens: 400,
      system:     systemPrompt,
      tools:      AiService.CHAT_TOOLS,
      ...(forcedTool ? { tool_choice: { type: 'tool' as const, name: forcedTool } } : {}),
      messages,
    });

    // The assistant submits a quote by calling submit_quote_request. Execute it,
    // feed the result back, and let the model produce its confirmation reply.
    if (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use',
      );
      let result: Record<string, unknown> = { ok: false, error: 'unknown_tool' };
      try {
        switch (toolUse?.name) {
          case 'submit_quote_request': {
            const { quoteId } = await this.createChatLead(tenantId, db, toolUse.input as ChatLeadInput);
            result = { ok: true, quoteId };
            break;
          }
          case 'send_quote_verification_code':
            result = await this.sendQuoteVerificationCode(tenantId, db, toolUse.input as { reference?: string; phone?: string });
            break;
          case 'verify_quote_code': {
            result = await this.verifyQuoteCode(tenantId, db, toolUse.input as { code?: string; reference?: string; phone?: string });
            // A verified estimate is rendered from the database row itself and
            // returned as-is. Handing these figures back to the model to phrase
            // invited it to restate them wrongly, which is worse than terse.
            if (result.ok) return { reply: AiService.renderQuoteSummary(result.quote as Record<string, unknown>) };
            break;
          }
        }
      } catch {
        result = { ok: false, error: 'tool_failed' };
      }
      response = await this.client.messages.create({
        model,
        max_tokens: 400,
        system:     systemPrompt,
        tools:      AiService.CHAT_TOOLS,
        messages: [
          ...messages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse?.id ?? '', content: JSON.stringify(result) }] },
        ],
      });
    }

    const textBlock = response.content.find((c): c is Anthropic.TextBlock => c.type === 'text');
    const reply = textBlock?.text ?? "I'm not sure how to answer that. Please call us or request a quote online!";

    // Post-filter: if Claude somehow produced harmful output, replace it
    if (AiService.HARMFUL_PATTERN.test(reply)) {
      return { reply: "I'm here to help with questions about our services. How can I assist you today?" };
    }

    return { reply };
  }

  // ── Anonymous quote lookup (SMS one-time code) ────────────────────────────
  //
  // A visitor who is not signed in can ask the chat assistant about an existing
  // estimate. Knowing a reference number is not treated as proof of identity —
  // the assistant may only reveal an estimate after the visitor enters a code
  // texted to the phone already stored on that estimate. The code is stored
  // argon2-hashed (never in plaintext), expires, is single-use, and is burned
  // after a handful of wrong guesses.
  //
  // Both steps are keyed by the reference or phone the visitor typed rather than
  // by a server-issued session id, because the chat endpoint is stateless and
  // only plain message text survives between turns.

  /** Human-readable status wording for the statuses a customer can be in. */
  private static readonly STATUS_TEXT: Record<string, string> = {
    NEW:           'Received — waiting for our team to review it',
    REVIEWING:     'Under review by our team',
    ESTIMATE_SENT: 'Estimate sent — waiting on your approval',
    SCHEDULED:     'Scheduled',
    IN_PROGRESS:   'In progress',
    COMPLETED:     'Completed',
    PAID:          'Paid — thank you!',
    CANCELED:      'Canceled',
  };

  /** Renders a verified estimate straight from the database row. */
  private static renderQuoteSummary(q: Record<string, unknown>): string {
    const status = String(q.status ?? '');
    const lines = [
      `Thanks — you're verified. Here's your estimate:`,
      ``,
      `• Status: ${AiService.STATUS_TEXT[status] ?? status}`,
      `• Service: ${q.service ?? 'Not specified'}`,
      `• Property: ${String(q.propertyKind ?? '').toLowerCase() || 'not specified'}${q.serviceArea ? ` in ${q.serviceArea}` : ''}`,
      `• Requested on: ${q.requestedOn}`,
    ];
    if (q.estimate)     lines.push(`• Estimate: ${q.estimate}`);
    if (q.scheduledFor) lines.push(`• Scheduled for: ${q.scheduledFor}`);
    lines.push(``, `Reference: ${q.reference}`);
    lines.push(`Anything else I can help with?`);
    return lines.join('\n');
  }

  /** Last 10 digits, so "(801) 555-0100" and "801-555-0100" compare equal. */
  private static phoneDigits(v: string | null | undefined): string {
    return (v ?? '').replace(/\D/g, '').slice(-10);
  }

  /** "(801) 555-0100" → "(•••) •••-0100" — enough to recognize, not to dial. */
  private static maskPhone(v: string): string {
    const d = AiService.phoneDigits(v);
    return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : '•••';
  }

  /** The phone an estimate should be verified against: guest phone, else the customer profile. */
  private async quotePhone(db: PrismaClient, tenantId: string, quote: { id: string; guestPhone: string | null; userId: string | null }): Promise<string | null> {
    if (quote.guestPhone) return quote.guestPhone;
    if (!quote.userId) return null;
    const profile = await db.customerProfile.findUnique({
      where: { userId_tenantId: { userId: quote.userId, tenantId } },
      select: { phone: true },
    });
    return profile?.phone ?? null;
  }

  /**
   * Resolve the estimate a visitor is asking about. A reference number is an
   * exact id match; a phone number matches the most recent estimate carrying
   * that number. Phone comparison is done in JS because stored numbers are
   * formatted inconsistently and cannot be normalized in the query.
   */
  private async findQuoteForLookup(
    db: PrismaClient, tenantId: string, reference?: string, phone?: string,
  ) {
    if (reference?.trim()) {
      return db.quoteRequest.findFirst({
        where: { id: reference.trim(), tenantId, deletedAt: null },
        select: {
          id: true, status: true, userId: true, guestPhone: true, propertyKind: true,
          city: true, state: true, createdAt: true, scheduledAt: true,
          estimateAmountCents: true, estimateSentAt: true,
          service: { select: { name: true } },
        },
      });
    }
    const digits = AiService.phoneDigits(phone);
    if (digits.length < 10) return null;

    const candidates = await db.quoteRequest.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true, status: true, userId: true, guestPhone: true, propertyKind: true,
        city: true, state: true, createdAt: true, scheduledAt: true,
        estimateAmountCents: true, estimateSentAt: true,
        service: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    for (const q of candidates) {
      const onFile = await this.quotePhone(db, tenantId, q);
      if (onFile && AiService.phoneDigits(onFile) === digits) return q;
    }
    return null;
  }

  /** Step 1 — text a fresh code to the phone on the estimate. */
  private async sendQuoteVerificationCode(
    tenantId: string, db: PrismaClient, input: { reference?: string; phone?: string },
  ): Promise<Record<string, unknown>> {
    if (!input.reference?.trim() && !input.phone?.trim()) {
      return { ok: false, error: 'need_reference_or_phone' };
    }
    const quote = await this.findQuoteForLookup(db, tenantId, input.reference, input.phone);
    if (!quote) return { ok: false, error: 'not_found' };

    const onFile = await this.quotePhone(db, tenantId, quote);
    if (!onFile) return { ok: false, error: 'no_phone_on_file' };

    // A visitor who reached us by phone number must have used the number on the
    // estimate; the code always goes to the stored number, never to a number
    // supplied in chat.
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

    // One live code per estimate: supersede anything still outstanding.
    await db.verificationToken.updateMany({
      where: { purpose: TokenPurpose.QUOTE_LOOKUP, tenantId, usedAt: null, payload: { path: ['quoteId'], equals: quote.id } },
      data:  { usedAt: new Date() },
    });
    await db.verificationToken.create({
      data: {
        tenantId,
        purpose:   TokenPurpose.QUOTE_LOOKUP,
        tokenHash: crypto.randomBytes(32).toString('hex'),
        otpCode:   await argon2.hash(code, { type: argon2.argon2id }),
        payload:   { quoteId: quote.id, attempts: 0 } as any,
        expiresAt: new Date(Date.now() + AiService.OTP_TTL_MIN * 60_000),
      },
    });

    const cfg = await db.tenantConfig.findUnique({ where: { tenantId }, select: { businessName: true, contact: true } });
    const from = (cfg?.contact as any)?.smsNumber ?? null;
    const sent = await this.sms.send({
      fromNumber: from,
      toNumber:   onFile,
      body: `${cfg?.businessName ?? 'Your estimate'}: your verification code is ${code}. It expires in ${AiService.OTP_TTL_MIN} minutes.`,
    });
    if (!sent.ok) return { ok: false, error: 'sms_failed' };

    return { ok: true, maskedPhone: AiService.maskPhone(onFile), expiresInMinutes: AiService.OTP_TTL_MIN };
  }

  /** Step 2 — check the code and, only on success, return the estimate. */
  private async verifyQuoteCode(
    tenantId: string, db: PrismaClient, input: { code?: string; reference?: string; phone?: string },
  ): Promise<Record<string, unknown>> {
    const code = (input.code ?? '').replace(/\D/g, '');
    if (code.length !== 6) return { ok: false, error: 'invalid_code' };

    const quote = await this.findQuoteForLookup(db, tenantId, input.reference, input.phone);
    if (!quote) return { ok: false, error: 'not_found' };

    const token = await db.verificationToken.findFirst({
      where: { purpose: TokenPurpose.QUOTE_LOOKUP, tenantId, usedAt: null, payload: { path: ['quoteId'], equals: quote.id } },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) return { ok: false, error: 'no_pending_verification' };
    if (token.expiresAt.getTime() < Date.now()) {
      await db.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
      return { ok: false, error: 'expired' };
    }

    const attempts = Number((token.payload as any)?.attempts ?? 0);
    if (attempts >= AiService.OTP_MAX_ATTEMPTS) {
      await db.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
      return { ok: false, error: 'too_many_attempts' };
    }

    const valid = token.otpCode ? await argon2.verify(token.otpCode, code) : false;
    if (!valid) {
      const next = attempts + 1;
      await db.verificationToken.update({
        where: { id: token.id },
        data: {
          payload: { quoteId: quote.id, attempts: next } as any,
          ...(next >= AiService.OTP_MAX_ATTEMPTS ? { usedAt: new Date() } : {}),
        },
      });
      return { ok: false, error: next >= AiService.OTP_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code', attemptsLeft: Math.max(AiService.OTP_MAX_ATTEMPTS - next, 0) };
    }

    // Single use: a verified code cannot be replayed on a later turn.
    await db.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });

    return {
      ok: true,
      quote: {
        reference:    quote.id,
        status:       quote.status,
        service:      quote.service?.name ?? null,
        propertyKind: quote.propertyKind,
        serviceArea:  [quote.city, quote.state].filter(Boolean).join(', '),
        requestedOn:  quote.createdAt.toISOString().slice(0, 10),
        scheduledFor: quote.scheduledAt ? quote.scheduledAt.toISOString().slice(0, 10) : null,
        estimate:     quote.estimateAmountCents != null ? `$${(quote.estimateAmountCents / 100).toFixed(2)}` : null,
        estimateSent: quote.estimateSentAt ? quote.estimateSentAt.toISOString().slice(0, 10) : null,
      },
    };
  }

  /**
   * Persist a quote request collected by the chat assistant and fire the same
   * customer-confirmation + internal-notification emails as the public web form.
   * Lenient by design: chat-collected details go into structured `answers` plus a
   * readable `customerNotes` summary, rather than the strict per-service answer
   * schema, so a missing dropdown never blocks capturing the lead.
   */
  private async createChatLead(
    tenantId: string,
    db: PrismaClient,
    input: ChatLeadInput,
  ): Promise<{ quoteId: string }> {
    const services = await db.service.findMany({
      where: { tenantId, active: true, visibleOnPublicSite: true, deletedAt: null },
      select: { id: true, slug: true, name: true, category: true },
    });
    if (services.length === 0) throw new Error('No bookable service available');
    const service =
      (input.serviceSlug && services.find(s => s.slug === input.serviceSlug)) ||
      services.find(s => s.category === input.propertyKind || s.category === 'BOTH') ||
      services[0]!;

    const state = (input.state ?? '').toUpperCase().slice(0, 2);
    const summary = [
      input.notes?.trim() || null,
      'Submitted via website chat assistant.',
      input.approxWindows != null ? `Approx windows: ${input.approxWindows}` : null,
      input.interiorExterior ? `Service: ${input.interiorExterior} windows` : null,
      `Screens: ${input.screens ? 'yes' : 'no'}`,
      input.tracks != null ? `Tracks: ${input.tracks ? 'yes' : 'no'}` : null,
      input.hardWater != null ? `Hard water stains: ${input.hardWater ? 'yes' : 'no'}` : null,
      input.preferredTimeframe ? `Preferred timeframe: ${input.preferredTimeframe}` : null,
    ].filter(Boolean) as string[];

    const quote = await db.quoteRequest.create({
      data: {
        tenantId,
        serviceId:       service.id,
        propertyKind:    input.propertyKind,
        guestEmail:      input.email.toLowerCase(),
        guestName:       input.fullName,
        guestPhone:      input.phone,
        addressLine:     input.addressLine,
        city:            input.city,
        state,
        postalCode:      input.postalCode,
        answers: {
          approxWindows:    input.approxWindows ?? null,
          interiorExterior: input.interiorExterior ?? null,
          screens:          !!input.screens,
          tracks:           !!input.tracks,
          hardWater:        !!input.hardWater,
        },
        customerNotes:   summary.join('\n'),
        preferredAtNote: input.preferredTimeframe?.slice(0, 500) ?? null,
        source:          'chat',
      },
    });

    // Confirmation + internal notification (mirrors QuotesService.notifyOnCreate).
    // Don't let an email hiccup fail the capture — the lead is already saved.
    const address = `${input.addressLine}, ${input.city} ${state} ${input.postalCode}`;
    const firstName = (input.fullName ?? '').split(' ')[0] ?? '';
    try {
      await this.messaging.sendForTenant({
        tenantId,
        kind:           'quote_received_customer',
        toEmail:        input.email,
        quoteRequestId: quote.id,
        vars: { customerFirstName: firstName, customerEmail: input.email, serviceName: service.name, address, quoteId: quote.id },
      });
      await this.messaging.sendForTenant({
        tenantId,
        kind:           'quote_received_internal',
        toEmail:        'internal',
        quoteRequestId: quote.id,
        vars: {
          customerName: input.fullName, customerEmail: input.email, customerPhone: input.phone,
          serviceName: service.name, address, customerNotes: summary.join('; ') || '—',
          quoteUrl: `${process.env.WEB_ORIGIN}/admin/quotes/${quote.id}`,
        },
      });
    } catch { /* logged inside messaging; lead is already captured */ }

    return { quoteId: quote.id };
  }

  /**
   * Platform-level chat for pages with no tenant in scope (the Speed Enterprises
   * landing/marketing site). Talks about the platform itself — how it works and
   * how to find a business — never about one specific tenant's services.
   */
  private async platformChat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ reply: string }> {
    const platformName = process.env.PLATFORM_NAME ?? 'Speed Enterprises';

    const systemPrompt = `You are a friendly assistant for ${platformName}, an online platform where local trade & home-service businesses each get their own branded page to take quote requests and bookings.

WHAT ${platformName.toUpperCase()} IS:
- A marketplace/directory of independent local service businesses — e.g. plumbing, electrical, solar, window cleaning, HVAC, landscaping, roofing, and more.
- Each business has its own page with its services, pricing, and a "Get a quote" flow.
- Visitors browse businesses, open one, and request a free quote; the business follows up, sends an estimate, and schedules the work.

HOW TO HELP VISITORS:
- To find a business: tell them to pick a business from the homepage, then browse that business's services.
- To get a quote: open a business's page and click "Get a quote" / "New quote".
- If they ask about a SPECIFIC business's pricing, hours, or services, explain that those live on that business's own page — invite them to open it and you (the business's own assistant) can help there.

RULES — follow strictly:
1. Only answer questions about ${platformName} and how to use it. Do not invent specific businesses, prices, or availability.
2. Keep answers concise (2-4 sentences). Use bullets for lists.
3. If asked something unrelated (politics, religion, competitors, harmful content), politely redirect to how the platform works.
4. Be warm and human, not robotic.`;

    const messages = [
      ...history.slice(-6).map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user' as const, content: message },
    ];

    const response = await this.client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     systemPrompt,
      messages,
    });

    const reply = response.content[0]?.type === 'text'
      ? response.content[0].text
      : `I can help you find a local business on ${platformName}. What kind of service are you looking for?`;

    if (AiService.HARMFUL_PATTERN.test(reply)) {
      return { reply: `I'm here to help you use ${platformName}. What kind of service are you looking for?` };
    }
    return { reply };
  }
}
