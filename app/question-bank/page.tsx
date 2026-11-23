'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Loader2, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  bankQuestionSchema,
  difficulties,
  difficultyLabels,
  questionTypes,
  typeLabels,
  type BankQuestion,
  type BankQuestionInput,
} from '@/lib/legal/questions';

const selectStyle = 'rounded-md border bg-background px-3 py-2 text-sm';
const practiceDraftKey = 'maic:legal-practice-draft';
const emptyEntry: BankQuestionInput = {
  topic: '',
  difficulty: 'medium',
  tags: [],
  enabled: true,
  sourceTitle: '',
  sourceUrl: '',
  question: {
    type: 'single',
    question: '',
    options: [
      { value: 'A', label: '' },
      { value: 'B', label: '' },
    ],
    answer: ['A'],
    points: 1,
  },
};

interface PracticeResult {
  classroomUrl: string;
  count: number;
  missing: number;
  bankCount: number;
  generatedCount: number;
  searchStatus: string;
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data.error === 'string' ? data.error : '请求未完成，请稍后重试');
  return data as T;
}

export default function QuestionBankPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const importTrigger = useRef<HTMLButtonElement | null>(null);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [draft, setDraft] = useState<BankQuestionInput>(emptyEntry);
  const [optionsText, setOptionsText] = useState('');
  const [answerText, setAnswerText] = useState('A');
  const [editorError, setEditorError] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState<BankQuestionInput[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(3);
  const [practiceType, setPracticeType] = useState<(typeof questionTypes)[number]>('single');
  const [difficulty, setDifficulty] = useState<(typeof difficulties)[number]>('medium');
  const [generating, setGenerating] = useState(false);
  const [practice, setPractice] = useState<PracticeResult | null>(null);
  const requestId = useRef<string | null>(null);
  const generationBusy = useRef(false);

  async function loadQuestions() {
    setLoading(true);
    try {
      const result = await request<{ questions: BankQuestion[] }>('/api/question-bank');
      setQuestions(result.questions);
      setError('');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setInitialized(true);
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQuestions();
    try {
      const stored = sessionStorage.getItem(practiceDraftKey);
      if (stored) {
        const draft = JSON.parse(stored);
        if (typeof draft.topic === 'string' && typeof draft.requestId === 'string') {
          setTopic(draft.topic);
          setCount(draft.count);
          setPracticeType(draft.type);
          setDifficulty(draft.difficulty);
          requestId.current = draft.requestId;
          setPractice(draft.result ?? null);
        }
      }
    } catch {
      /* A private browser may disable draft storage. */
    }
  }, []);

  function configurePractice(change: () => void) {
    change();
    requestId.current = null;
    setPractice(null);
    try {
      sessionStorage.removeItem(practiceDraftKey);
    } catch {
      /* Best effort draft recovery. */
    }
  }

  function openEditor(entry: BankQuestion | null) {
    editorTrigger.current = document.activeElement as HTMLElement | null;
    setEditing(entry);
    const value = entry ?? structuredClone(emptyEntry);
    setDraft(value);
    setOptionsText((value.question.options ?? []).map((option) => option.label).join('\n'));
    setAnswerText(value.question.answer?.join(',') ?? '');
    setEditorError('');
    setEditorOpen(true);
  }

  async function saveQuestion(event: FormEvent) {
    event.preventDefault();
    const isText = draft.question.type === 'short_answer';
    const parsed = bankQuestionSchema.safeParse({
      ...draft,
      question: {
        ...draft.question,
        options: isText
          ? undefined
          : optionsText
              .split('\n')
              .filter((line) => line.trim())
              .map((label, index) => ({ value: String.fromCharCode(65 + index), label })),
        answer: isText
          ? undefined
          : answerText
              .toUpperCase()
              .split(/[,，\s]+/)
              .filter(Boolean),
      },
    });
    if (!parsed.success) {
      setEditorError('请填写知识点、题干，以及完整的选项和正确答案');
      return;
    }
    setSaving(true);
    setEditorError('');
    try {
      if (editing)
        await request('/api/question-bank', 'PATCH', {
          id: editing.id,
          updatedAt: editing.updatedAt,
          entry: parsed.data,
        });
      else await request('/api/question-bank', 'POST', { questions: [parsed.data] });
      setEditorOpen(false);
      await loadQuestions();
    } catch (failure) {
      setEditorError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function readImport(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError('每次导入文件最大为 2 MB');
      return;
    }
    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw) || raw.length > 200)
        throw new Error('请选择最多包含 200 题的 JSON 数组');
      const valid: BankQuestionInput[] = [];
      const errors: string[] = [];
      raw.forEach((item, index) => {
        const parsed = bankQuestionSchema.safeParse(item);
        if (parsed.success) valid.push(parsed.data);
        else errors.push(`第 ${index + 1} 题，请检查知识点、题干、选项或答案`);
      });
      setImporting(valid);
      setImportErrors(errors);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  async function importQuestions() {
    if (!importing?.length) return;
    setSaving(true);
    try {
      const result = await request<{ inserted: number; skipped: number }>(
        '/api/question-bank',
        'POST',
        { questions: importing },
      );
      setNotice(`已导入 ${result.inserted} 题，跳过 ${result.skipped} 道重复题`);
      setImporting(null);
      await loadQuestions();
    } catch (failure) {
      setImportErrors([(failure as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  async function toggleQuestion(entry: BankQuestion) {
    setSaving(true);
    try {
      await request('/api/question-bank', 'PATCH', {
        id: entry.id,
        updatedAt: entry.updatedAt,
        entry: { ...entry, enabled: !entry.enabled },
      });
      await loadQuestions();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function generatePractice(event?: FormEvent) {
    event?.preventDefault();
    if (generationBusy.current || !topic.trim()) return;
    generationBusy.current = true;
    setGenerating(true);
    setError('');
    requestId.current ??= crypto.randomUUID();
    const draft = { topic, count, type: practiceType, difficulty, requestId: requestId.current };
    try {
      sessionStorage.setItem(practiceDraftKey, JSON.stringify(draft));
    } catch {
      /* Best effort draft recovery. */
    }
    try {
      const result = await request<PracticeResult>('/api/question-bank/practice', 'POST', {
        topic,
        count,
        type: practiceType,
        difficulty,
        requestId: requestId.current,
      });
      setPractice(result);
      try {
        sessionStorage.setItem(practiceDraftKey, JSON.stringify({ ...draft, result }));
      } catch {
        /* Best effort draft recovery. */
      }
      if (result.missing === 0) router.push(result.classroomUrl);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      generationBusy.current = false;
      setGenerating(false);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify([emptyEntry], null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '题库导入模板.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const visible = questions.filter(
    (entry) =>
      (!typeFilter || entry.question.type === typeFilter) &&
      `${entry.topic} ${entry.tags.join(' ')} ${entry.question.question} ${entry.sourceTitle}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowLeft size={16} />
            返回课堂首页
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            <BookOpen />
            法学题库与练习
          </h1>
          <p className="text-sm text-muted-foreground">
            面向法学专业学生与法学爱好者，结合概念理解和案例推理。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            ref={importTrigger}
            variant="outline"
            disabled={!initialized}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} />
            导入题目
          </Button>
          <Button disabled={!initialized} onClick={() => openEditor(null)}>
            <Plus size={16} />
            新建题目
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="导入题库文件"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readImport(file);
              event.target.value = '';
            }}
          />
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-medium">生成练习</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          优先使用题库中的合适题目，不足时由模型查找资料或生成补足。
        </p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={generatePractice}>
          <label className="min-w-64 flex-1 space-y-2 text-sm">
            练习主题
            <Input
              value={topic}
              required
              disabled={generating}
              placeholder="例如，合同履行与违约责任"
              onChange={(event) => configurePractice(() => setTopic(event.target.value))}
            />
          </label>
          <label className="space-y-2 text-sm">
            题型
            <select
              aria-label="练习题型"
              className={`block ${selectStyle}`}
              value={practiceType}
              disabled={generating}
              onChange={(event) =>
                configurePractice(() => setPracticeType(event.target.value as typeof practiceType))
              }
            >
              {questionTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            难度
            <select
              aria-label="练习难度"
              className={`block ${selectStyle}`}
              value={difficulty}
              disabled={generating}
              onChange={(event) =>
                configurePractice(() => setDifficulty(event.target.value as typeof difficulty))
              }
            >
              {difficulties.map((value) => (
                <option key={value} value={value}>
                  {difficultyLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="w-20 space-y-2 text-sm">
            题数
            <Input
              aria-label="练习题数"
              type="number"
              min={1}
              max={10}
              value={count}
              disabled={generating}
              onChange={(event) => configurePractice(() => setCount(Number(event.target.value)))}
            />
          </label>
          <Button type="submit" disabled={generating || !initialized || !topic.trim()}>
            {generating && <Loader2 className="animate-spin" size={16} />}
            {generating ? '正在准备练习' : '生成并开始练习'}
          </Button>
        </form>
        {generating && (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            正在选题并补足缺题，完成后自动进入课堂练习。
          </p>
        )}
        {practice && practice.missing > 0 && (
          <div role="status" className="mt-4 space-y-3 rounded-lg bg-muted p-4 text-sm">
            <p>
              已取得 {practice.count} 题，其中题库 {practice.bankCount} 题、补充{' '}
              {practice.generatedCount} 题，还缺 {practice.missing} 题。
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={generating}
                onClick={() => void generatePractice()}
              >
                继续补足
              </Button>
              <Link className="self-center underline" href={practice.classroomUrl}>
                使用已有题目练习
              </Link>
            </div>
          </div>
        )}
      </section>

      {practice?.missing === 0 && (
        <div className="flex items-center gap-4 text-sm">
          <Link className="underline" href={practice.classroomUrl}>
            继续上次练习
          </Link>
          <Button
            variant="outline"
            disabled={generating}
            onClick={() => {
              requestId.current = null;
              setPractice(null);
              void generatePractice();
            }}
          >
            换一组题
          </Button>
        </div>
      )}

      <section className="space-y-4" aria-label="我的题库">
        <div className="flex items-center gap-3">
          <h2 className="mr-auto text-lg font-medium">我的题库 · {questions.length} 题</h2>
          <Input
            className="max-w-72"
            aria-label="搜索题目"
            placeholder="搜索知识点、题干或来源"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="筛选题型"
            className={selectStyle}
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="">全部题型</option>
            {questionTypes.map((type) => (
              <option key={type} value={type}>
                {typeLabels[type]}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => void loadQuestions()}>
            刷新
          </Button>
        </div>
        {loading && questions.length === 0 ? (
          <p role="status" className="py-8 text-center text-muted-foreground">
            正在读取题库…
          </p>
        ) : questions.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <BookOpen className="mx-auto mb-3 text-muted-foreground" />
            <h3 className="font-medium">题库暂时为空</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              可以直接生成练习，模型会补充所需题目。以后可导入自己的题库。
            </p>
            <Button className="mt-4" variant="outline" onClick={downloadTemplate}>
              下载导入模板
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">没有符合筛选条件的题目</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {visible.map((entry) => (
              <li key={entry.id} className="flex items-start gap-4 p-5">
                <button className="flex-1 text-left" onClick={() => openEditor(entry)}>
                  <span className="text-xs text-muted-foreground">
                    {entry.topic} · {typeLabels[entry.question.type]} ·{' '}
                    {difficultyLabels[entry.difficulty]}
                    {!entry.enabled && ' · 已停用'}
                  </span>
                  <p className="mt-2 whitespace-pre-wrap">{entry.question.question}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.sourceTitle || '用户题库'}
                  </p>
                </button>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => void toggleQuestion(entry)}
                >
                  {entry.enabled ? '停用' : '启用'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!saving) setEditorOpen(open);
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editorTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? '题目详情与编辑' : '新建题目'}</DialogTitle>
            <DialogDescription>保存后用于新练习，已有课堂中的题目与作答保留。</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveQuestion} className="space-y-4">
            <label className="block space-y-2 text-sm">
              知识点
              <Input
                value={draft.topic}
                onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
                required
              />
            </label>
            <div className="flex gap-3">
              <label className="text-sm">
                题型
                <select
                  className={`ml-2 ${selectStyle}`}
                  value={draft.question.type}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      question: {
                        ...draft.question,
                        type: event.target.value as typeof draft.question.type,
                      },
                    })
                  }
                >
                  {questionTypes.map((type) => (
                    <option key={type} value={type}>
                      {typeLabels[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                难度
                <select
                  className={`ml-2 ${selectStyle}`}
                  value={draft.difficulty}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      difficulty: event.target.value as typeof draft.difficulty,
                    })
                  }
                >
                  {difficulties.map((value) => (
                    <option key={value} value={value}>
                      {difficultyLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block space-y-2 text-sm">
              题干
              <Textarea
                rows={4}
                value={draft.question.question}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    question: { ...draft.question, question: event.target.value },
                  })
                }
                required
              />
            </label>
            {draft.question.type !== 'short_answer' && (
              <>
                <label className="block space-y-2 text-sm">
                  选项，每行一个，依次对应 A、B、C…
                  <Textarea
                    rows={4}
                    value={optionsText}
                    onChange={(event) => setOptionsText(event.target.value)}
                    required
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  正确答案字母，多选用逗号分隔
                  <Input
                    value={answerText}
                    onChange={(event) => setAnswerText(event.target.value)}
                    required
                  />
                </label>
              </>
            )}
            <label className="block space-y-2 text-sm">
              解析与参考答案
              <Textarea
                rows={3}
                value={draft.question.analysis ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    question: {
                      ...draft.question,
                      analysis: event.target.value,
                      ...(draft.question.type === 'short_answer'
                        ? { commentPrompt: event.target.value }
                        : {}),
                    },
                  })
                }
              />
            </label>
            <label className="block space-y-2 text-sm">
              来源名称
              <Input
                value={draft.sourceTitle}
                onChange={(event) => setDraft({ ...draft, sourceTitle: event.target.value })}
              />
            </label>
            <label className="block space-y-2 text-sm">
              来源链接
              <Input
                type="url"
                value={draft.sourceUrl}
                onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })}
              />
            </label>
            {editorError && (
              <p role="alert" className="text-sm text-red-700">
                {editorError}
              </p>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? '正在保存' : '保存题目'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={importing !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setImporting(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            importTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>导入预览</DialogTitle>
            <DialogDescription>
              可导入 {importing?.length ?? 0} 题，重复题自动跳过。
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 space-y-2 overflow-auto text-sm">
            {importing?.map((entry, index) => (
              <li key={index}>
                {index + 1}. {entry.question.question}
              </li>
            ))}
          </ul>
          {importErrors.length > 0 && (
            <div role="alert" className="max-h-40 overflow-auto text-sm text-red-700">
              {importErrors.map((message, index) => (
                <p key={index}>{message}</p>
              ))}
            </div>
          )}
          <Button disabled={saving || !importing?.length} onClick={() => void importQuestions()}>
            {saving ? '正在导入' : '导入有效题目'}
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
