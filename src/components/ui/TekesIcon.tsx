import type { CSSProperties, ComponentPropsWithoutRef } from 'react';
import { sharedIconNames } from '../../icons/tool-assets';
// Vite resolves local artwork at build time. Node/SSR uses the public shared fallback.
const local: Record<string, string> = import.meta.env
  ? import.meta.glob('../../icons/local/*.svg', {
      eager: true,
      query: '?url',
      import: 'default',
    })
  : {};
const localURLs = Object.fromEntries(
  Object.entries(local).map(([path, url]) => [
    path.split('/').at(-1)!.replace('.svg', ''),
    url,
  ]),
);
export function TekesIcon({
  name,
  size = 15,
  role,
  className = '',
  style,
  ...props
}: Omit<ComponentPropsWithoutRef<'span'>, 'role'> & {
  name: string;
  size?: number;
  role?: string;
}) {
  const shared = sharedIconNames.some((value) => value === name);
  const url = shared ? `/tekes-icons/defaults/${name}.svg` : localURLs[name];
  const fallback = '/tekes-icons/defaults/tekes-provider.svg';
  return (
    <span
      className={`tekes-icon ${className}`}
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
      data-tool-role={role}
      data-icon-source="tekesui"
      data-icon-name={url ? name : 'tekes-provider'}
      data-icon-requested={name}
      data-icon-fallback={!url || undefined}
      style={
        {
          width: size,
          height: size,
          '--tekes-icon-url': `url("${url || fallback}")`,
          ...style,
        } as CSSProperties
      }
    />
  );
}
