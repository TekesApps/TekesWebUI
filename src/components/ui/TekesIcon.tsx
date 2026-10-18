import type { CSSProperties, ComponentPropsWithoutRef } from 'react';
import { getIconUrl, type IconName } from '@tekesui/icons';
export function TekesIcon({
  name,
  size = 15,
  role,
  className = '',
  style,
  ...props
}: Omit<ComponentPropsWithoutRef<'span'>, 'role'> & {
  name: IconName;
  size?: number;
  role?: string;
}) {
  const url = getIconUrl(name);
  return (
    <span
      className={`tekes-icon ${className}`}
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
      data-tool-role={role}
      data-icon-source="tekesui"
      data-icon-name={name}
      data-icon-requested={name}
      style={
        {
          width: size,
          height: size,
          '--tekes-icon-url': `url("${url}")`,
          ...style,
        } as CSSProperties
      }
    />
  );
}
