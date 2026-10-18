import type { ComponentPropsWithoutRef } from 'react';
import { interfaceIcons } from '../../icons/interface-assets';
import { TekesIcon } from './TekesIcon';
type Props = Omit<ComponentPropsWithoutRef<'span'>, 'role'> & { size?: number };
function icon(slot: keyof typeof interfaceIcons) {
  return function Icon(props: Props) {
    return <TekesIcon {...props} name={interfaceIcons[slot]} />;
  };
}
export const ArrowDown = icon('ArrowDown'),
  ArrowUp = icon('ArrowUp'),
  Archive = icon('Archive'),
  Check = icon('Check'),
  ChevronDown = icon('ChevronDown'),
  ChevronRight = icon('ChevronRight'),
  Folder = icon('Folder'),
  FolderOpen = icon('FolderOpen'),
  LoaderCircle = icon('LoaderCircle'),
  LockKeyhole = icon('LockKeyhole'),
  Menu = icon('Menu'),
  MoreHorizontal = icon('MoreHorizontal'),
  Pencil = icon('Pencil'),
  Sparkles = icon('Sparkles'),
  X = icon('X'),
  Plus = icon('Plus'),
  SlidersHorizontal = icon('SlidersHorizontal'),
  Settings2 = icon('Settings2'),
  CircleHelp = icon('CircleHelp'),
  Brain = icon('Brain'),
  FileText = icon('FileText'),
  Square = icon('Square'),
  AlertCircle = icon('AlertCircle'),
  Info = icon('Info'),
  ShieldCheck = icon('ShieldCheck'),
  MessageCircleQuestion = icon('MessageCircleQuestion'),
  Copy = icon('Copy'),
  AnnotationIcon = icon('Annotation');

export const Search = icon('Search');
