import { z } from 'zod';
import type { QuizQuestion } from '@/lib/types/stage';

export const questionTypes = ['single', 'multiple', 'short_answer'] as const;
export const difficulties = ['easy', 'medium', 'hard'] as const;

const questionSchema = z
  .object({
    id: z.string().max(128).optional(),
    type: z.enum(questionTypes),
    question: z.string().trim().min(1, '请填写题干').max(20000),
    options: z
      .array(
        z.object({
          value: z.string().regex(/^[A-Z]$/),
          label: z.string().trim().min(1).max(5000),
        }),
      )
      .min(2)
      .max(26)
      .optional(),
    answer: z
      .array(z.string().regex(/^[A-Z]$/))
      .max(26)
      .optional(),
    analysis: z.string().max(20000).optional(),
    commentPrompt: z.string().max(10000).optional(),
    points: z.number().positive().max(100).default(1),
  })
  .superRefine((question, ctx) => {
    if (question.type === 'short_answer') return;
    const values = question.options?.map((option) => option.value) ?? [];
    const answers = question.answer ?? [];
    if (
      values.length < 2 ||
      new Set(values).size !== values.length ||
      answers.length === 0 ||
      new Set(answers).size !== answers.length ||
      answers.some((answer) => !values.includes(answer)) ||
      (question.type === 'single' && answers.length !== 1)
    ) {
      ctx.addIssue({ code: 'custom', message: '请填写完整且不重复的选项及正确答案' });
    }
  });

export const bankQuestionSchema = z.object({
  topic: z.string().trim().min(1, '请填写知识点').max(200),
  difficulty: z.enum(difficulties).default('medium'),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  enabled: z.boolean().default(true),
  sourceTitle: z.string().trim().max(300).default(''),
  sourceUrl: z
    .union([z.literal(''), z.url().refine((url) => /^https?:\/\//.test(url))])
    .default(''),
  question: questionSchema,
});

export type BankQuestionInput = z.infer<typeof bankQuestionSchema>;
export interface BankQuestion extends BankQuestionInput {
  id: string;
  updatedAt: string;
}

export interface AssessmentResult {
  questions: QuizQuestion[];
  bankCount: number;
  generatedCount: number;
  missing: number;
  searchStatus: 'unused' | 'used' | 'unavailable' | 'failed';
}

export const practiceRequestSchema = z.object({
  topic: z.string().trim().min(1, '请输入练习主题').max(500),
  count: z.number().int().min(1).max(10).default(3),
  type: z.enum(questionTypes).default('single'),
  difficulty: z.enum(difficulties).default('medium'),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
});

export const typeLabels = { single: '单选题', multiple: '多选题', short_answer: '简答题' };
export const difficultyLabels = { easy: '基础', medium: '进阶', hard: '挑战' };
