export type HarnessSettingValue = string | number | boolean | string[] | null;
export interface HarnessSettingField {
  path: string[];
  label: string;
  description: string;
  kind:
    | 'string'
    | 'boolean'
    | 'number'
    | 'integer'
    | 'stringList'
    | 'enum'
    | 'unavailable';
  value: HarnessSettingValue;
  overridden: boolean;
  writable: boolean;
  options?: string[];
  minimum?: number;
  maximum?: number;
}
export interface HarnessSettingNamespace {
  id: string;
  title: string;
  applies: string;
  revision: number | null;
  readOnlyReason: string | null;
  fields: HarnessSettingField[];
}
export interface HarnessSettingsSnapshot {
  endpointId: string;
  connectionEpoch: number;
  namespaces: HarnessSettingNamespace[];
}
export interface HarnessSettingsMutation {
  connectionEpoch: number;
  namespace: string;
  expectedRevision: number;
  changes: (
    | { path: string[]; value: Exclude<HarnessSettingValue, null> }
    | { path: string[]; unset: true }
  )[];
}
