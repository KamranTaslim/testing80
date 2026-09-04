import { describe, expect, it } from 'vitest';
import { checkCoverage } from '../src/coverage/checker';
import { closeCoverageGaps } from '../src/coverage/gapFiller';
import { createLlmClient } from '../src/llm';
import { OfflineModelProvider } from '../src/llm/providers/offline';
import type { GenerationContext } from '../src/generation/context';
import type { Question, Requirement } from '../src/domain/types';
import { NO_HIRING_PROCESS } from '../src/research/companyResearch';

const requirements: Requirement[] = [
  { id: 'r1', text: '5+ years with React', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Familiarity with GDPR in a healthcare setting', kind: 'domain', priority: 'nice' },
];

const context: GenerationContext = {
  company: 'Testco',
  companyUrl: 'https://testco.example',
  seniority: 'senior',
  facts: [],
  process: NO_HIRING_PROCESS,
  thin: false,
};

const question = (id: string, requirementIds: string[]): Question => ({
  id,
  requirement_ids: requirementIds,
  category: 'technical',
  prompt: `question ${id}`,
  answer_outline: 'outline',
  difficulty: 2,
});

describe('coverage checking', () => {
  it('reports requirements with no question against them', () => {
    const report = checkCoverage(requirements, [question('q1', ['r1'])]);
    expect(report.uncovered.map((requirement) => requirement.id)).toEqual(['r2', 'r3']);
    expect(report.uncoveredMust.map((requirement) => requirement.id)).toEqual(['r2']);
    expect(report.coveredCount).toBe(1);
  });

  it('ignores references to requirements that do not exist', () => {
    const report = checkCoverage(requirements, [question('q1', ['r9'])]);
    expect(report.danglingQuestionIds).toEqual(['q1']);
    expect(report.coveredCount).toBe(0);
  });

  it('treats a question covering several requirements as covering all of them', () => {
    const report = checkCoverage(requirements, [question('q1', ['r1', 'r2'])]);
    expect(report.uncovered.map((requirement) => requirement.id)).toEqual(['r3']);
  });
});

describe('the second pass', () => {
  it('runs another pass when the first draft leaves a technical gap', async () => {
    const llm = createLlmClient(new OfflineModelProvider());
    const technicalOnly: Requirement[] = [
      { id: 'r1', text: '5+ years with React', kind: 'technical', priority: 'must' },
      { id: 'r2', text: 'Strong PostgreSQL and schema design', kind: 'technical', priority: 'must' },
    ];

    const result = await closeCoverageGaps(llm, technicalOnly, [question('q1', ['r1'])], context, {
      maxPasses: 2,
    });

    expect(result.passes).toBe(2);
    expect(result.report.uncovered).toHaveLength(0);
    expect(result.questions.length).toBeGreaterThan(1);
    // The question that was already there is untouched by the gap pass.
    expect(result.questions[0]!.id).toBe('q1');
  });

  it('reports a behavioural gap it could not close instead of hiding it', async () => {
    const llm = createLlmClient(new OfflineModelProvider());
    const result = await closeCoverageGaps(llm, requirements, [question('q1', ['r1'])], context, {
      maxPasses: 2,
    });

    // The gap pass only regenerates technical questions, so the behavioural
    // requirement is still listed as uncovered rather than silently dropped.
    expect(result.report.uncovered.map((requirement) => requirement.id)).toContain('r2');
    expect(result.notes.join(' ')).toMatch(/still uncovered/);
  });

  it('stops at the configured pass limit', async () => {
    const llm = createLlmClient(new OfflineModelProvider());
    const result = await closeCoverageGaps(llm, requirements, [], context, { maxPasses: 2 });
    expect(result.passes).toBeLessThanOrEqual(2);
  });
});
