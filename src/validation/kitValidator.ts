import type { Kit } from '../domain/types';
import { QUESTION_CATEGORIES, REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES } from '../domain/types';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Structural validation of the kit before it is saved or written out.
 *
 * This checks that every field required by the kit structure is present and
 * has the right type, that enum values are legal, and that difficulty and
 * minutes are integers in range. It is a shape check: it does not follow ids
 * between sections.
 */
export function validateKit(kit: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (typeof kit !== 'object' || kit === null) {
    return { valid: false, errors: [{ path: '', message: 'kit is not an object' }], warnings };
  }
  const value = kit as Record<string, unknown>;

  for (const key of ['source', 'company_brief', 'role', 'questions', 'flashcards', 'schedule', 'coverage']) {
    if (!(key in value)) fail(key, 'required field is missing');
  }

  const source = asRecord(value.source);
  if (!source) fail('source', 'must be an object');
  else {
    for (const key of ['company', 'company_url', 'role', 'location', 'researched_at']) {
      if (typeof source[key] !== 'string') fail(`source.${key}`, 'must be a string');
    }
    if (!isInteger(source.jd_chars)) fail('source.jd_chars', 'must be an integer');
    if (!isStringArray(source.pages_used)) fail('source.pages_used', 'must be an array of strings');
  }

  const brief = asRecord(value.company_brief);
  if (!brief) fail('company_brief', 'must be an object');
  else {
    if (typeof brief.summary !== 'string') fail('company_brief.summary', 'must be a string');
    if (typeof brief.what_they_do !== 'string') fail('company_brief.what_they_do', 'must be a string');
    if (!isStringArray(brief.sources)) fail('company_brief.sources', 'must be an array of strings');
  }

  const role = asRecord(value.role);
  if (!role) fail('role', 'must be an object');
  else {
    if (typeof role.title !== 'string') fail('role.title', 'must be a string');
    if (typeof role.seniority !== 'string') fail('role.seniority', 'must be a string');
    if (!isStringArray(role.responsibilities)) fail('role.responsibilities', 'must be an array of strings');
    const requirements = Array.isArray(role.requirements) ? role.requirements : null;
    if (!requirements) fail('role.requirements', 'must be an array');
    else {
      requirements.forEach((entry, index) => {
        const path = `role.requirements[${index}]`;
        const requirement = asRecord(entry);
        if (!requirement) return fail(path, 'must be an object');
        if (typeof requirement.id !== 'string' || !requirement.id) fail(`${path}.id`, 'must be a non-empty string');
        if (typeof requirement.text !== 'string' || !requirement.text.trim()) {
          fail(`${path}.text`, 'must be a non-empty string');
        }
        if (!REQUIREMENT_KINDS.includes(requirement.kind as never)) {
          fail(`${path}.kind`, `must be one of ${REQUIREMENT_KINDS.join(' | ')}`);
        }
        if (!REQUIREMENT_PRIORITIES.includes(requirement.priority as never)) {
          fail(`${path}.priority`, `must be one of ${REQUIREMENT_PRIORITIES.join(' | ')}`);
        }
      });
    }
  }

  const questions = Array.isArray(value.questions) ? value.questions : null;
  if (!questions) fail('questions', 'must be an array');
  else {
    questions.forEach((entry, index) => {
      const path = `questions[${index}]`;
      const question = asRecord(entry);
      if (!question) return fail(path, 'must be an object');
      if (typeof question.id !== 'string' || !question.id) fail(`${path}.id`, 'must be a non-empty string');
      if (!QUESTION_CATEGORIES.includes(question.category as never)) {
        fail(`${path}.category`, `must be one of ${QUESTION_CATEGORIES.join(' | ')}`);
      }
      if (typeof question.prompt !== 'string' || !question.prompt.trim()) {
        fail(`${path}.prompt`, 'must be a non-empty string');
      }
      if (typeof question.answer_outline !== 'string') fail(`${path}.answer_outline`, 'must be a string');
      if (
        !isInteger(question.difficulty) ||
        (question.difficulty as number) < 1 ||
        (question.difficulty as number) > 3
      ) {
        fail(`${path}.difficulty`, 'must be an integer between 1 and 3');
      }
      if (!isStringArray(question.requirement_ids)) {
        fail(`${path}.requirement_ids`, 'must be an array of strings');
      }
    });
  }

  const flashcards = Array.isArray(value.flashcards) ? value.flashcards : null;
  if (!flashcards) fail('flashcards', 'must be an array');
  else {
    flashcards.forEach((entry, index) => {
      const path = `flashcards[${index}]`;
      const card = asRecord(entry);
      if (!card) return fail(path, 'must be an object');
      if (typeof card.id !== 'string' || !card.id) fail(`${path}.id`, 'must be a non-empty string');
      if (typeof card.front !== 'string' || !card.front.trim()) fail(`${path}.front`, 'must be a non-empty string');
      if (typeof card.back !== 'string' || !card.back.trim()) fail(`${path}.back`, 'must be a non-empty string');
      if (!isStringArray(card.requirement_ids)) {
        fail(`${path}.requirement_ids`, 'must be an array of strings');
      }
    });
  }

  const schedule = asRecord(value.schedule);
  if (!schedule) fail('schedule', 'must be an object');
  else {
    if (!isInteger(schedule.days_available) || (schedule.days_available as number) < 1) {
      fail('schedule.days_available', 'must be a positive integer');
    }
    const days = Array.isArray(schedule.days) ? schedule.days : null;
    if (!days) fail('schedule.days', 'must be an array');
    else {
      if (isInteger(schedule.days_available) && days.length !== schedule.days_available) {
        fail('schedule.days', 'must contain exactly days_available entries');
      }
      days.forEach((entry, index) => {
        const path = `schedule.days[${index}]`;
        const day = asRecord(entry);
        if (!day) return fail(path, 'must be an object');
        if (!isInteger(day.day)) fail(`${path}.day`, 'must be an integer');
        if (typeof day.focus !== 'string' || !day.focus.trim()) fail(`${path}.focus`, 'must be a non-empty string');
        if (!isInteger(day.minutes) || (day.minutes as number) < 1) {
          fail(`${path}.minutes`, 'must be a positive integer');
        }
        if (!isStringArray(day.question_ids)) fail(`${path}.question_ids`, 'must be an array of strings');
      });
    }
  }

  const coverage = asRecord(value.coverage);
  if (!coverage) fail('coverage', 'must be an object');
  else {
    if (!isStringArray(coverage.uncovered_requirement_ids)) {
      fail('coverage.uncovered_requirement_ids', 'must be an array of strings');
    }
    if (!isInteger(coverage.passes) || (coverage.passes as number) < 1) {
      fail('coverage.passes', 'must be a positive integer');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function assertValidKit(kit: Kit): void {
  const result = validateKit(kit);
  if (!result.valid) {
    const detail = result.errors
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new Error(`generated kit failed structural validation: ${detail}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
