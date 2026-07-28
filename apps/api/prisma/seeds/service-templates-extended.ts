/**
 * Expanded trade catalog — starter templates for the industries added beyond
 * the original launch set. Concatenated into SERVICE_TEMPLATES.
 *
 * These are QUOTE_REQUIRED by default (the onboarding wizard lets the owner
 * switch to COMPUTED and add pricing rules later), so they carry no pricing
 * rules — just realistic intake questions per trade. Kept deliberately
 * conservative; tenants customize after cloning.
 */
import type { SeedServiceTemplate } from './service-templates';

type Q = SeedServiceTemplate['questions'][number];

// ── Reusable intake questions ────────────────────────────────────────────────
const PROPERTY: Q = {
  id: 'property_type', label: 'Property type', type: 'select', required: true, options: [
    { value: 'residential', label: 'Residential' },
    { value: 'commercial', label: 'Commercial' },
  ],
};
const PHOTOS: Q = { id: 'photos', label: 'Photos of the area or project (optional)', type: 'photo', required: false, maxFiles: 6 };
const NOTES: Q = { id: 'notes', label: 'Anything else we should know?', type: 'longtext', required: false };
const ADDRESS: Q = { id: 'address', label: 'Service address', type: 'address', required: false };
const URGENCY: Q = {
  id: 'urgency', label: 'How urgent is this?', type: 'select', required: false, options: [
    { value: 'routine', label: 'Routine' },
    { value: 'soon', label: 'Within a week' },
    { value: 'emergency', label: 'Emergency' },
  ],
};
const sqft = (label = 'Approximate area (sq ft)'): Q => ({ id: 'sqft', label, type: 'number', required: false, min: 1, unit: 'sqft' });
const linearFt = (label = 'Approximate length (linear ft)'): Q => ({ id: 'linear_ft', label, type: 'number', required: false, min: 1, unit: 'ft' });
const count = (id: string, label: string, unit: string): Q => ({ id, label, type: 'number', required: false, min: 1, unit });

interface TmplOpts {
  category?: SeedServiceTemplate['category'];
  iconKey?: string;
  basePrice?: number;
  sortOrder?: number;
  lineItemKinds?: SeedServiceTemplate['lineItemKinds'];
  capabilities?: SeedServiceTemplate['capabilities'];
  questions?: Q[];
  durationMin?: number;
}

function tmpl(industry: SeedServiceTemplate['industry'], name: string, description: string, opts: TmplOpts = {}): SeedServiceTemplate {
  return {
    industry,
    name,
    description,
    category: opts.category ?? 'BOTH',
    iconKey: opts.iconKey ?? 'wrench',
    recommendedBasePriceCents: opts.basePrice ?? 0,
    pricingMode: 'QUOTE_REQUIRED',
    sortOrder: opts.sortOrder ?? 0,
    questions: opts.questions ?? [PROPERTY, PHOTOS, NOTES],
    pricingRules: [],
    lineItemKinds: opts.lineItemKinds ?? ['misc'],
    capabilities: opts.capabilities ?? ['photo_upload'],
    ...(opts.durationMin ? { estimatedDurationMinutes: opts.durationMin } : {}),
  };
}

