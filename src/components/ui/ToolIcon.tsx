import { toolRole } from '../../transcript';
import { toolIcons } from '../../icons/tool-assets';
import { TekesIcon } from './TekesIcon';
export { toolIcons } from '../../icons/tool-assets';
export function ToolIcon({ name }: { name: string }) {
  const role = toolRole(name);
  return <TekesIcon name={toolIcons[role]} role={role} />;
}
