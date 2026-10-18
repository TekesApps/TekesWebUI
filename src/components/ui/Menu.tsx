import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';

/** Shared menu behavior: roving focus, typeahead, dismissal and viewport collision. */
export function Menu({
  trigger,
  children,
  label,
  side = 'bottom',
  align = 'end',
  wide = false,
}: {
  trigger: ReactElement;
  children: ReactNode;
  label: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  wide?: boolean;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <span className="ui-menu-anchor" ref={anchor}>
      <Dropdown.Root
        modal={false}
        onOpenChange={() =>
          setContainer(anchor.current?.closest('dialog') || null)
        }
      >
        <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
        <Dropdown.Portal container={container}>
          <Dropdown.Content
            className={`ui-menu ${wide ? 'ui-menu-wide' : ''}`}
            aria-label={label}
            side={side}
            align={align}
            sideOffset={8}
            collisionPadding={12}
          >
            {children}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </span>
  );
}
export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="ui-menu-label">{children}</Dropdown.Label>;
}
export function MenuSeparator() {
  return <Dropdown.Separator className="ui-menu-separator" />;
}
export function MenuItem({
  children,
  description,
  icon,
  onSelect,
  disabled,
  selected,
  danger = false,
}: {
  children: ReactNode;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  selected?: boolean;
  danger?: boolean;
}) {
  const content = (
    <>
      {icon && <span className="ui-menu-icon">{icon}</span>}
      <span className="ui-menu-copy">
        <span>{children}</span>
        {description && <small>{description}</small>}
      </span>
      {selected && <Check size={15} className="ui-menu-check" />}
    </>
  );
  return selected !== undefined ? (
    <Dropdown.CheckboxItem
      className="ui-menu-item"
      checked={selected}
      disabled={disabled}
      onSelect={onSelect}
    >
      {content}
    </Dropdown.CheckboxItem>
  ) : (
    <Dropdown.Item
      className={`ui-menu-item ${danger ? 'ui-menu-danger' : ''}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      {content}
    </Dropdown.Item>
  );
}
export function MenuSub({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger className="ui-menu-item">
        <span className="ui-menu-copy">{label}</span>
        <ChevronRight size={14} />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent
        className="ui-menu"
        sideOffset={6}
        collisionPadding={12}
      >
        {children}
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
export function ChoiceMenu({
  label,
  value,
  options,
  onChange,
  disabled,
  icon,
  className = '',
  side = 'top',
}: {
  label: string;
  value: string;
  options: { value: string; label: string; description?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
  side?: 'top' | 'bottom';
}) {
  return (
    <Menu
      label={label}
      side={side}
      wide={options.some((o) => !!o.description)}
      trigger={
        <button
          type="button"
          className={`ui-choice ${className}`}
          aria-label={label}
          disabled={disabled}
        >
          {icon}
          <span>{options.find((o) => o.value === value)?.label || label}</span>
          <ChevronDown size={12} />
        </button>
      }
    >
      <MenuLabel>{label}</MenuLabel>
      <Dropdown.RadioGroup value={value} onValueChange={onChange}>
        {options.map((option) => (
          <Dropdown.RadioItem
            className="ui-menu-item"
            key={option.value}
            value={option.value}
          >
            <span className="ui-menu-copy">
              <span>{option.label}</span>
              {option.description && <small>{option.description}</small>}
            </span>
            <Dropdown.ItemIndicator className="ui-menu-check">
              <Check size={15} />
            </Dropdown.ItemIndicator>
          </Dropdown.RadioItem>
        ))}
      </Dropdown.RadioGroup>
    </Menu>
  );
}
