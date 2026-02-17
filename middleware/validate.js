/**
 * Zod validation schemas and reusable validation middleware for Express routes.
 * Uses zod v4 with .passthrough() so multer/file-upload fields are not stripped.
 */
const { z } = require('zod');

// ---------------------------------------------------------------------------
// Validation middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns Express middleware that validates req.body against the given schema.
 * On failure: responds 400 with { success: false, error: message }.
 * On success: replaces req.body with the parsed (coerced/trimmed) data and calls next().
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const path = firstIssue.path.length ? firstIssue.path.join('.') + ': ' : '';
      return res.status(400).json({
        success: false,
        error: path + firstIssue.message,
      });
    }
    req.body = result.data;
    next();
  };
}

// ---------------------------------------------------------------------------
// Shared field helpers
// ---------------------------------------------------------------------------

const emailField = z.string().trim().toLowerCase().email();
const optionalString = z.string().optional();
const optionalTrimmedString = z.string().trim().optional();
const optionalCoerceNumber = z.coerce.number().optional();

// Strong password: min 12 chars, at least 1 uppercase, 1 lowercase, 1 number
const strongPassword = z.string().min(12, 'Password must be at least 12 characters').refine(
  (pw) => /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw),
  { message: 'Password must include uppercase, lowercase, and a number' }
);

// ---------------------------------------------------------------------------
// Auth schemas
// ---------------------------------------------------------------------------

const setup = z.object({
  email: emailField,
  password: strongPassword,
  display_name: z.string().trim().min(1),
  country_code: z.string().optional().default('US'),
  region: optionalString,
}).passthrough();

const register = z.object({
  email: emailField,
  password: strongPassword,
  display_name: z.string().trim().min(1),
  invite_code: z.string().optional(),
  country_code: z.string().optional().default('US'),
  region: optionalString,
  terms_accepted: z.preprocess(
    (v) => v === 'true' || v === true ? true : v,
    z.literal(true, { errorMap: () => ({ message: 'You must accept the terms of service' }) })
  ),
}).passthrough();

const login = z.object({
  email: emailField,
  password: z.string().min(1),
}).passthrough();

const forgotPassword = z.object({
  email: emailField,
}).passthrough();

const resetPassword = z.object({
  password: strongPassword,
  token: optionalString,
  phone: optionalString,
  code: optionalString,
}).passthrough();

const changePassword = z.object({
  current_password: z.string().optional(),
  new_password: strongPassword,
}).passthrough();

// ---------------------------------------------------------------------------
// Sites schemas
// ---------------------------------------------------------------------------

const createSite = z.object({
  name: z.string().trim().min(1),
  description: optionalString,
  latitude: optionalCoerceNumber,
  longitude: optionalCoerceNumber,
  land_type: optionalString,
  permission_status: z.enum(['granted', 'requested', 'denied', 'not_required', 'not_requested']).optional(),
  status: optionalString,
  priority: z.coerce.number().min(1).max(5).optional(),
  notes: optionalString,
  tags: optionalString,
  contact_name: optionalString,
  contact_phone: optionalString,
  contact_email: optionalString,
  legal_notes: optionalString,
}).passthrough();

const updateSite = createSite;

// ---------------------------------------------------------------------------
// Finds schemas
// ---------------------------------------------------------------------------

const createFind = z.object({
  site_id: z.coerce.number(),
  date: optionalString,
  description: optionalTrimmedString,
  material: z.enum([
    'iron', 'copper', 'brass', 'silver', 'gold', 'lead',
    'zinc', 'nickel', 'aluminum', 'tin', 'unknown', 'other',
  ]).optional(),
  estimated_age: optionalString,
  depth: optionalCoerceNumber,
  depth_cm: optionalCoerceNumber,
  condition: z.enum(['excellent', 'good', 'fair', 'poor', 'fragment']).optional(),
  value_estimate: optionalCoerceNumber,
  notes: optionalString,
  latitude: optionalCoerceNumber,
  longitude: optionalCoerceNumber,
  category: z.enum([
    'coin', 'jewelry', 'relic', 'military', 'button', 'buckle',
    'tool', 'toy', 'natural', 'trash', 'unknown',
  ]).optional(),
  tags: optionalString,
}).passthrough();

const updateFind = z.object({
  site_id: optionalCoerceNumber,
  date: optionalString,
  description: optionalTrimmedString,
  material: z.enum([
    'iron', 'copper', 'brass', 'silver', 'gold', 'lead',
    'zinc', 'nickel', 'aluminum', 'tin', 'unknown', 'other',
  ]).optional(),
  estimated_age: optionalString,
  depth: optionalCoerceNumber,
  depth_cm: optionalCoerceNumber,
  condition: z.enum(['excellent', 'good', 'fair', 'poor', 'fragment']).optional(),
  value_estimate: optionalCoerceNumber,
  notes: optionalString,
  latitude: optionalCoerceNumber,
  longitude: optionalCoerceNumber,
  category: z.enum([
    'coin', 'jewelry', 'relic', 'military', 'button', 'buckle',
    'tool', 'toy', 'natural', 'trash', 'unknown',
  ]).optional(),
  tags: optionalString,
}).passthrough();

// ---------------------------------------------------------------------------
// Permissions schemas
// ---------------------------------------------------------------------------

