import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Address } from '../types';
import {
  sourceMatches,
  textFingerprint,
  type Annotation,
  type AnnotationSource,
} from '../annotations';
import { Dialog } from './Dialog';
import { Pencil, AnnotationIcon, X } from './ui/Icons';

export function revealAnnotation(
  annotation: Annotation,
  address: Address | null,
) {
  const s = annotation.sourceLocator;
  if (!s) return '来源未提供可定位地址，引用内容已完整保留。';
  if (address?.endpoint !== s.endpoint || address.sessionId !== s.sessionId)
    return '来源属于另一个会话，请先打开原会话。';
  const article = [
    ...document.querySelectorAll<HTMLElement>('[data-message-id]'),
  ].find(
    (el) => el.dataset.messageId === s.itemId && el.dataset.turnId === s.turnId,
  );
  const text = article?.querySelector<HTMLElement>('[data-annotation-text]');
  if (!text) return '来源尚未加载或已不可用，请先加载更早消息。';
  if (!sourceMatches(annotation, text.textContent || ''))
    return '原文已变化，无法准确定位。批注仍保留捕获时的引用。';
  // Walk text nodes so Markdown formatting and repeated excerpts keep exact UTF-16 offsets.
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0,
    started = false,
    node: Node | null;
  while ((node = walker.nextNode())) {
    const end = offset + (node.textContent || '').length;
    if (!started && s.start <= end) {
      range.setStart(node, s.start - offset);
      started = true;
    }
    if (started && s.end <= end) {
      range.setEnd(node, s.end - offset);
      break;
    }
    offset = end;
  }
  if (!started || !node) return '原文已变化，无法准确定位。';
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  article!.scrollIntoView({
    block: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth',
  });
  return '';
}

function AnnotationEditor({
  annotation,
  onSave,
  onClose,
  creating = false,
  address,
  onRemove,
}: {
  annotation: Annotation;
  onSave: (annotation: Annotation) => void;
  onClose: () => void;
  creating?: boolean;
  address?: Address | null;
  onRemove?: () => void;
}) {
  const [comment, setComment] = useState(annotation.comment);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return createPortal(
    <Dialog title={creating ? '添加批注' : '编辑批注'} onClose={onClose}>
      <div className="annotation-source-label">
        {annotation.source} · 原文引用
      </div>
      <blockquote className="annotation-excerpt">
        {annotation.excerpt}
      </blockquote>
      {!creating && (
        <button
          type="button"
          className="annotation-source-link"
          onClick={() => {
            const result = revealAnnotation(annotation, address || null);
            if (result) setNotice(result);
            else onClose();
          }}
        >
          定位原文
        </button>
      )}
      {notice && (
        <p className="annotation-notice" role="status">
          {notice}
        </p>
      )}
      <label className="annotation-comment-label" htmlFor="annotation-comment">
        批注 <span>可选</span>
      </label>
      <textarea
        ref={input}
        id="annotation-comment"
        autoFocus
        rows={3}
        maxLength={100000}
        value={comment}
        placeholder="对这段文字有什么想法？"
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="dialog-actions annotation-editor-actions">
        {onRemove && (
          <button type="button" onClick={onRemove}>
            删除批注
          </button>
        )}
        <button type="button" className="secondary-button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onSave({ ...annotation, comment })}
        >
          {creating ? '添加到消息' : '保存批注'}
        </button>
      </div>
    </Dialog>,
    document.body,
  );
}

