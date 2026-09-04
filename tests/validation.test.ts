import { describe, expect, it } from 'vitest';
import { validateKit } from '../src/validation/kitValidator';
import type { Kit } from '../src/domain/types';

function validKit(): Kit {
  return {
    source: {
      company: 'Testco',
      company_url: 'https://testco.example',
      role: 'Backend Engineer',
      location: 'Remote',
      jd_chars: 812,
      researched_at: '2026-09-01T09:12:44.000Z',
      pages_used: ['https://testco.example/'],
    },
    company_brief: {
      summary: 'Testco builds things.',
      what_they_do: 'Software.',
      sources: ['https://testco.example/'],
    },
    role: {
      title: 'Backend Engineer',
      seniority: 'senior',
      responsibilities: ['Own the payments service'],
      requirements: [
        { id: 'r1', text: '5+ years with Go', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Kubernetes', kind: 'technical', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Tell me about Go.',
        answer_outline: 'Concurrency, tooling, one production story.',
        difficulty: 2,
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'technical',
        prompt: 'Tell me about Kubernetes.',
        answer_outline: 'Scheduling, resources, a failure you debugged.',
        difficulty: 3,
      },
    ],
    flashcards: [{ id: 'f1', front: 'Go', back: 'Goroutines and channels', requirement_ids: ['r1'] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Technical depth: Go', question_ids: ['q1'], minutes: 60 },
        { day: 2, focus: 'Technical depth: Kubernetes', question_ids: ['q2'], minutes: 45 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 2 },
  };
}

describe('kit structure validation', () => {
  it('accepts a well-formed kit', () => {
    const result = validateKit(validKit());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a missing top-level section', () => {
    const kit = validKit() as unknown as Record<string, unknown>;
    delete kit.coverage;
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === 'coverage')).toBe(true);
  });

  it('rejects a difficulty outside 1..3 and a non-integer minutes value', () => {
    const kit = validKit();
    kit.questions[0]!.difficulty = 5;
    kit.schedule.days[0]!.minutes = 42.5;
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path.includes('difficulty'))).toBe(true);
    expect(result.errors.some((issue) => issue.path.includes('minutes'))).toBe(true);
  });

  it('rejects a schedule whose day count does not match days_available', () => {
    const kit = validKit();
    kit.schedule.days.pop();
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === 'schedule.days')).toBe(true);
  });

});
