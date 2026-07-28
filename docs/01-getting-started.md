# Getting started

This walks through the first-run experience and the common workflows.

## Prereqs

- Node 20+
- pnpm 9+ (`npm i -g pnpm@9`)
- Docker (for Postgres + Mailhog)

## First run

```bash
cd ~/ProjectIdeas/speed-enterprises

# Dependencies
pnpm install

# Bring up local services
pnpm db:up

# Build the shared package once so the API can import it
pnpm build:shared

# Generate the Prisma client and create the schema
pnpm prisma:generate
pnpm prisma:migrate

# Seed everything (templates + 2 example tenants + platform admin)
pnpm seed

# Start the API
pnpm dev
```

Endpoints to try:

- `GET http://localhost:4000/health` → `{ status: "ok" }`
- `GET http://localhost:4000/api/config/speedenterprises`
- Swagger: <http://localhost:4000/docs>
- Mailhog (dev email inbox): <http://localhost:8025>

## Common commands

```bash
pnpm fresh                # docker reset + migrate + seed (clobbers data)
pnpm prisma:studio        # open Prisma Studio against your local DB
pnpm typecheck            # type-check every package in parallel
pnpm --filter @speed-enterprises/api dev
pnpm --filter @speed-enterprises/shared dev   # watch-build shared types
```

## Sample requests

### Fetch a tenant's config (public — used by web/mobile at boot)

```bash
curl -s http://localhost:4000/api/config/speedenterprises | jq '{
  businessName, industry,
  brandColor: .branding.colors.brand500,
  services: [.services[] | { name, pricingMode, questionCount: (.questions | length) }]
}'
```

### Submit a public (anonymous) quote request

```bash
curl -s http://localhost:4000/api/public/quotes \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Slug: speedenterprises' \
  -d '{
    "serviceSlug": "residential-window-cleaning",
    "propertyKind": "RESIDENTIAL",
    "contact": { "email": "jane@example.com", "phone": "5555550100", "fullName": "Jane Doe" },
    "address":  { "line1": "742 Evergreen Terrace", "city": "Salt Lake City", "state": "UT", "postalCode": "84101" },
    "answers":  { "window_count": 18, "stories": "2", "coverage": "both", "screens": true, "hard_water": false }
  }' | jq
```

Watch Mailhog (<http://localhost:8025>) — you'll see two emails fire: the customer confirmation and the internal notification, both rendered with Speed Enterprises' orange branding.

### Switch to a different tenant on the same request

```bash
# Same request, different tenant → different branding, different services, different pricing.
curl -s http://localhost:4000/api/services/public \
  -H 'X-Tenant-Slug: speedenterprises' | jq
```

### Sign in as platform admin and create a third tenant

```bash
# Log in
ADMIN_JSON=$(curl -s http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@speedenterprises.app","password":"Admin!Platform2026"}')
TOKEN=$(echo "$ADMIN_JSON" | jq -r .accessToken)

# Get available HVAC templates
TPL=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/platform/tenants | jq)

# Create a new tenant — clones services from the HVAC industry templates
curl -s -X POST http://localhost:4000/api/platform/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "blue-flame-hvac",
    "businessName": "Blue Flame HVAC",
    "legalName": "Blue Flame Heating & Cooling LLC",
    "industry": "HVAC",
    "ownerEmail": "owner@blueflame.example",
    "ownerName": "Pat Owner",
    "serviceTemplateIds": []
  }' | jq
```

The new tenant is now live at `/api/config/blue-flame-hvac`. The owner gets an invite email visible in Mailhog.
