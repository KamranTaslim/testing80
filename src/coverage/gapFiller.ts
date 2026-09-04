import type { LlmClient } from '../llm/client';
import type { Question, Requirement } from '../domain/types';
import type { GenerationContext } from '../generation/context';
import { generateBatch, planQuestionBatches } from '../generation/questions';
import { checkCoverage, type CoverageReport } from './checker';
import { logger } from '../util/logger';

export interface GapFillResult {
  questions: Question[];
  passes: number;
  report: CoverageReport;
  notes: string[];
}

export interface GapFillOptions {
  /** Total generation passes allowed, including the first draft. */
  maxPasses: number;
  onPass?: (pass: number, uncovered: number) => void;
}

/**
 * The second pass.
 *
 * After the first draft we check coverage in code, and any requirement with no
 * question against it goes back to the model. Technical requirements are the
 * ones the first pass usually drops when a category has a lot of them, so the
 * gap pass concentrates on those; a behavioural or domain gap is usually a
 * sign that the posting itself is thin, and is reported rather than papered
 * over.
 */
export async function closeCoverageGaps(
  llm: LlmClient,
  requirements: Requirement[],
  initialQuestions: Question[],
  context: GenerationContext,
  options: GapFillOptions,
): Promise<GapFillResult> {
  const questions = [...initialQuestions];
  const notes: string[] = [];
  let passes = 1;
  let report = checkCoverage(requirements, questions);
  options.onPass?.(passes, report.uncovered.length);

  while (report.uncovered.length > 0 && passes < options.maxPasses) {
    passes += 1;
    const targets = [...report.uncoveredMust, ...report.uncoveredNice];
    logger.info(`coverage pass ${passes}: ${targets.length} requirement(s) uncovered`);

    const batches = planQuestionBatches(targets, context).filter(
      (batch) => batch.category === 'technical',
    );
    const before = questions.length;

    for (const batch of batches) {
      const generated = await generateBatch(llm, batch, context);
      for (const question of generated) {
        questions.push({ ...question, id: nextQuestionId(questions) });
      }
    }

    report = checkCoverage(requirements, questions);
    options.onPass?.(passes, report.uncovered.length);

    if (questions.length === before) {
      notes.push(`Coverage pass ${passes} produced no new questions; stopping the loop.`);
      break;
    }
  }

  if (report.uncovered.length > 0) {
    notes.push(
      `${report.uncovered.length} requirement(s) are still uncovered after ${passes} pass(es); they are listed in coverage.uncovered_requirement_ids.`,
    );
  }

  return { questions, passes, report, notes };
}

export function nextQuestionId(questions: Array<{ id: string }>): string {
  let highest = 0;
  for (const question of questions) {
    const match = /^q(\d+)$/.exec(question.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `q${highest + 1}`;
}
