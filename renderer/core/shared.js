// Спільні чисті модулі (shared/*.js, UMD → window.KH), реекспорт для ESM.
export const ts = window.KH.textStructure;
export const preserveStructure = ts.preserveStructure;
export const tokensOf = ts.tokensOf;
export const validateTokens = ts.validateTokens;
export const tokenIssueText = ts.tokenIssueText;
export const segmentByTokens = ts.segmentByTokens;
export const autoFixStructure = ts.autoFixStructure;
export const syncPaddingFromEn = ts.syncPaddingFromEn;
export const LETTER_RE = ts.LETTER_RE;
export const tsvFormat = window.KH.tsv;
export const kh1OutRel = ts.kh1OutRel;