export const EXTENDED_SERVICE_TEMPLATES: SeedServiceTemplate[] = [
  // ── GUTTERS ───────────────────────────────────────────────────────────────
  tmpl('GUTTERS', 'Gutter Installation', 'New seamless gutters and downspouts', {
    iconKey: 'home', sortOrder: 0, lineItemKinds: ['linear_ft'], capabilities: ['photo_upload', 'address_autocomplete', 'ar_measurement'],
    questions: [PROPERTY, { id: 'stories', label: 'How many stories?', type: 'select', required: true, options: [
      { value: '1', label: '1 story' }, { value: '2', label: '2 stories' }, { value: '3+', label: '3+ stories' }] },
      linearFt('Approximate roofline length (linear ft)'), { id: 'guards', label: 'Add gutter guards?', type: 'boolean', required: false }, PHOTOS, NOTES],
  }),
  tmpl('GUTTERS', 'Gutter Cleaning', 'Clear leaves and debris from gutters and downspouts', {
    iconKey: 'droplet', sortOrder: 1, lineItemKinds: ['linear_ft'], capabilities: ['photo_upload'],
    questions: [PROPERTY, { id: 'stories', label: 'How many stories?', type: 'select', required: true, options: [
      { value: '1', label: '1 story' }, { value: '2', label: '2 stories' }, { value: '3+', label: '3+ stories' }] }, URGENCY, PHOTOS, NOTES],
  }),

  // ── SIDING ────────────────────────────────────────────────────────────────
  tmpl('SIDING', 'Siding Installation & Repair', 'Vinyl, fiber-cement, and wood siding install or repair', {
    iconKey: 'building', sortOrder: 0, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [PROPERTY, { id: 'material', label: 'Preferred material', type: 'select', required: false, options: [
      { value: 'vinyl', label: 'Vinyl' }, { value: 'fiber_cement', label: 'Fiber cement (Hardie)' }, { value: 'wood', label: 'Wood' }, { value: 'unsure', label: 'Not sure' }] },
      { id: 'scope', label: 'Install or repair?', type: 'select', required: true, options: [
        { value: 'full', label: 'Full replacement' }, { value: 'partial', label: 'Partial / repair' }] }, sqft('Approximate wall area (sq ft)'), PHOTOS, NOTES],
  }),

  // ── GLASS & WINDOWS ─────────────────────────────────────────────────────────
  tmpl('GLASS', 'Window Replacement', 'Replace old or damaged windows', {
    iconKey: 'window', sortOrder: 0, lineItemKinds: ['window'], capabilities: ['photo_upload', 'window_rectangle_scan', 'ar_measurement'],
    questions: [PROPERTY, count('window_count', 'How many windows?', 'windows'), { id: 'style', label: 'Window style', type: 'select', required: false, options: [
      { value: 'double_hung', label: 'Double-hung' }, { value: 'casement', label: 'Casement' }, { value: 'slider', label: 'Slider' }, { value: 'picture', label: 'Picture' }, { value: 'unsure', label: 'Not sure' }] }, PHOTOS, NOTES],
  }),
  tmpl('GLASS', 'Door Installation', 'Entry, patio, and sliding door installation', {
    iconKey: 'door', sortOrder: 1, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'ar_measurement'],
    questions: [PROPERTY, { id: 'door_type', label: 'Door type', type: 'select', required: true, options: [
      { value: 'entry', label: 'Entry door' }, { value: 'patio', label: 'Patio door' }, { value: 'sliding', label: 'Sliding glass' }, { value: 'storm', label: 'Storm door' }] }, count('door_count', 'How many doors?', 'doors'), PHOTOS, NOTES],
  }),
  tmpl('GLASS', 'Glass Repair', 'Broken glass, mirrors, and shower-glass repair', {
    iconKey: 'window', sortOrder: 2, lineItemKinds: ['window'], capabilities: ['photo_upload'],
    questions: [{ id: 'glass_type', label: 'What needs repair?', type: 'select', required: true, options: [
      { value: 'window', label: 'Window pane' }, { value: 'mirror', label: 'Mirror' }, { value: 'shower', label: 'Shower glass' }, { value: 'storefront', label: 'Storefront glass' }, { value: 'tabletop', label: 'Tabletop' }] }, URGENCY, PHOTOS, NOTES],
  }),

  // ── GARAGE DOORS ────────────────────────────────────────────────────────────
  tmpl('GARAGE_DOOR', 'Garage Door Repair', 'Springs, openers, tracks, and full garage-door service', {
    iconKey: 'door', sortOrder: 0, lineItemKinds: ['unit'], capabilities: ['photo_upload'],
    questions: [{ id: 'issue', label: "What's wrong?", type: 'select', required: true, options: [
      { value: 'wont_open', label: "Won't open / close" }, { value: 'spring', label: 'Broken spring' }, { value: 'opener', label: 'Opener problem' }, { value: 'off_track', label: 'Off track' }, { value: 'new_door', label: 'Want a new door' }] }, URGENCY, PHOTOS, NOTES],
  }),

  // ── FLOORING ─────────────────────────────────────────────────────────────────
  tmpl('FLOORING', 'Flooring Installation', 'Hardwood, laminate, and luxury vinyl plank flooring', {
    iconKey: 'layers', sortOrder: 0, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'ar_measurement'],
    questions: [PROPERTY, { id: 'material', label: 'Flooring type', type: 'select', required: true, options: [
      { value: 'hardwood', label: 'Hardwood' }, { value: 'laminate', label: 'Laminate' }, { value: 'lvp', label: 'Luxury vinyl plank' }, { value: 'unsure', label: 'Not sure' }] }, sqft('Approximate floor area (sq ft)'), { id: 'rooms', label: 'Which rooms?', type: 'text', required: false }, PHOTOS, NOTES],
  }),
  tmpl('FLOORING', 'Carpet Installation', 'Carpet supply and installation', {
    iconKey: 'layers', sortOrder: 1, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'ar_measurement'],
    questions: [PROPERTY, sqft('Approximate carpet area (sq ft)'), count('rooms', 'How many rooms?', 'rooms'), { id: 'removal', label: 'Remove old flooring?', type: 'boolean', required: false }, PHOTOS, NOTES],
  }),
  tmpl('FLOORING', 'Tile Installation', 'Floor, wall, and backsplash tile', {
    iconKey: 'grid', sortOrder: 2, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'ar_measurement'],
    questions: [PROPERTY, { id: 'tile_area', label: 'Where is the tile?', type: 'select', required: true, options: [
      { value: 'floor', label: 'Floor' }, { value: 'shower', label: 'Shower / tub' }, { value: 'backsplash', label: 'Backsplash' }, { value: 'wall', label: 'Wall' }] }, sqft('Approximate area (sq ft)'), PHOTOS, NOTES],
  }),
  tmpl('FLOORING', 'Garage Epoxy Flooring', 'Epoxy and polyaspartic garage floor coatings', {
    iconKey: 'layers', sortOrder: 3, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload'],
    questions: [count('bays', 'How many car bays?', 'bays'), sqft('Approximate floor area (sq ft)'), { id: 'condition', label: 'Current floor condition', type: 'select', required: false, options: [
      { value: 'good', label: 'Good' }, { value: 'cracked', label: 'Cracked / stained' }, { value: 'previously_coated', label: 'Previously coated' }] }, PHOTOS, NOTES],
  }),

  // ── CABINETS & COUNTERTOPS ───────────────────────────────────────────────────
  tmpl('CABINETS_COUNTERTOPS', 'Cabinet Installation', 'Kitchen and bath cabinetry install or refacing', {
    iconKey: 'box', sortOrder: 0, lineItemKinds: ['linear_ft'], capabilities: ['photo_upload', 'ar_measurement'],
    questions: [{ id: 'room', label: 'Which room?', type: 'select', required: true, options: [
      { value: 'kitchen', label: 'Kitchen' }, { value: 'bathroom', label: 'Bathroom' }, { value: 'laundry', label: 'Laundry / other' }] }, { id: 'scope', label: 'New cabinets or reface?', type: 'select', required: true, options: [
        { value: 'new', label: 'New cabinets' }, { value: 'reface', label: 'Refacing' }] }, linearFt('Approximate cabinet run (linear ft)'), PHOTOS, NOTES],
  }),
  tmpl('CABINETS_COUNTERTOPS', 'Countertop Installation', 'Quartz, granite, and laminate countertops', {
    iconKey: 'box', sortOrder: 1, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'ar_measurement'],
    questions: [{ id: 'material', label: 'Material', type: 'select', required: true, options: [
      { value: 'quartz', label: 'Quartz' }, { value: 'granite', label: 'Granite' }, { value: 'laminate', label: 'Laminate' }, { value: 'butcher_block', label: 'Butcher block' }, { value: 'unsure', label: 'Not sure' }] }, sqft('Approximate counter area (sq ft)'), PHOTOS, NOTES],
  }),

  // ── FENCING ──────────────────────────────────────────────────────────────────
  tmpl('FENCING', 'Fence Installation', 'Wood, vinyl, and chain-link fencing and gates', {
    iconKey: 'fence', sortOrder: 0, lineItemKinds: ['linear_ft'], capabilities: ['photo_upload', 'map_polygon', 'address_autocomplete'],
    questions: [PROPERTY, { id: 'material', label: 'Fence material', type: 'select', required: true, options: [
      { value: 'wood', label: 'Wood' }, { value: 'vinyl', label: 'Vinyl' }, { value: 'chain_link', label: 'Chain link' }, { value: 'aluminum', label: 'Aluminum' }, { value: 'unsure', label: 'Not sure' }] }, linearFt('Approximate fence length (linear ft)'), { id: 'gates', label: 'How many gates?', type: 'number', required: false, min: 0 }, PHOTOS, NOTES],
  }),

  // ── DECKS & PATIOS ───────────────────────────────────────────────────────────
  tmpl('DECK_PATIO', 'Deck Building', 'New decks, deck repair, and resurfacing', {
    iconKey: 'home', sortOrder: 0, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'ar_measurement'],
    questions: [{ id: 'scope', label: 'New build or repair?', type: 'select', required: true, options: [
      { value: 'new', label: 'New deck' }, { value: 'repair', label: 'Repair / resurface' }] }, { id: 'material', label: 'Decking material', type: 'select', required: false, options: [
        { value: 'wood', label: 'Wood' }, { value: 'composite', label: 'Composite' }, { value: 'unsure', label: 'Not sure' }] }, sqft('Approximate deck size (sq ft)'), PHOTOS, NOTES],
  }),
  tmpl('DECK_PATIO', 'Patio & Hardscape', 'Paver patios, walkways, and retaining walls', {
    iconKey: 'grid', sortOrder: 1, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'map_polygon'],
    questions: [{ id: 'feature', label: 'What are you building?', type: 'multiselect', required: true, options: [
      { value: 'patio', label: 'Paver patio' }, { value: 'walkway', label: 'Walkway' }, { value: 'retaining_wall', label: 'Retaining wall' }, { value: 'firepit', label: 'Fire pit' }] }, sqft('Approximate area (sq ft)'), PHOTOS, NOTES],
  }),

  // ── LOCKSMITH ──────────────────────────────────────────────────────────────────
  tmpl('LOCKSMITH', 'Locksmith Service', 'Lockouts, rekeys, lock changes, and new hardware', {
    iconKey: 'key', sortOrder: 0, category: 'BOTH', lineItemKinds: ['unit'], capabilities: ['photo_upload'],
    questions: [{ id: 'service', label: 'What do you need?', type: 'select', required: true, options: [
      { value: 'lockout', label: 'Locked out' }, { value: 'rekey', label: 'Rekey locks' }, { value: 'change', label: 'Change / install locks' }, { value: 'key_copy', label: 'Key copy / fob' }, { value: 'safe', label: 'Safe service' }] }, URGENCY, { id: 'lock_count', label: 'How many locks?', type: 'number', required: false, min: 1 }, NOTES],
  }),

  // ── MOVING ──────────────────────────────────────────────────────────────────
  tmpl('MOVING', 'Moving Service', 'Local and long-distance moving and packing', {
    iconKey: 'truck', sortOrder: 0, category: 'BOTH', lineItemKinds: ['misc'], capabilities: ['photo_upload', 'address_autocomplete', 'date_picker'],
    questions: [{ id: 'move_type', label: 'Type of move', type: 'select', required: true, options: [
      { value: 'local', label: 'Local' }, { value: 'long_distance', label: 'Long distance' }] }, { id: 'home_size', label: 'Size of home', type: 'select', required: true, options: [
        { value: 'studio', label: 'Studio / 1 bed' }, { value: '2_3', label: '2–3 bedrooms' }, { value: '4plus', label: '4+ bedrooms' }, { value: 'office', label: 'Office / commercial' }] }, { id: 'packing', label: 'Need packing help?', type: 'boolean', required: false }, { id: 'move_date', label: 'Preferred move date', type: 'date', required: false }, NOTES],
  }),

  // ── JUNK REMOVAL ──────────────────────────────────────────────────────────────
  tmpl('JUNK_REMOVAL', 'Junk Removal', 'Hauling, debris removal, and property cleanouts', {
    iconKey: 'trash', sortOrder: 0, category: 'BOTH', lineItemKinds: ['misc'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [{ id: 'volume', label: 'Roughly how much?', type: 'select', required: true, options: [
      { value: 'few_items', label: 'A few items' }, { value: 'half_truck', label: 'About half a truck' }, { value: 'full_truck', label: 'A full truck' }, { value: 'multiple', label: 'Multiple loads' }] }, { id: 'items', label: 'What are we hauling?', type: 'text', required: false }, URGENCY, PHOTOS, NOTES],
  }),

  // ── SEPTIC ──────────────────────────────────────────────────────────────────
  tmpl('SEPTIC', 'Septic Service', 'Septic pumping, inspection, and repair', {
    iconKey: 'droplet', sortOrder: 0, lineItemKinds: ['misc'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [{ id: 'service', label: 'What do you need?', type: 'select', required: true, options: [
      { value: 'pumping', label: 'Pumping' }, { value: 'inspection', label: 'Inspection' }, { value: 'repair', label: 'Repair' }, { value: 'install', label: 'New system' }] }, URGENCY, NOTES],
  }),

  // ── RADON ──────────────────────────────────────────────────────────────────
  tmpl('RADON', 'Radon Mitigation', 'Radon testing and mitigation systems', {
    iconKey: 'shield', sortOrder: 0, lineItemKinds: ['misc'], capabilities: ['photo_upload'],
    questions: [{ id: 'service', label: 'Testing or mitigation?', type: 'select', required: true, options: [
      { value: 'test', label: 'Radon testing' }, { value: 'mitigation', label: 'Mitigation system' }, { value: 'both', label: 'Both' }] }, { id: 'foundation', label: 'Foundation type', type: 'select', required: false, options: [
        { value: 'basement', label: 'Basement' }, { value: 'slab', label: 'Slab' }, { value: 'crawlspace', label: 'Crawlspace' }] }, PHOTOS, NOTES],
  }),

  // ── RESTORATION ──────────────────────────────────────────────────────────────
  tmpl('RESTORATION', 'Water Damage Restoration', 'Flood, leak, and water-damage cleanup and repair', {
    iconKey: 'droplet', sortOrder: 0, lineItemKinds: ['room'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [{ id: 'source', label: 'Source of water', type: 'select', required: false, options: [
      { value: 'flood', label: 'Flood / storm' }, { value: 'leak', label: 'Pipe / appliance leak' }, { value: 'sewage', label: 'Sewage backup' }, { value: 'unknown', label: 'Not sure' }] }, URGENCY, { id: 'rooms', label: 'How many rooms affected?', type: 'number', required: false, min: 1 }, PHOTOS, NOTES],
  }),
  tmpl('RESTORATION', 'Fire & Smoke Damage Restoration', 'Fire, smoke, and soot damage restoration', {
    iconKey: 'flame', sortOrder: 1, lineItemKinds: ['room'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [URGENCY, { id: 'rooms', label: 'How many rooms affected?', type: 'number', required: false, min: 1 }, PHOTOS, NOTES],
  }),
  tmpl('RESTORATION', 'Mold Remediation', 'Mold inspection, removal, and remediation', {
    iconKey: 'shield', sortOrder: 2, lineItemKinds: ['room'], capabilities: ['photo_upload'],
    questions: [{ id: 'location', label: 'Where is the mold?', type: 'select', required: false, options: [
      { value: 'bathroom', label: 'Bathroom' }, { value: 'basement', label: 'Basement' }, { value: 'attic', label: 'Attic' }, { value: 'walls', label: 'Walls / multiple' }] }, { id: 'tested', label: 'Has it been tested?', type: 'boolean', required: false }, PHOTOS, NOTES],
  }),

  // ── INSULATION ──────────────────────────────────────────────────────────────
  tmpl('INSULATION', 'Insulation Installation', 'Attic, wall, and spray-foam insulation', {
    iconKey: 'layers', sortOrder: 0, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload'],
    questions: [PROPERTY, { id: 'area', label: 'Where?', type: 'multiselect', required: true, options: [
      { value: 'attic', label: 'Attic' }, { value: 'walls', label: 'Walls' }, { value: 'crawlspace', label: 'Crawlspace' }, { value: 'basement', label: 'Basement' }] }, { id: 'type', label: 'Insulation type', type: 'select', required: false, options: [
        { value: 'blown_in', label: 'Blown-in' }, { value: 'batt', label: 'Batt / roll' }, { value: 'spray_foam', label: 'Spray foam' }, { value: 'unsure', label: 'Not sure' }] }, sqft(), PHOTOS, NOTES],
  }),

  // ── CHIMNEY & FIREPLACE ───────────────────────────────────────────────────────
  tmpl('CHIMNEY', 'Chimney Cleaning', 'Chimney sweeping and creosote removal', {
    iconKey: 'flame', sortOrder: 0, lineItemKinds: ['unit'], capabilities: ['photo_upload'],
    questions: [{ id: 'fireplace_type', label: 'Fireplace type', type: 'select', required: false, options: [
      { value: 'wood', label: 'Wood-burning' }, { value: 'gas', label: 'Gas' }, { value: 'pellet', label: 'Pellet stove' }] }, { id: 'last_cleaned', label: 'When was it last cleaned?', type: 'select', required: false, options: [
        { value: 'lt1', label: 'Under a year' }, { value: '1_3', label: '1–3 years' }, { value: 'gt3', label: '3+ years / never' }] }, PHOTOS, NOTES],
  }),
  tmpl('CHIMNEY', 'Fireplace Repair', 'Fireplace, flue, and chimney repair', {
    iconKey: 'flame', sortOrder: 1, lineItemKinds: ['unit'], capabilities: ['photo_upload'],
    questions: [{ id: 'issue', label: "What's the issue?", type: 'select', required: true, options: [
      { value: 'wont_light', label: "Won't light / draft" }, { value: 'damper', label: 'Damper problem' }, { value: 'masonry', label: 'Cracked masonry / flue' }, { value: 'cap', label: 'Cap / crown' }, { value: 'inspection', label: 'Just need inspection' }] }, PHOTOS, NOTES],
  }),

  // ── WINDOW TREATMENTS ───────────────────────────────────────────────────────
  tmpl('WINDOW_TREATMENTS', 'Blinds & Shades Installation', 'Custom blinds, shades, and shutters', {
    iconKey: 'window', sortOrder: 0, lineItemKinds: ['window'], capabilities: ['photo_upload', 'ar_measurement', 'window_rectangle_scan'],
    questions: [PROPERTY, { id: 'product', label: 'Product type', type: 'select', required: true, options: [
      { value: 'blinds', label: 'Blinds' }, { value: 'shades', label: 'Shades' }, { value: 'shutters', label: 'Shutters' }, { value: 'drapery', label: 'Drapery' }, { value: 'unsure', label: 'Not sure' }] }, count('window_count', 'How many windows?', 'windows'), { id: 'motorized', label: 'Motorized?', type: 'boolean', required: false }, PHOTOS, NOTES],
  }),

  // ── SECURITY & SMART HOME ──────────────────────────────────────────────────────
  tmpl('SECURITY_SMART_HOME', 'Security Camera Installation', 'CCTV, doorbell cameras, and surveillance systems', {
    iconKey: 'shield', sortOrder: 0, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [PROPERTY, count('camera_count', 'How many cameras?', 'cameras'), { id: 'wiring', label: 'Wired or wireless?', type: 'select', required: false, options: [
      { value: 'wired', label: 'Wired' }, { value: 'wireless', label: 'Wireless' }, { value: 'unsure', label: 'Not sure' }] }, PHOTOS, NOTES],
  }),
  tmpl('SECURITY_SMART_HOME', 'Smart Home Installation', 'Smart thermostats, locks, lighting, and automation', {
    iconKey: 'cpu', sortOrder: 1, lineItemKinds: ['unit'], capabilities: ['photo_upload'],
    questions: [{ id: 'devices', label: 'What would you like installed?', type: 'multiselect', required: true, options: [
      { value: 'thermostat', label: 'Smart thermostat' }, { value: 'locks', label: 'Smart locks' }, { value: 'lighting', label: 'Smart lighting' }, { value: 'doorbell', label: 'Video doorbell' }, { value: 'hub', label: 'Hub / automation' }, { value: 'speakers', label: 'Speakers / AV' }] }, NOTES],
  }),

  // ── EV CHARGING ──────────────────────────────────────────────────────────────
  tmpl('EV_CHARGER', 'EV Charger Installation', 'Level 2 home and commercial EV charger installation', {
    iconKey: 'zap', sortOrder: 0, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [PROPERTY, { id: 'charger', label: 'Do you have a charger?', type: 'select', required: false, options: [
      { value: 'have', label: 'I have one' }, { value: 'need', label: 'Need a recommendation' }] }, { id: 'panel_distance', label: 'Distance from electrical panel', type: 'select', required: false, options: [
        { value: 'close', label: 'Same wall / close' }, { value: 'medium', label: 'Across the garage' }, { value: 'far', label: 'Far / outdoors' }] }, PHOTOS, NOTES],
  }),

  // ── COMMERCIAL MAINTENANCE ─────────────────────────────────────────────────────
  tmpl('COMMERCIAL_MAINTENANCE', 'Commercial Maintenance Plan', 'Recurring facility and building maintenance', {
    iconKey: 'building', sortOrder: 0, category: 'COMMERCIAL', lineItemKinds: ['misc'], capabilities: ['photo_upload', 'address_autocomplete', 'multi_property'],
    questions: [{ id: 'facility', label: 'Facility type', type: 'select', required: true, options: [
      { value: 'office', label: 'Office' }, { value: 'retail', label: 'Retail' }, { value: 'industrial', label: 'Industrial / warehouse' }, { value: 'multi', label: 'Multi-site' }] }, { id: 'frequency', label: 'How often?', type: 'select', required: true, options: [
        { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'on_call', label: 'On-call' }] }, { id: 'scope', label: 'What should the plan cover?', type: 'longtext', required: false }, NOTES],
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // Additional services under EXISTING industries (from the expanded catalog)
  // ════════════════════════════════════════════════════════════════════════════

  // ── PLUMBING ──────────────────────────────────────────────────────────────────
  tmpl('PLUMBING', 'Sewer Line Repair', 'Sewer line repair, replacement, and camera inspection', {
    iconKey: 'droplet', sortOrder: 10, lineItemKinds: ['fixture'], capabilities: ['photo_upload'],
    questions: [{ id: 'symptom', label: "What's happening?", type: 'select', required: true, options: [
      { value: 'backup', label: 'Backups / slow drains' }, { value: 'smell', label: 'Sewer smell' }, { value: 'yard', label: 'Wet spots in yard' }, { value: 'inspection', label: 'Want an inspection' }] }, URGENCY, PHOTOS, NOTES],
  }),
  tmpl('PLUMBING', 'Water Heater Installation', 'Tank and tankless water heater install or repair', {
    iconKey: 'droplet', sortOrder: 11, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'nameplate_ocr'],
    questions: [{ id: 'type', label: 'Tank or tankless?', type: 'select', required: true, options: [
      { value: 'tank', label: 'Tank' }, { value: 'tankless', label: 'Tankless' }, { value: 'unsure', label: 'Not sure' }] }, { id: 'fuel', label: 'Gas or electric?', type: 'select', required: false, options: [
        { value: 'gas', label: 'Gas' }, { value: 'electric', label: 'Electric' }] }, { id: 'scope', label: 'Install or repair?', type: 'select', required: true, options: [
        { value: 'install', label: 'New install / replace' }, { value: 'repair', label: 'Repair' }] }, PHOTOS, NOTES],
  }),

  // ── ELECTRICAL ──────────────────────────────────────────────────────────────────
  tmpl('ELECTRICAL', 'Electrical Repair & Wiring', 'Outlets, switches, lighting, and general wiring', {
    iconKey: 'zap', sortOrder: 0, lineItemKinds: ['fixture'], capabilities: ['photo_upload'],
    questions: [PROPERTY, { id: 'work', label: 'What do you need?', type: 'multiselect', required: true, options: [
      { value: 'outlet', label: 'Outlets / switches' }, { value: 'lighting', label: 'Lighting / fans' }, { value: 'rewire', label: 'Rewiring' }, { value: 'troubleshoot', label: 'Troubleshooting' }] }, URGENCY, PHOTOS, NOTES],
  }),
  tmpl('ELECTRICAL', 'Panel Upgrade', 'Electrical panel and service upgrades', {
    iconKey: 'zap', sortOrder: 1, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'nameplate_ocr'],
    questions: [{ id: 'current_amps', label: 'Current panel size (if known)', type: 'select', required: false, options: [
      { value: '100', label: '100 amp' }, { value: '150', label: '150 amp' }, { value: '200', label: '200 amp' }, { value: 'unsure', label: 'Not sure' }] }, { id: 'reason', label: 'Reason for upgrade', type: 'text', required: false }, PHOTOS, NOTES],
  }),

  // ── SOLAR ──────────────────────────────────────────────────────────────────────
  tmpl('SOLAR', 'Solar Panel Installation', 'Residential and commercial solar PV installation', {
    iconKey: 'sun', sortOrder: 0, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'address_autocomplete', 'map_polygon'],
    questions: [PROPERTY, { id: 'roof_type', label: 'Roof type', type: 'select', required: false, options: [
      { value: 'asphalt', label: 'Asphalt shingle' }, { value: 'metal', label: 'Metal' }, { value: 'tile', label: 'Tile' }, { value: 'flat', label: 'Flat' }, { value: 'ground', label: 'Ground mount' }] }, { id: 'bill', label: 'Average monthly electric bill', type: 'currency', required: false }, { id: 'battery', label: 'Interested in battery backup?', type: 'boolean', required: false }, PHOTOS, NOTES],
  }),

  // ── GENERAL CONTRACTING ──────────────────────────────────────────────────────────
  tmpl('GENERAL_CONTRACTING', 'Home Remodel', 'Whole-home and multi-room remodeling', {
    iconKey: 'hammer', sortOrder: 0, lineItemKinds: ['room'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [{ id: 'scope', label: 'Project scope', type: 'longtext', required: true }, { id: 'rooms', label: 'Which areas?', type: 'text', required: false }, { id: 'budget', label: 'Rough budget', type: 'currency', required: false }, PHOTOS, NOTES],
  }),
  tmpl('GENERAL_CONTRACTING', 'Kitchen Remodel', 'Full and partial kitchen renovations', {
    iconKey: 'hammer', sortOrder: 1, lineItemKinds: ['room'], capabilities: ['photo_upload'],
    questions: [{ id: 'scope', label: 'How extensive?', type: 'select', required: true, options: [
      { value: 'cosmetic', label: 'Cosmetic refresh' }, { value: 'midrange', label: 'Mid-range remodel' }, { value: 'full', label: 'Full gut renovation' }] }, { id: 'budget', label: 'Rough budget', type: 'currency', required: false }, PHOTOS, NOTES],
  }),
  tmpl('GENERAL_CONTRACTING', 'Bathroom Remodel', 'Full and partial bathroom renovations', {
    iconKey: 'hammer', sortOrder: 2, lineItemKinds: ['room'], capabilities: ['photo_upload'],
    questions: [{ id: 'scope', label: 'How extensive?', type: 'select', required: true, options: [
      { value: 'cosmetic', label: 'Cosmetic refresh' }, { value: 'midrange', label: 'Mid-range remodel' }, { value: 'full', label: 'Full gut renovation' }] }, { id: 'count', label: 'How many bathrooms?', type: 'number', required: false, min: 1 }, PHOTOS, NOTES],
  }),
  tmpl('GENERAL_CONTRACTING', 'Basement Finishing', 'Finish or remodel a basement', {
    iconKey: 'hammer', sortOrder: 3, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload'],
    questions: [sqft('Approximate basement size (sq ft)'), { id: 'features', label: 'Include any of these?', type: 'multiselect', required: false, options: [
      { value: 'bathroom', label: 'Bathroom' }, { value: 'bedroom', label: 'Bedroom' }, { value: 'wet_bar', label: 'Wet bar' }, { value: 'egress', label: 'Egress window' }] }, PHOTOS, NOTES],
  }),
  tmpl('GENERAL_CONTRACTING', 'Drywall', 'Drywall hanging, finishing, and repair', {
    iconKey: 'square', sortOrder: 4, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload'],
    questions: [{ id: 'scope', label: 'New or repair?', type: 'select', required: true, options: [
      { value: 'new', label: 'New drywall' }, { value: 'repair', label: 'Patch / repair' }, { value: 'texture', label: 'Texture / finish' }] }, sqft(), PHOTOS, NOTES],
  }),
  tmpl('GENERAL_CONTRACTING', 'Demolition', 'Interior and selective demolition', {
    iconKey: 'hammer', sortOrder: 5, lineItemKinds: ['misc'], capabilities: ['photo_upload'],
    questions: [{ id: 'scope', label: 'What needs to come out?', type: 'longtext', required: true }, { id: 'haul', label: 'Include debris haul-away?', type: 'boolean', required: false }, PHOTOS, NOTES],
  }),

  // ── CONCRETE & ASPHALT ──────────────────────────────────────────────────────────
  tmpl('CONCRETE_ASPHALT', 'Concrete Work', 'Driveways, slabs, sidewalks, and patios', {
    iconKey: 'square', sortOrder: 0, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'map_polygon'],
    questions: [{ id: 'project', label: 'What are you pouring?', type: 'select', required: true, options: [
      { value: 'driveway', label: 'Driveway' }, { value: 'slab', label: 'Slab / foundation' }, { value: 'sidewalk', label: 'Sidewalk / walkway' }, { value: 'patio', label: 'Patio' }] }, sqft(), PHOTOS, NOTES],
  }),
  tmpl('CONCRETE_ASPHALT', 'Asphalt Paving', 'Asphalt driveways, lots, and sealcoating', {
    iconKey: 'square', sortOrder: 1, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'map_polygon'],
    questions: [{ id: 'project', label: 'Project type', type: 'select', required: true, options: [
      { value: 'driveway', label: 'Driveway' }, { value: 'lot', label: 'Parking lot' }, { value: 'sealcoat', label: 'Sealcoat / repair' }] }, sqft(), PHOTOS, NOTES],
  }),
  tmpl('CONCRETE_ASPHALT', 'Masonry', 'Brick, block, and stone masonry', {
    iconKey: 'square', sortOrder: 2, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload'],
    questions: [{ id: 'material', label: 'Material', type: 'select', required: false, options: [
      { value: 'brick', label: 'Brick' }, { value: 'block', label: 'Block' }, { value: 'stone', label: 'Stone' }] }, { id: 'scope', label: 'Describe the work', type: 'longtext', required: false }, PHOTOS, NOTES],
  }),
  tmpl('CONCRETE_ASPHALT', 'Stucco', 'Stucco installation and repair', {
    iconKey: 'square', sortOrder: 3, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload'],
    questions: [{ id: 'scope', label: 'New or repair?', type: 'select', required: true, options: [
      { value: 'new', label: 'New stucco' }, { value: 'repair', label: 'Repair / patch' }] }, sqft(), PHOTOS, NOTES],
  }),
  tmpl('CONCRETE_ASPHALT', 'Foundation Repair', 'Foundation crack and settlement repair', {
    iconKey: 'square', sortOrder: 4, lineItemKinds: ['misc'], capabilities: ['photo_upload'],
    questions: [{ id: 'symptom', label: "What are you seeing?", type: 'multiselect', required: true, options: [
      { value: 'cracks', label: 'Wall / floor cracks' }, { value: 'settling', label: 'Settling / sloping' }, { value: 'water', label: 'Water intrusion' }, { value: 'bowing', label: 'Bowing walls' }] }, URGENCY, PHOTOS, NOTES],
  }),
  tmpl('CONCRETE_ASPHALT', 'Excavation', 'Site excavation, grading, and trenching', {
    iconKey: 'truck', sortOrder: 5, lineItemKinds: ['misc'], capabilities: ['photo_upload', 'map_polygon', 'address_autocomplete'],
    questions: [{ id: 'work', label: 'Type of work', type: 'select', required: true, options: [
      { value: 'grading', label: 'Grading / leveling' }, { value: 'trenching', label: 'Trenching' }, { value: 'digout', label: 'Dig-out / footings' }, { value: 'drainage', label: 'Drainage' }] }, { id: 'scope', label: 'Describe the site', type: 'longtext', required: false }, PHOTOS, NOTES],
  }),

  // ── LANDSCAPING ──────────────────────────────────────────────────────────────────
  tmpl('LANDSCAPING', 'Weed Control & Fertilization', 'Weed control and lawn fertilization programs', {
    iconKey: 'leaf', sortOrder: 10, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'map_polygon'],
    questions: [sqft('Approximate lawn area (sq ft)'), { id: 'program', label: 'One-time or program?', type: 'select', required: false, options: [
      { value: 'one_time', label: 'One-time' }, { value: 'seasonal', label: 'Seasonal program' }] }, PHOTOS, NOTES],
  }),
  tmpl('LANDSCAPING', 'Sprinkler & Irrigation', 'Sprinkler repair and irrigation installation', {
    iconKey: 'droplet', sortOrder: 11, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'map_polygon'],
    questions: [{ id: 'service', label: 'Install or repair?', type: 'select', required: true, options: [
      { value: 'install', label: 'New irrigation system' }, { value: 'repair', label: 'Repair / adjust' }, { value: 'winterize', label: 'Winterize / blowout' }] }, sqft('Approximate yard area (sq ft)'), PHOTOS, NOTES],
  }),
  tmpl('LANDSCAPING', 'Tree Service', 'Tree trimming, removal, and stump grinding', {
    iconKey: 'leaf', sortOrder: 12, lineItemKinds: ['misc'], capabilities: ['photo_upload'],
    questions: [{ id: 'service', label: 'What do you need?', type: 'select', required: true, options: [
      { value: 'trim', label: 'Trimming / pruning' }, { value: 'removal', label: 'Tree removal' }, { value: 'stump', label: 'Stump grinding' }, { value: 'emergency', label: 'Storm / emergency' }] }, count('tree_count', 'How many trees?', 'trees'), PHOTOS, NOTES],
  }),

  // ── PAINTING ──────────────────────────────────────────────────────────────────────
  tmpl('PAINTING', 'Exterior Painting', 'Exterior house and building painting', {
    iconKey: 'brush', sortOrder: 10, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [PROPERTY, { id: 'stories', label: 'How many stories?', type: 'select', required: true, options: [
      { value: '1', label: '1 story' }, { value: '2', label: '2 stories' }, { value: '3+', label: '3+ stories' }] }, sqft('Approximate wall area (sq ft)'), { id: 'surface', label: 'Surface', type: 'select', required: false, options: [
        { value: 'siding', label: 'Siding' }, { value: 'stucco', label: 'Stucco' }, { value: 'brick', label: 'Brick' }, { value: 'wood', label: 'Wood' }] }, PHOTOS, NOTES],
  }),

  // ── CLEANING ──────────────────────────────────────────────────────────────────────
  tmpl('CLEANING', 'Commercial Cleaning', 'Office, retail, and janitorial cleaning', {
    iconKey: 'sparkles', sortOrder: 10, category: 'COMMERCIAL', lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'address_autocomplete', 'multi_property'],
    questions: [{ id: 'facility', label: 'Facility type', type: 'select', required: true, options: [
      { value: 'office', label: 'Office' }, { value: 'retail', label: 'Retail' }, { value: 'medical', label: 'Medical' }, { value: 'industrial', label: 'Industrial' }] }, sqft('Approximate area (sq ft)'), { id: 'frequency', label: 'How often?', type: 'select', required: true, options: [
        { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }] }, NOTES],
  }),
  tmpl('CLEANING', 'Carpet Cleaning', 'Carpet and upholstery deep cleaning', {
    iconKey: 'sparkles', sortOrder: 11, lineItemKinds: ['room'], capabilities: ['photo_upload'],
    questions: [count('rooms', 'How many rooms?', 'rooms'), { id: 'extras', label: 'Anything extra?', type: 'multiselect', required: false, options: [
      { value: 'stairs', label: 'Stairs' }, { value: 'upholstery', label: 'Upholstery' }, { value: 'pet', label: 'Pet stains / odor' }, { value: 'area_rug', label: 'Area rugs' }] }, PHOTOS, NOTES],
  }),

  // ── WINDOW CLEANING ────────────────────────────────────────────────────────────────
  tmpl('WINDOW_CLEANING', 'Pressure Washing', 'Exterior pressure and soft washing', {
    iconKey: 'droplet', sortOrder: 10, lineItemKinds: ['sqft_zone'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [PROPERTY, { id: 'surfaces', label: 'What needs washing?', type: 'multiselect', required: true, options: [
      { value: 'driveway', label: 'Driveway / concrete' }, { value: 'siding', label: 'House / siding' }, { value: 'deck', label: 'Deck / patio' }, { value: 'roof', label: 'Roof (soft wash)' }, { value: 'fence', label: 'Fence' }] }, sqft('Approximate area (sq ft)'), PHOTOS, NOTES],
  }),

  // ── POOL SERVICE ──────────────────────────────────────────────────────────────────
  tmpl('POOL_SERVICE', 'Pool & Spa Service', 'Pool cleaning, maintenance, and repair', {
    iconKey: 'droplet', sortOrder: 0, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'address_autocomplete'],
    questions: [{ id: 'service', label: 'What do you need?', type: 'select', required: true, options: [
      { value: 'cleaning', label: 'Cleaning / maintenance' }, { value: 'opening', label: 'Opening / closing' }, { value: 'repair', label: 'Equipment repair' }, { value: 'green', label: 'Green pool recovery' }] }, { id: 'type', label: 'Pool or spa?', type: 'select', required: false, options: [
        { value: 'pool', label: 'Pool' }, { value: 'spa', label: 'Spa / hot tub' }, { value: 'both', label: 'Both' }] }, PHOTOS, NOTES],
  }),

  // ── APPLIANCE REPAIR ──────────────────────────────────────────────────────────────
  tmpl('APPLIANCE_REPAIR', 'Appliance Repair', 'Repair for major home appliances', {
    iconKey: 'plug', sortOrder: 0, lineItemKinds: ['unit'], capabilities: ['photo_upload', 'nameplate_ocr'],
    questions: [{ id: 'appliance', label: 'Which appliance?', type: 'select', required: true, options: [
      { value: 'refrigerator', label: 'Refrigerator' }, { value: 'washer', label: 'Washer' }, { value: 'dryer', label: 'Dryer' }, { value: 'dishwasher', label: 'Dishwasher' }, { value: 'oven', label: 'Oven / range' }, { value: 'other', label: 'Other' }] }, { id: 'problem', label: "What's it doing?", type: 'text', required: false }, URGENCY, PHOTOS, NOTES],
  }),

  // ── HANDYMAN ──────────────────────────────────────────────────────────────────────
  tmpl('HANDYMAN', 'Handyman Service', 'Small repairs, mounting, assembly, and to-do lists', {
    iconKey: 'wrench', sortOrder: 0, lineItemKinds: ['misc'], capabilities: ['photo_upload'],
    questions: [{ id: 'tasks', label: 'What needs doing?', type: 'longtext', required: true }, { id: 'category', label: 'Type of work', type: 'multiselect', required: false, options: [
      { value: 'mounting', label: 'Mounting / hanging' }, { value: 'assembly', label: 'Furniture assembly' }, { value: 'repair', label: 'Small repairs' }, { value: 'doors', label: 'Doors / trim' }, { value: 'other', label: 'Other' }] }, PHOTOS, NOTES],
  }),
];