export function AnnotationCapture({
  address,
  onAdd,
  children,
}: {
  address: Address | null;
  onAdd: (annotation: Annotation) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [capture, setCapture] = useState<{
    annotation: Annotation;
    x: number;
    y: number;
  } | null>(null);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    function readSelection() {
      if (editing || !address) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setCapture(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const container =
        range.startContainer.nodeType === 1
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const text = container?.closest<HTMLElement>('[data-annotation-text]');
      const article = text?.closest<HTMLElement>('[data-message-id]');
      if (
        !text ||
        !article ||
        !root.current?.contains(text) ||
        !text.contains(range.endContainer)
      ) {
        setCapture(null);
        return;
      }
      const excerpt = range.toString();
      if (!excerpt.trim()) {
        setCapture(null);
        return;
      }
      if (excerpt.length > 100000) {
        setCapture(null);
        setNotice('选中文本过长，请分段添加批注。');
        return;
      }
      const before = range.cloneRange();
      before.selectNodeContents(text);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const kind = article.dataset.messageKind as AnnotationSource['kind'];
      if (!['user', 'assistant', 'narration'].includes(kind)) return;
      const rect = range.getBoundingClientRect();
      setCapture({
        annotation: {
          id: crypto.randomUUID(),
          excerpt,
          comment: '',
          source: kind === 'user' ? '你的消息' : '回复',
          sourceLocator: {
            ...address,
            itemId: article.dataset.messageId!,
            turnId: article.dataset.turnId!,
            kind,
            start,
            end: start + excerpt.length,
            fingerprint: textFingerprint(text.textContent || ''),
          },
        },
        x: Math.max(12, Math.min(rect.left, window.innerWidth - 130)),
        y: Math.max(8, rect.top - 42),
      });
      setNotice('');
    }
    document.addEventListener('selectionchange', readSelection);
    window.addEventListener('resize', readSelection);
    window.addEventListener('scroll', readSelection, true);
    return () => {
      document.removeEventListener('selectionchange', readSelection);
      window.removeEventListener('resize', readSelection);
      window.removeEventListener('scroll', readSelection, true);
    };
  }, [address?.endpoint, address?.sessionId, editing]);
  return (
    <div className="annotation-capture" ref={root}>
      {children}
      {notice && (
        <p className="annotation-notice" role="status">
          {notice}
        </p>
      )}
      {capture &&
        !editing &&
        createPortal(
          <button
            type="button"
            className="annotation-selection-button"
            style={{ left: capture.x, top: capture.y }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEditing(capture.annotation);
              setCapture(null);
            }}
          >
            <AnnotationIcon size={14} />
            添加批注
          </button>,
          document.body,
        )}
      {editing && (
        <AnnotationEditor
          annotation={editing}
          creating
          onClose={() => setEditing(null)}
          onSave={(a) => {
            onAdd(a);
            setEditing(null);
            setCapture(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      )}
    </div>
  );
}

export function AnnotationList({
  annotations,
  address,
  onEdit,
  onRemove,
  onRevealed,
}: {
  annotations: Annotation[];
  address: Address | null;
  onEdit?: (a: Annotation) => void;
  onRemove?: (id: string) => void;
  onRevealed?: () => void;
}) {
  const [notice, setNotice] = useState('');
  return (
    <div className="annotation-list">
      {annotations.map((a, i) => (
        <div className="annotation-entry" key={a.id}>
          <div className="annotation-entry-heading">
            <span>
              <AnnotationIcon size={13} />
              批注 {i + 1}
            </span>
            <div>
              {onEdit && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`编辑批注 ${i + 1}`}
                  onClick={() => onEdit(a)}
                >
                  <Pencil size={13} />
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`删除批注 ${i + 1}`}
                  onClick={() => onRemove(a.id)}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
          <blockquote>{a.excerpt}</blockquote>
          {a.comment && <p className="annotation-comment">{a.comment}</p>}
          <button
            type="button"
            className="annotation-source-link"
            onClick={() => {
              const result = revealAnnotation(a, address);
              setNotice(result);
              if (!result) onRevealed?.();
            }}
          >
            定位原文
          </button>
        </div>
      ))}
      {notice && (
        <p className="annotation-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

export function ComposerAnnotations({
  annotations,
  address,
  onSave,
  onRemove,
}: {
  annotations: Annotation[];
  address: Address | null;
  onSave: (a: Annotation) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Annotation | null>(null);
  useEffect(() => {
    setOpen(false);
    setEditing(null);
  }, [address?.endpoint, address?.sessionId]);
  if (!annotations.length) return null;
  return (
    <div className="composer-annotations">
      <button
        type="button"
        className="annotation-badge"
        onClick={() =>
          annotations.length === 1 ? setEditing(annotations[0]) : setOpen(true)
        }
      >
        <AnnotationIcon size={14} />
        批注 <span>{annotations.length}</span>
      </button>
      {open &&
        !editing &&
        createPortal(
          <Dialog
            title={`批注 · ${annotations.length}`}
            onClose={() => setOpen(false)}
          >
            <AnnotationList
              annotations={annotations}
              address={address}
              onEdit={setEditing}
              onRemove={onRemove}
              onRevealed={() => setOpen(false)}
            />
          </Dialog>,
          document.body,
        )}
      {editing && (
        <AnnotationEditor
          key={editing.id}
          annotation={editing}
          address={address}
          onRemove={() => {
            onRemove(editing.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            onSave(a);
            setEditing(null);
          }}
        />
      )}
      {annotations.length === 1 && (
        <button
          type="button"
          className="icon-button"
          aria-label="删除批注 1"
          onClick={() => onRemove(annotations[0].id)}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
