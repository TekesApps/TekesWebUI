# Chinese and English

TekesWebUI supports Simplified Chinese (`zh-CN`) and English (`en`). First launch
uses the browser language (Chinese variants select Chinese; other languages use
English). The language menu is available before connecting and in connection
settings. A manual choice is stored in browser preferences and survives reload.
Changing language updates the document language, interface, accessibility labels,
menus, dates, status groups and input controls without reconnecting the service.

Locale belongs to Web only. No locale preference is sent to AgentKit or Harnesses.
Messages, user titles, quotes, annotation comments, paths, model/preset names, tool
arguments/results and other Harness-provided content keep their original text.
Starter prompt suggestions use the selected language only when explicitly chosen.

`src/i18n.ts` translates interface source keys using `src/locales/en.json`. Chinese
source copy is the Chinese catalog. Use `t` only for interface copy, with numbered
placeholders for values; never translate a message body or tool output. Public
AgentKit action labels and known reasons are translated at the Web presentation
boundary without recreating their action catalog, order or capability policy.
Unknown extension labels remain as supplied.

Module-level label maps retain their source keys; translate them when rendering
so language changes take effect immediately. Memoized message chrome subscribes
to locale changes while keeping the captured content unchanged. Tests check every
static translation call has English copy and identical placeholder identities.
