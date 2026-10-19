import type {
  ComposerAnnotation,
  TranscriptAnnotationSource,
} from '@tekesagentkit/client-contract';
export { annotationLimit } from '@tekesagentkit/client-contract';
import { annotationLimit } from '@tekesagentkit/client-contract';

export type AnnotationSource = TranscriptAnnotationSource;
export type Annotation = ComposerAnnotation;
export function textFingerprint(text: string) {
  // Change detection only; never an authorization or integrity proof.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}
export function isAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Annotation,
    s = a.sourceLocator;
  return (
    typeof a.id === 'string' &&
    !!a.id &&
    typeof a.excerpt === 'string' &&
    !!a.excerpt.trim() &&
    a.excerpt.length <= 100_000 &&
    typeof a.comment === 'string' &&
    a.comment.length <= 100_000 &&
    typeof a.source === 'string' &&
    !!a.source &&
    (!s ||
      (['endpoint', 'sessionId', 'itemId', 'turnId', 'fingerprint'].every(
        (k) =>
          typeof s[k as keyof AnnotationSource] === 'string' &&
          !!s[k as keyof AnnotationSource],
      ) &&
        ['user', 'assistant', 'narration'].includes(s.kind) &&
        Number.isSafeInteger(s.start) &&
        Number.isSafeInteger(s.end) &&
        s.start >= 0 &&
        s.end > s.start &&
        s.end - s.start === a.excerpt.length))
  );
}
export function sourceMatches(annotation: Annotation, text: string) {
  const s = annotation.sourceLocator;
  return (
    !!s &&
    textFingerprint(text) === s.fingerprint &&
    text.slice(s.start, s.end) === annotation.excerpt
  );
}

export class AnnotationDraftStore {
  private drafts = new Map<string, Annotation[]>();
  constructor(
    private storage?: Pick<
      Storage,
      'getItem' | 'setItem' | 'removeItem'
    > | null,
  ) {}
  get(key: string) {
    if (!this.drafts.has(key)) {
      try {
        const saved: unknown = JSON.parse(
          this.storage?.getItem(`tekes.web.annotations:${key}`) || '[]',
        );
        const restored = Array.isArray(saved)
          ? saved.map((value) => {
              if (isAnnotation(value)) return value;
              // One-time migration of pre-contract browser drafts. Never a prompt encoding.
              if (value && typeof value.source === 'object') {
                const migrated = {
                  ...value,
                  source: value.source.kind === 'user' ? '你的消息' : '回复',
                  sourceLocator: value.source,
                };
                if (isAnnotation(migrated)) return migrated;
              }
              return null;
            })
          : [];
        this.drafts.set(
          key,
          Array.isArray(saved) &&
            saved.length <= annotationLimit &&
            restored.every(isAnnotation)
            ? restored
            : [],
        );
      } catch {
        this.drafts.set(key, []);
      }
    }
    return this.drafts.get(key) || [];
  }
  set(key: string, annotations: Annotation[]) {
    this.drafts.set(key, annotations);
    try {
      if (annotations.length)
        this.storage?.setItem(
          `tekes.web.annotations:${key}`,
          JSON.stringify(annotations),
        );
      else this.storage?.removeItem(`tekes.web.annotations:${key}`);
    } catch {
      /* Draft remains available in memory when browser storage is full. */
    }
  }
  acknowledge(key: string, submitted: Annotation[]) {
    this.set(
      key,
      this.get(key).filter(
        (current) =>
          !submitted.some(
            (old) => JSON.stringify(old) === JSON.stringify(current),
          ),
      ),
    );
  }
}
