/**
 * Industry catalog. Each entry is a starter template that the new-tenant
 * onboarding wizard offers to clone into the tenant's own Service rows.
 *
 * Keep these conservative and generic — tenants will customize. The
 * questions and pricing rules are realistic enough to demo the engine on
 * day one.
 */
import type {
  Industry, QuestionInput, PricingRuleInput, ServiceCategory, PricingMode,
  LineItemKind, CapabilityKey,
} from '@speed-enterprises/shared';
import { EXTENDED_SERVICE_TEMPLATES } from './service-templates-extended';

export interface SeedServiceTemplate {
  industry: Industry;
  name: string;
  description: string;
  category: ServiceCategory;
  iconKey: string;
  recommendedBasePriceCents: number;
  pricingMode: PricingMode;
  /** Input shape — defaults (required, affectsPricing, internal) optional at the literal site. */
  questions: QuestionInput[];
  pricingRules: PricingRuleInput[];
  lineItemKinds: LineItemKind[];
  capabilities: CapabilityKey[];
  estimatedDurationMinutes?: number;
  sortOrder: number;
}

const BASE_SERVICE_TEMPLATES: SeedServiceTemplate[] = [
  // ── WINDOW CLEANING ─────────────────────────────────────────────────────
  {
    industry: 'WINDOW_CLEANING',
    name: 'Residential Window Cleaning',
    description: 'Interior and exterior window washing for homes',
    category: 'RESIDENTIAL',
    iconKey: 'home',
    recommendedBasePriceCents: 12500,
    pricingMode: 'COMPUTED',
    sortOrder: 0,
    questions: [
      { id: 'window_count', label: 'How many windows need cleaning? (rough count — count each window once, not interior/exterior separately)',  type: 'number', required: true, min: 1, max: 200, unit: 'windows', affectsPricing: true },
      { id: 'stories',      label: 'How many stories is the property?', type: 'select', required: true, options: [
        { value: '1', label: '1 story' }, { value: '2', label: '2 stories' }, { value: '3+', label: '3+ stories' },
      ], affectsPricing: true },
      { id: 'coverage',     label: 'Interior, exterior, or both?',     type: 'select', required: true, options: [
        { value: 'exterior', label: 'Exterior only' },
        { value: 'interior', label: 'Interior only' },
        { value: 'both',     label: 'Both' },
      ], affectsPricing: true },
      { id: 'screens',      label: 'Include screens?',                 type: 'boolean', required: true, affectsPricing: true },
      { id: 'tracks',       label: 'Include window track cleaning?',   type: 'boolean', required: true, affectsPricing: true },
      { id: 'hard_water',   label: 'Hard-water staining present?',     type: 'boolean', required: true, affectsPricing: true },
      { id: 'typical_window_size', label: 'Typical window size', type: 'measurement', required: false,
        helpText: 'Optional — on the mobile app, tap "AR measure" to scan one typical window with your camera.' },
      { id: 'photos',       label: 'Photos of the windows (optional)', type: 'photo', required: false, maxFiles: 6 },
    ],
    pricingRules: [
      { id: 'per_window', label: 'Per window', order: 10, effect: { kind: 'per_unit', questionId: 'window_count', cents: 800 } },
      { id: 'two_story',  label: '2-story multiplier', order: 20, when: [{ questionId: 'stories', op: 'eq', value: '2' }], effect: { kind: 'multiply', factor: 1.25 } },
      { id: 'three_story',label: '3+ story multiplier', order: 21, when: [{ questionId: 'stories', op: 'eq', value: '3+' }], effect: { kind: 'multiply', factor: 1.5 } },
      { id: 'both_sides', label: 'Interior + exterior', order: 30, when: [{ questionId: 'coverage', op: 'eq', value: 'both' }], effect: { kind: 'multiply', factor: 1.75 } },
      { id: 'screens_add',label: 'Screen cleaning', order: 40, when: [{ questionId: 'screens', op: 'truthy' }], effect: { kind: 'per_unit', questionId: 'window_count', cents: 200 } },
      { id: 'tracks_add', label: 'Track cleaning', order: 41, when: [{ questionId: 'tracks', op: 'truthy' }], effect: { kind: 'per_unit', questionId: 'window_count', cents: 150 } },
      { id: 'hardwater',  label: 'Hard-water treatment', order: 50, when: [{ questionId: 'hard_water', op: 'truthy' }], effect: { kind: 'add', cents: 5000 } },
      { id: 'min_floor',  label: 'Minimum service fee', order: 99, effect: { kind: 'min_price', cents: 12500 } },
    ],
    lineItemKinds: ['window'],
    capabilities: ['photo_upload', 'window_rectangle_scan', 'ar_measurement'],
    estimatedDurationMinutes: 90,
  },
  {
    industry: 'WINDOW_CLEANING',
    name: 'Commercial Window Cleaning',
    description: 'Office, retail, and storefront window cleaning',
    category: 'COMMERCIAL',
    iconKey: 'building',
    recommendedBasePriceCents: 30000,
    pricingMode: 'QUOTE_REQUIRED',
    sortOrder: 1,
    questions: [
      { id: 'business_type', label: 'Type of business', type: 'select', required: true, options: [
        { value: 'office', label: 'Office' }, { value: 'retail', label: 'Retail' },
        { value: 'restaurant', label: 'Restaurant' }, { value: 'medical', label: 'Medical office' },
        { value: 'school', label: 'School' }, { value: 'other', label: 'Other' },
      ] },
      { id: 'window_count', label: 'How many windows need cleaning? (rough count — count each window once, not interior/exterior separately)', type: 'number', required: true, min: 1, max: 1000, unit: 'windows', affectsPricing: true },
      { id: 'floors', label: 'How many floors?', type: 'number', required: true, min: 1, max: 50 },
      { id: 'access', label: 'Access requirements', type: 'multiselect', required: false, options: [
        { value: 'ladder',     label: 'Ladders OK' },
        { value: 'lift',       label: 'Lift / scissor required' },
        { value: 'rope',       label: 'Rope access' },
        { value: 'inside_only',label: 'Interior only' },
      ] },
      { id: 'frequency', label: 'How often?', type: 'select', required: true, options: [
        { value: 'weekly',    label: 'Weekly' },
        { value: 'biweekly',  label: 'Bi-weekly' },
        { value: 'monthly',   label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
      ] },
      { id: 'typical_pane_size', label: 'Typical pane size', type: 'measurement', required: false,
        helpText: 'Optional — on the mobile app, tap "AR measure" to scan a typical storefront pane with your camera.' },
      { id: 'photos', label: 'Photos of the storefront/facade', type: 'photo', maxFiles: 8 },
    ],
    pricingRules: [],
    lineItemKinds: ['window', 'sqft_zone'],
    capabilities: ['photo_upload', 'address_autocomplete', 'multi_property', 'ar_measurement', 'window_rectangle_scan'],
  },

  // ── PLUMBING ────────────────────────────────────────────────────────────
  {
    industry: 'PLUMBING',
    name: 'Drain Cleaning',
    description: 'Clear clogged drains in kitchens, bathrooms, or main lines',
    category: 'BOTH',
    iconKey: 'droplet',
    recommendedBasePriceCents: 18900,
    pricingMode: 'COMPUTED',
    sortOrder: 0,
    questions: [
      { id: 'drain_location', label: 'Where is the clog?', type: 'select', required: true, options: [
        { value: 'kitchen_sink',  label: 'Kitchen sink' },
        { value: 'bathroom_sink', label: 'Bathroom sink' },
        { value: 'shower_tub',    label: 'Shower / tub' },
        { value: 'toilet',        label: 'Toilet' },
        { value: 'main_line',     label: 'Main sewer line' },
        { value: 'unknown',       label: 'Not sure' },
      ], affectsPricing: true },
      { id: 'severity', label: 'How severe?', type: 'select', required: true, options: [
        { value: 'slow_drain',  label: 'Slow drain' },
        { value: 'full_block',  label: 'Fully blocked' },
        { value: 'backing_up',  label: 'Water is backing up' },
      ], affectsPricing: true },
      { id: 'has_cleanout', label: 'Is there a cleanout access?', type: 'boolean', required: false },
      { id: 'photos_or_video', label: 'Photo or video of the issue', type: 'photo', required: false, maxFiles: 4 },
      { id: 'emergency', label: 'Is this an emergency?', type: 'boolean', required: false, affectsPricing: true },
    ],
    pricingRules: [
      { id: 'main_line', label: 'Main line surcharge', order: 10, when: [{ questionId: 'drain_location', op: 'eq', value: 'main_line' }], effect: { kind: 'add', cents: 12000 } },
      { id: 'backing_up', label: 'Severe (backing up)', order: 20, when: [{ questionId: 'severity', op: 'eq', value: 'backing_up' }], effect: { kind: 'multiply', factor: 1.3 } },
      { id: 'emergency', label: 'Emergency dispatch fee', order: 30, when: [{ questionId: 'emergency', op: 'truthy' }], effect: { kind: 'add', cents: 7500 } },
    ],
    lineItemKinds: ['fixture'],
    capabilities: ['photo_upload', 'video_upload'],
  },
  {
    industry: 'PLUMBING',
    name: 'Fixture Installation',
    description: 'Install or replace sinks, toilets, faucets, or water heaters',
    category: 'BOTH',
    iconKey: 'wrench',
    recommendedBasePriceCents: 15000,
    pricingMode: 'QUOTE_REQUIRED',
    sortOrder: 1,
    questions: [
      { id: 'fixtures', label: 'What needs installing?', type: 'multiselect', required: true, options: [
        { value: 'faucet',        label: 'Faucet' },
        { value: 'toilet',        label: 'Toilet' },
        { value: 'sink',          label: 'Sink' },
        { value: 'water_heater',  label: 'Water heater' },
        { value: 'garbage_disposal', label: 'Garbage disposal' },
        { value: 'water_softener', label: 'Water softener' },
      ] },
      { id: 'supplied_by', label: 'Who supplies the fixture?', type: 'select', required: true, options: [
        { value: 'customer', label: 'I will supply it' },
        { value: 'plumber',  label: 'You provide / recommend' },
      ] },
      { id: 'photos', label: 'Photos of the area / existing fixture', type: 'photo', maxFiles: 4 },
    ],
    pricingRules: [],
    lineItemKinds: ['fixture'],
    capabilities: ['photo_upload'],
  },

  // ── HVAC ────────────────────────────────────────────────────────────────
  {
    industry: 'HVAC',
    name: 'HVAC Tune-Up',
    description: 'Seasonal maintenance: AC or furnace inspection and cleaning',
    category: 'BOTH',
    iconKey: 'thermometer',
    recommendedBasePriceCents: 12900,
    pricingMode: 'COMPUTED',
    sortOrder: 0,
    questions: [
      { id: 'system_type', label: 'What system needs servicing?', type: 'select', required: true, options: [
        { value: 'ac',      label: 'Air conditioning' },
        { value: 'furnace', label: 'Furnace' },
        { value: 'both',    label: 'Both' },
        { value: 'mini_split', label: 'Mini-split / ductless' },
      ], affectsPricing: true },
      { id: 'unit_count', label: 'How many units?', type: 'number', required: true, min: 1, max: 20, defaultValue: 1, affectsPricing: true },
      { id: 'last_serviced', label: 'When was it last serviced?', type: 'select', required: false, options: [
        { value: 'lt_1y',  label: 'Less than a year ago' },
        { value: '1_2y',   label: '1–2 years ago' },
        { value: 'gt_2y',  label: 'More than 2 years' },
        { value: 'never',  label: 'Never / unsure' },
      ] },
      { id: 'nameplate_photo', label: 'Photo of the unit nameplate', type: 'photo', maxFiles: 2, helpText: 'Helps us know the brand & model in advance' },
    ],
    pricingRules: [
      { id: 'both_systems', label: 'AC + furnace', order: 10, when: [{ questionId: 'system_type', op: 'eq', value: 'both' }], effect: { kind: 'multiply', factor: 1.6 } },
      { id: 'add_per_unit', label: 'Additional units', order: 20, effect: { kind: 'per_unit', questionId: 'unit_count', cents: 4900 } },
    ],
    lineItemKinds: ['unit'],
    capabilities: ['photo_upload', 'nameplate_ocr'],
  },

  // ── LANDSCAPING ─────────────────────────────────────────────────────────
  {
    industry: 'LANDSCAPING',
    name: 'Lawn Care Service',
    description: 'Mowing, edging, trimming, and yard cleanup',
    category: 'RESIDENTIAL',
    iconKey: 'tree',
    recommendedBasePriceCents: 6500,
    pricingMode: 'COMPUTED',
    sortOrder: 0,
    questions: [
      { id: 'yard_sqft', label: 'Approximate yard size', type: 'number', required: true, min: 100, unit: 'sqft', affectsPricing: true },
      { id: 'frequency', label: 'How often?', type: 'select', required: true, options: [
        { value: 'weekly',   label: 'Weekly' },
        { value: 'biweekly', label: 'Every other week' },
        { value: 'monthly',  label: 'Monthly' },
        { value: 'one_time', label: 'One-time' },
      ], affectsPricing: true },
      { id: 'add_ons', label: 'Add-ons', type: 'multiselect', options: [
        { value: 'edging',         label: 'Edging' },
        { value: 'leaf_removal',   label: 'Leaf removal' },
        { value: 'hedge_trimming', label: 'Hedge trimming' },
        { value: 'fertilization',  label: 'Fertilization' },
      ] },
      { id: 'map_polygon', label: 'Draw your yard area (optional)', type: 'measurement' },
    ],
    pricingRules: [
      { id: 'sqft_tier', label: 'Yard size tier', order: 10, effect: {
        kind: 'tier', questionId: 'yard_sqft',
        tiers: [
          { upTo: 2500,  cents: 0     },
          { upTo: 5000,  cents: 1500  },
          { upTo: 10000, cents: 3000  },
          { upTo: 20000, cents: 6500  },
          { upTo: 1e9,   cents: 12500 },
        ],
      }},
      { id: 'recurring_discount', label: 'Recurring discount', order: 20,
        when: [{ questionId: 'frequency', op: 'in', value: ['weekly','biweekly'] }],
        effect: { kind: 'multiply', factor: 0.85 } },
    ],
    lineItemKinds: ['sqft_zone'],
    capabilities: ['photo_upload', 'map_polygon'],
  },

  // ── CLEANING ────────────────────────────────────────────────────────────
  {
    industry: 'CLEANING',
    name: 'House Cleaning',
    description: 'Standard, deep, or move-in/out residential cleaning',
    category: 'RESIDENTIAL',
    iconKey: 'sparkles',
    recommendedBasePriceCents: 14900,
    pricingMode: 'COMPUTED',
    sortOrder: 0,
    questions: [
      { id: 'cleaning_type', label: 'Type of cleaning', type: 'select', required: true, options: [
        { value: 'standard',     label: 'Standard cleaning' },
        { value: 'deep',         label: 'Deep cleaning' },
        { value: 'move_in_out',  label: 'Move-in / move-out' },
      ], affectsPricing: true },
      { id: 'bedrooms',  label: 'Number of bedrooms',  type: 'number', required: true, min: 0, max: 10, affectsPricing: true },
      { id: 'bathrooms', label: 'Number of bathrooms', type: 'number', required: true, min: 1, max: 10, affectsPricing: true },
      { id: 'sqft',      label: 'Approximate home size (sqft)', type: 'number', required: false, min: 200 },
      { id: 'pets',      label: 'Pets in the home?', type: 'boolean' },
    ],
    pricingRules: [
      { id: 'deep_clean',  label: 'Deep cleaning surcharge', order: 10, when: [{ questionId: 'cleaning_type', op: 'eq', value: 'deep' }], effect: { kind: 'multiply', factor: 1.6 } },
      { id: 'move_clean',  label: 'Move-in/out surcharge',   order: 11, when: [{ questionId: 'cleaning_type', op: 'eq', value: 'move_in_out' }], effect: { kind: 'multiply', factor: 1.8 } },
      { id: 'per_bedroom', label: 'Per bedroom',  order: 20, effect: { kind: 'per_unit', questionId: 'bedrooms',  cents: 2500 } },
      { id: 'per_bathroom',label: 'Per bathroom', order: 21, effect: { kind: 'per_unit', questionId: 'bathrooms', cents: 3500 } },
    ],
    lineItemKinds: ['room'],
    capabilities: ['photo_upload'],
  },

  // ── ROOFING ─────────────────────────────────────────────────────────────
  {
    industry: 'ROOFING',
    name: 'Roof Inspection',
    description: 'Visual inspection and condition report',
    category: 'BOTH',
    iconKey: 'home',
    recommendedBasePriceCents: 24900,
    pricingMode: 'FIXED',
    sortOrder: 0,
    questions: [
      { id: 'roof_type', label: 'Roof material', type: 'select', required: true, options: [
        { value: 'asphalt',  label: 'Asphalt shingle' },
        { value: 'metal',    label: 'Metal' },
        { value: 'tile',     label: 'Tile' },
        { value: 'flat',     label: 'Flat / membrane' },
        { value: 'other',    label: 'Other' },
      ] },
      { id: 'age_years', label: 'Approximate age of roof', type: 'number', min: 0, max: 80, unit: 'years' },
      { id: 'concerns',  label: 'What concerns brought you here?', type: 'longtext' },
      { id: 'photos',    label: 'Photos of the roof', type: 'photo', maxFiles: 8 },
    ],
    pricingRules: [],
    lineItemKinds: ['sqft_zone'],
    capabilities: ['photo_upload'],
  },

  // ── PAINTING ────────────────────────────────────────────────────────────
  {
    industry: 'PAINTING',
    name: 'Interior Painting',
    description: 'Walls, trim, doors, and ceilings inside the home',
    category: 'RESIDENTIAL',
    iconKey: 'paint-bucket',
    recommendedBasePriceCents: 39900,
    pricingMode: 'COMPUTED',
    sortOrder: 0,
    questions: [
      { id: 'rooms',      label: 'How many rooms?',    type: 'number', required: true, min: 1, max: 30, affectsPricing: true },
      { id: 'include_ceilings', label: 'Include ceilings?', type: 'boolean', affectsPricing: true },
      { id: 'include_trim',     label: 'Include trim?',     type: 'boolean', affectsPricing: true },
      { id: 'paint_supplied', label: 'Paint supplied by', type: 'select', required: true, options: [
        { value: 'customer', label: 'Customer' },
        { value: 'painter',  label: 'Painter (recommended)' },
      ] },
      { id: 'photos', label: 'Photos of the rooms', type: 'photo', maxFiles: 8 },
    ],
    pricingRules: [
      { id: 'per_room', label: 'Per room', order: 10, effect: { kind: 'per_unit', questionId: 'rooms', cents: 25000 } },
      { id: 'ceilings', label: 'Ceilings included', order: 20, when: [{ questionId: 'include_ceilings', op: 'truthy' }], effect: { kind: 'multiply', factor: 1.2 } },
      { id: 'trim',     label: 'Trim included',     order: 21, when: [{ questionId: 'include_trim', op: 'truthy' }],     effect: { kind: 'multiply', factor: 1.15 } },
    ],
    lineItemKinds: ['room', 'sqft_zone'],
    capabilities: ['photo_upload'],
  },

  // ── PEST CONTROL ────────────────────────────────────────────────────────
  {
    industry: 'PEST_CONTROL',
    name: 'Pest Treatment',
    description: 'Targeted treatment for common pests',
    category: 'RESIDENTIAL',
    iconKey: 'bug',
    recommendedBasePriceCents: 12900,
    pricingMode: 'COMPUTED',
    sortOrder: 0,
    questions: [
      { id: 'pest_type', label: 'What pest are you dealing with?', type: 'multiselect', required: true, options: [
        { value: 'ants',     label: 'Ants' },
        { value: 'spiders',  label: 'Spiders' },
        { value: 'rodents',  label: 'Rodents' },
        { value: 'cockroaches', label: 'Cockroaches' },
        { value: 'wasps',    label: 'Wasps / hornets' },
        { value: 'termites', label: 'Termites' },
        { value: 'other',    label: 'Other' },
      ] },
      { id: 'severity', label: 'Severity', type: 'select', required: true, options: [
        { value: 'light',    label: 'Just a few' },
        { value: 'moderate', label: 'A noticeable problem' },
        { value: 'severe',   label: 'Severe / urgent' },
      ], affectsPricing: true },
      { id: 'photos', label: 'Photos of the pest or damage', type: 'photo', maxFiles: 4 },
    ],
    pricingRules: [
      { id: 'severe_surcharge', label: 'Severe-case surcharge', order: 10, when: [{ questionId: 'severity', op: 'eq', value: 'severe' }], effect: { kind: 'multiply', factor: 1.5 } },
      { id: 'termite_special',  label: 'Termite treatment',     order: 20, when: [{ questionId: 'pest_type', op: 'in', value: ['termites'] }], effect: { kind: 'add', cents: 30000 } },
    ],
    lineItemKinds: ['pest_treatment'],
    capabilities: ['photo_upload'],
  },
];

/**
 * The full catalog: the original launch templates plus the expanded trade set
 * (see service-templates-extended.ts). The onboarding wizard filters this by
 * `industry` to offer starter services for any supported trade.
 */
export const SERVICE_TEMPLATES: SeedServiceTemplate[] = [
  ...BASE_SERVICE_TEMPLATES,
  ...EXTENDED_SERVICE_TEMPLATES,
];
