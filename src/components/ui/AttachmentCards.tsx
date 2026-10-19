import { t } from '../../i18n';
import { FileText } from './Icons';
import type { Json } from '../../types';
import { byteSize } from '../../composer';
export function AttachmentCards({ attachments }: { attachments: Json[] }) {
  return (
    <div className="transcript-attachments">
      {attachments.map((part, index) => {
        const value =
          part && typeof part === 'object' && !Array.isArray(part) ? part : {};
        const nested = value.attachment || value.file;
        const metadata =
          nested && typeof nested === 'object' && !Array.isArray(nested)
            ? nested
            : value;
        const name =
          typeof metadata.name === 'string'
            ? metadata.name
            : value.type === 'image'
              ? t('图片附件')
              : t('文件附件');
        return (
          <div className="transcript-attachment" key={index}>
            <FileText size={18} />
            <span>
              <strong>{name}</strong>
              {typeof metadata.bytes === 'number' && (
                <small>{byteSize(metadata.bytes)}</small>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
