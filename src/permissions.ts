import type {
  PermissionPolicy,
  PermissionOption,
  PermissionModeState,
} from '@tekesagentkit/client-contract';
import { t } from './i18n';
export type { PermissionPolicy, PermissionOption, PermissionModeState };
export function permissionTitle(option: PermissionOption): string {
  const titles: Record<string, string> = {
    'read-only': '只读',
    'workspace-write': '工作区可写',
    'danger-full-access': '完整访问',
    'allow-tools': '允许工具',
    'ask-tools': '每次工具调用询问',
    'deny-tools': '禁止工具',
  };
  return titles[option.value]
    ? t(titles[option.value])
    : option.title || option.value;
}
export function validatePermissions(
  policy: PermissionPolicy,
  mode: string | null,
): void {
  if (
    !Array.isArray(policy?.threadLevel) ||
    !Array.isArray(policy?.serverLevel?.options)
  )
    throw new Error(t('Harness 返回了无效的权限配置'));
  for (const options of [policy.threadLevel, policy.serverLevel.options]) {
    if (
      options.some((o) => !o || typeof o.value !== 'string' || !o.value) ||
      new Set(options.map((o) => o.value)).size !== options.length
    )
      throw new Error(t('Harness 返回了无效的权限配置'));
  }
  if (
    policy.serverLevel.currentValue !== null &&
    !policy.serverLevel.options.some(
      (o) => o.value === policy.serverLevel.currentValue,
    )
  )
    throw new Error(t('Harness 返回了未知的权限模式'));
  if (
    mode !== null &&
    (typeof mode !== 'string' ||
      !(
        policy.threadLevel.length
          ? policy.threadLevel
          : policy.serverLevel.options
      ).some((o) => o.value === mode))
  )
    throw new Error(t('Harness 返回了未知的权限模式'));
}
