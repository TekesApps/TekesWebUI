import { t } from '../i18n';
import { useState } from 'react';
import { ShieldCheck, MessageCircleQuestion } from './ui/Icons';
import type { Actionable } from '../types';
import type { Workspace } from '../workspace';
import { displayError } from '../state';

export function ActionCard({
  action,
  workspace,
}: {
  action: Actionable;
  workspace: Workspace;
}) {
  const [answers, setAnswers] = useState<
    Record<string, { selected: string[]; custom: string }>
  >({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const payload = action.payload;
  async function respond(outcome: unknown) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await workspace.respond(action.id, action.revision, outcome);
    } catch (e) {
      setError(displayError(e));
      setBusy(false);
    }
  }
  return (
    <section className="action-card">
      <div className="action-heading">
        {action.kind === 'approval' ? (
          <ShieldCheck size={18} />
        ) : (
          <MessageCircleQuestion size={18} />
        )}
        <strong>
          {payload.title ||
            (action.kind === 'approval'
              ? t('需要你的确认')
              : t('需要你的回答'))}
        </strong>
      </div>
      {payload.description && <p>{payload.description}</p>}
      {action.kind === 'approval' ? (
        <div className="dialog-actions">
          <button
            disabled={busy}
            onClick={() =>
              void respond({
                sessionId: action.sessionId,
                approvalId: payload.approvalId,
                outcome: 'rejected',
              })
            }
          >
            {t('拒绝')}
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void respond({
                sessionId: action.sessionId,
                approvalId: payload.approvalId,
                outcome: 'allowed-once',
              })
            }
          >
            {t('允许一次')}
          </button>
        </div>
      ) : action.kind === 'question' && payload.questions ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void respond({
              sessionId: action.sessionId,
              answer: {
                answers: payload.questions!.map((q) => ({
                  id: q.id,
                  ...(answers[q.id] || { selected: [], custom: '' }),
                })),
              },
            });
          }}
        >
          <fieldset disabled={busy}>
            {payload.questions.map((q) => {
              const answer = answers[q.id] || { selected: [], custom: '' };
              return (
                <div className="question" key={q.id}>
                  <p>{q.question || q.id}</p>
                  {q.detail && <small>{q.detail}</small>}
                  {q.options?.map((option) => (
                    <label className="question-option" key={option.label}>
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={q.id}
                        checked={answer.selected.includes(option.label)}
                        onChange={(e) =>
                          setAnswers({
                            ...answers,
                            [q.id]: {
                              ...answer,
                              selected: q.multiSelect
                                ? e.target.checked
                                  ? [...answer.selected, option.label]
                                  : answer.selected.filter(
                                      (v) => v !== option.label,
                                    )
                                : [option.label],
                            },
                          })
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                  {(q.allowCustom !== false || q.isSecret) && (
                    <input
                      aria-label={q.question || q.id}
                      type={q.isSecret ? 'password' : 'text'}
                      autoComplete="off"
                      placeholder={t('输入回答')}
                      value={answer.custom}
                      onChange={(e) =>
                        setAnswers({
                          ...answers,
                          [q.id]: { ...answer, custom: e.target.value },
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
            <button className="primary" type="submit">
              {busy ? t('正在提交…') : t('提交回答')}
            </button>
          </fieldset>
        </form>
      ) : (
        <p>{t('请在 App 中处理此请求。')}</p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