const createPermission = z.object({
  site_id: optionalCoerceNumber,
  land_type: optionalString,
  agency_owner: optionalTrimmedString,
  contact_name: optionalString,
  contact_phone: optionalString,
  contact_email: optionalString,
  contact_address: optionalString,
  date_requested: optionalString,
  status: z.enum(['not_requested', 'pending', 'approved', 'denied', 'expired']).optional(),
  date_granted: optionalString,
  expiration_date: optionalString,
  notes: optionalString,
}).passthrough();

const updatePermission = createPermission;

// ---------------------------------------------------------------------------
// Permission contacts schemas
// ---------------------------------------------------------------------------

const createContact = z.object({
  contact_type: z.enum(['phone_call', 'email', 'in_person', 'letter_sent', 'letter_received', 'other']),
  outcome: z.enum(['positive', 'neutral', 'negative', 'no_response', 'follow_up_needed']).optional(),
  notes: optionalString,
  contact_date: optionalString,
}).passthrough();

const updateContact = z.object({
  contact_type: z.enum(['phone_call', 'email', 'in_person', 'letter_sent', 'letter_received', 'other']).optional(),
  outcome: z.enum(['positive', 'neutral', 'negative', 'no_response', 'follow_up_needed']).optional(),
  notes: optionalString,
  contact_date: optionalString,
}).passthrough();

// ---------------------------------------------------------------------------
// Reminder schemas
// ---------------------------------------------------------------------------

const createReminder = z.object({
  permission_id: optionalCoerceNumber,
  reminder_type: z.enum(['follow_up', 'expiration', 'custom']),
  title: z.string().trim().min(1).max(200),
  due_date: z.string().min(1),
  notes: optionalString,
}).passthrough();

const updateReminder = z.object({
  permission_id: optionalCoerceNumber,
  reminder_type: z.enum(['follow_up', 'expiration', 'custom']).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  due_date: z.string().optional(),
  notes: optionalString,
}).passthrough();

const completeReminder = z.object({
  is_completed: z.boolean(),
}).passthrough();

// ---------------------------------------------------------------------------
// Permission link schemas
// ---------------------------------------------------------------------------

const createPermissionLink = z.object({
  expires_in_days: z.coerce.number().int().min(1).max(90).optional().default(30),
  conditions_text: optionalString,
}).passthrough();

const approvePermissionLink = z.object({
  signed_name: z.string().trim().min(1).max(200),
  signature_image: optionalString,
  conditions_text: optionalString,
}).passthrough();

const denyPermissionLink = z.object({
  reason: optionalString,
}).passthrough();

// ---------------------------------------------------------------------------
// Legal suggestion schemas
// ---------------------------------------------------------------------------

const createLegalSuggestion = z.object({
  legal_content_id: optionalCoerceNumber,
  country_code: z.string().trim().min(1).max(5),
  region_code: optionalTrimmedString,
  suggestion_type: z.enum(['correction', 'new_section', 'outdated', 'add_region', 'other']).optional().default('correction'),
  section_title: optionalTrimmedString,
  suggested_text: z.string().trim().min(1),
  reason: optionalTrimmedString,
}).passthrough();

const reviewLegalSuggestion = z.object({
  status: z.enum(['approved', 'rejected']),
  admin_notes: optionalTrimmedString,
}).passthrough();

const applyLegalSuggestion = z.object({
  section_title: optionalTrimmedString,
  content_html: z.string().min(1),
  severity: z.enum(['ok', 'caution', 'warning', 'danger']).optional(),
  change_summary: optionalTrimmedString,
}).passthrough();

// ---------------------------------------------------------------------------
// Feedback schemas
// ---------------------------------------------------------------------------

const createFeedback = z.object({
  message: z.string().trim().min(1),
  type: z.enum(['bug', 'suggestion', 'question', 'other']).optional(),
  page_url: optionalString,
  user_agent: optionalString,
}).passthrough();

const updateFeedback = z.object({
  status: z.enum(['new', 'reviewed', 'resolved']).optional(),
  admin_notes: optionalString,
}).passthrough();

// ---------------------------------------------------------------------------
// Hunts schemas
// ---------------------------------------------------------------------------

const startHunt = z.object({
  site_id: optionalCoerceNumber,
  notes: optionalString,
}).passthrough();

const updateHunt = z.object({
  site_id: optionalCoerceNumber,
  notes: optionalString,
}).passthrough();

const uploadTrackpoints = z.object({
  idempotency_key: z.string().min(1),
  points: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    accuracy_m: z.number().optional(),
    altitude_m: z.number().optional(),
    recorded_at: z.string(),
  })).min(1).max(100),
}).passthrough();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const schemas = {
  // Auth
  setup,
  register,
  login,
  forgotPassword,
  resetPassword,
  changePassword,
  // Sites
  createSite,
  updateSite,
  // Finds
  createFind,
  updateFind,
  // Permissions
  createPermission,
  updatePermission,
  // Permission contacts
  createContact,
  updateContact,
  // Permission links
  createPermissionLink,
  approvePermissionLink,
  denyPermissionLink,
  // Reminders
  createReminder,
  updateReminder,
  completeReminder,
  // Legal suggestions
  createLegalSuggestion,
  reviewLegalSuggestion,
  applyLegalSuggestion,
  // Feedback
  createFeedback,
  updateFeedback,
  // Hunts
  startHunt,
  updateHunt,
  uploadTrackpoints,
};

module.exports = { validate, schemas };
