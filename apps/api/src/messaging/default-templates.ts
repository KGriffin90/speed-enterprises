import type { AutomationTemplate } from '@speed-enterprises/shared';

/**
 * Default templates seeded for every new tenant. They use Handlebars-style
 * placeholders that are filled by MessagingService.render(). Tenants can
 * override any template via the AutomationTemplate table.
 *
 * Available placeholders (always — provided by sendForTenant):
 *   {{businessName}}, {{businessEmail}}, {{businessPhone}}, {{platformName}},
 *   {{webOrigin}}, {{customerFirstName}}, {{customerEmail}}, {{quoteId}},
 *   {{quoteUrl}}, {{quoteAmount}}, {{serviceName}}, {{address}}
 */
export const DEFAULT_TEMPLATES: ReadonlyArray<AutomationTemplate> = [
  // Verify email (platform-level — not tenant-branded; sent before tenant context)
  {
    kind: 'verify_email',
    channel: 'EMAIL',
    subject: 'Verify your email — {{platformName}}',
    body: `Hi,

Welcome to {{platformName}}. Use this code to verify your email:

**{{otp}}**

Or click here: {{verifyUrl}}

The code can take a few minutes to arrive and expires 15 minutes after it was sent.`,
    enabled: true,
  },
  {
    kind: 'password_reset',
    channel: 'EMAIL',
    subject: 'Reset your password — {{platformName}}',
    body: `Hi,

Click here to reset your password:

{{resetUrl}}

This link expires in 60 minutes. If you didn't request this, ignore the email.`,
    enabled: true,
  },

  // Quote lifecycle (tenant-branded)
  {
    kind: 'quote_received_customer',
    channel: 'EMAIL',
    subject: 'Thanks for choosing {{businessName}}, {{customerFirstName}}!',
    body: `Hi {{customerFirstName}},

Thank you for choosing **{{businessName}}**! We've received your request for **{{serviceName}}** at {{address}}.

Our team is reviewing the details. You can expect a custom estimate within 1–2 business days.

If you have questions, just reply to this email.

— The {{businessName}} Team
{{businessEmail}}

Reference: {{quoteId}}`,
    enabled: true,
  },
  {
    kind: 'quote_received_internal',
    channel: 'EMAIL',
    subject: 'New {{serviceName}} quote — {{customerName}}',
    body: `**New quote request**

- Customer: {{customerName}} <{{customerEmail}}> {{customerPhone}}
- Address:  {{address}}
- Service:  {{serviceName}}
- Notes:    {{customerNotes}}

Open: {{quoteUrl}}`,
    enabled: true,
  },
  {
    kind: 'estimate_sent_customer',
    channel: 'EMAIL',
    subject: 'Your {{businessName}} estimate ({{quoteAmount}})',
    body: `Hi {{customerFirstName}},

Your estimate is ready:

**{{quoteAmount}}**

{{estimateMessage}}

Tap here to accept or ask questions: {{quoteUrl}}

— {{businessName}}

Reference: {{quoteId}}`,
    enabled: true,
  },
  {
    kind: 'quote_followup_no_response',
    channel: 'EMAIL',
    subject: 'Following up on your {{serviceName}} estimate',
    body: `Hi {{customerFirstName}},

Just checking in on the estimate we sent for {{serviceName}}. Let us know if you'd like to move forward or if you have any questions.

{{quoteUrl}}

— {{businessName}}`,
    enabled: true,
  },
  {
    kind: 'quote_accepted_internal',
    channel: 'EMAIL',
    subject: '🎉 {{customerName}} accepted — {{serviceName}} ({{quoteAmount}})',
    body: `**Estimate accepted by customer**

- Customer: {{customerName}} <{{customerEmail}}>
- Service:  {{serviceName}}
- Address:  {{address}}
- Amount:   {{quoteAmount}}
{{#if customerNote}}- Note:     {{customerNote}}{{/if}}

Open: {{quoteUrl}}`,
    enabled: true,
  },
  {
    kind: 'job_scheduled_customer',
    channel: 'EMAIL',
    subject: 'Your {{businessName}} appointment is confirmed',
    body: `Hi {{customerFirstName}},

Your appointment is scheduled for **{{scheduledAt}}** at {{address}}.

We'll send a reminder before the visit. Reply if anything changes.

— {{businessName}}`,
    enabled: true,
  },
  {
    kind: 'job_reminder_customer',
    channel: 'EMAIL',
    subject: 'Reminder: {{businessName}} visit on {{scheduledAt}}',
    body: `Hi {{customerFirstName}},

Quick reminder that we'll be at {{address}} on **{{scheduledAt}}** for {{serviceName}}.

— {{businessName}}`,
    enabled: true,
  },
  {
    kind: 'job_completed_customer',
    channel: 'EMAIL',
    subject: 'Thanks from {{businessName}}!',
    body: `Hi {{customerFirstName}},

We've completed the {{serviceName}} at {{address}}. Thanks for choosing {{businessName}}!

— {{businessName}}`,
    enabled: true,
  },
  {
    kind: 'invoice_sent_customer',
    channel: 'EMAIL',
    subject: 'Invoice from {{businessName}} — {{quoteAmount}}',
    body: `Hi {{customerFirstName}},

Your invoice is ready: **{{quoteAmount}}**

Pay online: {{invoiceUrl}}

Thank you,
{{businessName}}`,
    enabled: true,
  },
  {
    kind: 'payment_received_customer',
    channel: 'EMAIL',
    subject: 'Payment received — thank you!',
    body: `Hi {{customerFirstName}},

We've received your payment of {{quoteAmount}}. Thank you!

— {{businessName}}`,
    enabled: true,
  },
  {
    kind: 'review_request_customer',
    channel: 'EMAIL',
    subject: 'How did we do?',
    body: `Hi {{customerFirstName}},

It was a pleasure serving you. If you've got a minute, we'd love your honest review:

{{reviewUrl}}

— {{businessName}}`,
    enabled: true,
  },
];
