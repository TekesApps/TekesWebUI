import { t } from '../../i18n';
import { useState } from 'react';
import { Check, Copy } from './Icons';
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  return (
    <button
      className="icon-button copy-button"
      aria-label={error ? t('复制失败，请选择文本复制') : t('复制内容')}
      title={
        copied
          ? t('已复制')
          : error
            ? t('复制失败，请选择文本复制')
            : t('复制内容')
      }
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setError(true);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
